CREATE TABLE google_identities (
    subject text PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    csrf_token text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE oauth_states (
    state_hash text PRIMARY KEY,
    verifier text NOT NULL,
    nonce text NOT NULL,
    expires_at timestamptz NOT NULL
);
-- Small branding assets live in PostgreSQL; no separate storage service needed.
CREATE TABLE brand_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content_type text NOT NULL,
    content bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
