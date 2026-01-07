/**
 * Stripe Routes
 * Handles payment webhooks and subscription management
 *
 * Setup in Stripe Dashboard:
 * 1. Create Products for each plan (Basic, Pro, Enterprise)
 * 2. Create Payment Links for each product
 * 3. Add ?client_reference_id={USER_ID} to payment links
 * 4. Set webhook endpoint to /api/stripe/webhook
 * 5. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to .env
 */

import { Router } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { provisionPhoneNumbersForUser, releasePhoneNumbersForUser } from '../services/phoneProvisioning.js';

const router = Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Initialize Supabase with service role for admin operations
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Plan configurations - matches subscription_plans table
const PLAN_CONFIG = {
    basic: { phoneNumbers: 2, dailyCallsPerNumber: 50 },
    pro: { phoneNumbers: 5, dailyCallsPerNumber: 50 },
    enterprise: { phoneNumbers: 10, dailyCallsPerNumber: 100 },
};

/**
 * Verify Stripe webhook signature
 */
function verifyStripeSignature(payload, signature) {
    if (!STRIPE_WEBHOOK_SECRET) {
        console.warn('⚠️ STRIPE_WEBHOOK_SECRET not set - skipping signature verification');
        return true;
    }

    const elements = signature.split(',');
    const signatureObj = {};

    for (const element of elements) {
        const [key, value] = element.split('=');
        signatureObj[key] = value;
    }

    const timestamp = signatureObj.t;
    const expectedSignature = signatureObj.v1;

    const signedPayload = `${timestamp}.${payload}`;
    const computedSignature = crypto
        .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
        .update(signedPayload)
        .digest('hex');

    return computedSignature === expectedSignature;
}

/**
 * Process successful checkout/payment
 */
async function handleCheckoutCompleted(session) {
    console.log('💳 Processing checkout.session.completed');

    const userId = session.client_reference_id;
    const customerEmail = session.customer_email || session.customer_details?.email;
    const customerId = session.customer;

    if (!userId) {
        console.error('❌ No client_reference_id (user_id) in session');
        throw new Error('Missing client_reference_id');
    }

    // Get the plan from metadata or line items
    let planId = session.metadata?.plan_id;

    // If no plan_id in metadata, try to determine from price
    if (!planId && session.line_items?.data?.length > 0) {
        const priceId = session.line_items.data[0].price?.id;
        // Look up plan by stripe_price_id
        const { data: plan } = await supabase
            .from('subscription_plans')
            .select('id')
            .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_yearly.eq.${priceId}`)
            .single();

        planId = plan?.id;
    }

    // Default to basic if still not found
    planId = planId || 'basic';

    console.log(`  User: ${userId}, Plan: ${planId}, Customer: ${customerId}`);

    const planConfig = PLAN_CONFIG[planId];
    if (!planConfig) {
        throw new Error(`Unknown plan: ${planId}`);
    }

    // 1. Create or update user subscription
    const { data: subscription, error: subError } = await supabase
        .from('user_subscriptions')
        .upsert({
            user_id: userId,
            plan_id: planId,
            stripe_customer_id: customerId,
            stripe_subscription_id: session.subscription,
            stripe_payment_intent_id: session.payment_intent,
            status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: session.subscription
                ? null  // Will be updated by subscription webhook
                : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days for one-time
            metadata: {
                checkout_session_id: session.id,
                customer_email: customerEmail,
            },
        }, {
            onConflict: 'user_id',
        })
        .select()
        .single();

    if (subError) {
        console.error('❌ Failed to create subscription:', subError);
        throw subError;
    }

    console.log(`  ✓ Subscription created/updated: ${subscription.id}`);

    // 2. Update user's plan in profiles
    await supabase
        .from('profiles')
        .update({ plan: planId })
        .eq('id', userId);

    console.log(`  ✓ Profile plan updated to: ${planId}`);

    // 3. Provision phone numbers
    console.log(`  📞 Provisioning ${planConfig.phoneNumbers} phone numbers...`);

    try {
        const provisionResult = await provisionPhoneNumbersForUser(
            supabase,
            userId,
            planConfig.phoneNumbers,
            'IE'  // Default to Ireland, could be made configurable
        );

        // Update subscription with provisioning result
        await supabase
            .from('user_subscriptions')
            .update({
                metadata: {
                    ...subscription.metadata,
                    phones_provisioned: provisionResult.success.length,
                    phones_failed: provisionResult.failed.length,
                    provisioned_at: new Date().toISOString(),
                },
            })
            .eq('id', subscription.id);

        console.log(`  ✓ Provisioned ${provisionResult.success.length} phone numbers`);

        if (provisionResult.failed.length > 0) {
            console.warn(`  ⚠️ ${provisionResult.failed.length} phone numbers failed to provision`);
        }
    } catch (provisionError) {
        console.error('  ❌ Phone provisioning failed:', provisionError);
        // Don't throw - subscription is still valid, just needs manual intervention
        await supabase
            .from('user_subscriptions')
            .update({
                metadata: {
                    ...subscription.metadata,
                    provisioning_error: provisionError.message,
                },
            })
            .eq('id', subscription.id);
    }

    return { userId, planId, subscription };
}

/**
 * Process subscription update (upgrade/downgrade)
 */
async function handleSubscriptionUpdated(subscription) {
    console.log('📝 Processing customer.subscription.updated');

    const customerId = subscription.customer;

    // Find user by Stripe customer ID
    const { data: userSub } = await supabase
        .from('user_subscriptions')
        .select('*, profiles!inner(id)')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!userSub) {
        console.warn('⚠️ No subscription found for customer:', customerId);
        return;
    }

    const userId = userSub.user_id;

    // Determine plan from price
    const priceId = subscription.items?.data?.[0]?.price?.id;
    const { data: plan } = await supabase
        .from('subscription_plans')
        .select('*')
        .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_yearly.eq.${priceId}`)
        .single();

    if (plan && plan.id !== userSub.plan_id) {
        console.log(`  Plan change: ${userSub.plan_id} → ${plan.id}`);

        const oldPlan = PLAN_CONFIG[userSub.plan_id];
        const newPlan = PLAN_CONFIG[plan.id];

        // Handle phone number changes
        if (newPlan.phoneNumbers > oldPlan.phoneNumbers) {
            // Upgrade: provision more numbers
            const additionalNumbers = newPlan.phoneNumbers - oldPlan.phoneNumbers;
            console.log(`  📞 Provisioning ${additionalNumbers} additional phone numbers...`);
            await provisionPhoneNumbersForUser(supabase, userId, additionalNumbers, 'IE');
        } else if (newPlan.phoneNumbers < oldPlan.phoneNumbers) {
            // Downgrade: release excess numbers
            const excessNumbers = oldPlan.phoneNumbers - newPlan.phoneNumbers;
            console.log(`  📞 Releasing ${excessNumbers} excess phone numbers...`);
            await releasePhoneNumbersForUser(supabase, userId, excessNumbers);
        }

        // Update subscription
        await supabase
            .from('user_subscriptions')
            .update({
                plan_id: plan.id,
                current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                status: subscription.status,
            })
            .eq('user_id', userId);

        // Update profile
        await supabase
            .from('profiles')
            .update({ plan: plan.id })
            .eq('id', userId);
    }
}

