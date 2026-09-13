import { findSession } from '../services/sessions.js';

const publicRoutes = new Set([
    'GET /stripe/plans', 'GET /billing/plans',
    'POST /stripe/webhook', 'POST /billing/webhook',
    'POST /resend/webhook', 'POST /vapi/webhook', 'POST /email/inbound',
    'GET /email-tracking/open', 'GET /email-tracking/click',
    'GET /email-tracking/unsubscribe', 'POST /email-tracking/unsubscribe',
]);

// User IDs are selectors, never credentials. Validate every supplied identity,
// including nested payloads, before any service-role database operation.
export function hasForeignIdentity(value, userId) {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, item]) => {
        if (['userId', 'user_id', 'adminUserId'].includes(key)) return item != null && item !== userId;
        return hasForeignIdentity(item, userId);
    });
}

export function createApiAuth(getSession = findSession) {
    return async (req, res, next) => {
        if (publicRoutes.has(`${req.method} ${req.path}`)) return next();
        try {
            const session = await getSession(req);
            if (!session) return res.status(401).json({ error: 'Authentication required' });
            req.user = session.user;
            req.session = session;
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
                if (req.headers['x-csrf-token'] !== session.csrfToken) return res.status(403).json({ error: 'Invalid request token. Refresh and try again.' });
                const origin = req.headers.origin;
                const allowed = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(url => new URL(url.trim()).origin);
                if (origin && !allowed.includes(origin)) return res.status(403).json({ error: 'Request origin is not allowed' });
            }
            const headers = [req.headers['x-user-id'], req.headers['x-admin-user-id']];
            if (headers.some(id => id != null && id !== req.user.id) ||
                hasForeignIdentity(req.body, req.user.id) || hasForeignIdentity(req.query, req.user.id)) {
                return res.status(403).json({ error: 'Access denied: User ID mismatch' });
            }
            req.headers['x-user-id'] = req.user.id;
            next();
        } catch (error) {
            console.error('Authentication unavailable:', error.message);
            res.status(503).json({ error: 'Authentication temporarily unavailable' });
        }
    };
}

export function requireOwnUser(req, res, next, userId) {
    if (!req.user || req.user.id !== userId) return res.status(403).json({ error: 'Access denied: User ID mismatch' });
    next();
}
