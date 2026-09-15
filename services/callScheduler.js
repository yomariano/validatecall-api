import { dispatchFleetCall } from './assistantFleet.js';
import { claimScheduledCall } from './jobClaims.js';
import cron from 'node-cron';
import { createDatabase } from '../db/database.js';


const RETRY_DELAY_MINUTES = 10;
const POLL_BATCH_SIZE = 10;

// Initialize PostgreSQL with service role for backend operations
const db = createDatabase();

/**
 * CallScheduler - Manages scheduled phone calls
 * Runs a cron job every minute to check for due calls
 */
class CallScheduler {
    constructor() {
        this.isProcessing = false;
        this.cronJob = null;
    }

    /**
     * Start the scheduler
     */
    start() {
        // Run every minute
        this.cronJob = cron.schedule('* * * * *', async () => {
            await this.processDueCalls();
        });

        console.log('📅 Call scheduler started - checking for due calls every minute');
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            console.log('📅 Call scheduler stopped');
        }
    }

    /**
     * Main processing function - called every minute
     */
    async processDueCalls() {
        // Prevent overlapping processing
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            // 1. Process pending calls that are due
            const pendingCalls = await this.getDuePendingCalls();
            for (const scheduledCall of pendingCalls) {
                await this.executeScheduledCall(scheduledCall);
            }

            // 2. Process retry calls that are due
            const retryCalls = await this.getDueRetryCalls();
            for (const scheduledCall of retryCalls) {
                await this.executeScheduledCall(scheduledCall);
            }

            const totalProcessed = pendingCalls.length + retryCalls.length;
            if (totalProcessed > 0) {
                console.log(`📞 Processed ${totalProcessed} scheduled call(s)`);
            }
        } catch (error) {
            console.error('❌ Scheduler error:', error.message);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get pending calls that are due now
     */
    async getDuePendingCalls() {
        const { data, error } = await db
            .from('scheduled_calls')
            .select('*')
            .eq('status', 'pending')
            .lte('scheduled_at', new Date().toISOString())
            .order('scheduled_at', { ascending: true })
            .limit(POLL_BATCH_SIZE);

        if (error) {
            console.error('Error fetching pending calls:', error.message);
            return [];
        }

        return data || [];
    }

    /**
     * Get retry calls that are due now
     */
    async getDueRetryCalls() {
        const { data, error } = await db
            .from('scheduled_calls')
            .select('*')
            .eq('status', 'retry_scheduled')
            .lte('next_retry_at', new Date().toISOString())
            .order('next_retry_at', { ascending: true })
            .limit(POLL_BATCH_SIZE);

        if (error) {
            console.error('Error fetching retry calls:', error.message);
            return [];
        }

        return data || [];
    }

    /**
     * Execute a scheduled call
     */
    async executeScheduledCall(scheduledCall) {
        const { id, user_id, phone_number, customer_name, product_idea, company_context, assistant_id, lead_id, from_number_id } = scheduledCall;

        console.log(`📞 Executing scheduled call ${id} to ${phone_number}`);

        // Mark as in_progress
        if (!await claimScheduledCall(db, scheduledCall)) return;

        try {
            const result = await dispatchFleetCall(user_id, { phoneNumber:phone_number, customerName:customer_name,
                productIdea:product_idea, companyContext:company_context, assistantId:assistant_id, fromNumberId:from_number_id });
            const { data: call } = await db.from('calls').select('id').eq('vapi_call_id',result.id).eq('user_id',user_id).single();
            if (call && lead_id) await db.from('calls').update({lead_id}).eq('id',call.id).eq('user_id',user_id);
            await this.updateStatus(id,'completed',{call_id:call?.id,vapi_call_id:result.id,completed_at:new Date().toISOString()});
        } catch(error) {
            if (error.providerRequestStarted) await this.updateStatus(id,'failed',{last_error:'Provider outcome needs review before retry.'});
            else await this.handleCallFailure(scheduledCall,error);
        }
    }

    /**
     * Handle call failure - schedule retry or mark as failed
     */
    async handleCallFailure(scheduledCall, error) {
        const { id, retry_count, max_retries } = scheduledCall;
        const newRetryCount = retry_count + 1;

        if (newRetryCount < max_retries) {
            // Schedule retry
            const nextRetryAt = new Date(Date.now() + RETRY_DELAY_MINUTES * 60 * 1000);

            await this.updateStatus(id, 'retry_scheduled', {
                retry_count: newRetryCount,
                next_retry_at: nextRetryAt.toISOString(),
                last_error: error.message,
            });

            console.log(`🔄 Scheduled call ${id} will retry at ${nextRetryAt.toISOString()} (attempt ${newRetryCount + 1}/${max_retries})`);
        } else {
            // Max retries exceeded
            await this.updateStatus(id, 'failed', {
                retry_count: newRetryCount,
                last_error: error.message,
            });

            console.log(`❌ Scheduled call ${id} permanently failed after ${max_retries} attempts`);
        }
    }

    /**
     * Update scheduled call status
     */
    async updateStatus(id, status, additionalUpdates = {}) {
        const { error } = await db
            .from('scheduled_calls')
            .update({
                status,
                updated_at: new Date().toISOString(),
                ...additionalUpdates,
            })
            .eq('id', id);

        if (error) {
            console.error(`Error updating scheduled call ${id}:`, error.message);
        }
    }

    /**
     * Get next available phone number for a user
     */

    /**
     * Increment phone usage counter
     */
    async incrementPhoneUsage(phoneNumberId, userId, callId = null) {
        const { error: rpcError } = await db.rpc('increment_phone_usage', {
            p_phone_number_id: phoneNumberId,
            p_user_id: userId,
            p_call_id: callId
        });

        // Fallback if RPC doesn't exist - use read-then-update
        if (rpcError) {
            console.log('  [Scheduler] RPC not available, using fallback increment');

            // Get current values
            const { data: current, error: readError } = await db
                .from('user_phone_numbers')
                .select('daily_calls_used, total_calls_made')
                .eq('phone_number_id', phoneNumberId)
                .eq('user_id', userId)
                .single();

            if (readError || !current) {
                console.error('[Scheduler] Failed to read phone number for increment:', readError);
                return;
            }

            // Update with incremented values
            const { error: updateError } = await db
                .from('user_phone_numbers')
                .update({
                    daily_calls_used: (current.daily_calls_used || 0) + 1,
                    total_calls_made: (current.total_calls_made || 0) + 1,
                })
                .eq('phone_number_id', phoneNumberId)
                .eq('user_id', userId);

            if (updateError) {
                console.error('[Scheduler] Failed to increment phone usage:', updateError);
            }
        }
    }

    /**
     * Build system prompt for market research
     */
    buildSystemPrompt(productIdea, companyContext) {
        return `You are Alex, a friendly market researcher having a casual phone conversation. Your goal is to learn about business challenges in a natural, conversational way.

WHAT YOU'RE RESEARCHING:
${productIdea || 'A new product or service'}

${companyContext ? `ABOUT THE COMPANY:\n${companyContext}` : ''}

YOUR PERSONALITY:
- Warm, curious, and genuinely interested
- Speak like a real person, not a survey bot
- Keep responses concise - 1-2 sentences max
- React authentically before moving on

CONVERSATION FLOW:
1. Brief greeting and permission to chat
2. Ask about their role and day-to-day challenges
3. Naturally introduce what you're researching
4. Get their honest reaction and feedback
5. Thank them and ask if they'd like updates

IMPORTANT:
- If they're busy, offer to call back later
- If they're not the right person, ask who is
- Never be pushy - respect their time`;
    }

    /**
     * Build first message
     */
    buildFirstMessage(productIdea) {
        return `Hey! This is Alex - I'm doing some quick market research${productIdea ? ` on ${productIdea.substring(0, 50)}` : ''}. Got like 2 minutes?`;
    }

    /**
     * Create market research assistant config
     */
    createMarketResearchAssistant(productIdea, companyContext) {
        return {
            name: 'Market Research Agent',
            model: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                temperature: 0.7,
                messages: [{
                    role: 'system',
                    content: this.buildSystemPrompt(productIdea, companyContext)
                }]
            },
            voice: {
                provider: '11labs',
                voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel
                stability: 0.4,
                similarityBoost: 0.75,
                style: 0.5,
            },
            firstMessage: this.buildFirstMessage(productIdea),
            endCallMessage: 'Thanks so much for your time - have a great day!',
            silenceTimeoutSeconds: 30,
            maxDurationSeconds: 300,
        };
    }
}

// Export singleton instance
const callScheduler = new CallScheduler();
export default callScheduler;
