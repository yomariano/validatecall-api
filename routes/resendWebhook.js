/**
 * Resend Webhook Routes
 * Handles inbound email events from Resend
 *
 * Setup in Resend Dashboard:
 * 1. Go to Webhooks > Add Webhook
 * 2. Set URL to: https://your-api.com/api/resend/webhook
 * 3. Select events: email.received (for inbound)
 * 4. Copy the signing secret to RESEND_WEBHOOK_SECRET env var
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import crypto from 'crypto';

const router = Router();

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Initialize Supabase client with service role for backend operations
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Verify Resend webhook signature
 * @see https://resend.com/docs/dashboard/webhooks/verify-signature
 */
function verifyWebhookSignature(payload, signature, secret) {
    if (!secret) {
        console.warn('RESEND_WEBHOOK_SECRET not set - skipping verification');
        return true; // Allow in development
    }

    try {
        // Resend uses svix for webhooks
        // Signature format: v1,timestamp,signature
        const parts = signature.split(',');
        if (parts.length < 3) return false;

        const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
        const sig = parts.find(p => p.startsWith('v1='))?.split('=')[1];

        if (!timestamp || !sig) return false;

        // Check timestamp to prevent replay attacks (5 min tolerance)
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - parseInt(timestamp)) > 300) {
            console.warn('Webhook timestamp too old');
            return false;
        }

        // Compute expected signature
        const signedPayload = `${timestamp}.${payload}`;
        const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(signedPayload)
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(sig),
            Buffer.from(expectedSig)
        );
    } catch (err) {
        console.error('Signature verification error:', err);
        return false;
    }
}

/**
 * Fetch full email content from Resend
 * Webhooks only include metadata, must call API for body/attachments
 */
async function fetchEmailContent(emailId) {
    if (!resend) return null;

    try {
        // Use Resend's received emails API
        const response = await fetch(`https://api.resend.com/emails/${emailId}`, {
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            }
        });

        if (!response.ok) {
            console.error('Failed to fetch email content:', response.status);
            return null;
        }

        return await response.json();
    } catch (err) {
        console.error('Error fetching email content:', err);
        return null;
    }
}

/**
 * Find the original sent email and lead by matching sender email
 */
async function findOriginalEmail(fromEmail, toEmail, inReplyTo) {
    // First, try to match by in-reply-to header (most accurate)
    if (inReplyTo) {
        const { data: emailLog } = await supabase
            .from('email_logs')
            .select('*, leads:metadata->>leadId')
            .eq('message_id', inReplyTo)
            .maybeSingle();

        if (emailLog) {
            return emailLog;
        }
    }

    // Fallback: find the most recent cold email sent to this sender
    const { data: emailLog } = await supabase
        .from('email_logs')
        .select('*')
        .eq('email_type', 'cold_email')
        .eq('recipient', fromEmail)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    return emailLog;
}

/**
 * Find lead by email address
 */
async function findLeadByEmail(email) {
    const { data: lead } = await supabase
        .from('leads')
        .select('id, user_id, name')
        .eq('email', email)
        .maybeSingle();

    return lead;
}

/**
 * POST /api/resend/webhook
 * Main webhook endpoint for Resend events
 */
