/**
 * Email Sequence Scheduler
 * Manages automated email sequences - polls for due emails and sends them
 *
 * Runs a cron job every minute to check for emails that need to be sent.
 * Respects send windows (time of day, days of week) and stop conditions.
 */

import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import { sendSequenceEmail } from './emailTracking.js';
import { generatePersonalizedContent } from './emailPersonalization.js';

const POLL_BATCH_SIZE = 50;
const RETRY_DELAY_MINUTES = 5;

// Initialize Supabase with service role for backend operations
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * EmailSequenceScheduler - Manages automated email sequences
 * Runs a cron job every minute to check for due emails
 */
class EmailSequenceScheduler {
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
            await this.processDueEmails();
        });

        console.log('📧 Email sequence scheduler started - checking for due emails every minute');
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            console.log('📧 Email sequence scheduler stopped');
        }
    }

    /**
     * Main processing function - called every minute
     */
    async processDueEmails() {
        // Prevent overlapping processing
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            // Get enrollments with emails due now
            const dueEnrollments = await this.getDueEnrollments();

            if (dueEnrollments.length === 0) {
                return;
            }

            console.log(`📧 Processing ${dueEnrollments.length} due email(s)`);

            for (const enrollment of dueEnrollments) {
                await this.processEnrollment(enrollment);
            }

        } catch (error) {
            console.error('❌ Email scheduler error:', error.message);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Get enrollments with emails due to be sent
     */
    async getDueEnrollments() {
        const now = new Date();

        const { data, error } = await supabase
            .from('email_sequence_enrollments')
            .select(`
                *,
                sequence:email_sequences(*),
                lead:leads(*)
            `)
            .eq('status', 'active')
            .lte('next_email_at', now.toISOString())
            .order('next_email_at', { ascending: true })
            .limit(POLL_BATCH_SIZE);

        if (error) {
            console.error('Error fetching due enrollments:', error.message);
            return [];
        }

        // Filter by send window
        const filtered = (data || []).filter(enrollment => {
            return this.isWithinSendWindow(enrollment.sequence, now);
        });

        return filtered;
    }

    /**
     * Check if current time is within the sequence's send window
     */
    isWithinSendWindow(sequence, now = new Date()) {
        if (!sequence) return false;

        // Check day of week (1=Monday, 7=Sunday in PostgreSQL, JS: 0=Sunday)
        const dayOfWeek = now.getDay() || 7; // Convert JS Sunday (0) to 7
        const sendDays = sequence.send_days || [1, 2, 3, 4, 5];

        if (!sendDays.includes(dayOfWeek)) {
            return false;
        }

        // Check time window
        const timezone = sequence.timezone || 'UTC';
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
            // Fallback to UTC
            currentTime = now.getUTCHours() * 60 + now.getUTCMinutes();
        }

        const [startH, startM] = (sequence.send_window_start || '09:00').split(':').map(Number);
        const [endH, endM] = (sequence.send_window_end || '17:00').split(':').map(Number);

        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        return currentTime >= startMinutes && currentTime <= endMinutes;
    }

    /**
     * Process a single enrollment - send the next email in the sequence
     */
    async processEnrollment(enrollment) {
        const { id: enrollmentId, sequence, lead, current_step, user_id } = enrollment;

        if (!sequence || !lead) {
            console.error(`Missing sequence or lead for enrollment ${enrollmentId}`);
            return;
        }

        // Check if lead is unsubscribed
        const isUnsubscribed = await this.isEmailUnsubscribed(user_id, lead.email);
        if (isUnsubscribed) {
            await this.stopEnrollment(enrollmentId, 'unsubscribed', 'Email unsubscribed');
            return;
        }

        // Get the next step
        const nextStepNumber = current_step + 1;
        const { data: step, error: stepError } = await supabase
            .from('email_sequence_steps')
            .select('*')
            .eq('sequence_id', sequence.id)
            .eq('step_number', nextStepNumber)
            .single();

        if (stepError || !step) {
            // No more steps - mark as completed
            await this.completeEnrollment(enrollmentId, sequence.id);
            return;
        }

        try {
            // Get or generate personalized content
            let personalizedData = enrollment.personalized_data || {};
            if (!personalizedData.firstName || Object.keys(personalizedData).length === 0) {
                personalizedData = await generatePersonalizedContent(lead, sequence, user_id);
                // Cache it
                await supabase
                    .from('email_sequence_enrollments')
                    .update({ personalized_data: personalizedData })
                    .eq('id', enrollmentId);
            }

            // Get user's brand settings
            const { data: profile } = await supabase
                .from('profiles')
                .select('email, full_name')
                .eq('id', user_id)
                .single();

            // Get sender settings from campaign if linked
            let senderEmail = null;
            let senderName = null;

            if (sequence.campaign_id) {
                const { data: campaign } = await supabase
                    .from('campaigns')
                    .select('sender_email, sender_name')
                    .eq('id', sequence.campaign_id)
                    .single();

                if (campaign) {
                    senderEmail = campaign.sender_email;
                    senderName = campaign.sender_name;
                }
            }

            // Personalize subject and body
            const subject = this.personalizeTemplate(step.subject_template, lead, personalizedData);
            const body = this.personalizeTemplate(step.body_template, lead, personalizedData);

            // Send the email with tracking
            const result = await sendSequenceEmail({
                userId: user_id,
                enrollmentId,
                sequenceId: sequence.id,
                stepNumber: nextStepNumber,
                lead,
                subject,
                body,
                senderName: senderName || profile?.full_name || 'Team',
                senderEmail: senderEmail,
                ctaText: step.cta_text,
                ctaUrl: step.cta_url,
            });

            if (result.success) {
                // Advance to next step
                await this.advanceEnrollment(enrollmentId, sequence, nextStepNumber);

                // Update stats
                await this.incrementStats(sequence.id, nextStepNumber, lead.id);

                console.log(`✉️ Sent step ${nextStepNumber} to ${lead.email} (enrollment ${enrollmentId})`);
            } else {
                console.error(`Failed to send email to ${lead.email}:`, result.error);
                // Schedule retry
                await this.scheduleRetry(enrollmentId);
            }

        } catch (error) {
            console.error(`Error processing enrollment ${enrollmentId}:`, error.message);
            await this.scheduleRetry(enrollmentId);
        }
    }

    /**
     * Personalize a template with lead data
     */
    personalizeTemplate(template, lead, personalizedData = {}) {
        if (!template) return '';

        let result = template;

        // Standard replacements
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
     * Extract first name from business name (best effort)
     */
    extractFirstName(name) {
        if (!name) return null;

        // Common business suffixes to remove
        const suffixes = ['LLC', 'Inc', 'Corp', 'Ltd', 'Co', 'Company', 'Services', 'Solutions'];
        let cleaned = name;

        for (const suffix of suffixes) {
            cleaned = cleaned.replace(new RegExp(`\\s*${suffix}\\.?\\s*$`, 'i'), '');
        }

        // If it looks like a person's name (e.g., "John Smith"), return first word
        const words = cleaned.trim().split(/\s+/);
        if (words.length <= 3 && !cleaned.includes('&')) {
            return words[0];
        }

        return null;
    }

    /**
     * Advance enrollment to next step
     */
    async advanceEnrollment(enrollmentId, sequence, currentStepNumber) {
        // Get next step to calculate delay
        const { data: nextStep } = await supabase
            .from('email_sequence_steps')
            .select('delay_days, delay_hours')
            .eq('sequence_id', sequence.id)
            .eq('step_number', currentStepNumber + 1)
            .single();

        let nextEmailAt = null;

        if (nextStep) {
            // Calculate next email time
            nextEmailAt = new Date();
            nextEmailAt.setDate(nextEmailAt.getDate() + (nextStep.delay_days || 0));
            nextEmailAt.setHours(nextEmailAt.getHours() + (nextStep.delay_hours || 0));
        }

        await supabase
            .from('email_sequence_enrollments')
            .update({
                current_step: currentStepNumber,
                last_email_at: new Date().toISOString(),
                next_email_at: nextEmailAt?.toISOString() || null,
                emails_sent: supabase.sql`emails_sent + 1`,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);

        // If no next step, mark as completed
        if (!nextStep) {
            await this.completeEnrollment(enrollmentId, sequence.id);
        }
    }

    /**
     * Complete an enrollment (all steps done)
     */
    async completeEnrollment(enrollmentId, sequenceId) {
        await supabase
            .from('email_sequence_enrollments')
            .update({
                status: 'completed',
                next_email_at: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);

        console.log(`✅ Enrollment ${enrollmentId} completed all steps`);
    }

    /**
     * Stop an enrollment due to a condition (reply, click, bounce, unsubscribe)
     */
    async stopEnrollment(enrollmentId, status, reason) {
        await supabase
            .from('email_sequence_enrollments')
            .update({
                status: `stopped_${status}`,
                stopped_at: new Date().toISOString(),
                stopped_reason: reason,
                next_email_at: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);

        console.log(`🛑 Enrollment ${enrollmentId} stopped: ${reason}`);
    }

    /**
     * Schedule a retry after failure
     */
    async scheduleRetry(enrollmentId) {
        const nextRetry = new Date();
        nextRetry.setMinutes(nextRetry.getMinutes() + RETRY_DELAY_MINUTES);

        await supabase
            .from('email_sequence_enrollments')
            .update({
                next_email_at: nextRetry.toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', enrollmentId);
    }

    /**
     * Increment stats after sending
     */
    async incrementStats(sequenceId, stepNumber, leadId) {
        // Update sequence stats
        await supabase.rpc('increment_sequence_stats', {
            p_sequence_id: sequenceId,
            p_stat_name: 'total_sent',
            p_increment: 1
        }).catch(() => {
            // Fallback if RPC doesn't exist
            supabase
                .from('email_sequences')
                .update({ total_sent: supabase.sql`total_sent + 1` })
                .eq('id', sequenceId);
        });

        // Update step stats
        await supabase.rpc('increment_step_stats', {
            p_sequence_id: sequenceId,
            p_step_number: stepNumber,
            p_stat_name: 'emails_sent',
            p_increment: 1
        }).catch(() => {
            // Fallback if RPC doesn't exist
            supabase
                .from('email_sequence_steps')
                .update({ emails_sent: supabase.sql`emails_sent + 1` })
                .eq('sequence_id', sequenceId)
                .eq('step_number', stepNumber);
        });

        // Update lead stats
        await supabase
            .from('leads')
            .update({
                total_emails_sent: supabase.sql`COALESCE(total_emails_sent, 0) + 1`,
                last_email_at: new Date().toISOString(),
                email_status: 'contacted'
            })
            .eq('id', leadId);
    }

    /**
     * Check if an email is unsubscribed
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
     * Handle stop conditions when events occur
     * Called by webhook handlers
     */
    async handleStopCondition(enrollmentId, eventType) {
        // Get enrollment with sequence settings
        const { data: enrollment } = await supabase
            .from('email_sequence_enrollments')
            .select(`
                *,
                sequence:email_sequences(stop_on_reply, stop_on_click, stop_on_bounce)
            `)
            .eq('id', enrollmentId)
            .single();

        if (!enrollment || enrollment.status !== 'active') {
            return;
        }

        const sequence = enrollment.sequence;

        if (eventType === 'reply' && sequence.stop_on_reply) {
            await this.stopEnrollment(enrollmentId, 'reply', 'Lead replied to email');
        } else if (eventType === 'click' && sequence.stop_on_click) {
            await this.stopEnrollment(enrollmentId, 'click', 'Lead clicked a link');
        } else if (eventType === 'bounce' && sequence.stop_on_bounce) {
            await this.stopEnrollment(enrollmentId, 'bounce', 'Email bounced');
        }
    }
}

// Export singleton instance
const emailSequenceScheduler = new EmailSequenceScheduler();
export default emailSequenceScheduler;
export { EmailSequenceScheduler };
