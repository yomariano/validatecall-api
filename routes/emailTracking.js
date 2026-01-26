/**
 * Email Tracking Routes
 * Handles tracking pixel requests, click redirects, and unsubscribes
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { recordTrackingEvent, processUnsubscribe } from '../services/emailTracking.js';
import emailSequenceScheduler from '../services/emailSequenceScheduler.js';

const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// 1x1 transparent GIF
const TRACKING_PIXEL = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/email-tracking/open
 * Tracking pixel endpoint - returns 1x1 transparent GIF
 */
router.get('/open', async (req, res) => {
    const { tid: trackingId } = req.query;

    // Always return the pixel immediately
    res.set({
        'Content-Type': 'image/gif',
        'Content-Length': TRACKING_PIXEL.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
    });
    res.send(TRACKING_PIXEL);

    // Record event asynchronously (don't block response)
    if (trackingId) {
        recordTrackingEvent({
            trackingId,
            eventType: 'open',
            ipAddress: req.ip || req.headers['x-forwarded-for'],
            userAgent: req.headers['user-agent'],
        }).catch(err => {
            console.error('Error recording open event:', err.message);
        });
    }
});

/**
 * GET /api/email-tracking/click
 * Click tracking endpoint - records click and redirects
 */
router.get('/click', async (req, res) => {
    const { tid: trackingId, url } = req.query;

    if (!url) {
        return res.redirect(FRONTEND_URL);
    }

    // Decode URL
    let targetUrl;
    try {
        targetUrl = decodeURIComponent(url);
    } catch {
        targetUrl = url;
    }

    // Validate URL (basic security check)
    try {
        new URL(targetUrl);
    } catch {
        // Invalid URL, redirect to frontend
        return res.redirect(FRONTEND_URL);
    }

    // Record event asynchronously
    if (trackingId) {
        recordTrackingEvent({
            trackingId,
            eventType: 'click',
            url: targetUrl,
            ipAddress: req.ip || req.headers['x-forwarded-for'],
            userAgent: req.headers['user-agent'],
        }).then(async event => {
            // Check stop conditions
            if (event?.enrollment_id) {
                await emailSequenceScheduler.handleStopCondition(event.enrollment_id, 'click');
            }
        }).catch(err => {
            console.error('Error recording click event:', err.message);
        });
    }

    // Redirect to target URL
    res.redirect(302, targetUrl);
});

/**
 * GET /api/email-tracking/unsubscribe
 * Unsubscribe page - shows confirmation
 */
router.get('/unsubscribe', async (req, res) => {
    const { tid: trackingId, e: encodedEmail } = req.query;

    if (!trackingId || !encodedEmail) {
        return res.redirect(FRONTEND_URL);
    }

    // Decode email
    let email;
    try {
        email = Buffer.from(encodedEmail, 'base64url').toString();
    } catch {
        return res.redirect(FRONTEND_URL);
    }

    // Render unsubscribe confirmation page
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unsubscribe - ValidateCall</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            background: linear-gradient(135deg, #f5f5f5 0%, #e5e5e5 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 480px;
            width: 100%;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            text-align: center;
        }
        .icon {
            width: 64px;
            height: 64px;
            background: #fef3c7;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 32px;
        }
        h1 {
            color: #1f2937;
            margin-bottom: 12px;
            font-size: 24px;
        }
        p {
            color: #6b7280;
            margin-bottom: 24px;
        }
        .email {
            background: #f3f4f6;
            padding: 12px 20px;
            border-radius: 8px;
            font-family: monospace;
            color: #374151;
            margin-bottom: 24px;
            word-break: break-all;
        }
        button {
            background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
            color: white;
            border: none;
            padding: 14px 32px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .success {
            color: #059669;
            font-weight: 500;
        }
        .error {
            color: #dc2626;
        }
        #result { margin-top: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">📧</div>
        <h1>Unsubscribe from Emails</h1>
        <p>You are about to unsubscribe the following email address from our marketing communications:</p>
        <div class="email">${email}</div>
        <button id="unsubscribeBtn" onclick="handleUnsubscribe()">
            Confirm Unsubscribe
        </button>
        <div id="result"></div>
    </div>

    <script>
        async function handleUnsubscribe() {
            const btn = document.getElementById('unsubscribeBtn');
            const result = document.getElementById('result');

            btn.disabled = true;
            btn.textContent = 'Processing...';

            try {
                const response = await fetch('/api/email-tracking/unsubscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        trackingId: '${trackingId}',
                        email: '${email}'
                    })
                });

                const data = await response.json();

                if (data.success) {
                    result.innerHTML = '<p class="success">You have been successfully unsubscribed. You will no longer receive marketing emails from us.</p>';
                    btn.style.display = 'none';
                } else {
                    result.innerHTML = '<p class="error">Something went wrong. Please try again or contact support.</p>';
                    btn.disabled = false;
                    btn.textContent = 'Try Again';
                }
            } catch (err) {
                result.innerHTML = '<p class="error">Network error. Please try again.</p>';
                btn.disabled = false;
                btn.textContent = 'Try Again';
            }
        }
    </script>
