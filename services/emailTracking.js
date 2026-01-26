/**
 * Email Tracking Service
 * Handles tracking pixels, link wrapping, and sending tracked emails
 *
 * Features:
 * - Unique tracking ID per email
 * - 1x1 pixel for open tracking
 * - Link wrapping for click tracking
 * - Unsubscribe link insertion
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import crypto from 'crypto';
import { generateColdEmailHtml } from './email.js';
import { getBrandSettings } from './userSettings.js';
import { getUserResendApiKey, getActiveEmailProvider } from './userSettings.js';

const API_URL = process.env.API_URL || 'http://localhost:3002';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Generate a unique tracking ID
 */
export function generateTrackingId() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Insert tracking pixel into HTML email
 * @param {string} html - Email HTML content
 * @param {string} trackingId - Unique tracking ID
 * @returns {string} HTML with tracking pixel
 */
export function insertTrackingPixel(html, trackingId) {
    const pixel = `<img src="${API_URL}/api/email-tracking/open?tid=${trackingId}" width="1" height="1" style="display:none;visibility:hidden;width:1px;height:1px;border:0;" alt="" />`;

    // Insert before closing body tag
    if (html.includes('</body>')) {
        return html.replace('</body>', `${pixel}</body>`);
    }

    // Fallback: append at end
    return html + pixel;
}

/**
 * Wrap links for click tracking
 * @param {string} html - Email HTML content
 * @param {string} trackingId - Unique tracking ID
 * @returns {string} HTML with wrapped links
 */
export function wrapLinksForTracking(html, trackingId) {
    // Match href attributes with http/https URLs
    // Avoid wrapping tracking pixel URL, unsubscribe URL, or already-wrapped URLs
    return html.replace(
        /href="(https?:\/\/[^"]+)"/gi,
        (match, url) => {
            // Skip tracking URLs
            if (url.includes('/api/email-tracking/')) {
                return match;
            }
            // Skip already-encoded URLs
            if (url.includes('tid=')) {
                return match;
            }

            const trackedUrl = `${API_URL}/api/email-tracking/click?tid=${trackingId}&url=${encodeURIComponent(url)}`;
            return `href="${trackedUrl}"`;
        }
    );
}

/**
 * Generate unsubscribe link
 * @param {string} trackingId - Tracking ID for the email
 * @param {string} email - Recipient email
 * @returns {string} Unsubscribe URL
 */
export function generateUnsubscribeLink(trackingId, email) {
    const encoded = Buffer.from(email).toString('base64url');
    return `${API_URL}/api/email-tracking/unsubscribe?tid=${trackingId}&e=${encoded}`;
}

/**
 * Add unsubscribe footer to HTML email
 * @param {string} html - Email HTML content
 * @param {string} trackingId - Tracking ID
 * @param {string} email - Recipient email
 * @returns {string} HTML with unsubscribe footer
 */
export function addUnsubscribeFooter(html, trackingId, email) {
    const unsubscribeUrl = generateUnsubscribeLink(trackingId, email);

    const footer = `
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Don't want to receive these emails? <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe</a>
            </p>
        </div>
    `;

    // Insert before the closing of the main content table
    if (html.includes('</body>')) {
        return html.replace('</body>', `${footer}</body>`);
    }

    return html + footer;
}

/**
 * Send a sequence email with full tracking
 * @param {Object} options - Email options
 */
