/**
 * Admin Routes
 * Platform-wide marketing campaigns and user management
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { sendCampaignEmail } from '../services/campaignEmail.js';

const router = Router();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Apply admin auth to all routes
router.use(requireAdmin);

// =============================================
// USER SEGMENTATION
// =============================================

/**
 * GET /api/admin/users/segments
 * Get available user segments with counts
 */
router.get('/users/segments', async (req, res) => {
    try {
        const now = new Date();
        const day3Ago = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
        const day7Ago = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
        const day14Ago = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
        const day30Ago = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

        // Get counts for each segment
        const [all, free, paid, inactive3d, inactive7d, inactive14d, inactive30d] = await Promise.all([
            supabase.from('profiles').select('id', { count: 'exact', head: true }),
            supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('plan', 'free'),
            supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('plan', 'free'),
            supabase.from('profiles').select('id', { count: 'exact', head: true }).lt('last_login_at', day3Ago),
            supabase.from('profiles').select('id', { count: 'exact', head: true }).lt('last_login_at', day7Ago),
            supabase.from('profiles').select('id', { count: 'exact', head: true }).lt('last_login_at', day14Ago),
            supabase.from('profiles').select('id', { count: 'exact', head: true }).lt('last_login_at', day30Ago),
        ]);

        res.json({
            segments: [
                { id: 'all', name: 'All Users', count: all.count || 0 },
                { id: 'free', name: 'Free Plan', count: free.count || 0 },
                { id: 'paid', name: 'Paid Plans', count: paid.count || 0 },
                { id: 'inactive_3d', name: 'Inactive 3+ Days', count: inactive3d.count || 0 },
                { id: 'inactive_7d', name: 'Inactive 7+ Days', count: inactive7d.count || 0 },
                { id: 'inactive_14d', name: 'Inactive 14+ Days', count: inactive14d.count || 0 },
                { id: 'inactive_30d', name: 'Inactive 30+ Days', count: inactive30d.count || 0 },
            ]
        });
    } catch (error) {
        console.error('Segments error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/admin/users
 * Get users by segment
 */
router.get('/users', async (req, res) => {
    try {
        const { segment = 'all', limit = 100, offset = 0 } = req.query;

        let query = supabase
            .from('profiles')
            .select('id, email, full_name, plan, created_at, last_login_at')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // Apply segment filter
        const now = new Date();
        switch (segment) {
            case 'free':
                query = query.eq('plan', 'free');
                break;
            case 'paid':
                query = query.neq('plan', 'free');
                break;
            case 'inactive_3d':
                query = query.lt('last_login_at', new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString());
                break;
            case 'inactive_7d':
                query = query.lt('last_login_at', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());
                break;
            case 'inactive_14d':
                query = query.lt('last_login_at', new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString());
                break;
            case 'inactive_30d':
                query = query.lt('last_login_at', new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString());
                break;
        }

        const { data: users, error, count } = await query;

        if (error) throw error;

        res.json({ users, total: count });
    } catch (error) {
        console.error('Users error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// CAMPAIGNS
// =============================================

/**
 * GET /api/admin/campaigns
 * List all campaigns
 */
router.get('/campaigns', async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;

        let query = supabase
            .from('email_campaigns')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (status) {
            query = query.eq('status', status);
        }

        const { data: campaigns, error } = await query;

        if (error) throw error;

        res.json({ campaigns });
    } catch (error) {
        console.error('Campaigns error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/admin/campaigns
 * Create a new campaign
 */
router.post('/campaigns', async (req, res) => {
    try {
        const { name, subject, bodyHtml, bodyText, segment = 'all', scheduledAt } = req.body;

        if (!name || !subject || !bodyHtml) {
            return res.status(400).json({ error: 'name, subject, and bodyHtml are required' });
        }

        const { data: campaign, error } = await supabase
            .from('email_campaigns')
            .insert({
                name,
                subject,
                body_html: bodyHtml,
                body_text: bodyText || bodyHtml.replace(/<[^>]*>/g, ''),
                segment,
                status: scheduledAt ? 'scheduled' : 'draft',
                scheduled_at: scheduledAt || null,
                created_by: req.adminUser.id,
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ campaign });
    } catch (error) {
        console.error('Create campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/admin/campaigns/:id
 * Update a campaign
 */
router.patch('/campaigns/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Map camelCase to snake_case
        const dbUpdates = {};
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.subject) dbUpdates.subject = updates.subject;
        if (updates.bodyHtml) dbUpdates.body_html = updates.bodyHtml;
        if (updates.bodyText) dbUpdates.body_text = updates.bodyText;
        if (updates.segment) dbUpdates.segment = updates.segment;
        if (updates.status) dbUpdates.status = updates.status;
        if (updates.scheduledAt !== undefined) dbUpdates.scheduled_at = updates.scheduledAt;

        const { data: campaign, error } = await supabase
            .from('email_campaigns')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ campaign });
    } catch (error) {
        console.error('Update campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/admin/campaigns/:id/send
 * Send a campaign immediately
 */
router.post('/campaigns/:id/send', async (req, res) => {
    try {
        const { id } = req.params;

        // Get campaign
        const { data: campaign, error: campaignError } = await supabase
            .from('email_campaigns')
            .select('*')
            .eq('id', id)
            .single();

        if (campaignError || !campaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status === 'sent') {
            return res.status(400).json({ error: 'Campaign already sent' });
        }

        // Get users in segment
        const users = await getUsersBySegment(campaign.segment);

        if (users.length === 0) {
            return res.status(400).json({ error: 'No users in segment' });
        }

        // Update campaign status
        await supabase
            .from('email_campaigns')
            .update({
                status: 'sending',
                total_recipients: users.length,
            })
            .eq('id', id);

        // Send emails (in background)
        sendCampaignEmails(campaign, users).catch(err => {
            console.error('Campaign send error:', err);
        });

        res.json({
            success: true,
            message: `Sending to ${users.length} users`,
            totalRecipients: users.length,
        });
    } catch (error) {
        console.error('Send campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/admin/campaigns/:id
 * Delete a campaign
 */
router.delete('/campaigns/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('email_campaigns')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Delete campaign error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// TEMPLATES
// =============================================

/**
 * GET /api/admin/templates
 * List email templates
 */
router.get('/templates', async (req, res) => {
    try {
        const { data: templates, error } = await supabase
            .from('email_templates')
            .select('*')
            .order('name');

        if (error) throw error;

        res.json({ templates });
    } catch (error) {
        console.error('Templates error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/admin/templates
 * Create a template
 */
router.post('/templates', async (req, res) => {
    try {
        const { name, description, subject, bodyHtml, bodyText, templateType = 'marketing', variables } = req.body;

        const { data: template, error } = await supabase
            .from('email_templates')
            .insert({
                name,
                description,
                subject,
                body_html: bodyHtml,
                body_text: bodyText,
                template_type: templateType,
                variables: variables || ['firstName', 'email'],
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ template });
    } catch (error) {
        console.error('Create template error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// AUTOMATED TRIGGERS
// =============================================

/**
 * GET /api/admin/triggers
 * List automated triggers
 */
router.get('/triggers', async (req, res) => {
    try {
        const { data: triggers, error } = await supabase
            .from('automated_triggers')
            .select('*')
            .order('trigger_type');

        if (error) throw error;

        res.json({ triggers });
    } catch (error) {
        console.error('Triggers error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/admin/triggers/:id
 * Update a trigger (enable/disable, edit content)
 */
router.patch('/triggers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const dbUpdates = {};
        if (updates.name) dbUpdates.name = updates.name;
        if (updates.subject) dbUpdates.subject = updates.subject;
        if (updates.bodyHtml) dbUpdates.body_html = updates.bodyHtml;
        if (updates.bodyText) dbUpdates.body_text = updates.bodyText;
        if (typeof updates.isActive === 'boolean') dbUpdates.is_active = updates.isActive;
        if (updates.delayMinutes !== undefined) dbUpdates.delay_minutes = updates.delayMinutes;
        if (updates.discountCode !== undefined) dbUpdates.discount_code = updates.discountCode;
        if (updates.discountPercent !== undefined) dbUpdates.discount_percent = updates.discountPercent;
        if (updates.discountExpiresHours !== undefined) dbUpdates.discount_expires_hours = updates.discountExpiresHours;

        const { data: trigger, error } = await supabase
            .from('automated_triggers')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ trigger });
    } catch (error) {
        console.error('Update trigger error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/admin/triggers
 * Create a new trigger
 */
router.post('/triggers', async (req, res) => {
    try {
        const {
            name,
            description,
            triggerType,
            subject,
            bodyHtml,
            bodyText,
            isActive = false,
            delayMinutes = 0,
            discountCode,
            discountPercent,
            discountExpiresHours,
        } = req.body;

        if (!name || !triggerType || !subject || !bodyHtml) {
            return res.status(400).json({ error: 'name, triggerType, subject, and bodyHtml required' });
        }

        const { data: trigger, error } = await supabase
            .from('automated_triggers')
            .insert({
                name,
                description,
                trigger_type: triggerType,
                subject,
                body_html: bodyHtml,
                body_text: bodyText,
                is_active: isActive,
                delay_minutes: delayMinutes,
                discount_code: discountCode,
                discount_percent: discountPercent,
                discount_expires_hours: discountExpiresHours,
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ trigger });
    } catch (error) {
        console.error('Create trigger error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// ANALYTICS
// =============================================

/**
 * GET /api/admin/analytics
 * Get campaign and trigger analytics
 */
router.get('/analytics', async (req, res) => {
    try {
        const [campaignStats, triggerStats, recentSends] = await Promise.all([
            // Campaign stats
            supabase
                .from('email_campaigns')
                .select('status, sent_count, failed_count')
                .then(({ data }) => {
                    const totals = { draft: 0, scheduled: 0, sent: 0, totalSent: 0, totalFailed: 0 };
                    (data || []).forEach(c => {
                        totals[c.status] = (totals[c.status] || 0) + 1;
                        totals.totalSent += c.sent_count || 0;
                        totals.totalFailed += c.failed_count || 0;
                    });
                    return totals;
                }),

            // Trigger stats
            supabase
                .from('trigger_logs')
                .select('trigger_type, status')
                .then(({ data }) => {
                    const byType = {};
                    (data || []).forEach(t => {
                        if (!byType[t.trigger_type]) byType[t.trigger_type] = { sent: 0, failed: 0 };
                        byType[t.trigger_type][t.status === 'sent' ? 'sent' : 'failed']++;
                    });
                    return byType;
                }),

            // Recent sends
            supabase
                .from('email_logs')
                .select('email_type, recipient, status, created_at')
                .order('created_at', { ascending: false })
                .limit(20),
        ]);

        res.json({
            campaigns: campaignStats,
            triggers: triggerStats,
            recentSends: recentSends.data || [],
        });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// HELPER FUNCTIONS
// =============================================

async function getUsersBySegment(segment) {
    const now = new Date();

    let query = supabase
        .from('profiles')
        .select('id, email, full_name, plan');

    switch (segment) {
        case 'free':
            query = query.eq('plan', 'free');
            break;
        case 'paid':
            query = query.neq('plan', 'free');
            break;
        case 'inactive_3d':
            query = query.lt('last_login_at', new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString());
            break;
        case 'inactive_7d':
            query = query.lt('last_login_at', new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());
            break;
        case 'inactive_14d':
            query = query.lt('last_login_at', new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString());
            break;
        case 'inactive_30d':
            query = query.lt('last_login_at', new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString());
            break;
        // 'all' - no filter
    }

    const { data } = await query;
    return data || [];
}

async function sendCampaignEmails(campaign, users) {
    let sentCount = 0;
    let failedCount = 0;

    for (const user of users) {
        try {
            // Personalize content
            const personalizedHtml = personalizeContent(campaign.body_html, user);
            const personalizedText = personalizeContent(campaign.body_text, user);
            const personalizedSubject = personalizeContent(campaign.subject, user);

            // Send email
            const result = await sendCampaignEmail({
                to: user.email,
                subject: personalizedSubject,
                html: personalizedHtml,
                text: personalizedText,
            });

            // Log recipient
            await supabase.from('campaign_recipients').insert({
                campaign_id: campaign.id,
                user_id: user.id,
                email: user.email,
                status: result.success ? 'sent' : 'failed',
                sent_at: result.success ? new Date().toISOString() : null,
                resend_id: result.emailId,
                error_message: result.error,
            });

            if (result.success) {
                sentCount++;
            } else {
                failedCount++;
            }

            // Small delay between sends
            await new Promise(r => setTimeout(r, 100));
        } catch (err) {
            console.error(`Failed to send to ${user.email}:`, err);
            failedCount++;
        }
    }

    // Update campaign stats
    await supabase
        .from('email_campaigns')
        .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            sent_count: sentCount,
            failed_count: failedCount,
        })
        .eq('id', campaign.id);

    console.log(`Campaign ${campaign.id} complete: ${sentCount} sent, ${failedCount} failed`);
}

function personalizeContent(content, user) {
    if (!content) return content;

    const firstName = user.full_name?.split(' ')[0] || 'there';

    return content
        .replace(/\{\{firstName\}\}/g, firstName)
        .replace(/\{\{email\}\}/g, user.email || '')
        .replace(/\{\{planName\}\}/g, user.plan || 'free')
        .replace(/\{\{upgradeUrl\}\}/g, 'https://validatecall.com/billing');
}

export default router;
