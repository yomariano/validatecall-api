/**
 * Multi-Channel Workflow Scheduler
 * Handles unified outreach workflows with email + voice calls
 *
 * Runs a cron job every minute to process due actions.
 * Supports: email, call, sms, wait steps
 */

import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import { sendSequenceEmail } from './emailTracking.js';
import { generatePersonalizedContent } from './emailPersonalization.js';

const POLL_BATCH_SIZE = 50;
const RETRY_DELAY_MINUTES = 5;

// Clean environment variables
const cleanEnvVar = (val) => val?.replace(/["';]/g, '').trim();
const vapiApiKey = cleanEnvVar(process.env.VAPI_API_KEY);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * WorkflowScheduler - Manages multi-channel outreach workflows
 */
class WorkflowScheduler {
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
            await this.processDueActions();
        });

        console.log('🔄 Workflow scheduler started - checking for due actions every minute');
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            console.log('🔄 Workflow scheduler stopped');
        }
    }

    /**
     * Main processing function
     */
    async processDueActions() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const dueEnrollments = await this.getDueEnrollments();

            if (dueEnrollments.length === 0) return;

            console.log(`🔄 Processing ${dueEnrollments.length} due workflow action(s)`);

            for (const enrollment of dueEnrollments) {
                await this.processEnrollment(enrollment);
            }

        } catch (error) {
            console.error('❌ Workflow scheduler error:', error.message);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get enrollments with actions due now
     */
    async getDueEnrollments() {
        const now = new Date();

        const { data, error } = await supabase
            .from('workflow_enrollments')
            .select(`
                *,
                workflow:outreach_workflows(*),
                lead:leads(*)
            `)
            .eq('status', 'active')
            .lte('next_action_at', now.toISOString())
            .order('next_action_at', { ascending: true })
            .limit(POLL_BATCH_SIZE);

        if (error) {
            console.error('Error fetching due enrollments:', error.message);
            return [];
        }

        // Filter by send window
        return (data || []).filter(enrollment => {
            return this.isWithinSendWindow(enrollment.workflow, now);
        });
    }

    /**
     * Check if current time is within send window
     */
    isWithinSendWindow(workflow, now = new Date()) {
        if (!workflow) return false;

        const dayOfWeek = now.getDay() || 7;
        const sendDays = workflow.send_days || [1, 2, 3, 4, 5];

        if (!sendDays.includes(dayOfWeek)) return false;

        const timezone = workflow.timezone || 'UTC';
        let currentTime;

        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const parts = formatter.formatToParts(now);
            const hour = parseInt(parts.find(p => p.type === 'hour').value);
            const minute = parseInt(parts.find(p => p.type === 'minute').value);
            currentTime = hour * 60 + minute;
        } catch {
            currentTime = now.getUTCHours() * 60 + now.getUTCMinutes();
        }

        const [startH, startM] = (workflow.send_window_start || '09:00').split(':').map(Number);
        const [endH, endM] = (workflow.send_window_end || '17:00').split(':').map(Number);

        return currentTime >= (startH * 60 + startM) && currentTime <= (endH * 60 + endM);
    }

    /**
     * Process a single enrollment
     */
    async processEnrollment(enrollment) {
        const { id: enrollmentId, workflow, lead, current_step, user_id, next_action_type } = enrollment;

        if (!workflow || !lead) {
            console.error(`Missing workflow or lead for enrollment ${enrollmentId}`);
            return;
        }

        // Check unsubscribe
        const isUnsubscribed = await this.isEmailUnsubscribed(user_id, lead.email);
        if (isUnsubscribed) {
            await this.stopEnrollment(enrollmentId, 'unsubscribed', 'Email unsubscribed');
            return;
        }

        // Get next step
        const nextStepNumber = current_step + 1;
        const { data: step, error: stepError } = await supabase
            .from('workflow_steps')
            .select('*')
            .eq('workflow_id', workflow.id)
            .eq('step_number', nextStepNumber)
            .single();

        if (stepError || !step) {
            await this.completeEnrollment(enrollmentId, workflow.id);
            return;
        }

        // Check step condition
        const shouldExecute = await this.checkStepCondition(enrollment, step);
        if (!shouldExecute) {
            // Skip this step, advance to next
            await this.advanceToNextStep(enrollmentId, workflow, nextStepNumber);
            return;
        }

        try {
            let result;

            switch (step.step_type) {
                case 'email':
                    result = await this.executeEmailStep(enrollment, step, workflow);
                    break;
                case 'call':
                    result = await this.executeCallStep(enrollment, step, workflow);
                    break;
                case 'sms':
                    result = await this.executeSmsStep(enrollment, step, workflow);
                    break;
                case 'wait':
                    result = { success: true };
                    break;
                default:
                    console.error(`Unknown step type: ${step.step_type}`);
                    result = { success: false };
            }

            if (result.success) {
                await this.advanceToNextStep(enrollmentId, workflow, nextStepNumber);
                await this.logAction(enrollment, step, result);
                await this.incrementStats(workflow.id, step, result);

                console.log(`✅ Executed ${step.step_type} step ${nextStepNumber} for ${lead.email}`);
            } else {
                console.error(`Failed ${step.step_type} for ${lead.email}:`, result.error);
                await this.scheduleRetry(enrollmentId);
            }

        } catch (error) {
            console.error(`Error processing enrollment ${enrollmentId}:`, error.message);
            await this.scheduleRetry(enrollmentId);
        }
    }

    /**
     * Check if step condition is met
     */
    async checkStepCondition(enrollment, step) {
        const condition = step.condition || 'always';

        switch (condition) {
            case 'always':
                return true;

            case 'no_reply':
                // Check if lead has replied
                const { data: replies } = await supabase
                    .from('email_responses')
                    .select('id')
                    .eq('lead_id', enrollment.lead_id)
                    .eq('user_id', enrollment.user_id)
                    .limit(1);
                return !replies || replies.length === 0;

            case 'no_open':
                // Check if any email was opened
                return enrollment.opens === 0;

            case 'no_answer':
                // Check if any call was answered
                const { data: answeredCalls } = await supabase
                    .from('workflow_action_log')
                    .select('id')
                    .eq('enrollment_id', enrollment.id)
                    .eq('action_result', 'answered')
                    .limit(1);
                return !answeredCalls || answeredCalls.length === 0;

            default:
                return true;
        }
    }

    /**
     * Execute an email step
     */
    async executeEmailStep(enrollment, step, workflow) {
        const { lead, user_id, id: enrollmentId, personalized_data } = enrollment;

        // Get or generate personalized content
        let personalizedData = personalized_data || {};
        if (Object.keys(personalizedData).length === 0) {
            personalizedData = await generatePersonalizedContent(lead, workflow, user_id);
            await supabase
                .from('workflow_enrollments')
                .update({ personalized_data: personalizedData })
                .eq('id', enrollmentId);
        }

        // Get sender info
        const { data: profile } = await supabase
            .from('profiles')
            .select('email, full_name')
            .eq('id', user_id)
            .single();

        let senderEmail = null;
        let senderName = null;

        if (workflow.campaign_id) {
            const { data: campaign } = await supabase
                .from('campaigns')
                .select('sender_email, sender_name')
                .eq('id', workflow.campaign_id)
                .single();

            if (campaign) {
                senderEmail = campaign.sender_email;
                senderName = campaign.sender_name;
            }
        }

        // Personalize content
        const subject = this.personalizeTemplate(step.email_subject, lead, personalizedData);
        const body = this.personalizeTemplate(step.email_body, lead, personalizedData);

        // Send email
        const result = await sendSequenceEmail({
            userId: user_id,
            enrollmentId,
            sequenceId: workflow.id,
            stepNumber: step.step_number,
            lead,
            subject,
            body,
            senderName: senderName || profile?.full_name || 'Team',
            senderEmail,
            ctaText: step.email_cta_text,
            ctaUrl: step.email_cta_url,
        });

        return {
            success: result.success,
            actionType: 'email_sent',
            emailId: result.emailId,
            trackingId: result.trackingId,
            error: result.error,
        };
    }

    /**
     * Execute a voice call step
     */
    async executeCallStep(enrollment, step, workflow) {
        const { lead, user_id, id: enrollmentId, personalized_data } = enrollment;

        if (!vapiApiKey) {
            return { success: false, error: 'VAPI not configured' };
        }

        if (!lead.phone) {
            return { success: false, error: 'Lead has no phone number' };
        }

        // Get assistant ID
        const assistantId = step.call_assistant_id || workflow.default_assistant_id;
        if (!assistantId) {
            return { success: false, error: 'No assistant configured for call' };
        }

        // Get campaign context
        let productIdea = '';
        let companyContext = '';

        if (workflow.campaign_id) {
            const { data: campaign } = await supabase
                .from('campaigns')
                .select('product_idea, company_context')
                .eq('id', workflow.campaign_id)
                .single();

            if (campaign) {
                productIdea = campaign.product_idea || '';
                companyContext = campaign.company_context || '';
            }
        }

        // Add personalized context for the AI
        const personalizedData = personalized_data || {};
        const callContext = `
${companyContext}

LEAD INFO:
- Business: ${lead.name}
- Industry: ${lead.category || 'Unknown'}
- Location: ${lead.city || 'Unknown'}

${step.call_script_context || ''}

${personalizedData.openingLine ? `Opening suggestion: ${personalizedData.openingLine}` : ''}
${personalizedData.painPoint ? `Pain point to address: ${personalizedData.painPoint}` : ''}
        `.trim();

        try {
            // Initiate VAPI call
            const response = await fetch('https://api.vapi.ai/call', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${vapiApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    assistantId,
                    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
                    customer: {
                        number: lead.phone,
                        name: lead.name,
                    },
                    assistantOverrides: {
                        firstMessage: `Hi, is this ${personalizedData.firstName || lead.name}?`,
                        model: {
                            messages: [
                                {
                                    role: 'system',
                                    content: callContext,
                                }
                            ]
                        }
                    },
                    metadata: {
                        workflowId: workflow.id,
                        enrollmentId,
                        stepNumber: step.step_number,
                        leadId: lead.id,
                        userId: user_id,
                    }
                }),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`VAPI error: ${error}`);
            }

            const callData = await response.json();

            // Log the call initiation
            await supabase.from('calls').insert({
                user_id,
                lead_id: lead.id,
                campaign_id: workflow.campaign_id,
                vapi_call_id: callData.id,
                phone_number: lead.phone,
                status: 'queued',
                metadata: {
                    workflowId: workflow.id,
                    enrollmentId,
                    stepNumber: step.step_number,
                }
            });

            return {
                success: true,
                actionType: 'call_initiated',
                callId: callData.id,
            };

        } catch (error) {
            return {
                success: false,
                actionType: 'call_initiated',
                error: error.message,
            };
        }
    }

    /**
     * Execute an SMS step (placeholder)
     */
    async executeSmsStep(enrollment, step, workflow) {
        // SMS implementation would go here
        // For now, just skip
        console.log('SMS step not implemented yet');
        return { success: true, actionType: 'sms_skipped' };
    }

    /**
     * Personalize a template
     */
    personalizeTemplate(template, lead, personalizedData = {}) {
        if (!template) return '';

        let result = template;

        const replacements = {
            '{{businessName}}': lead.name || 'there',
            '{{firstName}}': personalizedData.firstName || this.extractFirstName(lead.name) || 'there',
            '{{city}}': lead.city || '',
            '{{industry}}': lead.category || '',
            '{{address}}': lead.address || '',
            '{{rating}}': lead.rating || '',
            '{{openingLine}}': personalizedData.openingLine || '',
            '{{painPoint}}': personalizedData.painPoint || '',
            '{{valueProposition}}': personalizedData.valueProposition || '',
            '{{followUpHook}}': personalizedData.followUpHook || '',
            '[Business Name]': lead.name || 'there',
        };

        for (const [key, value] of Object.entries(replacements)) {
            result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
        }

        return result;
    }

    /**
     * Extract first name
     */
    extractFirstName(name) {
        if (!name) return null;
        const suffixes = ['LLC', 'Inc', 'Corp', 'Ltd', 'Co', 'Company', 'Services', 'Solutions'];
        let cleaned = name;
        for (const suffix of suffixes) {
            cleaned = cleaned.replace(new RegExp(`\\s*${suffix}\\.?\\s*$`, 'i'), '');
        }
        const words = cleaned.trim().split(/\s+/);
        if (words.length <= 3 && !cleaned.includes('&')) {
            return words[0];
        }
        return null;
    }

    /**
     * Advance to next step
     */
    async advanceToNextStep(enrollmentId, workflow, currentStepNumber) {
        // Get next step
        const { data: nextStep } = await supabase
            .from('workflow_steps')
            .select('*')
            .eq('workflow_id', workflow.id)
            .eq('step_number', currentStepNumber + 1)
            .single();

        let nextActionAt = null;
        let nextActionType = null;

        if (nextStep) {
            // Calculate next action time
            nextActionAt = new Date();
            nextActionAt.setDate(nextActionAt.getDate() + (nextStep.delay_days || 0));
            nextActionAt.setHours(nextActionAt.getHours() + (nextStep.delay_hours || 0));
            nextActionAt.setMinutes(nextActionAt.getMinutes() + (nextStep.delay_minutes || 0));
            nextActionType = nextStep.step_type;
        }

        await supabase
            .from('workflow_enrollments')
            .update({
                current_step: currentStepNumber,
                last_action_at: new Date().toISOString(),
                next_action_at: nextActionAt?.toISOString() || null,
                next_action_type: nextActionType,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);

        if (!nextStep) {
            await this.completeEnrollment(enrollmentId, workflow.id);
        }
    }

    /**
     * Complete enrollment
     */
    async completeEnrollment(enrollmentId, workflowId) {
        await supabase
            .from('workflow_enrollments')
            .update({
                status: 'completed',
                next_action_at: null,
                next_action_type: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);

        console.log(`✅ Enrollment ${enrollmentId} completed all steps`);
    }

    /**
     * Stop enrollment
     */
    async stopEnrollment(enrollmentId, status, reason) {
        await supabase
            .from('workflow_enrollments')
            .update({
                status: `stopped_${status}`,
                stopped_at: new Date().toISOString(),
                stopped_reason: reason,
                next_action_at: null,
                next_action_type: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);

        console.log(`🛑 Enrollment ${enrollmentId} stopped: ${reason}`);
    }

    /**
     * Schedule retry
     */
    async scheduleRetry(enrollmentId) {
        const nextRetry = new Date();
        nextRetry.setMinutes(nextRetry.getMinutes() + RETRY_DELAY_MINUTES);

        await supabase
            .from('workflow_enrollments')
            .update({
                next_action_at: nextRetry.toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);
    }

    /**
     * Log action
     */
    async logAction(enrollment, step, result) {
        await supabase.from('workflow_action_log').insert({
            workflow_id: enrollment.workflow.id,
            enrollment_id: enrollment.id,
            step_id: step.id,
            lead_id: enrollment.lead_id,
            user_id: enrollment.user_id,
            action_type: result.actionType,
            action_result: result.success ? 'success' : 'failed',
            email_log_id: result.emailLogId || null,
            call_id: result.callId || null,
            tracking_id: result.trackingId || null,
            metadata: {
                stepNumber: step.step_number,
                stepType: step.step_type,
                error: result.error,
            }
        });
    }

    /**
     * Increment stats
     */
    async incrementStats(workflowId, step, result) {
        // Workflow stats
        const workflowStats = {};
        if (step.step_type === 'email' && result.success) {
            workflowStats.total_emails_sent = supabase.sql`total_emails_sent + 1`;
        } else if (step.step_type === 'call' && result.success) {
            workflowStats.total_calls_made = supabase.sql`total_calls_made + 1`;
        }

        if (Object.keys(workflowStats).length > 0) {
            await supabase
                .from('outreach_workflows')
                .update({ ...workflowStats, updated_at: new Date().toISOString() })
                .eq('id', workflowId);
        }

        // Step stats
        const stepStats = { executed: supabase.sql`executed + 1` };
        if (step.step_type === 'email' && result.success) {
            stepStats.emails_sent = supabase.sql`emails_sent + 1`;
        } else if (step.step_type === 'call' && result.success) {
            stepStats.calls_made = supabase.sql`calls_made + 1`;
        }

        await supabase
            .from('workflow_steps')
            .update(stepStats)
            .eq('id', step.id);
    }

    /**
     * Check if email is unsubscribed
     */
    async isEmailUnsubscribed(userId, email) {
        const { data } = await supabase
            .from('email_unsubscribes')
            .select('id')
            .eq('user_id', userId)
            .eq('email', email)
            .maybeSingle();

        return !!data;
    }

    /**
     * Handle stop conditions from external events
     */
    async handleStopCondition(enrollmentId, eventType) {
        const { data: enrollment } = await supabase
            .from('workflow_enrollments')
            .select(`
                *,
                workflow:outreach_workflows(
                    stop_on_reply,
                    stop_on_call_answered,
                    stop_on_click,
                    stop_on_bounce
                )
            `)
            .eq('id', enrollmentId)
            .single();

        if (!enrollment || enrollment.status !== 'active') return;

        const workflow = enrollment.workflow;

        if (eventType === 'reply' && workflow.stop_on_reply) {
            await this.stopEnrollment(enrollmentId, 'reply', 'Lead replied to email');
        } else if (eventType === 'call_answered' && workflow.stop_on_call_answered) {
            await this.stopEnrollment(enrollmentId, 'call', 'Lead answered call');
        } else if (eventType === 'click' && workflow.stop_on_click) {
            await this.stopEnrollment(enrollmentId, 'click', 'Lead clicked a link');
        } else if (eventType === 'bounce' && workflow.stop_on_bounce) {
            await this.stopEnrollment(enrollmentId, 'bounce', 'Email bounced');
        }
    }
}

// Export singleton
const workflowScheduler = new WorkflowScheduler();
export default workflowScheduler;
export { WorkflowScheduler };