router.post('/webhook', async (req, res) => {
    const signature = req.headers['svix-signature'] || req.headers['resend-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // Verify signature (if secret is configured)
    if (process.env.RESEND_WEBHOOK_SECRET) {
        const isValid = verifyWebhookSignature(
            rawBody,
            signature,
            process.env.RESEND_WEBHOOK_SECRET
        );

        if (!isValid) {
            console.error('Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
    }

    try {
        const event = req.body;
        const eventType = event.type;

        console.log(`[Resend Webhook] Received event: ${eventType}`);

        switch (eventType) {
            case 'email.received':
                await handleEmailReceived(event.data);
                break;

            case 'email.bounced':
                await handleEmailBounced(event.data);
                break;

            case 'email.complained':
                await handleEmailComplained(event.data);
                break;

            case 'email.delivered':
                await handleEmailDelivered(event.data);
                break;

            default:
                console.log(`Unhandled event type: ${eventType}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        // Return 200 to prevent Resend from retrying
        res.json({ received: true, error: error.message });
    }
});

/**
 * Handle inbound email received
 */
async function handleEmailReceived(data) {
    console.log('[Resend] Email received:', data.email_id);

    const {
        email_id,
        from,
        to,
        subject,
        created_at,
        headers
    } = data;

    // Extract from address and name
    const fromMatch = from.match(/^(.+?)\s*<(.+?)>$/) || [null, null, from];
    const fromName = fromMatch[1]?.trim() || null;
    const fromEmail = fromMatch[2] || from;

    // Extract to address (first one)
    const toEmail = Array.isArray(to) ? to[0] : to;

    // Get In-Reply-To header for threading
    const inReplyTo = headers?.['in-reply-to'] || headers?.['In-Reply-To'];
    const references = headers?.['references'] || headers?.['References'];

    // Find the original sent email and lead
    const originalEmail = await findOriginalEmail(fromEmail, toEmail, inReplyTo);

    // Also try to find lead directly by email
    const leadByEmail = await findLeadByEmail(fromEmail);

    // Determine user_id and lead_id
    let userId = originalEmail?.user_id;
    let leadId = leadByEmail?.id;

    // If we found original email, get lead_id from metadata
    if (originalEmail?.metadata?.leadId) {
        leadId = originalEmail.metadata.leadId;
    }

    // If still no user_id, try to get from lead
    if (!userId && leadByEmail) {
        userId = leadByEmail.user_id;
    }

    // Fetch full email content (body, attachments)
    const fullEmail = await fetchEmailContent(email_id);

    // Store the response
    const { data: response, error } = await supabase
        .from('email_responses')
        .insert({
            resend_email_id: email_id,
            email_log_id: originalEmail?.id || null,
            lead_id: leadId,
            user_id: userId,
            from_email: fromEmail,
            from_name: fromName,
            to_email: toEmail,
            subject: subject,
            body_text: fullEmail?.text || null,
            body_html: fullEmail?.html || null,
            in_reply_to: inReplyTo,
            references_header: references,
            attachments: fullEmail?.attachments || [],
            received_at: created_at || new Date().toISOString(),
            status: 'unread'
        })
        .select()
        .single();

    if (error) {
        console.error('Failed to store email response:', error);
        throw error;
    }

    console.log(`[Resend] Stored email response: ${response.id}`);

    // Update lead status if found
    if (leadId) {
        await supabase
            .from('leads')
            .update({
                status: 'interested', // They replied, so they're interested
                notes: `Email reply received: ${subject}`
            })
            .eq('id', leadId);

        console.log(`[Resend] Updated lead ${leadId} status to interested`);
    }

    return response;
}

/**
 * Handle email bounced
 */
async function handleEmailBounced(data) {
    console.log('[Resend] Email bounced:', data.email_id);

    const { email_id, to } = data;
    const recipientEmail = Array.isArray(to) ? to[0] : to;

    // Update email log status
    await supabase
        .from('email_logs')
        .update({ status: 'bounced' })
        .eq('resend_id', email_id);

    // Find and update lead status
    const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('email', recipientEmail)
        .maybeSingle();

    if (lead) {
        await supabase
            .from('leads')
            .update({ status: 'invalid', notes: 'Email bounced' })
            .eq('id', lead.id);
    }
}

/**
 * Handle spam complaint
 */
async function handleEmailComplained(data) {
    console.log('[Resend] Email complaint:', data.email_id);

    const { email_id, to } = data;
    const recipientEmail = Array.isArray(to) ? to[0] : to;

    // Update email log status
    await supabase
        .from('email_logs')
        .update({ status: 'complained' })
        .eq('resend_id', email_id);

    // Find and update lead - mark as not interested
    const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('email', recipientEmail)
        .maybeSingle();

    if (lead) {
        await supabase
            .from('leads')
            .update({ status: 'not_interested', notes: 'Marked as spam' })
            .eq('id', lead.id);
    }
}

/**
 * Handle email delivered
 */
async function handleEmailDelivered(data) {
    console.log('[Resend] Email delivered:', data.email_id);

    // Update email log status
    await supabase
        .from('email_logs')
        .update({ status: 'delivered' })
        .eq('resend_id', data.email_id);
}

/**
 * GET /api/resend/status
 * Check webhook configuration status
 */
router.get('/status', (req, res) => {
    res.json({
        configured: !!process.env.RESEND_API_KEY,
        webhookSecret: !!process.env.RESEND_WEBHOOK_SECRET,
        inboundDomain: process.env.RESEND_INBOUND_DOMAIN || 'Not configured'
    });
});

export default router;