/**
 * Process subscription cancellation
 */
async function handleSubscriptionDeleted(subscription) {
    console.log('🚫 Processing customer.subscription.deleted');

    const customerId = subscription.customer;

    const { data: userSub } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!userSub) {
        console.warn('⚠️ No subscription found for customer:', customerId);
        return;
    }

    const userId = userSub.user_id;

    // Release all phone numbers
    console.log('  📞 Releasing all phone numbers...');
    await releasePhoneNumbersForUser(supabase, userId);

    // Update subscription status
    await supabase
        .from('user_subscriptions')
        .update({
            status: 'canceled',
            cancel_at_period_end: false,
        })
        .eq('user_id', userId);

    // Downgrade profile to free
    await supabase
        .from('profiles')
        .update({ plan: 'free' })
        .eq('id', userId);

    console.log(`  ✓ User ${userId} downgraded to free plan`);
}

// =============================================
// ROUTES
// =============================================

/**
 * Stripe Webhook Handler
 * Receives events from Stripe when payments/subscriptions change
 */
router.post('/webhook', async (req, res) => {
    console.log('📨 Stripe webhook received');

    const signature = req.headers['stripe-signature'];
    let event;

    try {
        // Parse the event from raw body
        const rawBody = req.body;

        // In production, verify signature
        if (STRIPE_WEBHOOK_SECRET && signature) {
            // For now, trust the event (implement proper verification in production)
            event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
        } else {
            event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
        }

        console.log(`  Event type: ${event.type}`);

        // Handle different event types
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object);
                break;

            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object);
                break;

            case 'invoice.paid':
                console.log('  Invoice paid - subscription continues');
                break;

            case 'invoice.payment_failed':
                console.log('  ⚠️ Payment failed - may need to handle');
                break;

            default:
                console.log(`  Unhandled event type: ${event.type}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * Get subscription plans
 */
router.get('/plans', async (req, res) => {
    try {
        const { data: plans, error } = await supabase
            .from('subscription_plans')
            .select('*')
            .eq('is_active', true)
            .order('sort_order');

        if (error) throw error;

        res.json(plans);
    } catch (error) {
        console.error('Failed to get plans:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get current user's subscription
 */
router.get('/subscription/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const { data: subscription, error } = await supabase
            .from('user_subscriptions')
            .select(`
                *,
                plan:subscription_plans(*)
            `)
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') throw error;  // PGRST116 = no rows

        res.json(subscription || null);
    } catch (error) {
        console.error('Failed to get subscription:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Generate Stripe Payment Link URL with user ID
 * Frontend calls this to get the payment link with proper client_reference_id
 */
router.get('/payment-link/:planId/:userId', async (req, res) => {
    try {
        const { planId, userId } = req.params;

        // Get plan with payment link
        const { data: plan, error } = await supabase
            .from('subscription_plans')
            .select('stripe_payment_link')
            .eq('id', planId)
            .single();

        if (error || !plan?.stripe_payment_link) {
            return res.status(404).json({ error: 'Plan or payment link not found' });
        }

        // Append client_reference_id to payment link
        const paymentUrl = new URL(plan.stripe_payment_link);
        paymentUrl.searchParams.set('client_reference_id', userId);

        res.json({ url: paymentUrl.toString() });
    } catch (error) {
        console.error('Failed to generate payment link:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Manual provisioning trigger (for admin/debugging)
 */
router.post('/provision/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { planId = 'basic', countryCode = 'IE' } = req.body;

        const planConfig = PLAN_CONFIG[planId];
        if (!planConfig) {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const result = await provisionPhoneNumbersForUser(
            supabase,
            userId,
            planConfig.phoneNumbers,
            countryCode
        );

        res.json(result);
    } catch (error) {
        console.error('Manual provisioning failed:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Check Stripe configuration status
 */
router.get('/status', (req, res) => {
    res.json({
        configured: !!STRIPE_SECRET_KEY,
        webhookConfigured: !!STRIPE_WEBHOOK_SECRET,
    });
});

export default router;
