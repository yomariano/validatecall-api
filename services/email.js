/**
 * Email Service using Resend
 * Handles all transactional email sending for ValidateCall
 */

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'ValidateCall <noreply@validatecall.com>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@validatecall.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://validatecall.com';

/**
 * Check if email service is configured
 */
export function isConfigured() {
    return !!process.env.RESEND_API_KEY;
}

/**
 * Send welcome email to new users
 */
export async function sendWelcomeEmail({ email, name }) {
    if (!resend) {
        console.warn('RESEND_API_KEY not set - skipping welcome email');
        return { success: false, error: 'Email service not configured' };
    }

    const firstName = name?.split(' ')[0] || 'there';

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            to: email,
            replyTo: REPLY_TO,
            subject: "Welcome to ValidateCall - Let's validate your business idea!",
            html: generateWelcomeHtml({ firstName, email }),
            text: generateWelcomeText({ firstName }),
        });

        if (error) {
            console.error('Failed to send welcome email:', error);
            return { success: false, error: error.message };
        }

        console.log(`Welcome email sent to ${email}, id: ${data.id}`);
        return { success: true, emailId: data.id };
    } catch (err) {
        console.error('Welcome email exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Send payment confirmation email
 */
export async function sendPaymentConfirmationEmail({ email, name, planName, amount, currency = 'USD' }) {
    if (!resend) {
        console.warn('RESEND_API_KEY not set - skipping payment email');
        return { success: false, error: 'Email service not configured' };
    }

    const firstName = name?.split(' ')[0] || 'there';

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            to: email,
            replyTo: REPLY_TO,
            subject: `Payment Confirmed - Welcome to ValidateCall ${planName}!`,
            html: generatePaymentHtml({ firstName, planName, amount, currency }),
            text: generatePaymentText({ firstName, planName, amount, currency }),
        });

        if (error) {
            console.error('Failed to send payment email:', error);
            return { success: false, error: error.message };
        }

        console.log(`Payment confirmation sent to ${email}, id: ${data.id}`);
        return { success: true, emailId: data.id };
    } catch (err) {
        console.error('Payment email exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Send usage alert email (approaching limit)
 */
export async function sendUsageAlertEmail({ email, name, resourceType, used, limit, percentUsed }) {
    if (!resend) {
        console.warn('RESEND_API_KEY not set - skipping usage alert');
        return { success: false, error: 'Email service not configured' };
    }

    const firstName = name?.split(' ')[0] || 'there';

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            to: email,
            replyTo: REPLY_TO,
            subject: `You've used ${percentUsed}% of your ${resourceType} - ValidateCall`,
            html: generateUsageAlertHtml({ firstName, resourceType, used, limit, percentUsed }),
            text: generateUsageAlertText({ firstName, resourceType, used, limit, percentUsed }),
        });

        if (error) {
            console.error('Failed to send usage alert:', error);
            return { success: false, error: error.message };
        }

        console.log(`Usage alert sent to ${email}, id: ${data.id}`);
        return { success: true, emailId: data.id };
    } catch (err) {
        console.error('Usage alert exception:', err);
        return { success: false, error: err.message };
    }
}

// ============================================
// HTML Email Templates
// ============================================

