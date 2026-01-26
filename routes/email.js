/**
 * Email Routes
 * Endpoints for triggering transactional emails
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { sendWelcomeEmail, sendUsageAlertEmail, sendColdEmail, generateColdEmailHtml, isConfigured } from '../services/email.js';
import { getBrandSettings } from '../services/userSettings.js';

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
        const { userId, email, name, force } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Check if welcome email was already sent to this user/email (prevent duplicates)
        // Skip check if force=true (for testing/resending)
        if (!force) {
            const { data: existingEmail } = await supabase
                .from('email_logs')
                .select('id, created_at')
                .eq('email_type', 'welcome')
                .eq('recipient', email)
                .eq('status', 'sent')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (existingEmail) {
                console.log(`Welcome email already sent to ${email} at ${existingEmail.created_at}, skipping duplicate`);
                return res.json({
                    success: true,
                    skipped: true,
                    message: 'Welcome email already sent to this address',
                    previouslySentAt: existingEmail.created_at,
                });
            }
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
            // Log the email (important for deduplication)
            // Uses unique constraint to prevent race conditions
            try {
                await supabase.from('email_logs').insert({
                    user_id: userId || null,
                    email_type: 'welcome',
                    recipient: email,
                    resend_id: result.emailId,
                    status: 'sent',
                });
                console.log(`✉️ Welcome email sent and logged for ${email}`);
            } catch (err) {
                // If unique constraint violation, email was already logged (race condition)
                if (err.code === '23505') {
                    console.log(`✉️ Welcome email log already exists for ${email} (race condition handled)`);
                } else {
                    console.warn('Failed to log email:', err.message);
                }
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
        const { leadId, toEmail, toName, subject, body, senderName, senderEmail, senderCompany, userId, ctaText, ctaUrl } = req.body;

        if (!toEmail || !subject || !body) {
            return res.status(400).json({ error: 'toEmail, subject, and body are required' });
        }

        // Fetch user's brand settings if userId provided
        let brandSettings = {};
        if (userId) {
            const brandResult = await getBrandSettings(userId);
            if (brandResult.success) {
                brandSettings = {
                    brandLogoUrl: brandResult.brandLogoUrl,
                    brandColor: brandResult.brandColor,
                    brandName: brandResult.brandName,
                    brandCtaText: brandResult.brandCtaText,
                    brandCtaUrl: brandResult.brandCtaUrl,
                };
            }
        }

        // Per-campaign CTA overrides global brand settings
        const effectiveCtaText = ctaText || brandSettings.brandCtaText;
        const effectiveCtaUrl = ctaUrl || brandSettings.brandCtaUrl;

        // Generate HTML version with professional template
        const htmlContent = generateColdEmailHtml({
            subject,
            body,
            senderName,
            senderCompany: senderCompany || brandSettings.brandName,
            senderEmail,
            brandLogoUrl: brandSettings.brandLogoUrl,
            brandColor: brandSettings.brandColor,
            brandName: brandSettings.brandName,
            brandCtaText: effectiveCtaText,
            brandCtaUrl: effectiveCtaUrl,
        });

        // Send the email (pass userId to use their Resend API key if available)
        const result = await sendColdEmail({
            userId,
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

/**
 * POST /api/email/inbound
 * Receive inbound emails from Cloudflare Email Workers
 * This allows emails to be stored in ValidateCall while also forwarding to Gmail
 * Body: { from, to, subject, text, html, headers }
 */
