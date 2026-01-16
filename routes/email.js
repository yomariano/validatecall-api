/**
 * Email Routes
 * Endpoints for triggering transactional emails
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { sendWelcomeEmail, sendUsageAlertEmail, sendColdEmail, generateColdEmailHtml, isConfigured } from '../services/email.js';

// Allow self-signed certificates in development
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Clean up URL and API key (remove ALL quotes, semicolons, whitespace)
const cleanEnvVar = (val) => val?.replace(/["';]/g, '').trim();
const claudeApiUrl = cleanEnvVar(process.env.CLAUDE_API_URL);
const claudeApiKey = cleanEnvVar(process.env.CLAUDE_API_KEY);

// Helper to call Claude API
const promptClaude = async (prompt, model = 'sonnet') => {
    if (!claudeApiUrl || !claudeApiKey) {
        throw new Error('Claude API not configured');
    }

    const url = `${claudeApiUrl}/v1/claude`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': claudeApiKey,
        },
        body: JSON.stringify({ prompt, model }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.result || data.response || data.content || data;
};

const router = Router();

// Initialize Supabase client with service role for backend operations
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/email/status
 * Check if email service is configured
 */
router.get('/status', (req, res) => {
    res.json({
        configured: isConfigured(),
        fromAddress: process.env.EMAIL_FROM_ADDRESS || 'Not set',
        replyTo: process.env.EMAIL_REPLY_TO || 'Not set',
    });
});

/**
 * POST /api/email/welcome
 * Send welcome email to a new user
 * Body: { userId?, email, name? }
 */