function generateWelcomeHtml({ firstName }) {
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
            <p style="color: #666; margin-top: 5px;">AI-Powered Market Research</p>
        </div>

        <h2 style="color: #1a1a2e; margin-top: 0;">Welcome, ${firstName}!</h2>

        <p>Thanks for signing up for ValidateCall. You're now ready to validate your business ideas with real customer conversations.</p>

        <p>Here's what you can do with your <strong>free account</strong>:</p>
        <ul style="padding-left: 20px;">
            <li><strong>10 leads</strong> to discover potential customers</li>
            <li><strong>5 AI-powered calls</strong> to validate your ideas</li>
            <li><strong>2 minutes per call</strong> for meaningful conversations</li>
        </ul>

        <div style="text-align: center; margin: 35px 0;">
            <a href="${FRONTEND_URL}/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Go to Dashboard</a>
        </div>

        <p>Need more? <a href="${FRONTEND_URL}/pricing" style="color: #7c3aed; text-decoration: none; font-weight: 500;">Upgrade your plan</a> for unlimited access.</p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

        <p style="color: #666; font-size: 14px; margin-bottom: 0;">
            Questions? Reply to this email or contact us at <a href="mailto:support@validatecall.com" style="color: #7c3aed;">support@validatecall.com</a>
        </p>
    </div>

    <p style="text-align: center; color: #999; font-size: 12px; margin-top: 20px;">
        &copy; ${new Date().getFullYear()} ValidateCall. All rights reserved.
    </p>
</body>
</html>`;
}

function generateWelcomeText({ firstName }) {
    return `
Welcome to ValidateCall, ${firstName}!

Thanks for signing up. You're now ready to validate your business ideas with real customer conversations.

Your free account includes:
- 10 leads to discover potential customers
- 5 AI-powered calls to validate your ideas
- 2 minutes per call for meaningful conversations

Get started: ${FRONTEND_URL}/dashboard

Need more? Upgrade your plan: ${FRONTEND_URL}/pricing

Questions? Reply to this email or contact support@validatecall.com
`;
}

function generatePaymentHtml({ firstName, planName, amount, currency }) {
    const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
    }).format(amount / 100);

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

        <div style="text-align: center; margin-bottom: 25px;">
            <div style="background: #10b981; color: white; width: 60px; height: 60px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 28px;">&#10003;</div>
        </div>

        <h2 style="color: #1a1a2e; margin-top: 0; text-align: center;">Payment Confirmed!</h2>

        <p>Hi ${firstName},</p>

        <p>Thank you for upgrading to <strong>ValidateCall ${planName}</strong>!</p>

        <div style="background: #f8f4ff; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #7c3aed;">
            <p style="margin: 0;"><strong>Plan:</strong> ${planName}</p>
            <p style="margin: 10px 0 0;"><strong>Amount:</strong> ${formattedAmount}</p>
        </div>

        <p>Your upgraded features are now active. You can start using them immediately.</p>

        <div style="text-align: center; margin: 35px 0;">
            <a href="${FRONTEND_URL}/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Go to Dashboard</a>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

        <p style="color: #666; font-size: 14px;">
            Manage your subscription: <a href="${FRONTEND_URL}/billing" style="color: #7c3aed;">Billing Settings</a><br>
            Questions? Contact <a href="mailto:support@validatecall.com" style="color: #7c3aed;">support@validatecall.com</a>
        </p>
    </div>

    <p style="text-align: center; color: #999; font-size: 12px; margin-top: 20px;">
        &copy; ${new Date().getFullYear()} ValidateCall. All rights reserved.
    </p>
</body>
</html>`;
}

function generatePaymentText({ firstName, planName, amount, currency }) {
    const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
    }).format(amount / 100);

    return `
Payment Confirmed!

Hi ${firstName},

Thank you for upgrading to ValidateCall ${planName}!

Plan: ${planName}
Amount: ${formattedAmount}

Your upgraded features are now active.

Dashboard: ${FRONTEND_URL}/dashboard
Manage subscription: ${FRONTEND_URL}/billing

Questions? Contact support@validatecall.com
`;
}

