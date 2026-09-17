import { createHash, randomBytes } from 'node:crypto';
import { database } from '../db/database.js';

export const API_KEY_PREFIX = 'vc_live_';
export const API_SCOPES = Object.freeze([
    'data:read',
    'data:write',
    'research:write',
    'assistants:read',
    'assistants:write',
    'calls:read',
    'calls:write',
    'recordings:read',
]);

export const hashApiKey = value => createHash('sha256').update(value).digest('hex');

export function normalizeScopes(scopes) {
    if (!Array.isArray(scopes) || !scopes.length) throw Object.assign(new Error('Choose at least one API scope.'), { status: 400 });
    const unique = [...new Set(scopes)];
    if (unique.some(scope => !API_SCOPES.includes(scope))) throw Object.assign(new Error('One or more API scopes are invalid.'), { status: 400 });
    return unique;
}

function publicKey(row) {
    return {
        id: row.id,
        name: row.name,
        prefix: row.key_prefix,
        last_four: row.key_last_four,
        scopes: Array.isArray(row.scopes) ? row.scopes : [],
        rate_limit_per_minute: row.rate_limit_per_minute,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
        created_at: row.created_at,
    };
}

export async function createDeveloperKey(userId, { name, scopes, expires_at: expiresAt = null } = {}) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName || cleanName.length > 80) throw Object.assign(new Error('Give the API key a name up to 80 characters.'), { status: 400 });
    const cleanScopes = normalizeScopes(scopes);
    const { rows: active } = await database.query(`SELECT count(*)::int AS count FROM api_keys
        WHERE user_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`, [userId]);
    if (active[0].count >= 20) throw Object.assign(new Error('Revoke an existing API key before creating another.'), { status: 409 });
    let expiry = null;
    if (expiresAt != null) {
        expiry = new Date(expiresAt);
        if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) throw Object.assign(new Error('API key expiry must be in the future.'), { status: 400 });
    }
    const secret = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const { rows } = await database.query(`INSERT INTO api_keys
        (user_id,name,key_hash,key_prefix,key_last_four,scopes,expires_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
        [userId, cleanName, hashApiKey(secret), secret.slice(0,15), secret.slice(-4), JSON.stringify(cleanScopes), expiry?.toISOString() || null]);
    return { ...publicKey(rows[0]), secret };
}

export async function listDeveloperKeys(userId) {
    const { rows } = await database.query(`SELECT id,name,key_prefix,key_last_four,scopes,rate_limit_per_minute,
        last_used_at,expires_at,revoked_at,created_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC`, [userId]);
    return rows.map(publicKey);
}

export async function revokeDeveloperKey(userId, id) {
    const { rows } = await database.query(`UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now())
        WHERE id=$1 AND user_id=$2 RETURNING id,revoked_at`, [id,userId]);
    if (!rows.length) throw Object.assign(new Error('API key not found.'), { status: 404 });
    return rows[0];
}
