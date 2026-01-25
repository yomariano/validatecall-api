-- Email responses table for storing inbound email replies
-- Run this in Supabase SQL Editor

-- =============================================
-- EMAIL RESPONSES TABLE - Inbound email replies
-- =============================================
CREATE TABLE IF NOT EXISTS email_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to original sent email
    email_log_id UUID REFERENCES email_logs(id) ON DELETE SET NULL,

    -- Link to lead (for quick lookups)
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

    -- Owner (user who sent the original email)
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Resend email ID
    resend_email_id VARCHAR(100) NOT NULL,

    -- Email content
    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(255),
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    body_text TEXT,
    body_html TEXT,

    -- Thread tracking
    in_reply_to VARCHAR(255),      -- Original Message-ID
    references_header TEXT,         -- Email references chain

    -- Attachments metadata (stored as JSON array)
    attachments JSONB DEFAULT '[]'::jsonb,

    -- Status
    status VARCHAR(20) DEFAULT 'unread', -- unread, read, replied, archived

    -- Timestamps
    received_at TIMESTAMPTZ NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_email_responses_user_id ON email_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_email_responses_lead_id ON email_responses(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_responses_email_log_id ON email_responses(email_log_id);
CREATE INDEX IF NOT EXISTS idx_email_responses_from_email ON email_responses(from_email);
CREATE INDEX IF NOT EXISTS idx_email_responses_status ON email_responses(status);
CREATE INDEX IF NOT EXISTS idx_email_responses_received_at ON email_responses(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_responses_resend_id ON email_responses(resend_email_id);

-- Enable Row Level Security
ALTER TABLE email_responses ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access (for webhook operations)
CREATE POLICY "Service role full access" ON email_responses
    FOR ALL USING (auth.role() = 'service_role');

-- Policy: Users can view their own email responses
CREATE POLICY "Users can view own email responses" ON email_responses
    FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can update their own email responses (mark as read, etc.)
CREATE POLICY "Users can update own email responses" ON email_responses
    FOR UPDATE USING (auth.uid() = user_id);

COMMENT ON TABLE email_responses IS 'Stores inbound email replies from leads via Resend webhooks';
COMMENT ON COLUMN email_responses.email_log_id IS 'Reference to the original outbound email in email_logs';
COMMENT ON COLUMN email_responses.resend_email_id IS 'Email ID from Resend inbound webhook';
COMMENT ON COLUMN email_responses.attachments IS 'JSON array of attachment metadata [{filename, content_type, size, download_url}]';

-- =============================================
-- UPDATE EMAIL_LOGS - Add metadata column if not exists
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'email_logs' AND column_name = 'metadata') THEN
        ALTER TABLE email_logs ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- =============================================
-- UPDATE EMAIL_LOGS - Add message_id column for threading
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'email_logs' AND column_name = 'message_id') THEN
        ALTER TABLE email_logs ADD COLUMN message_id VARCHAR(255);
    END IF;
END $$;

-- Index for message_id lookups (for matching replies)
CREATE INDEX IF NOT EXISTS idx_email_logs_message_id ON email_logs(message_id);

-- =============================================
-- VIEW - Email threads combining sent and received
-- =============================================
CREATE OR REPLACE VIEW email_threads AS
SELECT
    'sent' as direction,
    el.id,
    el.user_id,
    COALESCE((el.metadata->>'leadId')::uuid, NULL) as lead_id,
    el.recipient as email_address,
    el.metadata->>'subject' as subject,
    NULL as body_text,
    el.created_at as timestamp,
    'sent' as status
FROM email_logs el
WHERE el.email_type = 'cold_email'

UNION ALL

SELECT
    'received' as direction,
    er.id,
    er.user_id,
    er.lead_id,
    er.from_email as email_address,
    er.subject,
    er.body_text,
    er.received_at as timestamp,
    er.status
FROM email_responses er

ORDER BY timestamp DESC;

COMMENT ON VIEW email_threads IS 'Combined view of sent cold emails and received responses for thread display';
