-- Email logs table for tracking sent emails and deduplication
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    resend_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'sent',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by user and email type (for deduplication)
CREATE INDEX IF NOT EXISTS idx_email_logs_user_type ON email_logs(user_id, email_type);

-- Index for finding recent emails
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access (for backend operations)
CREATE POLICY "Service role full access" ON email_logs
    FOR ALL USING (auth.role() = 'service_role');

-- Policy: Users can view their own email logs
CREATE POLICY "Users can view own email logs" ON email_logs
    FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE email_logs IS 'Tracks all transactional emails sent via Resend';
COMMENT ON COLUMN email_logs.email_type IS 'Type of email: welcome, payment_confirmation, usage_alert_leads_80, usage_alert_calls_80';
COMMENT ON COLUMN email_logs.resend_id IS 'Email ID returned by Resend API';
