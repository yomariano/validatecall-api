# PostgreSQL and Google sign-in

## Deployment

1. Provision PostgreSQL 17 (or test another supported PostgreSQL version), take backups, and
   set the API's `DATABASE_URL`. Use the database provider's verified TLS configuration for
   remote connections. Do not disable certificate verification.
2. Run `npm ci` and `npm run db:migrate`. Migrations are transactional, protected by an advisory
   lock, and recorded with checksums. Edit a new migration, never an already-applied migration.
3. Configure Google OAuth, `FRONTEND_URL`, and `API_PUBLIC_URL`. The Google callback URI must
   match `GOOGLE_REDIRECT_URI` exactly. For production use HTTPS and `NODE_ENV=production`.
4. Build the frontend with its public `VITE_API_URL`. Host frontend/API on the same site
   (for example `app.validatecall.com` and `api.validatecall.com`). Sessions use SameSite=Lax
   cookies; unrelated frontend/API domains are not a supported deployment configuration.
5. Verify sign-in, a saved lead, campaign creation, and logout before enabling outbound workers.
   Configure and verify signed webhooks, then set `RUN_SCHEDULERS=true` if desired.

Google sign-in requests `openid email profile`, verifies the ID token using Google's library,
and binds it to a one-time state/nonce and PKCE verifier. Google access/refresh tokens are not
stored. A seven-day opaque session is kept in a Secure, HttpOnly cookie; only its hash is stored
in PostgreSQL. Expired sessions can be removed periodically with:

```sql
DELETE FROM auth_sessions WHERE expires_at < now();
DELETE FROM oauth_states WHERE expires_at < now();
```

Brand logos (up to 2 MB, PNG/JPEG/GIF/WebP) are stored in `brand_assets` and served by opaque ID.
Database backups therefore include newly uploaded branding assets.

## Existing Supabase installations

The code migration is separate from moving a live installation's data. The files in
`supabase/migrations` are historical; do not apply them to the standalone database, and do not
apply the standalone bootstrap over an existing production schema.

Perform a rehearsed migration into a separate database before cutover:

1. Back up the source database and storage. Stop writes and outbound workers for the final copy.
2. Apply `db/migrations` to the empty target. Copy application rows using an audited export/import
   that preserves primary keys, foreign keys, timestamps, subscription/provider IDs, and JSON
   values. Compare counts per table and per user. Account for seeded template/plan rows and the
   lead-usage triggers when importing; preserve usage counters rather than incrementing them twice.
3. Export the Google subject alongside the original profile UUID from the source. On the
   Supabase source, this query provides the identity mapping (never migrate by email alone):

   ```sql
   SELECT user_id, identity_data->>'sub' AS subject
   FROM auth.identities
   WHERE provider = 'google' AND identity_data->>'sub' IS NOT NULL;
   ```

   Import those pairs into target `google_identities(user_id, subject)` after profiles.
   Validate duplicates and missing profiles first. The old Supabase session is not carried over;
   users sign in again. Accounts without a Google identity need a separately verified account
   linking process; the application intentionally refuses automatic linking based on email.
4. Reconcile historical Vapi assistants and calls with their actual owners, then populate
   `vapi_assistants(id,user_id)` and `vapi_calls(id,user_id)`. Only these server-owned mappings
   authorize provider access. Do not infer ownership from shared assistant IDs or untrusted
   old client-submitted records. Unmapped resources stay inaccessible.
5. Reupload existing brand logos through Settings so their URLs point at the new API. Verify
   that no active email template still depends on the old storage URLs before retiring storage.
6. Test the copied database with workers disabled, switch the application URLs, then enable
   workers. Keep the source backup and a rollback plan until the migration is accepted.

No live data has been migrated by the repository changes. Source credentials and an actual
export are required to rehearse and validate this installation-specific cutover.

## Outbound recovery

`scheduled_calls` is claimed with a status/timestamp compare-and-set. Sequence/workflow actions
have durable unique keys in `outbound_job_claims`. Claims do not expire automatically: a worker
crash or timeout may occur after a provider accepted the request. Review stale `running` claims,
`needs_review` claims, and paused enrollments in operations monitoring.

Check the provider's delivery/call record before manually retrying. If delivered, reconcile the
local record and advance the enrollment instead of sending again. If definitively not delivered,
resume the enrollment after review; only release an old claim if intentionally retrying that
same action. These claims prevent competing workers, but cannot make an external provider and
PostgreSQL one atomic transaction.
