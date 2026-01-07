import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =============================================
// SCHEDULED CALLS ENDPOINTS
// =============================================

/**
 * Schedule a new call
 * POST /api/scheduled/calls
 */
router.post('/calls', async (req, res) => {
    try {
        const {
            userId,
            leadId,
            campaignId,
            phoneNumber,
            customerName,
            scheduledAt,
            productIdea,
            companyContext,
            assistantId,
            maxRetries = 3,
        } = req.body;

        // Validation
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        if (!phoneNumber) {
            return res.status(400).json({ error: 'phoneNumber is required' });
        }
        if (!scheduledAt) {
            return res.status(400).json({ error: 'scheduledAt is required' });
        }
        if (!productIdea) {
            return res.status(400).json({ error: 'productIdea is required' });
        }

        // Validate scheduled time is in the future
        const scheduledTime = new Date(scheduledAt);
        if (scheduledTime <= new Date()) {
            return res.status(400).json({ error: 'scheduledAt must be in the future' });
        }

        // Create scheduled call
        const { data, error } = await supabase
            .from('scheduled_calls')
            .insert({
                user_id: userId,
                lead_id: leadId || null,
                campaign_id: campaignId || null,
                phone_number: phoneNumber,
                customer_name: customerName || null,
                scheduled_at: scheduledAt,
                product_idea: productIdea,
                company_context: companyContext || null,
                assistant_id: assistantId || null,
                max_retries: maxRetries,
                status: 'pending',
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating scheduled call:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log(`📅 Scheduled call created: ${data.id} for ${scheduledAt}`);

        res.status(201).json({
            message: 'Call scheduled successfully',
            data,
        });
    } catch (error) {
        console.error('Schedule call error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get scheduled calls for a user
 * GET /api/scheduled/calls?userId=xxx&status=pending&limit=50
 */
router.get('/calls', async (req, res) => {
    try {
        const { userId, status, limit = 50 } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        let query = supabase
            .from('scheduled_calls')
            .select(`
                *,
                lead:leads(id, name, phone, category)
            `)
            .eq('user_id', userId)
            .order('scheduled_at', { ascending: true })
            .limit(parseInt(limit));

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching scheduled calls:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({
            data,
            count: data.length,
        });
    } catch (error) {
        console.error('Get scheduled calls error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get a specific scheduled call
 * GET /api/scheduled/calls/:id
 */
router.get('/calls/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('scheduled_calls')
            .select(`
                *,
                lead:leads(id, name, phone, category, address),
                call:calls(id, status, duration_seconds, transcript, summary)
            `)
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Scheduled call not found' });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ data });
    } catch (error) {
        console.error('Get scheduled call error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Update a scheduled call (reschedule or modify)
 * PATCH /api/scheduled/calls/:id
 */
router.patch('/calls/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            scheduledAt,
            productIdea,
            companyContext,
            assistantId,
            maxRetries,
        } = req.body;

        // Check current status - only pending calls can be modified
        const { data: existing, error: fetchError } = await supabase
            .from('scheduled_calls')
            .select('status')
            .eq('id', id)
            .single();

        if (fetchError) {
            if (fetchError.code === 'PGRST116') {
                return res.status(404).json({ error: 'Scheduled call not found' });
            }
            return res.status(500).json({ error: fetchError.message });
        }

        if (!['pending', 'retry_scheduled', 'failed'].includes(existing.status)) {
            return res.status(400).json({
                error: `Cannot modify call with status: ${existing.status}`,
            });
        }

        // Build update object
        const updates = {};
        if (scheduledAt) {
            const scheduledTime = new Date(scheduledAt);
            if (scheduledTime <= new Date()) {
                return res.status(400).json({ error: 'scheduledAt must be in the future' });
            }
            updates.scheduled_at = scheduledAt;
            updates.status = 'pending'; // Reset status if rescheduling
            updates.retry_count = 0;
            updates.next_retry_at = null;
            updates.last_error = null;
        }
        if (productIdea) updates.product_idea = productIdea;
        if (companyContext !== undefined) updates.company_context = companyContext;
        if (assistantId !== undefined) updates.assistant_id = assistantId;
        if (maxRetries !== undefined) updates.max_retries = maxRetries;

        const { data, error } = await supabase
            .from('scheduled_calls')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        console.log(`📅 Scheduled call updated: ${id}`);

        res.json({
            message: 'Scheduled call updated',
            data,
        });
    } catch (error) {
        console.error('Update scheduled call error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Cancel a scheduled call
 * DELETE /api/scheduled/calls/:id
 */
router.delete('/calls/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check current status
        const { data: existing, error: fetchError } = await supabase
            .from('scheduled_calls')
            .select('status')
            .eq('id', id)
            .single();

        if (fetchError) {
            if (fetchError.code === 'PGRST116') {
                return res.status(404).json({ error: 'Scheduled call not found' });
            }
            return res.status(500).json({ error: fetchError.message });
        }

        // Can only cancel pending or retry_scheduled calls
        if (!['pending', 'retry_scheduled'].includes(existing.status)) {
            return res.status(400).json({
                error: `Cannot cancel call with status: ${existing.status}`,
            });
        }

        // Update status to cancelled (soft delete)
        const { data, error } = await supabase
            .from('scheduled_calls')
            .update({ status: 'cancelled' })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        console.log(`📅 Scheduled call cancelled: ${id}`);

        res.json({
            message: 'Scheduled call cancelled',
            data,
        });
    } catch (error) {
        console.error('Cancel scheduled call error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get scheduled calls stats for a user
 * GET /api/scheduled/stats?userId=xxx
 */
router.get('/stats', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        // Get counts by status
        const { data, error } = await supabase
            .from('scheduled_calls')
            .select('status')
            .eq('user_id', userId);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        const stats = {
            total: data.length,
            pending: data.filter(c => c.status === 'pending').length,
            in_progress: data.filter(c => c.status === 'in_progress').length,
            completed: data.filter(c => c.status === 'completed').length,
            failed: data.filter(c => c.status === 'failed').length,
            retry_scheduled: data.filter(c => c.status === 'retry_scheduled').length,
            cancelled: data.filter(c => c.status === 'cancelled').length,
        };

        res.json({ stats });
    } catch (error) {
        console.error('Get scheduled stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Bulk schedule calls (for campaigns)
 * POST /api/scheduled/calls/bulk
 */
router.post('/calls/bulk', async (req, res) => {
    try {
        const {
            userId,
            campaignId,
            calls, // Array of { leadId, phoneNumber, customerName }
            scheduledAt,
            productIdea,
            companyContext,
            assistantId,
            maxRetries = 3,
            delayBetweenCallsMs = 60000, // 1 minute between calls by default
        } = req.body;

        // Validation
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }
        if (!calls || !Array.isArray(calls) || calls.length === 0) {
            return res.status(400).json({ error: 'calls array is required' });
        }
        if (!scheduledAt) {
            return res.status(400).json({ error: 'scheduledAt is required' });
        }
        if (!productIdea) {
            return res.status(400).json({ error: 'productIdea is required' });
        }

        const baseTime = new Date(scheduledAt);
        if (baseTime <= new Date()) {
            return res.status(400).json({ error: 'scheduledAt must be in the future' });
        }

        // Create scheduled calls with staggered times
        const scheduledCalls = calls.map((call, index) => ({
            user_id: userId,
            lead_id: call.leadId || null,
            campaign_id: campaignId || null,
            phone_number: call.phoneNumber,
            customer_name: call.customerName || null,
            scheduled_at: new Date(baseTime.getTime() + (index * delayBetweenCallsMs)).toISOString(),
            product_idea: productIdea,
            company_context: companyContext || null,
            assistant_id: assistantId || null,
            max_retries: maxRetries,
            status: 'pending',
        }));

        const { data, error } = await supabase
            .from('scheduled_calls')
            .insert(scheduledCalls)
            .select();

        if (error) {
            console.error('Error creating bulk scheduled calls:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log(`📅 Bulk scheduled ${data.length} calls starting at ${scheduledAt}`);

        res.status(201).json({
            message: `${data.length} calls scheduled successfully`,
            data,
            summary: {
                total: data.length,
                firstCallAt: scheduledCalls[0].scheduled_at,
                lastCallAt: scheduledCalls[scheduledCalls.length - 1].scheduled_at,
            },
        });
    } catch (error) {
        console.error('Bulk schedule error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
