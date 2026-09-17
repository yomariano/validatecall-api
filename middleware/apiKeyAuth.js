import { hashApiKey } from '../services/apiKeys.js';
import { database } from '../db/database.js';
import { hasForeignIdentity } from './auth.js';

const buckets = new Map();

function bearer(req) {
    const match = /^Bearer\s+(vc_live_[A-Za-z0-9_-]+)$/i.exec(req.get('authorization') || '');
    return match?.[1] || null;
}

function rateLimit(req, res, key) {
    const now = Date.now();
    const windowStart = Math.floor(now / 60000) * 60000;
    const existing = buckets.get(key.id);
    const bucket = existing?.windowStart === windowStart ? existing : { windowStart, count: 0 };
    bucket.count += 1;
    buckets.set(key.id, bucket);
    const remaining = Math.max(0, key.rate_limit_per_minute - bucket.count);
    res.set({
        'X-RateLimit-Limit': String(key.rate_limit_per_minute),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil((windowStart + 60000) / 1000)),
    });
    if (bucket.count > key.rate_limit_per_minute) {
        res.set('Retry-After', String(Math.max(1, Math.ceil((windowStart + 60000 - now) / 1000))));
        res.status(429).json({ error: { code: 'rate_limit_exceeded', message: 'API rate limit exceeded.' } });
        return false;
    }
    return true;
}

export function createApiKeyAuth() {
    return async (req, res, next) => {
        const secret = bearer(req);
        if (!secret) return res.status(401).json({ error: { code: 'invalid_api_key', message: 'Use an API key in the Authorization: Bearer header.' } });
        try {
            const { rows } = await database.query(`SELECT k.*,p.email,p.full_name,p.avatar_url,p.is_admin
                FROM api_keys k JOIN profiles p ON p.id=k.user_id
                WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now()) LIMIT 1`, [hashApiKey(secret)]);
            const key = rows[0];
            if (!key) return res.status(401).json({ error: { code: 'invalid_api_key', message: 'The API key is invalid, expired or revoked.' } });
            if (!rateLimit(req,res,key)) return;
            req.user = { id:key.user_id, email:key.email, full_name:key.full_name, avatar_url:key.avatar_url, is_admin:key.is_admin };
            req.apiKey = { id:key.id, name:key.name, scopes:Array.isArray(key.scopes)?key.scopes:[], rateLimit:key.rate_limit_per_minute };
            if (hasForeignIdentity(req.body,req.user.id) || hasForeignIdentity(req.query,req.user.id)) {
                return res.status(403).json({ error: { code: 'tenant_mismatch', message: 'User identifiers cannot select another account.' } });
            }
            await database.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [key.id]);
            next();
        } catch (error) {
            console.error('API key authentication unavailable:', error.message);
            res.status(503).json({ error: { code: 'authentication_unavailable', message: 'API authentication is temporarily unavailable.' } });
        }
    };
}

export const requireScope = (...accepted) => (req,res,next) => {
    if (!accepted.some(scope => req.apiKey?.scopes.includes(scope))) {
        return res.status(403).json({ error: { code: 'insufficient_scope', message: `This endpoint requires ${accepted.join(' or ')}.` } });
    }
    next();
};

export function resetApiRateLimitsForTests() {
    if (process.env.NODE_ENV === 'test') buckets.clear();
}