</body>
</html>`;

    res.type('html').send(html);
});

/**
 * POST /api/email-tracking/unsubscribe
 * Process unsubscribe request
 */
router.post('/unsubscribe', async (req, res) => {
    const { trackingId, email } = req.body;

    if (!trackingId || !email) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const success = await processUnsubscribe(trackingId, email, 'link');
        res.json({ success });
    } catch (error) {
        console.error('Unsubscribe error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/email-tracking/analytics
 * Get email analytics for a user
 */
router.get('/analytics', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { startDate, endDate } = req.query;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        // Try RPC first
        let analytics;
        const { data: rpcResult, error: rpcError } = await supabase.rpc('get_email_analytics', {
            p_user_id: userId,
            p_start_date: start.toISOString(),
            p_end_date: end.toISOString()
        });

        if (!rpcError && rpcResult && rpcResult.length > 0) {
            analytics = rpcResult[0];
        } else {
            // Fallback: manual query
            const { data: emailLogs } = await supabase
                .from('email_logs')
                .select('*')
                .eq('user_id', userId)
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString());

            const logs = emailLogs || [];
            const sent = logs.length;
            const delivered = logs.filter(l => l.delivered_at).length;
            const uniqueOpens = logs.filter(l => l.opened_at).length;
            const uniqueClicks = logs.filter(l => l.clicked_at).length;
            const bounces = logs.filter(l => l.bounced_at).length;
            const totalOpens = logs.reduce((sum, l) => sum + (l.open_count || 0), 0);
            const totalClicks = logs.reduce((sum, l) => sum + (l.click_count || 0), 0);

            const { count: unsubs } = await supabase
                .from('email_unsubscribes')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .gte('unsubscribed_at', start.toISOString())
                .lte('unsubscribed_at', end.toISOString());

            analytics = {
                total_sent: sent,
                total_delivered: delivered,
                total_opens: totalOpens,
                total_clicks: totalClicks,
                total_bounces: bounces,
                total_unsubscribes: unsubs || 0,
                unique_opens: uniqueOpens,
                unique_clicks: uniqueClicks,
                open_rate: delivered > 0 ? Math.round((uniqueOpens / delivered) * 100) : 0,
                click_rate: delivered > 0 ? Math.round((uniqueClicks / delivered) * 100) : 0,
                bounce_rate: sent > 0 ? Math.round((bounces / sent) * 100) : 0,
            };
        }

        res.json({ analytics });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/email-tracking/analytics/timeseries
 * Get time-series data for charts
 */
router.get('/analytics/timeseries', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { startDate, endDate, interval = 'day' } = req.query;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        // Get email logs
        const { data: logs } = await supabase
            .from('email_logs')
            .select('created_at, opened_at, clicked_at, bounced_at')
            .eq('user_id', userId)
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString())
            .order('created_at', { ascending: true });

        // Group by day
        const dailyStats = {};

        (logs || []).forEach(log => {
            const date = new Date(log.created_at).toISOString().split('T')[0];

            if (!dailyStats[date]) {
                dailyStats[date] = { sent: 0, opens: 0, clicks: 0, bounces: 0 };
            }

            dailyStats[date].sent++;
            if (log.opened_at) dailyStats[date].opens++;
            if (log.clicked_at) dailyStats[date].clicks++;
            if (log.bounced_at) dailyStats[date].bounces++;
        });

        // Convert to array
        const timeseries = Object.entries(dailyStats)
            .map(([date, stats]) => ({
                date,
                ...stats,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        res.json({ timeseries });
    } catch (error) {
        console.error('Timeseries error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/email-tracking/recent
 * Get recent tracking events
 */
router.get('/recent', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { limit = 50, eventType } = req.query;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        let query = supabase
            .from('email_tracking_events')
            .select(`
                *,
                lead:leads(id, name, email)
            `)
            .eq('user_id', userId)
            .order('event_at', { ascending: false })
            .limit(parseInt(limit));

        if (eventType) {
            query = query.eq('event_type', eventType);
        }

        const { data, error } = await query;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({ events: data });
    } catch (error) {
        console.error('Recent events error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
