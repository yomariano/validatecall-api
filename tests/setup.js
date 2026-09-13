process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:59999/unused';
process.env.VAPI_API_KEY = 'test-vapi-key';
// Do not load developer credentials or perform outbound calls in tests.
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.RESEND_WEBHOOK_SECRET;
delete process.env.VAPI_WEBHOOK_SECRET;
delete process.env.DEEPINFRA_API_KEY;
delete process.env.BRAVE_SEARCH_API_KEY;
process.env.FRONTEND_URL = 'http://localhost:5173';