function generateUsageAlertHtml({ firstName, resourceType, used, limit, percentUsed }) {
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

        <h2 style="color: #1a1a2e; margin-top: 0;">Usage Alert: ${percentUsed}% Used</h2>

        <p>Hi ${firstName},</p>

        <p>You've used <strong>${used} of ${limit} ${resourceType}</strong> on your current plan.</p>

        <!-- Progress bar -->
        <div style="background: #e5e7eb; border-radius: 10px; height: 20px; margin: 20px 0; overflow: hidden;">
            <div style="background: ${percentUsed >= 90 ? '#ef4444' : '#f59e0b'}; height: 100%; width: ${percentUsed}%; border-radius: 10px;"></div>
        </div>

        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e;">
                <strong>Running low on ${resourceType}!</strong><br>
                Upgrade now to continue validating your business ideas without interruption.
            </p>
        </div>

        <div style="text-align: center; margin: 35px 0;">
            <a href="${FRONTEND_URL}/pricing" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Upgrade Now</a>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

        <p style="color: #666; font-size: 14px; margin-bottom: 0;">
            Questions? Contact <a href="mailto:support@validatecall.com" style="color: #7c3aed;">support@validatecall.com</a>
        </p>
    </div>

    <p style="text-align: center; color: #999; font-size: 12px; margin-top: 20px;">
        &copy; ${new Date().getFullYear()} ValidateCall. All rights reserved.
    </p>
</body>
</html>`;
}

function generateUsageAlertText({ firstName, resourceType, used, limit, percentUsed }) {
    return `
Usage Alert: ${percentUsed}% Used

Hi ${firstName},

You've used ${used} of ${limit} ${resourceType} on your current plan.

Running low! Upgrade now to continue validating your business ideas without interruption.

Upgrade: ${FRONTEND_URL}/pricing

Questions? Contact support@validatecall.com
`;
}

/**
 * Send cold email to a lead
 * @param {string} fromEmail - Custom sender email (requires verified domain in Resend)
 */
export async function sendColdEmail({ toEmail, toName, subject, htmlContent, textContent, fromName, fromEmail }) {
    if (!resend) {
        console.warn('RESEND_API_KEY not set - skipping cold email');
        return { success: false, error: 'Email service not configured' };
    }

    try {
        // Build the from address
        // If custom fromEmail is provided (and domain is verified in Resend), use it
        // Otherwise fall back to default
        let fromAddress;
        if (fromEmail) {
            // Custom sender email provided - use it with optional display name
            fromAddress = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
        } else if (fromName) {
            // Only display name provided - use default email
            const defaultEmail = process.env.EMAIL_FROM_ADDRESS?.match(/<(.+)>/)?.[1] || 'noreply@validatecall.com';
            fromAddress = `${fromName} <${defaultEmail}>`;
        } else {
            // Use full default FROM_ADDRESS
            fromAddress = FROM_ADDRESS;
        }

        const { data, error } = await resend.emails.send({
            from: fromAddress,
            to: toEmail,
            replyTo: fromEmail || REPLY_TO, // Reply to custom email if provided
            subject: subject,
            html: htmlContent,
            text: textContent,
        });

        if (error) {
            console.error('Failed to send cold email:', error);
            // Check if it's a domain verification error
            if (error.message?.includes('domain') || error.message?.includes('verified')) {
                return {
                    success: false,
                    error: `Domain not verified: ${fromEmail}. Please verify your domain in Resend dashboard first.`
                };
            }
            return { success: false, error: error.message };
        }

        console.log(`Cold email sent to ${toEmail} from ${fromAddress}, id: ${data.id}`);
        return { success: true, emailId: data.id };
    } catch (err) {
        console.error('Cold email exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Generate cold email HTML template
 */
export function generateColdEmailHtml({ subject, body, senderName, senderCompany }) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="white-space: pre-wrap;">${body.replace(/\n/g, '<br>')}</div>

    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px;">
        <p style="margin: 0;">Best regards,<br>
        <strong>${senderName || 'The Team'}</strong>${senderCompany ? `<br>${senderCompany}` : ''}</p>
    </div>
</body>
</html>`;
}

export default {
    isConfigured,
    sendWelcomeEmail,
    sendPaymentConfirmationEmail,
    sendUsageAlertEmail,
    sendColdEmail,
    generateColdEmailHtml,
};
