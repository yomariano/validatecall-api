import { timingSafeEqual } from 'node:crypto';

export function requireWebhookSecret(envName, headerName = 'x-webhook-secret') {
    return (req, res, next) => {
        const secret = process.env[envName];
        if (!secret) return res.status(503).json({ error: 'Webhook authentication is not configured' });
        const supplied = req.headers[headerName];
        if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) {
            return res.status(401).json({ error: 'Invalid webhook credentials' });
        }
        next();
    };
}
