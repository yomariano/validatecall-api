/**
 * Trigger Engine
 * Background job that checks for trigger conditions and sends automated emails
 */

import { createClient } from '@supabase/supabase-js';
import { sendTriggerEmail } from './campaignEmail.js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Check interval (every 15 minutes)
const CHECK_INTERVAL = 15 * 60 * 1000;

let isRunning = false;
let intervalId = null;

/**
 * Start the trigger engine
 */
export function start() {
    if (isRunning) {
        console.log('⚡ Trigger engine already running');
        return;
    }

    console.log('⚡ Starting trigger engine (checking every 15 minutes)');
    isRunning = true;

    // Run immediately, then on interval
    runTriggerChecks();
    intervalId = setInterval(runTriggerChecks, CHECK_INTERVAL);
}

/**
 * Stop the trigger engine
 */
export function stop() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    isRunning = false;
    console.log('⚡ Trigger engine stopped');
}

/**
 * Main trigger check function
 */
async function runTriggerChecks() {
    try {
        // Get all active triggers
        const { data: triggers, error } = await supabase
            .from('automated_triggers')
            .select('*')
            .eq('is_active', true);

        if (error || !triggers?.length) {
            return;
        }

        console.log(`⚡ Checking ${triggers.length} active triggers`);

        for (const trigger of triggers) {
            await processTrigger(trigger);
        }
    } catch (err) {
        console.error('Trigger engine error:', err);
    }
}

/**
 * Process a single trigger
 */
async function processTrigger(trigger) {
    try {
        const users = await getUsersForTrigger(trigger.trigger_type);

        if (!users.length) return;

        console.log(`⚡ Trigger "${trigger.name}": ${users.length} eligible users`);

        for (const user of users) {
            // Check if already sent to this user for this trigger
            const alreadySent = await checkAlreadySent(trigger.id, user.id, trigger.trigger_type);
            if (alreadySent) continue;

            // Personalize and send
            const personalizedSubject = personalizeContent(trigger.subject, user, trigger);
            const personalizedHtml = personalizeContent(trigger.body_html, user, trigger);
            const personalizedText = personalizeContent(trigger.body_text, user, trigger);

            const result = await sendTriggerEmail({
                to: user.email,
                subject: personalizedSubject,
                html: personalizedHtml,
                text: personalizedText,
                triggerType: trigger.trigger_type,
            });

            // Log the trigger send
            await supabase.from('trigger_logs').insert({
                trigger_id: trigger.id,
                user_id: user.id,
                trigger_type: trigger.trigger_type,
                email: user.email,
                status: result.success ? 'sent' : 'failed',
                resend_id: result.emailId,
                error_message: result.error,
                context: {
                    usage: user.usage,
                    lastLoginAt: user.last_login_at,
                },
            });

            // Update trigger stats
            if (result.success) {
                await supabase
                    .from('automated_triggers')
                    .update({ times_triggered: trigger.times_triggered + 1 })
                    .eq('id', trigger.id);
            }

            // Small delay between sends
            await new Promise(r => setTimeout(r, 200));
        }
    } catch (err) {
        console.error(`Error processing trigger ${trigger.name}:`, err);
    }
}

/**
 * Get users matching trigger conditions
 */
