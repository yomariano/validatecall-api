/**
 * Free Tier Usage Routes
 * Tracks and enforces usage limits for free tier users
 *
 * Limits:
 * - 10 leads (lifetime)
 * - 5 calls (lifetime)
 * - 2 min max per call
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Initialize Supabase with service role for admin operations (if configured)
const supabase = supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

function ensureSupabaseConfigured({ res }) {
    if (supabase) return true;
    console.error('💥 Supabase not configured: missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
    res.status(500).json({ error: 'Supabase not configured' });
    return false;
}

/**
 * GET /api/usage/:userId
 * Get user's free tier usage stats
 */
router.get('/:userId', async (req, res) => {
    try {
        if (!ensureSupabaseConfigured({ res })) return;

        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }

        // First check if user has an active subscription
        let subscription, subscriptionError;
        try {
            const result = await supabase
                .from('user_subscriptions')
                .select('status, plan_id')
                .eq('user_id', userId)
                .eq('status', 'active')
                .limit(1)
                .maybeSingle();
            subscription = result.data;
            subscriptionError = result.error;
        } catch (queryError) {
            console.error('💥 Subscription query exception:', queryError);
            return res.status(500).json({ error: 'Failed to get usage' });
        }

        if (subscriptionError) {
            console.error('Error checking subscription:', subscriptionError);
            return res.status(500).json({ error: 'Failed to get usage' });
        }

        // If user has active subscription, return unlimited
        if (subscription) {
            return res.json({
                isFreeTier: false,
                subscription: {
                    planId: subscription.plan_id,
                    status: subscription.status
                },
                usage: null // No limits for subscribed users
            });
        }

        // Get free tier usage
        let usage, usageError;
        try {
            const result = await supabase
                .from('free_tier_usage')
                .select('*')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle();
            usage = result.data;
            usageError = result.error;
        } catch (queryError) {
            console.error('💥 Usage query exception:', queryError);
            return res.status(500).json({ error: 'Failed to get usage' });
        }

        if (usageError) {
            console.error('Error getting free tier usage:', usageError);
            return res.status(500).json({ error: 'Failed to get usage' });
        }

        // If no usage record exists, create one
        if (!usage) {
            let newUsage, createError;
            try {
                const result = await supabase
                    .from('free_tier_usage')
                    .insert({ user_id: userId })
                    .select()
                    .single();
                newUsage = result.data;
                createError = result.error;
            } catch (queryError) {
                console.error('💥 Create usage query exception:', queryError);
                return res.status(500).json({ error: 'Failed to create usage record' });
            }

            if (createError) {
                console.error('Error creating free tier usage:', createError);
                return res.status(500).json({ error: 'Failed to create usage record' });
            }
            usage = newUsage;
        }

        res.json({
            isFreeTier: true,
            subscription: null,
            usage: {
                leadsUsed: usage.leads_used,
                leadsLimit: usage.leads_limit,
                leadsRemaining: Math.max(0, usage.leads_limit - usage.leads_used),
                callsUsed: usage.calls_used,
                callsLimit: usage.calls_limit,
                callsRemaining: Math.max(0, usage.calls_limit - usage.calls_used),
                callSecondsPerCall: usage.call_seconds_per_call,
                createdAt: usage.created_at,
                updatedAt: usage.updated_at
            }
        });
    } catch (error) {
        console.error('Error getting usage:', error);
        res.status(500).json({ error: 'Failed to get usage' });
    }
});

/**
 * GET /api/usage/:userId/can-generate-leads
 * Check if user can generate more leads
 * Query params: count (optional, defaults to 1)
 */
