/**
 * Email Sequences Routes
 * API endpoints for managing email sequences
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { batchPersonalizeLeads } from '../services/emailPersonalization.js';

const router = Router();

// Initialize Supabase client with service role for backend operations
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/sequences
 * List user's sequences
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { data, error } = await supabase
            .from('email_sequences')
            .select(`
                *,
                campaign:campaigns(id, name),
                steps:email_sequence_steps(count)
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching sequences:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ sequences: data });
    } catch (error) {
        console.error('Sequences list error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/sequences
 * Create a new sequence
 */
router.post('/', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const {
            name,
            campaignId,
            timezone = 'UTC',
            sendWindowStart = '09:00',
            sendWindowEnd = '17:00',
            sendDays = [1, 2, 3, 4, 5],
            stopOnReply = true,
            stopOnClick = false,
            stopOnBounce = true,
            steps = []
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Sequence name is required' });
        }

        // Create sequence
        const { data: sequence, error: seqError } = await supabase
            .from('email_sequences')
            .insert({
                user_id: userId,
                campaign_id: campaignId || null,
                name,
                timezone,
                send_window_start: sendWindowStart,
                send_window_end: sendWindowEnd,
                send_days: sendDays,
                stop_on_reply: stopOnReply,
                stop_on_click: stopOnClick,
                stop_on_bounce: stopOnBounce,
                status: 'draft',
            })
            .select()
            .single();

        if (seqError) {
            console.error('Error creating sequence:', seqError);
            return res.status(500).json({ error: seqError.message });
        }

        // Create steps if provided
        if (steps.length > 0) {
            const stepsData = steps.map((step, index) => ({
                sequence_id: sequence.id,
                step_number: index + 1,
                delay_days: step.delayDays || 3,
                delay_hours: step.delayHours || 0,
                subject_template: step.subject,
                body_template: step.body,
                cta_text: step.ctaText || null,
                cta_url: step.ctaUrl || null,
            }));

            const { error: stepsError } = await supabase
                .from('email_sequence_steps')
                .insert(stepsData);

            if (stepsError) {
                console.error('Error creating steps:', stepsError);
                // Don't fail the whole request, sequence was created
            }
        }

        res.json({ sequence });
    } catch (error) {
        console.error('Create sequence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/sequences/:id
 * Get sequence details with steps and enrollment stats
 */
router.get('/:id', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { data: sequence, error } = await supabase
            .from('email_sequences')
            .select(`
                *,
                campaign:campaigns(id, name, lead_ids),
                steps:email_sequence_steps(*)
            `)
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (error) {
            console.error('Error fetching sequence:', error);
            return res.status(404).json({ error: 'Sequence not found' });
        }

        // Sort steps by step_number
        if (sequence.steps) {
            sequence.steps.sort((a, b) => a.step_number - b.step_number);
        }

        // Get enrollment counts by status
        const { data: enrollmentStats } = await supabase
            .from('email_sequence_enrollments')
            .select('status')
            .eq('sequence_id', id);

        const statusCounts = {
            active: 0,
            completed: 0,
            stopped_reply: 0,
            stopped_click: 0,
            stopped_bounce: 0,
            stopped_unsubscribe: 0,
            paused: 0,
        };

        (enrollmentStats || []).forEach(e => {
            if (statusCounts.hasOwnProperty(e.status)) {
                statusCounts[e.status]++;
            }
        });

        sequence.enrollmentStats = statusCounts;

        res.json({ sequence });
    } catch (error) {
        console.error('Get sequence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/sequences/:id
 * Update sequence settings and steps
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
            timezone,
            sendWindowStart,
            sendWindowEnd,
            sendDays,
            stopOnReply,
            stopOnClick,
            stopOnBounce,
            steps
        } = req.body;

        // Build update object
        const updates = { updated_at: new Date().toISOString() };
        if (name !== undefined) updates.name = name;
        if (timezone !== undefined) updates.timezone = timezone;
        if (sendWindowStart !== undefined) updates.send_window_start = sendWindowStart;
        if (sendWindowEnd !== undefined) updates.send_window_end = sendWindowEnd;
        if (sendDays !== undefined) updates.send_days = sendDays;
        if (stopOnReply !== undefined) updates.stop_on_reply = stopOnReply;
        if (stopOnClick !== undefined) updates.stop_on_click = stopOnClick;
        if (stopOnBounce !== undefined) updates.stop_on_bounce = stopOnBounce;

        const { data: sequence, error } = await supabase
            .from('email_sequences')
            .update(updates)
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error updating sequence:', error);
            return res.status(500).json({ error: error.message });
        }

        // Update steps if provided
        if (steps && Array.isArray(steps)) {
            // Delete existing steps
            await supabase
                .from('email_sequence_steps')
                .delete()
                .eq('sequence_id', id);

            // Insert new steps
            const stepsData = steps.map((step, index) => ({
                sequence_id: id,
                step_number: index + 1,
                delay_days: step.delayDays || 3,
                delay_hours: step.delayHours || 0,
                subject_template: step.subject,
                body_template: step.body,
                cta_text: step.ctaText || null,
                cta_url: step.ctaUrl || null,
            }));

            await supabase
                .from('email_sequence_steps')
                .insert(stepsData);
        }

        res.json({ sequence });
    } catch (error) {
        console.error('Update sequence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/sequences/:id
 * Delete a sequence
 */
router.delete('/:id', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { error } = await supabase
            .from('email_sequences')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);

        if (error) {
            console.error('Error deleting sequence:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete sequence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/sequences/:id/activate
 * Activate sequence and enroll leads
 */
router.post('/:id/activate', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;
        const { leadIds } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Get sequence with campaign
        const { data: sequence, error: seqError } = await supabase
            .from('email_sequences')
            .select(`
                *,
                campaign:campaigns(lead_ids),
                steps:email_sequence_steps(*)
            `)
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (seqError || !sequence) {
            return res.status(404).json({ error: 'Sequence not found' });
        }

        // Check for steps
        if (!sequence.steps || sequence.steps.length === 0) {
            return res.status(400).json({ error: 'Sequence has no steps defined' });
        }

        // Determine which leads to enroll
        let leadsToEnroll = leadIds || [];

        // If no leads specified, use campaign leads
        if (leadsToEnroll.length === 0 && sequence.campaign?.lead_ids) {
            leadsToEnroll = sequence.campaign.lead_ids;
        }

        if (leadsToEnroll.length === 0) {
            return res.status(400).json({ error: 'No leads to enroll' });
        }

        // Get first step for initial delay
        const firstStep = sequence.steps.sort((a, b) => a.step_number - b.step_number)[0];
        const initialDelayMs = ((firstStep.delay_days || 0) * 24 * 60 + (firstStep.delay_hours || 0)) * 60 * 1000;

        // Check for existing enrollments to avoid duplicates
        const { data: existingEnrollments } = await supabase
            .from('email_sequence_enrollments')
            .select('lead_id')
            .eq('sequence_id', id)
            .in('lead_id', leadsToEnroll);

        const existingLeadIds = new Set((existingEnrollments || []).map(e => e.lead_id));
        const newLeadIds = leadsToEnroll.filter(id => !existingLeadIds.has(id));

        // Get unsubscribed emails
        const { data: leads } = await supabase
            .from('leads')
            .select('id, email')
            .in('id', newLeadIds);

        const { data: unsubscribes } = await supabase
            .from('email_unsubscribes')
            .select('email')
            .eq('user_id', userId);

        const unsubscribedEmails = new Set((unsubscribes || []).map(u => u.email));
        const eligibleLeads = (leads || []).filter(l => !unsubscribedEmails.has(l.email));

        if (eligibleLeads.length === 0) {
            return res.status(400).json({ error: 'No eligible leads to enroll (all unsubscribed or already enrolled)' });
        }

        // Create enrollments
        const now = new Date();
        const firstEmailAt = new Date(now.getTime() + initialDelayMs);

        const enrollments = eligibleLeads.map(lead => ({
            sequence_id: id,
            lead_id: lead.id,
            user_id: userId,
            current_step: 0,
            status: 'active',
            next_email_at: firstEmailAt.toISOString(),
        }));

        const { error: enrollError } = await supabase
            .from('email_sequence_enrollments')
            .insert(enrollments);

        if (enrollError) {
            console.error('Error creating enrollments:', enrollError);
            return res.status(500).json({ error: enrollError.message });
        }

        // Update sequence status and stats
        await supabase
            .from('email_sequences')
            .update({
                status: 'active',
                total_enrolled: sequence.total_enrolled + eligibleLeads.length,
                updated_at: new Date().toISOString(),
            })
            .eq('id', id);

        // Start batch personalization in background
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
        console.error('Activate sequence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/sequences/:id/pause
 * Pause an active sequence
 */
router.post('/:id/pause', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Update sequence status
        await supabase
            .from('email_sequences')
            .update({
                status: 'paused',
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('user_id', userId);

        // Pause all active enrollments
        await supabase
            .from('email_sequence_enrollments')
            .update({
                status: 'paused',
                updated_at: new Date().toISOString(),
            })
            .eq('sequence_id', id)
            .eq('status', 'active');

        res.json({ success: true });
    } catch (error) {
        console.error('Pause sequence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/sequences/:id/resume
 * Resume a paused sequence
 */
router.post('/:id/resume', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Update sequence status
        await supabase
            .from('email_sequences')
            .update({
                status: 'active',
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('user_id', userId);

        // Resume paused enrollments - set next_email_at to now
        await supabase
            .from('email_sequence_enrollments')
            .update({
                status: 'active',
                next_email_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('sequence_id', id)
            .eq('status', 'paused');

        res.json({ success: true });
    } catch (error) {
        console.error('Resume sequence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/sequences/:id/analytics
 * Get detailed analytics for a sequence
 */
router.get('/:id/analytics', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Get sequence with steps
        const { data: sequence, error: seqError } = await supabase
            .from('email_sequences')
            .select(`
                *,
                steps:email_sequence_steps(*)
            `)
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (seqError) {
            return res.status(404).json({ error: 'Sequence not found' });
        }

        // Get enrollment breakdown
        const { data: enrollments } = await supabase
            .from('email_sequence_enrollments')
            .select('status, current_step, emails_sent, opens, clicks')
            .eq('sequence_id', id);

        // Calculate funnel stats
        const funnel = sequence.steps.map((step, i) => {
            const stepNum = step.step_number;
            const atOrPastStep = (enrollments || []).filter(e => e.current_step >= stepNum).length;
            return {
                stepNumber: stepNum,
                subject: step.subject_template.substring(0, 50),
                sent: step.emails_sent || 0,
                opens: step.opens || 0,
                clicks: step.clicks || 0,
                openRate: step.emails_sent > 0 ? Math.round((step.opens / step.emails_sent) * 100) : 0,
                clickRate: step.emails_sent > 0 ? Math.round((step.clicks / step.emails_sent) * 100) : 0,
                reachedStep: atOrPastStep,
            };
        });

        // Get status breakdown
        const statusBreakdown = {
            active: 0,
            completed: 0,
            stopped_reply: 0,
            stopped_click: 0,
            stopped_bounce: 0,
            stopped_unsubscribe: 0,
            paused: 0,
        };

        (enrollments || []).forEach(e => {
            if (statusBreakdown.hasOwnProperty(e.status)) {
                statusBreakdown[e.status]++;
            }
        });

        // Get recent activity
        const { data: recentEvents } = await supabase
            .from('email_tracking_events')
            .select(`
                *,
                lead:leads(name, email)
            `)
            .eq('user_id', userId)
            .in('enrollment_id', (enrollments || []).map(e => e.id))
            .order('event_at', { ascending: false })
            .limit(20);

        res.json({
            sequence: {
                id: sequence.id,
                name: sequence.name,
                status: sequence.status,
                total_enrolled: sequence.total_enrolled,
                total_sent: sequence.total_sent,
                total_opens: sequence.total_opens,
                total_clicks: sequence.total_clicks,
                total_replies: sequence.total_replies,
                total_bounces: sequence.total_bounces,
            },
            funnel,
            statusBreakdown,
            recentEvents: recentEvents || [],
        });
    } catch (error) {
        console.error('Sequence analytics error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/sequences/:id/enrollments
 * Get enrollments for a sequence with lead details
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
            .from('email_sequence_enrollments')
            .select(`
                *,
                lead:leads(id, name, email, phone, city, category, status)
            `, { count: 'exact' })
            .eq('sequence_id', id)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range((page - 1) * limit, page * limit - 1);

        if (status) {
            query = query.eq('status', status);
        }

        const { data, count, error } = await query;

        if (error) {
            console.error('Error fetching enrollments:', error);
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

/**
 * POST /api/sequences/:id/enrollments/:enrollmentId/stop
 * Manually stop an enrollment
 */
router.post('/:id/enrollments/:enrollmentId/stop', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id, enrollmentId } = req.params;
        const { reason = 'Manual stop' } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { error } = await supabase
            .from('email_sequence_enrollments')
            .update({
                status: 'paused',
                stopped_at: new Date().toISOString(),
                stopped_reason: reason,
                next_email_at: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId)
            .eq('sequence_id', id)
            .eq('user_id', userId);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Stop enrollment error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/sequences/:id/enrollments/:enrollmentId/resume
 * Resume a stopped/paused enrollment
 */
router.post('/:id/enrollments/:enrollmentId/resume', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id, enrollmentId } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { error } = await supabase
            .from('email_sequence_enrollments')
            .update({
                status: 'active',
                stopped_at: null,
                stopped_reason: null,
                next_email_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId)
            .eq('sequence_id', id)
            .eq('user_id', userId);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Resume enrollment error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
