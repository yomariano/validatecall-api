# Market Research AI - API Backend Server

A Node.js Express backend that proxies all external API calls (Supabase, Apify, Vapi) to keep API keys secure on the server side.

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

### Apify (Google Maps Scraping)
- `GET /api/apify/status` - Check if Apify is configured
- `POST /api/apify/scrape` - Start a scraping run
- `GET /api/apify/runs/:runId` - Get run status
- `GET /api/apify/runs/:runId/results` - Get scraped results
- `GET /api/apify/runs` - Get recent runs

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
    ├── apify.js      # Apify endpoints
    ├── supabase.js   # Supabase endpoints  
    └── vapi.js       # Vapi endpoints
```

The frontend makes all API calls to this backend server (default: `http://localhost:3001`), which then makes the actual API calls to the external services with the proper authentication.
