import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Import routes
import supabaseRoutes from './routes/supabase.js';
import vapiRoutes from './routes/vapi.js';
import stripeRoutes from './routes/stripe.js';
import scheduledRoutes from './routes/scheduled.js';
import claudeRoutes from './routes/claude.js';
import usageRoutes from './routes/usage.js';
import emailRoutes from './routes/email.js';
import domainsRoutes from './routes/domains.js';
import adminRoutes from './routes/admin.js';
import resendWebhookRoutes from './routes/resendWebhook.js';
import userSettingsRoutes from './routes/userSettings.js';

// Import services
import callScheduler from './services/callScheduler.js';
import triggerEngine from './services/triggerEngine.js';

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors({
    origin: [
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
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Resend webhook also needs raw body for signature verification
app.use('/api/resend/webhook', express.raw({ type: 'application/json' }));

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
            supabase: !!process.env.SUPABASE_URL,
            vapi: !!process.env.VAPI_API_KEY,
            stripe: !!process.env.STRIPE_SECRET_KEY,
            twilio: !!process.env.TWILIO_ACCOUNT_SID,
            claude: !!process.env.CLAUDE_API_URL,
            resend: !!process.env.RESEND_API_KEY,
            scheduler: true,
            triggerEngine: true,
        }
    });
});

// API Routes
app.use('/api/supabase', supabaseRoutes);
app.use('/api/vapi', vapiRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/billing', stripeRoutes);  // Alias for billing endpoints
app.use('/api/scheduled', scheduledRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/domains', domainsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/resend', resendWebhookRoutes);
app.use('/api/settings', userSettingsRoutes);

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

app.listen(PORT, () => {
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);

    // Start the call scheduler
    callScheduler.start();

    // Start the trigger engine (automated marketing emails)
    triggerEngine.start();
});