export async function sendSequenceEmail({
    userId,
    enrollmentId,
    sequenceId,
    stepNumber,
    lead,
    subject,
    body,
    senderName,
    senderEmail,
    ctaText,
    ctaUrl,
}) {
    // Generate tracking ID
    const trackingId = generateTrackingId();

    // Get user's email provider configuration
    const providerConfig = await getActiveEmailProvider(userId);

    // Get brand settings
    let brandSettings = {};
    const brandResult = await getBrandSettings(userId);
    if (brandResult.success) {
        brandSettings = {
            brandLogoUrl: brandResult.brandLogoUrl,
            brandColor: brandResult.brandColor,
            brandName: brandResult.brandName,
        };
    }

    // Generate base HTML
    let htmlContent = generateColdEmailHtml({
        subject,
        body,
        senderName,
        senderCompany: brandSettings.brandName,
        senderEmail,
        brandLogoUrl: brandSettings.brandLogoUrl,
        brandColor: brandSettings.brandColor,
        brandName: brandSettings.brandName,
        brandCtaText: ctaText,
        brandCtaUrl: ctaUrl,
    });

    // Add tracking
    htmlContent = wrapLinksForTracking(htmlContent, trackingId);
    htmlContent = insertTrackingPixel(htmlContent, trackingId);
    htmlContent = addUnsubscribeFooter(htmlContent, trackingId, lead.email);

    // Prepare email data
    const emailData = {
        from: senderEmail ? `${senderName} <${senderEmail}>` : `${senderName} <noreply@${process.env.RESEND_DEFAULT_DOMAIN || 'validatecall.com'}>`,
        to: lead.email,
        replyTo: senderEmail || undefined,
        subject,
        html: htmlContent,
        text: body + `\n\nBest regards,\n${senderName}`,
        headers: {
            'List-Unsubscribe': `<${generateUnsubscribeLink(trackingId, lead.email)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
    };

    try {
        let emailId;

        // Send via appropriate provider
        if (providerConfig?.provider === 'sendgrid' && providerConfig.apiKey) {
            const sgMail = (await import('@sendgrid/mail')).default;
            sgMail.setApiKey(providerConfig.apiKey);

            const [response] = await sgMail.send({
                to: lead.email,
                from: emailData.from,
                replyTo: emailData.replyTo,
                subject,
                html: htmlContent,
                text: emailData.text,
            });
            emailId = response.headers['x-message-id'];
        } else {
            // Use Resend
            let resendClient;
            if (providerConfig?.provider === 'resend' && providerConfig.apiKey) {
                resendClient = new Resend(providerConfig.apiKey);
            } else {
                resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
            }

            if (!resendClient) {
                throw new Error('No email provider configured');
            }

            const { data, error } = await resendClient.emails.send(emailData);

            if (error) {
                throw new Error(error.message);
            }

            emailId = data.id;
        }

        // Log the email with tracking info
        const { data: emailLog, error: logError } = await supabase
            .from('email_logs')
            .insert({
                user_id: userId,
                email_type: 'sequence_email',
                recipient: lead.email,
                resend_id: emailId,
                status: 'sent',
                tracking_id: trackingId,
                sequence_id: sequenceId,
                enrollment_id: enrollmentId,
                step_number: stepNumber,
                subject,
                metadata: {
                    leadId: lead.id,
                    leadName: lead.name,
                    stepNumber,
                }
            })
            .select()
            .single();

        if (logError) {
            console.warn('Failed to log sequence email:', logError.message);
        }

        return {
            success: true,
            emailId,
            trackingId,
            emailLogId: emailLog?.id,
        };

    } catch (error) {
        console.error('Failed to send sequence email:', error);

        // Log the failure
        await supabase
            .from('email_logs')
            .insert({
                user_id: userId,
                email_type: 'sequence_email',
                recipient: lead.email,
                status: 'failed',
                tracking_id: trackingId,
                sequence_id: sequenceId,
                enrollment_id: enrollmentId,
                step_number: stepNumber,
                subject,
                metadata: {
                    leadId: lead.id,
                    error: error.message,
                }
            });

        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Record a tracking event
 * @param {Object} event - Event data
 */
export async function recordTrackingEvent({
    trackingId,
    eventType,
    url = null,
    ipAddress = null,
    userAgent = null,
}) {
    // Get email log by tracking ID
    const { data: emailLog } = await supabase
        .from('email_logs')
        .select('id, user_id, enrollment_id, sequence_id, step_number')
        .eq('tracking_id', trackingId)
        .single();

    if (!emailLog) {
        console.warn(`No email found for tracking ID: ${trackingId}`);
        return null;
    }

    // Get lead ID from enrollment
    let leadId = null;
    if (emailLog.enrollment_id) {
        const { data: enrollment } = await supabase
            .from('email_sequence_enrollments')
            .select('lead_id')
            .eq('id', emailLog.enrollment_id)
            .single();
        leadId = enrollment?.lead_id;
    }

    // Detect device type from user agent
    let deviceType = 'unknown';
    if (userAgent) {
        const ua = userAgent.toLowerCase();
        if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
            deviceType = 'mobile';
        } else if (ua.includes('tablet') || ua.includes('ipad')) {
            deviceType = 'tablet';
        } else {
            deviceType = 'desktop';
        }
    }

    // Insert tracking event
    const { data: event, error } = await supabase
        .from('email_tracking_events')
        .insert({
            email_log_id: emailLog.id,
            enrollment_id: emailLog.enrollment_id,
            lead_id: leadId,
            user_id: emailLog.user_id,
            event_type: eventType,
            tracking_id: trackingId,
            url,
            ip_address: ipAddress,
            user_agent: userAgent,
            device_type: deviceType,
        })
        .select()
        .single();

    if (error) {
        console.error('Failed to record tracking event:', error.message);
        return null;
    }

    // Update email_logs with event timestamp and count
    const updates = {};
    if (eventType === 'open') {
        updates.open_count = supabase.sql`COALESCE(open_count, 0) + 1`;
        updates.opened_at = supabase.sql`COALESCE(opened_at, NOW())`;
    } else if (eventType === 'click') {
        updates.click_count = supabase.sql`COALESCE(click_count, 0) + 1`;
        updates.clicked_at = supabase.sql`COALESCE(clicked_at, NOW())`;
    } else if (eventType === 'delivered') {
        updates.delivered_at = new Date().toISOString();
    } else if (eventType === 'bounce') {
        updates.bounced_at = new Date().toISOString();
        updates.status = 'bounced';
    }

    if (Object.keys(updates).length > 0) {
        await supabase
            .from('email_logs')
            .update(updates)
            .eq('id', emailLog.id);
    }

    // Update enrollment stats
    if (emailLog.enrollment_id) {
        const enrollmentUpdates = {};
        if (eventType === 'open') {
            enrollmentUpdates.opens = supabase.sql`COALESCE(opens, 0) + 1`;
        } else if (eventType === 'click') {
            enrollmentUpdates.clicks = supabase.sql`COALESCE(clicks, 0) + 1`;
        }

        if (Object.keys(enrollmentUpdates).length > 0) {
            await supabase
                .from('email_sequence_enrollments')
                .update(enrollmentUpdates)
                .eq('id', emailLog.enrollment_id);
        }
    }

    // Update sequence stats
    if (emailLog.sequence_id) {
        const sequenceField = eventType === 'open' ? 'total_opens'
            : eventType === 'click' ? 'total_clicks'
            : eventType === 'bounce' ? 'total_bounces'
            : null;

        if (sequenceField) {
            await supabase.rpc('increment_sequence_stats', {
                p_sequence_id: emailLog.sequence_id,
                p_stat_name: sequenceField,
                p_increment: 1
            }).catch(() => {
                // Fallback
                supabase
                    .from('email_sequences')
                    .update({ [sequenceField]: supabase.sql`COALESCE(${sequenceField}, 0) + 1` })
                    .eq('id', emailLog.sequence_id);
            });
        }

        // Update step stats
        if (emailLog.step_number) {
            const stepField = eventType === 'open' ? 'opens'
                : eventType === 'click' ? 'clicks'
                : eventType === 'bounce' ? 'bounces'
                : null;

            if (stepField) {
                await supabase.rpc('increment_step_stats', {
                    p_sequence_id: emailLog.sequence_id,
                    p_step_number: emailLog.step_number,
                    p_stat_name: stepField,
                    p_increment: 1
                }).catch(() => {
                    // Fallback
                    supabase
                        .from('email_sequence_steps')
                        .update({ [stepField]: supabase.sql`COALESCE(${stepField}, 0) + 1` })
                        .eq('sequence_id', emailLog.sequence_id)
                        .eq('step_number', emailLog.step_number);
                });
            }
        }
    }

    // Update lead stats
    if (leadId) {
        const leadUpdates = {};
        if (eventType === 'open') {
            leadUpdates.total_opens = supabase.sql`COALESCE(total_opens, 0) + 1`;
            leadUpdates.last_opened_at = new Date().toISOString();
            leadUpdates.email_status = 'engaged';
        } else if (eventType === 'click') {
            leadUpdates.total_clicks = supabase.sql`COALESCE(total_clicks, 0) + 1`;
            leadUpdates.last_clicked_at = new Date().toISOString();
            leadUpdates.email_status = 'engaged';
        }

        if (Object.keys(leadUpdates).length > 0) {
            await supabase
                .from('leads')
                .update(leadUpdates)
                .eq('id', leadId);
        }
    }

    return event;
}

/**
 * Process unsubscribe
 * @param {string} trackingId - Tracking ID
 * @param {string} email - Email to unsubscribe
 * @param {string} reason - Reason for unsubscribe
 */
export async function processUnsubscribe(trackingId, email, reason = 'link') {
    // Get user ID from tracking ID
    const { data: emailLog } = await supabase
        .from('email_logs')
        .select('user_id, enrollment_id')
        .eq('tracking_id', trackingId)
        .single();

    if (!emailLog) {
        console.warn(`No email found for unsubscribe tracking ID: ${trackingId}`);
        return false;
    }

    // Add to unsubscribe list
    await supabase
        .from('email_unsubscribes')
        .upsert({
            user_id: emailLog.user_id,
            email,
            reason,
            source: 'link',
        }, {
            onConflict: 'user_id,email'
        });

    // Stop any active enrollments for this email
    if (emailLog.enrollment_id) {
        await supabase
            .from('email_sequence_enrollments')
            .update({
                status: 'stopped_unsubscribe',
                stopped_at: new Date().toISOString(),
                stopped_reason: 'Unsubscribed via email link',
                next_email_at: null,
            })
            .eq('id', emailLog.enrollment_id);
    }

    // Record the event
    await recordTrackingEvent({
        trackingId,
        eventType: 'unsubscribe',
    });

    return true;
}

export default {
    generateTrackingId,
    insertTrackingPixel,
    wrapLinksForTracking,
    addUnsubscribeFooter,
    sendSequenceEmail,
    recordTrackingEvent,
    processUnsubscribe,
};