async function getUsersForTrigger(triggerType) {
    const now = new Date();

    switch (triggerType) {
        // =============================================
        // USAGE-BASED TRIGGERS
        // =============================================
        case 'usage_50': {
            // Users at 50% usage (leads or calls)
            const { data } = await supabase
                .from('free_tier_usage')
                .select('user_id, leads_used, calls_used, profiles!inner(id, email, full_name, plan)')
                .or('leads_used.gte.5,calls_used.gte.3'); // 50% of 10 leads or 5 calls

            return (data || [])
                .filter(u => u.profiles?.plan === 'free')
                .map(u => ({
                    id: u.user_id,
                    email: u.profiles.email,
                    full_name: u.profiles.full_name,
                    usage: { leadsUsed: u.leads_used, callsUsed: u.calls_used },
                }));
        }

        case 'usage_80': {
            const { data } = await supabase
                .from('free_tier_usage')
                .select('user_id, leads_used, calls_used, profiles!inner(id, email, full_name, plan)')
                .or('leads_used.gte.8,calls_used.gte.4'); // 80% of limits

            return (data || [])
                .filter(u => u.profiles?.plan === 'free')
                .map(u => ({
                    id: u.user_id,
                    email: u.profiles.email,
                    full_name: u.profiles.full_name,
                    usage: { leadsUsed: u.leads_used, callsUsed: u.calls_used },
                }));
        }

        case 'usage_90': {
            const { data } = await supabase
                .from('free_tier_usage')
                .select('user_id, leads_used, calls_used, profiles!inner(id, email, full_name, plan)')
                .or('leads_used.gte.9,calls_used.gte.5'); // 90% of limits

            return (data || [])
                .filter(u => u.profiles?.plan === 'free')
                .map(u => ({
                    id: u.user_id,
                    email: u.profiles.email,
                    full_name: u.profiles.full_name,
                    usage: { leadsUsed: u.leads_used, callsUsed: u.calls_used },
                }));
        }

        case 'usage_100': {
            const { data } = await supabase
                .from('free_tier_usage')
                .select('user_id, leads_used, calls_used, profiles!inner(id, email, full_name, plan)')
                .or('leads_used.gte.10,calls_used.gte.5');

            return (data || [])
                .filter(u => u.profiles?.plan === 'free')
                .map(u => ({
                    id: u.user_id,
                    email: u.profiles.email,
                    full_name: u.profiles.full_name,
                    usage: { leadsUsed: u.leads_used, callsUsed: u.calls_used },
                }));
        }

        // =============================================
        // INACTIVITY TRIGGERS
        // =============================================
        case 'inactive_3d': {
            const cutoff = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
            const maxAge = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase
                .from('profiles')
                .select('id, email, full_name, last_login_at')
                .lt('last_login_at', cutoff)
                .gte('last_login_at', maxAge);

            return data || [];
        }

        case 'inactive_7d': {
            const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
            const maxAge = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase
                .from('profiles')
                .select('id, email, full_name, last_login_at')
                .lt('last_login_at', cutoff)
                .gte('last_login_at', maxAge);

            return data || [];
        }

        case 'inactive_14d': {
            const cutoff = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
            const maxAge = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase
                .from('profiles')
                .select('id, email, full_name, last_login_at')
                .lt('last_login_at', cutoff)
                .gte('last_login_at', maxAge);

            return data || [];
        }

        // =============================================
        // WELCOME SEQUENCE TRIGGERS
        // =============================================
        case 'welcome_day_2': {
            // Users who signed up 2 days ago (within a 24-hour window)
            const start = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
            const end = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase
                .from('profiles')
                .select('id, email, full_name, created_at')
                .gte('created_at', start)
                .lt('created_at', end);

            return data || [];
        }

        case 'welcome_day_5': {
            // Users who signed up 5 days ago (within a 24-hour window)
            const start = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();
            const end = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase
                .from('profiles')
                .select('id, email, full_name, created_at')
                .gte('created_at', start)
                .lt('created_at', end);

            return data || [];
        }

        // =============================================
        // ABANDONED UPGRADE TRIGGERS
        // Note: These require event tracking to be implemented
        // For now, they check users who visited pricing recently
        // =============================================
        case 'abandoned_upgrade_1h':
        case 'abandoned_upgrade_24h': {
            // Check for users who viewed pricing but didn't upgrade
            // This requires pricing_page_views table or event tracking
            // For now, return empty - implement when event tracking is added
            const { data: events } = await supabase
                .from('user_events')
                .select('user_id, created_at, profiles!inner(id, email, full_name, plan)')
                .eq('event_type', 'pricing_page_view')
                .eq('profiles.plan', 'free')
                .gte('created_at', triggerType === 'abandoned_upgrade_1h'
                    ? new Date(now - 2 * 60 * 60 * 1000).toISOString()  // 1-2 hours ago
                    : new Date(now - 25 * 60 * 60 * 1000).toISOString()) // 24-25 hours ago
                .lt('created_at', triggerType === 'abandoned_upgrade_1h'
                    ? new Date(now - 1 * 60 * 60 * 1000).toISOString()
                    : new Date(now - 24 * 60 * 60 * 1000).toISOString());

            // If user_events table doesn't exist, return empty
            if (!events) return [];

            return events.map(e => ({
                id: e.profiles.id,
                email: e.profiles.email,
                full_name: e.profiles.full_name,
            }));
        }

        // =============================================
        // SOCIAL PROOF WEEKLY
        // =============================================
        case 'social_proof_weekly': {
            // Send to all active users (logged in within last 30 days)
            // Only send on Mondays to avoid spam
            const dayOfWeek = now.getDay();
            if (dayOfWeek !== 1) return []; // Only on Mondays

            const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
            const { data } = await supabase
                .from('profiles')
                .select('id, email, full_name, last_login_at')
                .gte('last_login_at', cutoff);

            return data || [];
        }

        default:
            return [];
    }
}

