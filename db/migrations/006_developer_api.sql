CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  key_last_four TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 120,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT api_keys_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT api_keys_rate_limit CHECK (rate_limit_per_minute BETWEEN 1 AND 1000)
);

CREATE INDEX api_keys_user_id ON api_keys(user_id, created_at DESC);
CREATE INDEX api_keys_active_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;

CREATE TABLE api_idempotency (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT api_idempotency_key_length CHECK (char_length(idempotency_key) BETWEEN 8 AND 200)
);

CREATE INDEX api_idempotency_expiry ON api_idempotency(expires_at);

COMMENT ON TABLE api_keys IS 'Hashed developer API credentials. Plaintext secrets are returned only at creation.';
COMMENT ON TABLE api_idempotency IS 'Prevents duplicate side effects for developer API requests.';
