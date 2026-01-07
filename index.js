import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Import routes
import apifyRoutes from './routes/apify.js';
import supabaseRoutes from './routes/supabase.js';
import vapiRoutes from './routes/vapi.js';
import stripeRoutes from './routes/stripe.js';
import scheduledRoutes from './routes/scheduled.js';
import claudeRoutes from './routes/claude.js';

// Import services
import callScheduler from './services/callScheduler.js';

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175'],
    credentials: true,
}));

// Stripe webhook needs raw body for signature verification
// Must be before express.json() middleware
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

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
            apify: !!process.env.APIFY_TOKEN,
            vapi: !!process.env.VAPI_API_KEY,
            stripe: !!process.env.STRIPE_SECRET_KEY,
            twilio: !!process.env.TWILIO_ACCOUNT_SID,
            claude: !!process.env.CLAUDE_API_URL,
            scheduler: true,
        }
    });
});

// API Routes
app.use('/api/apify', apifyRoutes);
app.use('/api/supabase', supabaseRoutes);
app.use('/api/vapi', vapiRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/scheduled', scheduledRoutes);
app.use('/api/claude', claudeRoutes);

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
});