/**
 * Check if we already sent this trigger to this user
 */
async function checkAlreadySent(triggerId, userId, triggerType) {
    // For usage triggers, check if sent in last 7 days
    // For inactivity triggers, check if sent in last 30 days
    const daysBack = triggerType.startsWith('usage') ? 7 : 30;
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
        .from('trigger_logs')
        .select('id')
        .eq('trigger_id', triggerId)
        .eq('user_id', userId)
        .eq('status', 'sent')
        .gte('created_at', cutoff)
        .limit(1);

    return data && data.length > 0;
}

/**
 * Personalize email content with user data
 */
function personalizeContent(content, user, trigger) {
    if (!content) return content;

    const firstName = user.full_name?.split(' ')[0] || 'there';

    let result = content
        .replace(/\{\{firstName\}\}/g, firstName)
        .replace(/\{\{email\}\}/g, user.email || '')
        .replace(/\{\{upgradeUrl\}\}/g, 'https://validatecall.com/billing');

    // Usage-related variables
    if (user.usage) {
        const leadsUsed = user.usage.leadsUsed || 0;
        const callsUsed = user.usage.callsUsed || 0;
        const leadsLimit = 10;
        const callsLimit = 5;

        // Determine which resource is more used
        const leadsPercent = (leadsUsed / leadsLimit) * 100;
        const callsPercent = (callsUsed / callsLimit) * 100;

        if (leadsPercent >= callsPercent) {
            result = result
                .replace(/\{\{resourceType\}\}/g, 'leads')
                .replace(/\{\{used\}\}/g, leadsUsed.toString())
                .replace(/\{\{limit\}\}/g, leadsLimit.toString())
                .replace(/\{\{percentUsed\}\}/g, Math.round(leadsPercent).toString());
        } else {
            result = result
                .replace(/\{\{resourceType\}\}/g, 'calls')
                .replace(/\{\{used\}\}/g, callsUsed.toString())
                .replace(/\{\{limit\}\}/g, callsLimit.toString())
                .replace(/\{\{percentUsed\}\}/g, Math.round(callsPercent).toString());
        }
    }

    // Discount variables
    if (trigger) {
        result = result
            .replace(/\{\{discountCode\}\}/g, trigger.discount_code || '')
            .replace(/\{\{discountPercent\}\}/g, (trigger.discount_percent || '').toString())
            .replace(/\{\{expiresIn\}\}/g, `${trigger.discount_expires_hours || 24} hours`);
    }

    return result;
}

/**
 * Manually trigger a check for a specific trigger type (for testing)
 */
export async function manualTrigger(triggerType) {
    const { data: trigger } = await supabase
        .from('automated_triggers')
        .select('*')
        .eq('trigger_type', triggerType)
        .single();

    if (trigger) {
        await processTrigger(trigger);
        return { success: true, message: `Processed trigger: ${trigger.name}` };
    }

    return { success: false, error: 'Trigger not found' };
}

export default {
    start,
    stop,
    manualTrigger,
};
