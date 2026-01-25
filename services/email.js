/**
 * Email Service - Multi-Provider Support
 * Handles all transactional email sending for ValidateCall
 *
 * Supports: Resend, SendGrid
 * For cold emails, users can provide their own API key to send
 * from their own verified domains/senders.
 */

import { Resend } from 'resend';
import sgMail from '@sendgrid/mail';
import { getUserResendApiKey, getActiveEmailProvider } from './userSettings.js';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Get a Resend client - either the user's or the platform default
 * @param {string} userId - Optional user ID to get their API key
 * @returns {Resend|null} - Resend client or null if not configured
 */
async function getResendClient(userId = null) {
    // If userId provided, try to use their API key first
    if (userId) {
        const userApiKey = await getUserResendApiKey(userId);
        if (userApiKey) {
            return new Resend(userApiKey);
        }
    }

    // Fall back to platform default
    return resend;
}

/**
 * Get the email provider configuration for a user
 * @param {string} userId - User ID
 * @returns {Object} - { provider: 'resend'|'sendgrid'|null, apiKey, client }
 */
async function getEmailProviderConfig(userId) {
    if (!userId) {
        return { provider: 'resend', client: resend, apiKey: null };
    }

    const providerConfig = await getActiveEmailProvider(userId);

    if (!providerConfig) {
        // Fall back to platform default
        return { provider: 'resend', client: resend, apiKey: null };
    }

    if (providerConfig.provider === 'sendgrid') {
        return {
            provider: 'sendgrid',
            apiKey: providerConfig.apiKey,
            client: null, // SendGrid uses a different pattern
        };
    }

    if (providerConfig.provider === 'resend') {
        return {
            provider: 'resend',
            apiKey: providerConfig.apiKey,
            client: new Resend(providerConfig.apiKey),
        };
    }

    return { provider: 'resend', client: resend, apiKey: null };
}

/**
 * Send email via SendGrid
 * @param {string} apiKey - SendGrid API key
 * @param {Object} emailData - Email data
 */
async function sendViaSendGrid(apiKey, { from, to, replyTo, subject, html, text }) {
    sgMail.setApiKey(apiKey);

    const msg = {
        to,
        from, // Can be email string or { email, name } object
        replyTo,
        subject,
        html,
        text,
    };

    try {
        const [response] = await sgMail.send(msg);
        return {
            success: true,
            emailId: response.headers['x-message-id'],
        };
    } catch (err) {
        console.error('SendGrid send error:', err);
        if (err.response) {
            console.error('SendGrid error body:', err.response.body);
        }
        return {
            success: false,
            error: err.message || 'Failed to send via SendGrid',
        };
    }
}

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
 * Supports both Resend and SendGrid based on user's settings
 * @param {string} userId - User ID (to use their email provider settings)
 * @param {string} fromEmail - Custom sender email (requires verified domain/sender)
 */
