import 'dotenv/config';
import express from 'express';
import { assistantFleetWebhook } from './routes/assistantFleetWebhook.js';
import cors from 'cors';
import { createApiAuth } from './middleware/auth.js';

// Import routes
import researchRoutes from './routes/research.js';
import { researchConfigured } from './services/webResearch.js';
import telephonyRoutes from './routes/telephony.js';
import dataRoutes from './routes/data.js';
import authRoutes from './routes/auth.js';
import { database } from './db/database.js';
import voiceRoutes from './routes/voice.js';
import stripeRoutes from './routes/stripe.js';
import scheduledRoutes from './routes/scheduled.js';
import claudeRoutes from './routes/claude.js';
import usageRoutes from './routes/usage.js';
import emailRoutes from './routes/email.js';
import domainsRoutes from './routes/domains.js';
import adminRoutes from './routes/admin.js';
import resendWebhookRoutes from './routes/resendWebhook.js';
import userSettingsRoutes from './routes/userSettings.js';
import sequencesRoutes from './routes/sequences.js';
import emailTrackingRoutes from './routes/emailTracking.js';
import workflowsRoutes from './routes/workflows.js';
import developerRoutes from './routes/developer.js';
import publicApiRoutes from './routes/publicApi.js';

const app = express();

// Middleware
app.use(cors({
    origin: [
        ...(process.env.FRONTEND_URL || '').split(',').filter(Boolean),
        // Production domains
        'https://validatecall.com',
        'https://www.validatecall.com',
        'https://app.validatecall.com',
        // Local development
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175'
    ],
    credentials: true,
}));

// Stripe webhook needs raw body for signature verification
// Must be before express.json() middleware
app.use(['/api/stripe/webhook', '/api/billing/webhook'], express.raw({ type: 'application/json' }));

// Resend webhook also needs raw body for signature verification
app.use('/api/resend/webhook', express.raw({ type: 'application/json' }));

app.post('/api/voice/assistantfleet-webhook', express.raw({type:'application/json',limit:'2mb'}), assistantFleetWebhook);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            postgres: !!process.env.DATABASE_URL,
            research: researchConfigured(),
            assistantfleet: !!process.env.ASSISTANTFLEET_API_KEY,
            stripe: !!process.env.STRIPE_SECRET_KEY,
            telnyx: !!process.env.TELNYX_API_KEY,
            claude: !!process.env.CLAUDE_API_URL,
            resend: !!process.env.RESEND_API_KEY,
            scheduler: process.env.RUN_SCHEDULERS === 'true',
            triggerEngine: process.env.RUN_SCHEDULERS === 'true',
            emailSequenceScheduler: process.env.RUN_SCHEDULERS === 'true',
            workflowScheduler: process.env.RUN_SCHEDULERS === 'true',
        }
    });
});

// Readiness requires the migrated database, rather than an environment-variable check.
app.get('/health/ready', async (req, res) => {
    try {
        await database.query('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1');
        res.json({ status: 'ready' });
    } catch {
        res.status(503).json({ status: 'unavailable' });
    }
});

// Verify sessions before entering any private route. Webhooks verify provider credentials.
// Brand images are public by opaque ID so email recipients can load them.
app.get('/api/assets/:id', async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.sendStatus(404);
    try {
        const { rows } = await database.query('SELECT content_type,content FROM brand_assets WHERE id=$1', [req.params.id]);
        if (!rows[0]) return res.sendStatus(404);
        res.set('Content-Type', rows[0].content_type);
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Content-Security-Policy', "default-src 'none'");
        res.send(Buffer.from(rows[0].content));
    } catch { res.sendStatus(503); }
});
app.use('/api/auth', authRoutes);
app.use('/v1', publicApiRoutes);
app.use('/api', createApiAuth());

// API Routes
app.use('/api/telephony', telephonyRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/vapi', voiceRoutes); // Compatibility for older tabs; uses AssistantFleet only.
app.use('/api/stripe', stripeRoutes);
app.use('/api/billing', stripeRoutes);  // Alias for billing endpoints
app.use('/api/scheduled', scheduledRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/domains', domainsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/resend', resendWebhookRoutes);
app.use('/api/settings', userSettingsRoutes);
app.use('/api/sequences', sequencesRoutes);
app.use('/api/email-tracking', emailTrackingRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/developer', developerRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

export default app;
