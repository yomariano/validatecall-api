/**
 * Campaign Email Service
 * Handles sending marketing campaign emails via Resend
 */

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'ValidateCall <noreply@validatecall.com>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@validatecall.com';

/**
 * Send a campaign email to a single recipient
 */
export async function sendCampaignEmail({ to, subject, html, text }) {
    if (!resend) {
        console.warn('RESEND_API_KEY not set - skipping campaign email');
        return { success: false, error: 'Email service not configured' };
    }

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            to,
            replyTo: REPLY_TO,
            subject,
            html: wrapInTemplate(html),
            text,
        });

        if (error) {
            console.error(`Campaign email failed to ${to}:`, error);
            return { success: false, error: error.message };
        }

        return { success: true, emailId: data.id };
    } catch (err) {
        console.error(`Campaign email exception for ${to}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Send a triggered email (usage alerts, win-back, etc.)
 */
export async function sendTriggerEmail({ to, subject, html, text, triggerType }) {
    if (!resend) {
        console.warn('RESEND_API_KEY not set - skipping trigger email');
        return { success: false, error: 'Email service not configured' };
    }

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            to,
            replyTo: REPLY_TO,
            subject,
            html: wrapInTemplate(html),
            text,
            tags: [{ name: 'trigger_type', value: triggerType }],
        });

        if (error) {
            console.error(`Trigger email failed to ${to}:`, error);
            return { success: false, error: error.message };
        }

        console.log(`Trigger email sent to ${to} (${triggerType}), id: ${data.id}`);
        return { success: true, emailId: data.id };
    } catch (err) {
        console.error(`Trigger email exception for ${to}:`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Wrap email content in ValidateCall template
 */
function wrapInTemplate(bodyHtml) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #7c3aed; margin: 0; font-size: 28px;">ValidateCall</h1>
        </div>

        <div style="color: #333;">
            ${bodyHtml}
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

        <p style="color: #666; font-size: 14px; margin-bottom: 0;">
            Questions? Contact <a href="mailto:support@validatecall.com" style="color: #7c3aed;">support@validatecall.com</a>
        </p>
    </div>

    <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
        <p>&copy; ${new Date().getFullYear()} ValidateCall. All rights reserved.</p>
        <p>
            <a href="https://validatecall.com/unsubscribe" style="color: #999;">Unsubscribe</a>
        </p>
    </div>
</body>
</html>`;
}

export default {
    sendCampaignEmail,
    sendTriggerEmail,
};