router.get('/:userId/can-generate-leads', async (req, res) => {
    try {
        if (!ensureSupabaseConfigured({ res })) return;

        const { userId } = req.params;
        const count = parseInt(req.query.count) || 1;

        // Check for active subscription
        let subscription, subscriptionError;
        try {
            const result = await supabase
                .from('user_subscriptions')
                .select('status')
                .eq('user_id', userId)
                .eq('status', 'active')
                .limit(1)
                .maybeSingle();
            subscription = result.data;
            subscriptionError = result.error;
        } catch (queryError) {
            console.error('💥 Subscription query exception:', queryError);
            return res.status(500).json({ error: 'Failed to check limits' });
        }

        if (subscriptionError) {
            console.error('Error checking subscription:', subscriptionError);
            return res.status(500).json({ error: 'Failed to check limits' });
        }

        if (subscription) {
            return res.json({
                canGenerate: true,
                isFreeTier: false,
                remaining: null
            });
        }

        // Get free tier usage
        let usage, usageError;
        try {
            const result = await supabase
                .from('free_tier_usage')
                .select('leads_used, leads_limit')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle();
            usage = result.data;
            usageError = result.error;
        } catch (queryError) {
            console.error('💥 Usage query exception:', queryError);
            return res.status(500).json({ error: 'Failed to check limits' });
        }

        if (usageError) {
            console.error('Error getting lead usage:', usageError);
            return res.status(500).json({ error: 'Failed to check limits' });
        }

        if (!usage) {
            // No record means fresh user with full limits
            return res.json({
                canGenerate: count <= 10,
                isFreeTier: true,
                remaining: 10,
                requested: count
            });
        }

        const remaining = Math.max(0, usage.leads_limit - usage.leads_used);
        const canGenerate = remaining >= count;

        res.json({
            canGenerate,
            isFreeTier: true,
            remaining,
            requested: count,
            used: usage.leads_used,
            limit: usage.leads_limit
        });
    } catch (error) {
        console.error('Error checking lead generation:', error);
        res.status(500).json({ error: 'Failed to check limits' });
    }
});

/**
 * GET /api/usage/:userId/can-make-call
 * Check if user can make a call
 */
router.get('/:userId/can-make-call', async (req, res) => {
    try {
        if (!ensureSupabaseConfigured({ res })) return;

        const { userId } = req.params;

        // Check for active subscription
        let subscription, subscriptionError;
        try {
            const result = await supabase
                .from('user_subscriptions')
                .select('status')
                .eq('user_id', userId)
                .eq('status', 'active')
                .limit(1)
                .maybeSingle();
            subscription = result.data;
            subscriptionError = result.error;
        } catch (queryError) {
            console.error('💥 Subscription query exception:', queryError);
            return res.status(500).json({ error: 'Failed to check limits' });
        }

        if (subscriptionError) {
            console.error('Error checking subscription:', subscriptionError);
            return res.status(500).json({ error: 'Failed to check limits' });
        }

        if (subscription) {
            return res.json({
                canCall: true,
                isFreeTier: false,
                remaining: null,
                maxDuration: null // No duration limit for paid users
            });
        }

        // Get free tier usage
        let usage, usageError;
        try {
            const result = await supabase
                .from('free_tier_usage')
                .select('calls_used, calls_limit, call_seconds_per_call')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle();
            usage = result.data;
            usageError = result.error;
        } catch (queryError) {
            console.error('💥 Usage query exception:', queryError);
            return res.status(500).json({ error: 'Failed to check limits' });
        }

        if (usageError) {
            console.error('Error getting call usage:', usageError);
            return res.status(500).json({ error: 'Failed to check limits' });
        }

        if (!usage) {
            return res.json({
                canCall: true,
                isFreeTier: true,
                remaining: 5,
                maxDuration: 120 // 2 minutes for free tier
            });
        }

        const remaining = Math.max(0, usage.calls_limit - usage.calls_used);
        const canCall = remaining > 0;

        res.json({
            canCall,
            isFreeTier: true,
            remaining,
            used: usage.calls_used,
            limit: usage.calls_limit,
            maxDuration: usage.call_seconds_per_call
        });
    } catch (error) {
        console.error('Error checking call limits:', error);
        res.status(500).json({ error: 'Failed to check limits' });
    }
});

/**
 * POST /api/usage/:userId/increment-leads
 * Increment leads used count
 * Body: { count: number } (defaults to 1)
 */