router.post('/inbound', async (req, res) => {
    try {
        const { from, to, subject, text, html, headers, rawSize } = req.body;

        console.log('📧 Inbound email received:', { from, to, subject });

        if (!from || !to) {
            return res.status(400).json({ error: 'from and to are required' });
        }

        // Extract email address from "Name <email@domain.com>" format
        const extractEmail = (str) => {
            const match = str.match(/<([^>]+)>/);
            return match ? match[1] : str;
        };

        const extractName = (str) => {
            const match = str.match(/^([^<]+)</);
            return match ? match[1].trim() : null;
        };

        const fromEmail = extractEmail(from);
        const fromName = extractName(from);
        const toEmail = extractEmail(to);

        // Find the user who owns this receiving email address
        // Look up by their verified domain in user_domains table
        const toDomain = toEmail.split('@')[1]?.toLowerCase();
        console.log('🔍 Looking for user with domain:', toDomain);

        let userId = null;
        let leadId = null;

        // Look up user by their verified domain
        const { data: domainRecord, error: domainError } = await supabase
            .from('user_domains')
            .select('user_id')
            .ilike('domain_name', toDomain)
            .eq('status', 'verified')
            .maybeSingle();

        if (domainError) {
            console.error('Error finding user by domain:', domainError);
        }

        if (domainRecord) {
            userId = domainRecord.user_id;
            console.log('✅ Found user by domain:', userId);
        } else {
            console.log('⚠️ No user found for domain:', toDomain);
        }

        if (userId) {

            // Try to match to an existing lead by email
            const { data: lead } = await supabase
                .from('leads')
                .select('id')
                .eq('user_id', userId)
                .eq('email', fromEmail)
                .maybeSingle();

            if (lead) {
                leadId = lead.id;
            }
        }

        // Generate a unique ID for this inbound email (since it's not from Resend)
        const cloudflareEmailId = `cf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store the inbound email
        const { data: response, error: insertError } = await supabase
            .from('email_responses')
            .insert({
                user_id: userId,
                lead_id: leadId,
                from_email: fromEmail,
                from_name: fromName,
                to_email: toEmail,
                subject: subject || '(No subject)',
                body_text: text,
                body_html: html,
                status: 'unread',
                received_at: new Date().toISOString(),
                resend_email_id: cloudflareEmailId, // Use generated ID for Cloudflare emails
            })
            .select()
            .single();

        if (insertError) {
            console.error('Failed to store inbound email:', insertError);
            return res.status(500).json({ error: insertError.message });
        }

        console.log('✅ Inbound email stored:', response.id);

        res.json({
            success: true,
            responseId: response.id,
            userId,
            leadId,
        });
    } catch (error) {
        console.error('Inbound email error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/email/track-event
 * Track user events for trigger automation
 * Body: { userId, eventType, eventData?, pageUrl? }
 */
router.post('/track-event', async (req, res) => {
    try {
        const { userId, eventType, eventData, pageUrl, referrer } = req.body;

        if (!userId || !eventType) {
            return res.status(400).json({ error: 'userId and eventType are required' });
        }

        const { error } = await supabase.from('user_events').insert({
            user_id: userId,
            event_type: eventType,
            event_data: eventData || null,
            page_url: pageUrl || null,
            referrer: referrer || null,
        });

        if (error) {
            console.warn('Failed to track event:', error.message);
            // Don't fail the request - event tracking is non-critical
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Track event error:', error);
        // Don't fail - event tracking is non-critical
        res.json({ success: true });
    }
});

/**
 * GET /api/email/responses
 * Get all email responses for the authenticated user
 * Query: ?status=unread|read|all (default: all)
 */
router.get('/responses', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const status = req.query.status || 'all';

        let query = supabase
            .from('email_responses')
            .select(`
                *,
                lead:leads(id, name, email, status)
            `)
            .eq('user_id', userId)
            .order('received_at', { ascending: false });

        if (status !== 'all') {
            query = query.eq('status', status);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Failed to fetch email responses:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ responses: data });
    } catch (error) {
        console.error('Email responses error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/email/responses/unread-count
 * Get count of unread email responses
 */
router.get('/responses/unread-count', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { count, error } = await supabase
            .from('email_responses')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'unread');

        if (error) {
            console.error('Failed to count unread responses:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ unreadCount: count || 0 });
    } catch (error) {
        console.error('Unread count error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/email/thread/:leadId
 * Get complete email thread for a lead (sent + received)
 */
router.get('/thread/:leadId', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { leadId } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Get sent emails to this lead
        const { data: sentEmails, error: sentError } = await supabase
            .from('email_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('email_type', 'cold_email')
            .contains('metadata', { leadId })
            .order('created_at', { ascending: true });

        if (sentError) {
            console.error('Failed to fetch sent emails:', sentError);
        }

        // Get received emails from this lead
        const { data: receivedEmails, error: receivedError } = await supabase
            .from('email_responses')
            .select('*')
            .eq('user_id', userId)
            .eq('lead_id', leadId)
            .order('received_at', { ascending: true });

        if (receivedError) {
            console.error('Failed to fetch received emails:', receivedError);
        }

        // Combine and sort by timestamp
        const thread = [
            ...(sentEmails || []).map(e => ({
                id: e.id,
                direction: 'sent',
                subject: e.metadata?.subject,
                body: e.metadata?.body,
                timestamp: e.created_at,
                status: e.status
            })),
            ...(receivedEmails || []).map(e => ({
                id: e.id,
                direction: 'received',
                subject: e.subject,
                body: e.body_text || e.body_html,
                from: e.from_email,
                fromName: e.from_name,
                timestamp: e.received_at,
                status: e.status,
                attachments: e.attachments
            }))
        ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        res.json({ thread });
    } catch (error) {
        console.error('Email thread error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/email/responses/:id/read
 * Mark an email response as read
 */
router.patch('/responses/:id/read', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const { data, error } = await supabase
            .from('email_responses')
            .update({
                status: 'read',
                read_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            console.error('Failed to mark as read:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ response: data });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/email/responses/:id/reply
 * Reply to an email response
 */
router.post('/responses/:id/reply', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { id } = req.params;
        const { subject, body, senderName, senderEmail, senderCompany } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        // Get the original email response
        const { data: originalResponse, error: fetchError } = await supabase
            .from('email_responses')
            .select('*')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (fetchError || !originalResponse) {
            return res.status(404).json({ error: 'Email response not found' });
        }

        // Fetch user's brand settings
        let brandSettings = {};
        const brandResult = await getBrandSettings(userId);
        if (brandResult.success) {
            brandSettings = {
                brandLogoUrl: brandResult.brandLogoUrl,
                brandColor: brandResult.brandColor,
                brandName: brandResult.brandName,
                brandCtaText: brandResult.brandCtaText,
                brandCtaUrl: brandResult.brandCtaUrl,
            };
        }

        // Generate reply HTML with professional template
        const htmlContent = generateColdEmailHtml({
            subject,
            body,
            senderName,
            senderCompany: senderCompany || brandSettings.brandName,
            senderEmail,
            brandLogoUrl: brandSettings.brandLogoUrl,
            brandColor: brandSettings.brandColor,
            brandName: brandSettings.brandName,
            brandCtaText: brandSettings.brandCtaText,
            brandCtaUrl: brandSettings.brandCtaUrl,
        });

        // Send the reply (pass userId to use their Resend API key if available)
        const result = await sendColdEmail({
            userId,
            toEmail: originalResponse.from_email,
            toName: originalResponse.from_name,
            subject: subject.startsWith('Re:') ? subject : `Re: ${originalResponse.subject}`,
            htmlContent,
            textContent: body + `\n\nBest regards,\n${senderName || 'The Team'}${senderCompany ? `\n${senderCompany}` : ''}`,
            fromName: senderName,
            fromEmail: senderEmail,
        });

        if (result.success) {
            // Log the reply email
            await supabase.from('email_logs').insert({
                user_id: userId,
                email_type: 'cold_email',
                recipient: originalResponse.from_email,
                resend_id: result.emailId,
                status: 'sent',
                metadata: {
                    leadId: originalResponse.lead_id,
                    subject: subject.startsWith('Re:') ? subject : `Re: ${originalResponse.subject}`,
                    inReplyTo: originalResponse.resend_email_id
                },
            });

            // Update original response status
            await supabase
                .from('email_responses')
                .update({ status: 'replied' })
                .eq('id', id);
        }

        res.json(result);
    } catch (error) {
        console.error('Reply email error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
