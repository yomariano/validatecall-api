import { randomBytes, createHash } from 'node:crypto';
import { database } from '../db/database.js';

export const SESSION_COOKIE = 'validatecall_session';
export const STATE_COOKIE = 'validatecall_oauth_state';
export const hashToken = token => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export function readCookie(req, name) {
    const entry = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(name+'='));
    if (!entry) return null;
    try { return decodeURIComponent(entry.slice(name.length+1)); } catch { return null; }
}
export function cookieOptions(maxAge) {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge };
}
export async function findSession(req) {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const { rows } = await database.query(`SELECT s.token_hash, s.csrf_token, p.id, p.email, p.full_name, p.avatar_url, p.is_admin
        FROM auth_sessions s JOIN profiles p ON p.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [hashToken(token)]);
    if (!rows[0]) return null;
    const { token_hash, csrf_token, ...profile } = rows[0];
    return { tokenHash: token_hash, csrfToken: csrf_token,
        user: { ...profile, user_metadata: { full_name: profile.full_name, avatar_url: profile.avatar_url } } };
}
export async function createSession(userId) {
    const token = randomToken();
    const csrfToken = randomToken();
    await database.query(`INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')`, [hashToken(token), userId, csrfToken]);
    return { token, csrfToken };
}
