-- =============================================
-- Migration 011: User Email Domains
-- =============================================
-- Allows users to verify their own email domains
-- for sending cold emails from custom addresses

-- Create user_domains table
CREATE TABLE IF NOT EXISTS user_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    domain_name TEXT NOT NULL,
    resend_domain_id TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
    dns_records JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    UNIQUE(user_id, domain_name)
);

-- Add comments
COMMENT ON TABLE user_domains IS 'Stores user-verified email domains for sending cold emails';
COMMENT ON COLUMN user_domains.domain_name IS 'The domain name (e.g., abc.com)';
COMMENT ON COLUMN user_domains.resend_domain_id IS 'Domain ID from Resend API';
COMMENT ON COLUMN user_domains.status IS 'Verification status: pending, verified, or failed';
COMMENT ON COLUMN user_domains.dns_records IS 'DNS records required for verification (from Resend)';

-- Enable RLS
ALTER TABLE user_domains ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own domains"
    ON user_domains FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own domains"
    ON user_domains FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own domains"
    ON user_domains FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own domains"
    ON user_domains FOR DELETE
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_user_domains_user_id ON user_domains(user_id);
CREATE INDEX idx_user_domains_status ON user_domains(status);
CREATE INDEX idx_user_domains_domain_name ON user_domains(domain_name);

-- Trigger for updated_at
CREATE TRIGGER update_user_domains_updated_at
    BEFORE UPDATE ON user_domains
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant access to authenticated users
GRANT ALL ON user_domains TO authenticated;