router.post('/welcome', async (req, res) => {
    try {
        const { userId, email, name } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // If userId provided but no name, fetch from profile
        let userName = name;
        if (userId && !name) {
            const { data: profile } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('id', userId)
                .single();

            userName = profile?.full_name;
        }

        const result = await sendWelcomeEmail({
            email,
            name: userName,
        });

        if (result.success) {
            // Log the email (ignore errors - logging is optional)
            try {
                await supabase.from('email_logs').insert({
                    user_id: userId || null,
                    email_type: 'welcome',
                    recipient: email,
                    resend_id: result.emailId,
                    status: 'sent',
                });
            } catch (err) {
                console.warn('Failed to log email:', err.message);
            }
        }

        res.json(result);
    } catch (error) {
        console.error('Welcome email error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/email/usage-alert
 * Send usage alert when user approaches limit
 * Body: { userId, resourceType, used, limit }
 */
router.post('/usage-alert', async (req, res) => {
    try {
        const { userId, resourceType, used, limit } = req.body;

        if (!userId || !resourceType || used === undefined || !limit) {
            return res.status(400).json({
                error: 'userId, resourceType, used, and limit are required'
            });
        }

        // Get user profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('email, full_name')
            .eq('id', userId)
            .single();

        if (profileError || !profile?.email) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if alert already sent for this threshold
        const alertType = `usage_alert_${resourceType}_80`;
        const { data: existingAlert } = await supabase
            .from('email_logs')
            .select('id')
            .eq('user_id', userId)
            .eq('email_type', alertType)
            .maybeSingle();

        if (existingAlert) {
            return res.json({
                success: true,
                skipped: true,
                reason: 'Alert already sent for this threshold'
            });
        }

        const percentUsed = Math.round((used / limit) * 100);

        const result = await sendUsageAlertEmail({
            email: profile.email,
            name: profile.full_name,
            resourceType: resourceType === 'leads' ? 'leads' : 'calls',
            used,
            limit,
            percentUsed,
        });

        if (result.success) {
            try {
                await supabase.from('email_logs').insert({
                    user_id: userId,
                    email_type: alertType,
                    recipient: profile.email,
                    resend_id: result.emailId,
                    status: 'sent',
                });
            } catch (err) {
                console.warn('Failed to log email:', err.message);
            }
        }

        res.json(result);
    } catch (error) {
        console.error('Usage alert error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/email/generate-cold-email
 * Generate a personalized cold email using AI
 * Body: { lead, productIdea, companyContext, senderName }
 */
router.post('/generate-cold-email', async (req, res) => {
    try {
        const { lead, productIdea, companyContext, senderName } = req.body;

        if (!lead || !productIdea) {
            return res.status(400).json({ error: 'lead and productIdea are required' });
        }

        // Build a prompt for Claude to generate a personalized cold email
        const prompt = `You are an expert B2B sales copywriter. Generate a personalized cold email for a potential client.

LEAD INFORMATION:
- Business Name: ${lead.name}
- Industry/Category: ${lead.category || 'Unknown'}
- Location: ${lead.address || lead.city || 'Unknown'}
- Website: ${lead.website || 'Not available'}
- Rating: ${lead.rating ? `${lead.rating}/5 (${lead.review_count || 0} reviews)` : 'Not available'}

SENDER'S PRODUCT/SERVICE:
${productIdea}

${companyContext ? `SENDER'S COMPANY CONTEXT:\n${companyContext}` : ''}

REQUIREMENTS:
1. Create a compelling subject line (max 60 characters)
2. Write a personalized email body that:
   - Opens with something specific about their business (use their name, industry, or any available info)
   - Briefly explains the value proposition relevant to their industry
   - Keeps it concise (under 150 words)
   - Has a clear call-to-action
   - Sounds professional but friendly, not salesy
3. Sign off with "${senderName || 'Best regards'}"

Return your response in this EXACT JSON format (no markdown, no explanation):
{
  "subject": "Your subject line here",
  "body": "Your email body here (use \\n for new lines)",
  "preview": "First line preview text (under 90 chars)"
}`;

        const result = await promptClaude(prompt, 'sonnet');

        // Parse the JSON response
        let emailContent;
        try {
            const jsonStr = typeof result === 'string'
                ? result.trim().replace(/^```json\n?|\n?```$/g, '')
                : JSON.stringify(result);
            emailContent = JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('Failed to parse cold email response:', result);
            return res.status(500).json({ error: 'Failed to parse AI response' });
        }

        res.json({
            success: true,
            email: emailContent,
        });
    } catch (error) {
        console.error('Cold email generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/email/send-cold-email
 * Send a cold email to a lead
 * Body: { leadId, toEmail, toName, subject, body, senderName, senderEmail, senderCompany }
 */
router.post('/send-cold-email', async (req, res) => {
    try {
        const { leadId, toEmail, toName, subject, body, senderName, senderEmail, senderCompany, userId } = req.body;

        if (!toEmail || !subject || !body) {
            return res.status(400).json({ error: 'toEmail, subject, and body are required' });
        }

        // Generate HTML version
        const htmlContent = generateColdEmailHtml({
            subject,
            body,
            senderName,
            senderCompany,
        });

        // Send the email
        const result = await sendColdEmail({
            toEmail,
            toName,
            subject,
            htmlContent,
            textContent: body + `\n\nBest regards,\n${senderName || 'The Team'}${senderCompany ? `\n${senderCompany}` : ''}`,
            fromName: senderName,
            fromEmail: senderEmail,
        });

        if (result.success) {
            // Log the cold email
            try {
                await supabase.from('email_logs').insert({
                    user_id: userId || null,
                    email_type: 'cold_email',
                    recipient: toEmail,
                    resend_id: result.emailId,
                    status: 'sent',
                    metadata: { leadId, subject },
                });
            } catch (err) {
                console.warn('Failed to log cold email:', err.message);
            }

            // Update lead status to contacted if leadId provided
            if (leadId) {
                try {
                    await supabase
                        .from('leads')
                        .update({ status: 'contacted', notes: `Cold email sent: ${subject}` })
                        .eq('id', leadId);
                } catch (err) {
                    console.warn('Failed to update lead status:', err.message);
                }
            }
        }

        res.json(result);
    } catch (error) {
        console.error('Send cold email error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/email/test
 * Send a test email (development only)
 * Body: { email, type: 'welcome' | 'payment' | 'usage' }
 */
router.post('/test', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Test endpoint not available in production' });
    }

    try {
        const { email, type = 'welcome' } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        let result;
        switch (type) {
            case 'welcome':
                result = await sendWelcomeEmail({ email, name: 'Test User' });
                break;
            case 'payment':
                const { sendPaymentConfirmationEmail } = await import('../services/email.js');
                result = await sendPaymentConfirmationEmail({
                    email,
                    name: 'Test User',
                    planName: 'Pro',
                    amount: 4900,
                    currency: 'USD',
                });
                break;
            case 'usage':
                result = await sendUsageAlertEmail({
                    email,
                    name: 'Test User',
                    resourceType: 'leads',
                    used: 8,
                    limit: 10,
                    percentUsed: 80,
                });
                break;
            default:
                return res.status(400).json({ error: 'Invalid email type' });
        }

        res.json(result);
    } catch (error) {
        console.error('Test email error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
