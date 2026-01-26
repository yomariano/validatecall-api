/**
 * Multi-Channel Workflow Routes
 * API endpoints for managing outreach workflows (email + calls + SMS)
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { batchPersonalizeLeads } from '../services/emailPersonalization.js';

const router = Router();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/workflows
 * List user's workflows
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { data, error } = await supabase
            .from('outreach_workflows')
            .select(`
                *,
                campaign:campaigns(id, name),
                steps:workflow_steps(count)
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching workflows:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ workflows: data });
    } catch (error) {
        console.error('Workflows list error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/workflows
 * Create a new workflow
 */
router.post('/', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const {
            name,
            description,
            campaignId,
            timezone = 'UTC',
            sendWindowStart = '09:00',
            sendWindowEnd = '17:00',
            sendDays = [1, 2, 3, 4, 5],
            stopOnReply = true,
            stopOnCallAnswered = true,
            stopOnMeetingBooked = false,
            stopOnClick = false,
            stopOnBounce = true,
            defaultAssistantId,
            callMaxRetries = 2,
            steps = []
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Workflow name is required' });
        }

        // Create workflow
        const { data: workflow, error: workflowError } = await supabase
            .from('outreach_workflows')
            .insert({
                user_id: userId,
                campaign_id: campaignId || null,
                name,
                description,
                timezone,
                send_window_start: sendWindowStart,
                send_window_end: sendWindowEnd,
                send_days: sendDays,
                stop_on_reply: stopOnReply,
                stop_on_call_answered: stopOnCallAnswered,
                stop_on_meeting_booked: stopOnMeetingBooked,
                stop_on_click: stopOnClick,
                stop_on_bounce: stopOnBounce,
                default_assistant_id: defaultAssistantId || null,
                call_max_retries: callMaxRetries,
                status: 'draft',
            })
            .select()
            .single();

        if (workflowError) {
            console.error('Error creating workflow:', workflowError);
            return res.status(500).json({ error: workflowError.message });
        }

        // Create steps
        if (steps.length > 0) {
            const stepsData = steps.map((step, index) => ({
                workflow_id: workflow.id,
                step_number: index + 1,
                step_type: step.type,
                delay_days: step.delayDays || 0,
                delay_hours: step.delayHours || 0,
                delay_minutes: step.delayMinutes || 0,
                condition: step.condition || 'always',
                // Email fields
                email_subject: step.emailSubject || null,
                email_body: step.emailBody || null,
                email_cta_text: step.emailCtaText || null,
                email_cta_url: step.emailCtaUrl || null,
                // Call fields
                call_assistant_id: step.callAssistantId || null,
                call_script_context: step.callScriptContext || null,
                call_max_duration_seconds: step.callMaxDuration || 300,
                // SMS fields
                sms_message: step.smsMessage || null,
                // Wait fields
                wait_for: step.waitFor || null,
            }));

            const { error: stepsError } = await supabase
                .from('workflow_steps')
                .insert(stepsData);

            if (stepsError) {
                console.error('Error creating steps:', stepsError);
            }
        }

        res.json({ workflow });
    } catch (error) {
        console.error('Create workflow error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/workflows/:id
 * Get workflow details with steps
 */
router.get('/:id', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { data: workflow, error } = await supabase
            .from('outreach_workflows')
            .select(`
                *,
                campaign:campaigns(id, name, lead_ids, product_idea),
                steps:workflow_steps(*)
            `)
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (error) {
            console.error('Error fetching workflow:', error);
            return res.status(404).json({ error: 'Workflow not found' });
        }

        // Sort steps
        if (workflow.steps) {
            workflow.steps.sort((a, b) => a.step_number - b.step_number);
        }

        // Get enrollment stats
        const { data: enrollmentStats } = await supabase
            .from('workflow_enrollments')
            .select('status')
            .eq('workflow_id', id);

        const statusCounts = {
            active: 0,
            completed: 0,
            stopped_reply: 0,
            stopped_call: 0,
            stopped_click: 0,
            stopped_bounce: 0,
            paused: 0,
        };

        (enrollmentStats || []).forEach(e => {
            if (statusCounts.hasOwnProperty(e.status)) {
                statusCounts[e.status]++;
            }
        });

        workflow.enrollmentStats = statusCounts;

        res.json({ workflow });
    } catch (error) {
        console.error('Get workflow error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/workflows/:id
 * Update workflow
 */
router.patch('/:id', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const {
            name,
            description,
            timezone,
            sendWindowStart,
            sendWindowEnd,
            sendDays,
            stopOnReply,
            stopOnCallAnswered,
            stopOnMeetingBooked,
            stopOnClick,
            stopOnBounce,
            defaultAssistantId,
            callMaxRetries,
            steps
        } = req.body;

        // Build update object
        const updates = { updated_at: new Date().toISOString() };
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (timezone !== undefined) updates.timezone = timezone;
        if (sendWindowStart !== undefined) updates.send_window_start = sendWindowStart;
        if (sendWindowEnd !== undefined) updates.send_window_end = sendWindowEnd;
        if (sendDays !== undefined) updates.send_days = sendDays;
        if (stopOnReply !== undefined) updates.stop_on_reply = stopOnReply;
        if (stopOnCallAnswered !== undefined) updates.stop_on_call_answered = stopOnCallAnswered;
        if (stopOnMeetingBooked !== undefined) updates.stop_on_meeting_booked = stopOnMeetingBooked;
        if (stopOnClick !== undefined) updates.stop_on_click = stopOnClick;
        if (stopOnBounce !== undefined) updates.stop_on_bounce = stopOnBounce;
        if (defaultAssistantId !== undefined) updates.default_assistant_id = defaultAssistantId;
        if (callMaxRetries !== undefined) updates.call_max_retries = callMaxRetries;

        const { data: workflow, error } = await supabase
            .from('outreach_workflows')
            .update(updates)
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Update steps if provided
        if (steps && Array.isArray(steps)) {
            await supabase
                .from('workflow_steps')
                .delete()
                .eq('workflow_id', id);

            const stepsData = steps.map((step, index) => ({
                workflow_id: id,
                step_number: index + 1,
                step_type: step.type,
                delay_days: step.delayDays || 0,
                delay_hours: step.delayHours || 0,
                delay_minutes: step.delayMinutes || 0,
                condition: step.condition || 'always',
                email_subject: step.emailSubject || null,
                email_body: step.emailBody || null,
                email_cta_text: step.emailCtaText || null,
                email_cta_url: step.emailCtaUrl || null,
                call_assistant_id: step.callAssistantId || null,
                call_script_context: step.callScriptContext || null,
                call_max_duration_seconds: step.callMaxDuration || 300,
                sms_message: step.smsMessage || null,
                wait_for: step.waitFor || null,
            }));

            await supabase.from('workflow_steps').insert(stepsData);
        }

        res.json({ workflow });
    } catch (error) {
        console.error('Update workflow error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/workflows/:id
 * Delete workflow
 */
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { error } = await supabase
            .from('outreach_workflows')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete workflow error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/workflows/:id/activate
 * Activate workflow and enroll leads
 */
router.post('/:id/activate', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;
        const { leadIds } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Get workflow with campaign
        const { data: workflow, error: workflowError } = await supabase
            .from('outreach_workflows')
            .select(`
                *,
                campaign:campaigns(lead_ids),
                steps:workflow_steps(*)
            `)
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (workflowError || !workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        if (!workflow.steps || workflow.steps.length === 0) {
            return res.status(400).json({ error: 'Workflow has no steps' });
        }

        // Determine leads to enroll
        let leadsToEnroll = leadIds || [];

        if (leadsToEnroll.length === 0 && workflow.campaign?.lead_ids) {
            leadsToEnroll = workflow.campaign.lead_ids;
        }

        if (leadsToEnroll.length === 0) {
            return res.status(400).json({ error: 'No leads to enroll' });
        }

        // Check existing enrollments
        const { data: existingEnrollments } = await supabase
            .from('workflow_enrollments')
            .select('lead_id')
            .eq('workflow_id', id)
            .in('lead_id', leadsToEnroll);

        const existingLeadIds = new Set((existingEnrollments || []).map(e => e.lead_id));
        const newLeadIds = leadsToEnroll.filter(lid => !existingLeadIds.has(lid));

        // Get unsubscribed emails
        const { data: leads } = await supabase
            .from('leads')
            .select('id, email, phone')
            .in('id', newLeadIds);

        const { data: unsubscribes } = await supabase
            .from('email_unsubscribes')
            .select('email')
            .eq('user_id', userId);

        const unsubscribedEmails = new Set((unsubscribes || []).map(u => u.email));
        const eligibleLeads = (leads || []).filter(l => !unsubscribedEmails.has(l.email));

        if (eligibleLeads.length === 0) {
            return res.status(400).json({ error: 'No eligible leads to enroll' });
        }

        // Get first step for initial timing
        const firstStep = workflow.steps.sort((a, b) => a.step_number - b.step_number)[0];
        const initialDelayMs = (
            (firstStep.delay_days || 0) * 24 * 60 +
            (firstStep.delay_hours || 0) * 60 +
            (firstStep.delay_minutes || 0)
        ) * 60 * 1000;

        const now = new Date();
        const firstActionAt = new Date(now.getTime() + initialDelayMs);

        // Create enrollments
        const enrollments = eligibleLeads.map(lead => ({
            workflow_id: id,
            lead_id: lead.id,
            user_id: userId,
            current_step: 0,
            status: 'active',
            next_action_at: firstActionAt.toISOString(),
            next_action_type: firstStep.step_type,
        }));

        const { error: enrollError } = await supabase
            .from('workflow_enrollments')
            .insert(enrollments);

        if (enrollError) {
            return res.status(500).json({ error: enrollError.message });
        }

        // Update workflow
        await supabase
            .from('outreach_workflows')
            .update({
                status: 'active',
                total_enrolled: workflow.total_enrolled + eligibleLeads.length,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        // Start personalization in background
        batchPersonalizeLeads(id, eligibleLeads.map(l => l.id)).catch(err => {
            console.error('Background personalization error:', err);
        });

        res.json({
            success: true,
            enrolled: eligibleLeads.length,
            skipped: leadsToEnroll.length - newLeadIds.length,
            unsubscribed: newLeadIds.length - eligibleLeads.length,
        });
    } catch (error) {
        console.error('Activate workflow error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/workflows/:id/pause
 * Pause workflow
 */
router.post('/:id/pause', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        await supabase
            .from('outreach_workflows')
            .update({ status: 'paused', updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', userId);

        await supabase
            .from('workflow_enrollments')
            .update({ status: 'paused', updated_at: new Date().toISOString() })
            .eq('workflow_id', id)
            .eq('status', 'active');

        res.json({ success: true });
    } catch (error) {
        console.error('Pause workflow error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/workflows/:id/resume
 * Resume workflow
 */
router.post('/:id/resume', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        await supabase
            .from('outreach_workflows')
            .update({ status: 'active', updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', userId);

        await supabase
            .from('workflow_enrollments')
            .update({
                status: 'active',
                next_action_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('workflow_id', id)
            .eq('status', 'paused');

        res.json({ success: true });
    } catch (error) {
        console.error('Resume workflow error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/workflows/:id/analytics
 * Get workflow analytics
 */
router.get('/:id/analytics', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Get workflow with steps
        const { data: workflow } = await supabase
            .from('outreach_workflows')
            .select('*, steps:workflow_steps(*)')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        // Get enrollment breakdown
        const { data: enrollments } = await supabase
            .from('workflow_enrollments')
            .select('status, current_step, emails_sent, calls_made, opens, clicks')
            .eq('workflow_id', id);

        // Calculate funnel
        const funnel = workflow.steps.map((step) => ({
            stepNumber: step.step_number,
            type: step.step_type,
            subject: step.email_subject?.substring(0, 40) || step.step_type.toUpperCase(),
            executed: step.executed || 0,
            emailsSent: step.emails_sent || 0,
            callsMade: step.calls_made || 0,
            opens: step.opens || 0,
            clicks: step.clicks || 0,
            replies: step.replies || 0,
            callsAnswered: step.calls_answered || 0,
        }));

        // Status breakdown
        const statusBreakdown = {
            active: 0,
            completed: 0,
            stopped_reply: 0,
            stopped_call: 0,
            stopped_click: 0,
            stopped_bounce: 0,
            paused: 0,
        };

        (enrollments || []).forEach(e => {
            if (statusBreakdown.hasOwnProperty(e.status)) {
                statusBreakdown[e.status]++;
            }
        });

        // Recent actions
        const { data: recentActions } = await supabase
            .from('workflow_action_log')
            .select('*, lead:leads(name, email)')
            .eq('workflow_id', id)
            .order('executed_at', { ascending: false })
            .limit(20);

        res.json({
            workflow: {
                id: workflow.id,
                name: workflow.name,
                status: workflow.status,
                total_enrolled: workflow.total_enrolled,
                total_emails_sent: workflow.total_emails_sent,
                total_calls_made: workflow.total_calls_made,
                total_opens: workflow.total_opens,
                total_clicks: workflow.total_clicks,
                total_replies: workflow.total_replies,
                total_calls_answered: workflow.total_calls_answered,
            },
            funnel,
            statusBreakdown,
            recentActions: recentActions || [],
        });
    } catch (error) {
        console.error('Workflow analytics error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/workflows/:id/enrollments
 * Get enrollments for a workflow
 */
router.get('/:id/enrollments', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;
        const { status, page = 1, limit = 50 } = req.query;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        let query = supabase
            .from('workflow_enrollments')
            .select(`
                *,
                lead:leads(id, name, email, phone, city, category, status)
            `, { count: 'exact' })
            .eq('workflow_id', id)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range((page - 1) * limit, page * limit - 1);

        if (status) {
            query = query.eq('status', status);
        }

        const { data, count, error } = await query;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            enrollments: data,
            total: count,
            page: parseInt(page),
            totalPages: Math.ceil(count / limit),
        });
    } catch (error) {
        console.error('Get enrollments error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
