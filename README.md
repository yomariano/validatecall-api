# ValidateCall API

Express API for lead research, campaign data, voice calls, and email workflows. Uses direct
PostgreSQL access and Google OAuth with server-side sessions. Supabase is no longer required
at runtime.

## Local setup

```sh
npm ci
cp .env.example .env
docker compose up -d --wait
npm run db:migrate
npm run dev
```

Alternatively point `DATABASE_URL` at an existing **empty** PostgreSQL database you own.
Docker's example password and loopback port are for local development only.
Start the sibling frontend with `VITE_API_URL=http://localhost:3002`.

Create a Google OAuth **Web application** client and set `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the API environment. Register the exact
redirect URI `http://localhost:3002/api/auth/google/callback` for local development. Use
`FRONTEND_URL=http://localhost:5173`. Configure consent-screen test users if the client is in
testing mode. No Gmail API or inbox permissions are requested.

See [PostgreSQL and deployment notes](docs/POSTGRESQL.md) before replacing an existing installation.

## Optional providers

- Research: `BRAVE_SEARCH_API_KEY` and `DEEPINFRA_API_KEY`. Each request makes two searches
  and at most one model call. `DEEPINFRA_RESEARCH_MODEL` defaults to
  `deepseek-ai/DeepSeek-V4.1-Flash`; set a supported DeepInfra model ID to change it.
  Search results are evidence for extraction, not instructions. Source links accompany results;
  missing contact details stay empty. CSV import works without either key.
- Voice: Vapi credentials and phone number, plus `VAPI_WEBHOOK_SECRET` configured as the
  provider's `x-vapi-secret` webhook header.
- Email: Resend credentials and `RESEND_WEBHOOK_SECRET` for signed events. The inbound email
  relay must send `x-webhook-secret` matching `INBOUND_EMAIL_WEBHOOK_SECRET`.
- Billing: Stripe credentials, prices, and signing secret. Both `/api/stripe/webhook` and
  `/api/billing/webhook` verify the original request bytes.
- The existing Claude gateway is optional for copy generation and email personalization;
  it no longer generates contact records.

No provider secrets belong in frontend environment variables. Missing integrations return
an explicit unavailable error. Research limits default to 20 requests/user/day and 200 total/day
and are reserved atomically before provider requests (failed attempts still consume budget).
These are application request caps, not a provider billing guarantee.

## API and workers

`/api/auth/google` begins sign-in; `/api/auth/session` returns the signed-in profile and CSRF
token. Private routes require the HttpOnly session cookie. Mutations also require
`X-CSRF-Token`. `/api/data` serves user-owned database records. A user ID in a request does not
authenticate the caller. Admin endpoints check the authenticated profile's role.

Set `RUN_SCHEDULERS=true` only when the database and outbound providers are configured.
Workers use database claims to prevent competing instances from executing the same action.
Ambiguous failures remain claimed and pause affected enrollments; inspect the provider before
resuming. See the deployment notes for recovery details.

```sh
npm test -- --runInBand
```

Tests apply real SQL migrations in PGlite, an embedded PostgreSQL engine, and exercise the
Express middleware, OAuth callback, tenant isolation, signatures, concurrency, and sourced
research with mocked external providers. Importing `app.js` does not start a listener or workers.