export async function sendColdEmail({ userId, toEmail, toName, subject, htmlContent, textContent, fromName, fromEmail }) {
    // Get the user's email provider configuration
    const providerConfig = await getEmailProviderConfig(userId);

    // Build the from address
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

    const replyToAddress = fromEmail || REPLY_TO;

    // Send via the appropriate provider
    if (providerConfig.provider === 'sendgrid' && providerConfig.apiKey) {
        console.log(`Sending cold email via SendGrid to ${toEmail} from ${fromAddress}`);

        const result = await sendViaSendGrid(providerConfig.apiKey, {
            from: fromAddress,
            to: toEmail,
            replyTo: replyToAddress,
            subject,
            html: htmlContent,
            text: textContent,
        });

        if (result.success) {
            console.log(`Cold email sent via SendGrid to ${toEmail}, id: ${result.emailId}`);
        }
        return result;
    }

    // Default to Resend
    const resendClient = providerConfig.client || resend;

    if (!resendClient) {
        console.warn('No email provider configured - skipping cold email');
        return { success: false, error: 'Email service not configured. Please add your API key in Settings.' };
    }

    console.log(`Sending cold email via Resend to ${toEmail} from ${fromAddress}`);

    try {
        const { data, error } = await resendClient.emails.send({
            from: fromAddress,
            to: toEmail,
            replyTo: replyToAddress,
            subject: subject,
            html: htmlContent,
            text: textContent,
        });

        if (error) {
            console.error('Failed to send cold email via Resend:', error);
            // Check if it's a domain verification error
            if (error.message?.includes('domain') || error.message?.includes('verified')) {
                return {
                    success: false,
                    error: `Domain not verified: ${fromEmail}. Please verify your domain in your Resend dashboard first.`
                };
            }
            return { success: false, error: error.message };
        }

        console.log(`Cold email sent via Resend to ${toEmail}, id: ${data.id}`);
        return { success: true, emailId: data.id };
    } catch (err) {
        console.error('Cold email exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Generate cold email HTML template with professional header, body, and footer
 * @param {Object} options - Template options
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Email body text
 * @param {string} options.senderName - Sender's name
 * @param {string} options.senderCompany - Sender's company name
 * @param {string} options.senderEmail - Sender's email address
 * @param {string} options.brandLogoUrl - URL to brand logo (optional)
 * @param {string} options.brandColor - Hex color for brand (optional, e.g., #6366f1)
 * @param {string} options.brandName - Brand/company name for header (optional)
 */
export function generateColdEmailHtml({ subject, body, senderName, senderCompany, senderEmail, brandLogoUrl, brandColor, brandName: customBrandName }) {
    // Extract domain from sender email for branding fallback
    const domain = senderEmail ? senderEmail.split('@')[1] : '';
    const brandName = customBrandName || senderCompany || (domain ? domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1) : 'Our Team');

    // Helper to convert hex to HSL components
    const hexToHsl = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return null;

        let r = parseInt(result[1], 16) / 255;
        let g = parseInt(result[2], 16) / 255;
        let b = parseInt(result[3], 16) / 255;

        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    };

    // Generate a brand color based on the domain (consistent color per domain) - fallback
    const hashCode = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return hash;
    };

    // Determine colors - use custom brand color if provided, otherwise generate from domain
    let primaryColor, primaryColorDark, primaryColorLight;

    if (brandColor && /^#[0-9A-Fa-f]{6}$/.test(brandColor)) {
        // Use custom brand color
        const hsl = hexToHsl(brandColor);
        if (hsl) {
            primaryColor = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
            primaryColorDark = `hsl(${hsl.h}, ${hsl.s}%, ${Math.max(hsl.l - 10, 20)}%)`;
            primaryColorLight = `hsl(${hsl.h}, ${Math.min(hsl.s, 30)}%, 95%)`;
        } else {
            primaryColor = brandColor;
            primaryColorDark = brandColor;
            primaryColorLight = '#f5f5f5';
        }
    } else {
        // Fallback: generate color from domain hash
        const hue = domain ? Math.abs(hashCode(domain)) % 360 : 220;
        primaryColor = `hsl(${hue}, 70%, 50%)`;
        primaryColorDark = `hsl(${hue}, 70%, 40%)`;
        primaryColorLight = `hsl(${hue}, 70%, 95%)`;
    }

    // Build header content - logo or text
    const headerContent = brandLogoUrl
        ? `<img src="${brandLogoUrl}" alt="${brandName}" style="max-height: 50px; max-width: 200px; margin-bottom: 8px;" />`
        : `<h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600; letter-spacing: -0.5px;">${brandName}</h1>`;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td style="padding: 20px 0;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, ${primaryColor} 0%, ${primaryColorDark} 100%); padding: 24px 32px; text-align: center;">
                            ${headerContent}
                            ${domain ? `<p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 13px;">${domain}</p>` : ''}
                        </td>
                    </tr>

                    <!-- Body -->
                    <tr>
                        <td style="padding: 32px;">
                            <div style="font-size: 15px; line-height: 1.7; color: #374151;">
                                ${body.split('\n').map(line => {
                                    // Check if line is a bullet point
                                    if (line.trim().match(/^[•\-\*]\s/)) {
                                        return `<div style="padding-left: 16px; margin: 8px 0;">${line.trim()}</div>`;
                                    }
                                    // Empty line = paragraph break
                                    if (line.trim() === '') {
                                        return '<div style="height: 16px;"></div>';
                                    }
                                    return `<div style="margin: 0;">${line}</div>`;
                                }).join('')}
                            </div>
                        </td>
                    </tr>

                    <!-- Footer / Signature -->
                    <tr>
                        <td style="padding: 0 32px 32px 32px;">
                            <div style="border-top: 1px solid #e5e7eb; padding-top: 24px;">
                                <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 14px;">Best regards,</p>
                                <p style="margin: 0; font-size: 15px;">
                                    <strong style="color: #111827;">${senderName || 'The Team'}</strong>
                                </p>
                                ${senderCompany || domain ? `<p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px;">${senderCompany || brandName}</p>` : ''}
                                ${senderEmail ? `<p style="margin: 4px 0 0 0;"><a href="mailto:${senderEmail}" style="color: ${brandColor || primaryColor}; text-decoration: none; font-size: 14px;">${senderEmail}</a></p>` : ''}
                            </div>
                        </td>
                    </tr>

                    <!-- Bottom Brand Bar -->
                    <tr>
                        <td style="background-color: ${primaryColorLight}; padding: 16px 32px; text-align: center;">
                            <p style="margin: 0; color: #6b7280; font-size: 12px;">
                                ${domain ? `Sent from <a href="https://${domain}" style="color: ${brandColor || primaryColor}; text-decoration: none;">${domain}</a>` : ''}
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
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
