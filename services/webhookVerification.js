import Stripe from 'stripe';
import { Resend } from 'resend';

export function verifyStripeEvent(payload, signature, secret) {
    if (!secret || !signature || !Buffer.isBuffer(payload)) throw new Error('Missing webhook credentials or raw body');
    return new Stripe('sk_webhook_verification_only').webhooks.constructEvent(payload, signature, secret);
}

export function verifyResendEvent(payload, headers, secret) {
    if (!secret || !Buffer.isBuffer(payload)) throw new Error('Missing webhook secret or raw body');
    return new Resend('re_webhook_verification_only').webhooks.verify({
        payload: payload.toString('utf8'),
        headers: { id: headers['svix-id'], timestamp: headers['svix-timestamp'], signature: headers['svix-signature'] },
        webhookSecret: secret,
    });
}
