import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { database, getPool } from '../db/database.js';
import { createApiAuth } from '../middleware/auth.js';
import { SESSION_COOKIE, STATE_COOKIE, hashToken, randomToken, readCookie, cookieOptions, findSession, createSession } from '../services/sessions.js';

function googleClient() {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) throw new Error('Google sign-in is not configured');
    return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}
export function createAuthRouter({ getGoogleClient = googleClient } = {}) {
    const router = Router();
    router.get('/config', (req, res) => res.json({ configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI) }));
    router.get('/session', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const session = await findSession(req);
            res.json(session ? { user: session.user, csrfToken: session.csrfToken } : { user: null, csrfToken: null });
        } catch { res.status(503).json({ error: 'Sign-in is temporarily unavailable' }); }
    });
    router.get('/google', async (req, res) => {
        try {
            const client = getGoogleClient();
            const state = randomToken(); const nonce = randomToken();
            const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
            await database.query('DELETE FROM oauth_states WHERE expires_at<now()');
            await database.query(`INSERT INTO oauth_states(state_hash,verifier,nonce,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')`, [hashToken(state), codeVerifier, nonce]);
            res.cookie(STATE_COOKIE, state, cookieOptions(10*60*1000));
            res.redirect(client.generateAuthUrl({
                access_type: 'online', scope: ['openid', 'email', 'profile'], state, nonce,
                code_challenge: codeChallenge, code_challenge_method: 'S256', prompt: 'select_account',
            }));
        } catch (error) { res.status(503).json({ error: error.message }); }
    });
    router.get('/google/callback', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const state = req.query.state;
        if (typeof state !== 'string' || state !== readCookie(req, STATE_COOKIE) || typeof req.query.code !== 'string') {
            return res.status(400).send('Sign-in expired or was cancelled. Please start again.');
        }
        res.clearCookie(STATE_COOKIE, cookieOptions());
        try {
            const { rows: states } = await database.query('DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING verifier,nonce', [hashToken(state)]);
            if (!states.length) return res.status(400).send('Sign-in expired. Please start again.');
            const google = getGoogleClient();
            const { tokens } = await google.getToken({ code: req.query.code, codeVerifier: states[0].verifier });
            const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
            const identity = ticket.getPayload();
            if (!identity?.sub || !identity.email || identity.email_verified !== true || identity.nonce !== states[0].nonce) {
                return res.status(401).send('Google could not verify this sign-in.');
            }
            const connection = await getPool().connect();
            let userId;
            try {
                await connection.query('BEGIN');
                // Serialize first sign-in for a subject without trusting an email as an account-linking credential.
                await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity.sub]);
                const existing = await connection.query('SELECT user_id FROM google_identities WHERE subject=$1', [identity.sub]);
                userId = existing.rows[0]?.user_id;
                if (!userId) {
                    const profile = await connection.query('SELECT id FROM profiles WHERE lower(email)=lower($1)', [identity.email]);
                    if (profile.rows.length) throw Object.assign(new Error('Existing account needs its Google identity migrated before sign-in.'), { status: 409 });
                    const created = await connection.query('INSERT INTO profiles(email,full_name,avatar_url) VALUES($1,$2,$3) RETURNING id', [identity.email.toLowerCase(), identity.name || null, identity.picture || null]);
                    userId = created.rows[0].id;
                    await connection.query('INSERT INTO google_identities(subject,user_id) VALUES($1,$2)', [identity.sub,userId]);
                    await connection.query('INSERT INTO free_tier_usage(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [userId]);
                }
                await connection.query('COMMIT');
            } catch (error) { await connection.query('ROLLBACK'); throw error; }
            finally { connection.release(); }
            const oldToken = readCookie(req, SESSION_COOKIE);
            if (oldToken) await database.query('DELETE FROM auth_sessions WHERE token_hash=$1', [hashToken(oldToken)]);
            const { token } = await createSession(userId);
            res.cookie(SESSION_COOKIE, token, cookieOptions(7*24*60*60*1000));
            res.redirect(new URL('/dashboard', process.env.FRONTEND_URL || 'http://localhost:5173').href);
        } catch (error) {
            console.error('Google sign-in failed:', error.message);
            res.status(error.status || 502).send(error.status===409 ? error.message : 'Sign-in failed. Please start again.');
        }
    });
    router.post('/logout', createApiAuth(), async (req, res) => {
        try {
            await database.query('DELETE FROM auth_sessions WHERE token_hash=$1', [req.session.tokenHash]);
            res.clearCookie(SESSION_COOKIE, cookieOptions());
            res.json({ success: true });
        } catch { res.status(503).json({ error: 'Unable to sign out. Please try again.' }); }
    });
    return router;
}
export default createAuthRouter();