router.post('/:userId/increment-leads', async (req, res) => {
    try {
        if (!ensureSupabaseConfigured({ res })) return;

        const { userId } = req.params;
        const count = parseInt(req.body.count) || 1;

        // Check for active subscription (don't track for paid users)
        let subscription, subscriptionError;
        try {
            const result = await supabase
                .from('user_subscriptions')
                .select('status')
                .eq('user_id', userId)
                .eq('status', 'active')
                .limit(1)
                .maybeSingle();
            subscription = result.data;
            subscriptionError = result.error;
        } catch (queryError) {
            console.error('💥 Subscription query exception:', queryError);
            return res.status(500).json({ error: 'Failed to increment leads' });
        }

        if (subscriptionError) {
            console.error('Error checking subscription:', subscriptionError);
            return res.status(500).json({ error: 'Failed to increment leads' });
        }

        if (subscription) {
            return res.json({
                success: true,
                isFreeTier: false,
                message: 'Subscribed user - no tracking needed'
            });
        }

        // Increment usage
        let currentUsage, currentUsageError;
        try {
            const result = await supabase
                .from('free_tier_usage')
                .select('leads_used, leads_limit')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle();
            currentUsage = result.data;
            currentUsageError = result.error;
        } catch (queryError) {
            console.error('💥 Current usage query exception:', queryError);
            return res.status(500).json({ error: 'Failed to increment leads' });
        }

        if (currentUsageError) {
            console.error('Error getting current usage:', currentUsageError);
            return res.status(500).json({ error: 'Failed to increment leads' });
        }

        if (!currentUsage) {
            // Create record with initial count
            let createError;
            try {
                const result = await supabase
                    .from('free_tier_usage')
                    .insert({ user_id: userId, leads_used: count });
                createError = result.error;
            } catch (queryError) {
                console.error('💥 Create usage query exception:', queryError);
                return res.status(500).json({ error: 'Failed to increment leads' });
            }

            if (createError) throw createError;

            return res.json({
                success: true,
                isFreeTier: true,
                leadsUsed: count,
                leadsRemaining: 10 - count
            });
        }

        const newCount = currentUsage.leads_used + count;

        const { error: updateError } = await supabase
            .from('free_tier_usage')
            .update({ leads_used: newCount })
            .eq('user_id', userId);

        if (updateError) throw updateError;

        res.json({
            success: true,
            isFreeTier: true,
            leadsUsed: newCount,
            leadsRemaining: Math.max(0, currentUsage.leads_limit - newCount)
        });
    } catch (error) {
        console.error('Error incrementing leads:', error);
        res.status(500).json({ error: 'Failed to increment leads' });
    }
});

/**
 * POST /api/usage/:userId/increment-calls
 * Increment calls used count
 */
router.post('/:userId/increment-calls', async (req, res) => {
    try {
        if (!ensureSupabaseConfigured({ res })) return;

        const { userId } = req.params;

        // Check for active subscription
        let subscription, subscriptionError;
        try {
            const result = await supabase
                .from('user_subscriptions')
                .select('status')
                .eq('user_id', userId)
                .eq('status', 'active')
                .limit(1)
                .maybeSingle();
            subscription = result.data;
            subscriptionError = result.error;
        } catch (queryError) {
            console.error('💥 Subscription query exception:', queryError);
            return res.status(500).json({ error: 'Failed to increment calls' });
        }

        if (subscriptionError) {
            console.error('Error checking subscription:', subscriptionError);
            return res.status(500).json({ error: 'Failed to increment calls' });
        }

        if (subscription) {
            return res.json({
                success: true,
                isFreeTier: false,
                message: 'Subscribed user - no tracking needed'
            });
        }

        // Increment usage
        let currentUsage, currentUsageError;
        try {
            const result = await supabase
                .from('free_tier_usage')
                .select('calls_used, calls_limit')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle();
            currentUsage = result.data;
            currentUsageError = result.error;
        } catch (queryError) {
            console.error('💥 Current usage query exception:', queryError);
            return res.status(500).json({ error: 'Failed to increment calls' });
        }

        if (currentUsageError) {
            console.error('Error getting current usage:', currentUsageError);
            return res.status(500).json({ error: 'Failed to increment calls' });
        }

        if (!currentUsage) {
            // Create record with initial count
            let createError;
            try {
                const result = await supabase
                    .from('free_tier_usage')
                    .insert({ user_id: userId, calls_used: 1 });
                createError = result.error;
            } catch (queryError) {
                console.error('💥 Create usage query exception:', queryError);
                return res.status(500).json({ error: 'Failed to increment calls' });
            }

            if (createError) throw createError;

            return res.json({
                success: true,
                isFreeTier: true,
                callsUsed: 1,
                callsRemaining: 4
            });
        }

        const newCount = currentUsage.calls_used + 1;

        const { error: updateError } = await supabase
            .from('free_tier_usage')
            .update({ calls_used: newCount })
            .eq('user_id', userId);

        if (updateError) throw updateError;

        res.json({
            success: true,
            isFreeTier: true,
            callsUsed: newCount,
            callsRemaining: Math.max(0, currentUsage.calls_limit - newCount)
        });
    } catch (error) {
        console.error('Error incrementing calls:', error);
        res.status(500).json({ error: 'Failed to increment calls' });
    }
});

export default router;
