import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { Webhook } from 'standardwebhooks';
import { createApiAuth, requireOwnUser } from '../middleware/auth.js';
import { verifyStripeEvent, verifyResendEvent } from '../services/webhookVerification.js';
import { requireWebhookSecret } from '../middleware/webhookAuth.js';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
function appForAuth() {
    const app = express();
    app.use(express.json());
    const getSession = jest.fn(async req => req.headers.cookie === 'test-session=valid' ? { user: { id: userId }, csrfToken: 'csrf-test' } : null);
    app.use('/api', createApiAuth(getSession));
    app.param('userId', requireOwnUser);
    app.get('/api/private/:userId', (req, res) => res.json({ userId: req.user.id }));
    app.post('/api/private', (req, res) => res.json({ userId: req.user.id }));
    return { app, getSession };
}

test('requires verified sessions on localhost and in every environment', async () => {
    const { app, getSession } = appForAuth();
    await request(app).post('/api/private').set('x-user-id', userId).expect(401);
    await request(app).post('/api/private').set('Authorization', 'Bearer invalid').expect(401);
    expect(getSession).toHaveBeenCalledTimes(2);
});
test('rejects forged identities in headers, body, nested data, query and path', async () => {
    const { app } = appForAuth();
    for (const body of [{ userId: otherId }, { leads: [{ user_id: otherId }] }, { adminUserId: otherId }]) {
        await request(app).post('/api/private').set('Cookie', 'test-session=valid').set('X-CSRF-Token','csrf-test').send(body).expect(403);
    }
    await request(app).post('/api/private').set('Cookie', 'test-session=valid').set('X-CSRF-Token','csrf-test').set('x-user-id', otherId).expect(403);
    await request(app).post(`/api/private?userId=${otherId}`).set('Cookie', 'test-session=valid').set('X-CSRF-Token','csrf-test').expect(403);
    await request(app).get(`/api/private/${otherId}`).set('Cookie', 'test-session=valid').set('X-CSRF-Token','csrf-test').expect(403);
    await request(app).get(`/api/private/${userId}`).set('Cookie', 'test-session=valid').set('X-CSRF-Token','csrf-test').expect(200);
});
test('Stripe rejects unsigned, tampered and stale requests; verifies original bytes', () => {
    const payload = Buffer.from('{ "type": "checkout.session.completed", "data": {} }');
    const secret = 'whsec_test';
    const stripe = new Stripe('sk_test_example');
    const signature = stripe.webhooks.generateTestHeaderString({ payload: payload.toString(), secret });
    expect(verifyStripeEvent(payload, signature, secret).type).toBe('checkout.session.completed');
    expect(() => verifyStripeEvent(payload, signature, '')).toThrow();
    expect(() => verifyStripeEvent(Buffer.from('{}'), signature, secret)).toThrow();
    const stale = stripe.webhooks.generateTestHeaderString({ payload: payload.toString(), secret, timestamp: Math.floor(Date.now()/1000)-600 });
    expect(() => verifyStripeEvent(payload, stale, secret)).toThrow();
});
test('Resend verifies actual Svix headers and raw body, rejects malformed signatures', () => {
    const secret = 'whsec_'+Buffer.from('test secret for signed events').toString('base64');
    const payload = Buffer.from('{"type":"email.received","data":{}}');
    const date = new Date();
    const headers = { 'svix-id': 'msg_test', 'svix-timestamp': String(Math.floor(date.getTime()/1000)), 'svix-signature': new Webhook(secret).sign('msg_test', date, payload.toString()) };
    expect(verifyResendEvent(payload, headers, secret).type).toBe('email.received');
    expect(() => verifyResendEvent(Buffer.from('{}'), headers, secret)).toThrow();
    expect(() => verifyResendEvent(payload, {}, secret)).toThrow();
});
test('provider webhooks fail closed when their secret is missing', async () => {
    const app = express();
    app.post('/hook', requireWebhookSecret('TEST_WEBHOOK_SECRET'), (req, res) => res.sendStatus(200));
    delete process.env.TEST_WEBHOOK_SECRET;
    await request(app).post('/hook').expect(503);
    process.env.TEST_WEBHOOK_SECRET = 'known-test-secret';
    await request(app).post('/hook').set('x-webhook-secret', 'wrong').expect(401);
    await request(app).post('/hook').set('x-webhook-secret', 'known-test-secret').expect(200);
    delete process.env.TEST_WEBHOOK_SECRET;
});
