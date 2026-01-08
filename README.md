# Market Research AI - API Backend Server

A Node.js Express backend that proxies all external API calls (Supabase, Vapi, Claude) to keep API keys secure on the server side.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and add your API keys
cp .env.example .env

# Start development server (with hot reload)
npm run dev

# Start production server
npm start
```

## API Endpoints

### Health Check
- `GET /health` - Server status and configured services

### Claude AI (Lead Generation & Text Processing)
- `GET /api/claude/status` - Check if Claude API is configured
- `POST /api/claude/generate-leads` - Generate leads using Claude AI
- `POST /api/claude/generate` - Generate improved text for AI voice agent
- `POST /api/claude/classify-industry` - Classify leads by industry

### Supabase (Database)
- `GET /api/supabase/status` - Check if Supabase is configured
- `GET /api/supabase/leads` - Get leads
- `POST /api/supabase/leads` - Save leads
- `PATCH /api/supabase/leads/:id/status` - Update lead status
- `GET /api/supabase/campaigns` - Get campaigns
- `POST /api/supabase/campaigns` - Create campaign
- `GET /api/supabase/calls` - Get calls
- `POST /api/supabase/calls` - Save call
- `GET /api/supabase/dashboard` - Get dashboard stats

### Vapi (AI Voice Calls)
- `GET /api/vapi/status` - Check if Vapi is configured
- `POST /api/vapi/call` - Initiate a single call
- `POST /api/vapi/calls/batch` - Batch initiate calls
- `GET /api/vapi/calls/:callId` - Get call status
- `GET /api/vapi/calls` - Get all calls

### Stripe (Payments)
- `GET /api/stripe/status` - Check if Stripe is configured
- `GET /api/stripe/plans` - Get subscription plans
- `GET /api/stripe/subscription/:userId` - Get user subscription

### Scheduled Calls
- `POST /api/scheduled/calls` - Schedule a call
- `GET /api/scheduled/calls` - Get scheduled calls
- `PATCH /api/scheduled/calls/:id` - Update scheduled call
- `DELETE /api/scheduled/calls/:id` - Cancel scheduled call

## Environment Variables

See `.env.example` for all required configuration.

## Architecture

```
server/
├── index.js          # Express server entry point
├── package.json      # Dependencies
├── .env              # API keys (git-ignored)
├── .env.example      # Template for API keys
└── routes/
    ├── claude.js     # Claude AI endpoints (lead gen, text processing)
    ├── supabase.js   # Supabase database endpoints
    ├── vapi.js       # Vapi voice AI endpoints
    ├── stripe.js     # Stripe payment endpoints
    └── scheduled.js  # Call scheduling endpoints
```

The frontend makes all API calls to this backend server (default: `http://localhost:3002`), which then makes the actual API calls to the external services with the proper authentication.
