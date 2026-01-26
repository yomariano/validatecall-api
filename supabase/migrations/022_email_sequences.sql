-- Migration: Email Sequences & Tracking System
-- Cold email automation with multi-step sequences, tracking, and analytics

-- ============================================
-- 1. EMAIL SEQUENCES - Multi-step sequence definitions
-- ============================================
CREATE TABLE IF NOT EXISTS email_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'draft', -- draft, active, paused, completed

    -- Send window settings
    timezone TEXT DEFAULT 'UTC',
    send_window_start TIME DEFAULT '09:00',
    send_window_end TIME DEFAULT '17:00',
    send_days INTEGER[] DEFAULT '{1,2,3,4,5}', -- Mon-Fri (1=Monday, 7=Sunday)

    -- Stop conditions
    stop_on_reply BOOLEAN DEFAULT TRUE,
    stop_on_click BOOLEAN DEFAULT FALSE,
    stop_on_bounce BOOLEAN DEFAULT TRUE,

    -- Stats (denormalized for performance)
    total_enrolled INTEGER DEFAULT 0,
    total_sent INTEGER DEFAULT 0,
    total_opens INTEGER DEFAULT 0,
    total_clicks INTEGER DEFAULT 0,
    total_replies INTEGER DEFAULT 0,
    total_bounces INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_sequences_user_id ON email_sequences(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sequences_campaign_id ON email_sequences(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_sequences_status ON email_sequences(status);

-- ============================================
-- 2. EMAIL SEQUENCE STEPS - Individual steps in sequence
-- ============================================
CREATE TABLE IF NOT EXISTS email_sequence_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID REFERENCES email_sequences(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    delay_days INTEGER NOT NULL DEFAULT 3,
    delay_hours INTEGER DEFAULT 0,

    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    cta_text TEXT,
    cta_url TEXT,

    -- Stats per step (denormalized)
    emails_sent INTEGER DEFAULT 0,
    opens INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    bounces INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(sequence_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_email_sequence_steps_sequence_id ON email_sequence_steps(sequence_id);

-- ============================================
-- 3. EMAIL SEQUENCE ENROLLMENTS - Lead progress through sequence
-- ============================================
CREATE TABLE IF NOT EXISTS email_sequence_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID REFERENCES email_sequences(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    current_step INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- active, completed, stopped_reply, stopped_click, stopped_bounce, paused, unsubscribed

    next_email_at TIMESTAMPTZ,
    last_email_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    stopped_reason TEXT,

    -- AI-generated personalization cache
    personalized_data JSONB DEFAULT '{}',

    emails_sent INTEGER DEFAULT 0,
    opens INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(sequence_id, lead_id)
);

-- Index for scheduler polling (critical for performance)
CREATE INDEX IF NOT EXISTS idx_enrollments_pending ON email_sequence_enrollments(next_email_at, status)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_enrollments_sequence_id ON email_sequence_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_lead_id ON email_sequence_enrollments(lead_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON email_sequence_enrollments(user_id);

-- ============================================
-- 4. EMAIL TRACKING EVENTS - Opens, clicks, bounces
-- ============================================
CREATE TABLE IF NOT EXISTS email_tracking_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_log_id UUID REFERENCES email_logs(id) ON DELETE SET NULL,
    enrollment_id UUID REFERENCES email_sequence_enrollments(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    event_type TEXT NOT NULL, -- open, click, bounce, unsubscribe, delivered
    tracking_id TEXT NOT NULL,
    url TEXT, -- For clicks (original URL)

    ip_address TEXT,
    user_agent TEXT,
    device_type TEXT, -- desktop, mobile, tablet

    event_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_tracking_id ON email_tracking_events(tracking_id);
CREATE INDEX IF NOT EXISTS idx_tracking_email_log_id ON email_tracking_events(email_log_id);
CREATE INDEX IF NOT EXISTS idx_tracking_enrollment_id ON email_tracking_events(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_tracking_event_type ON email_tracking_events(event_type);
CREATE INDEX IF NOT EXISTS idx_tracking_event_at ON email_tracking_events(event_at DESC);

-- ============================================
-- 5. EMAIL UNSUBSCRIBES - Suppression list
-- ============================================
CREATE TABLE IF NOT EXISTS email_unsubscribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    reason TEXT,
    source TEXT, -- manual, link, complaint
    unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_unsubscribes_user_email ON email_unsubscribes(user_id, email);

-- ============================================
-- 6. ALTER EXISTING TABLES - Add tracking columns
-- ============================================

-- email_logs: Add tracking and sequence columns
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS tracking_id TEXT;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS sequence_id UUID REFERENCES email_sequences(id) ON DELETE SET NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES email_sequence_enrollments(id) ON DELETE SET NULL;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS step_number INTEGER;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS open_count INTEGER DEFAULT 0;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS subject TEXT;

-- Add index for tracking_id lookups
CREATE INDEX IF NOT EXISTS idx_email_logs_tracking_id ON email_logs(tracking_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sequence_id ON email_logs(sequence_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_enrollment_id ON email_logs(enrollment_id);

-- leads: Add engagement tracking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_status TEXT DEFAULT 'none'; -- none, contacted, engaged, replied, bounced, unsubscribed
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_emails_sent INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_opens INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_clicks INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_replied_at TIMESTAMPTZ;

-- ============================================
-- 7. ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on new tables
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_unsubscribes ENABLE ROW LEVEL SECURITY;

-- Service role policies (full access for backend)
CREATE POLICY "Service role full access on email_sequences" ON email_sequences
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on email_sequence_steps" ON email_sequence_steps
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on email_sequence_enrollments" ON email_sequence_enrollments
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on email_tracking_events" ON email_tracking_events
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on email_unsubscribes" ON email_unsubscribes
    FOR ALL USING (auth.role() = 'service_role');

-- User policies (users can view/manage their own data)
CREATE POLICY "Users can view own email_sequences" ON email_sequences
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own email_sequences" ON email_sequences
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own sequence steps" ON email_sequence_steps
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM email_sequences es
            WHERE es.id = email_sequence_steps.sequence_id
            AND es.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view own enrollments" ON email_sequence_enrollments
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own tracking events" ON email_tracking_events
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own unsubscribes" ON email_unsubscribes
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- 8. HELPER FUNCTIONS
-- ============================================

-- Function to increment sequence stats
CREATE OR REPLACE FUNCTION increment_sequence_stats(
    p_sequence_id UUID,
    p_stat_name TEXT,
    p_increment INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
    EXECUTE format(
        'UPDATE email_sequences SET %I = COALESCE(%I, 0) + $1, updated_at = NOW() WHERE id = $2',
        p_stat_name, p_stat_name
    )
    USING p_increment, p_sequence_id;
END;
$$ LANGUAGE plpgsql;

-- Function to increment step stats
CREATE OR REPLACE FUNCTION increment_step_stats(
    p_sequence_id UUID,
    p_step_number INTEGER,
    p_stat_name TEXT,
    p_increment INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
    EXECUTE format(
        'UPDATE email_sequence_steps SET %I = COALESCE(%I, 0) + $1, updated_at = NOW() WHERE sequence_id = $2 AND step_number = $3',
        p_stat_name, p_stat_name
    )
    USING p_increment, p_sequence_id, p_step_number;
END;
$$ LANGUAGE plpgsql;

-- Function to increment lead email stats
CREATE OR REPLACE FUNCTION increment_lead_email_stats(
    p_lead_id UUID,
    p_stat_name TEXT,
    p_increment INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
    EXECUTE format(
        'UPDATE leads SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
        p_stat_name, p_stat_name
    )
    USING p_increment, p_lead_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get email analytics for a date range
CREATE OR REPLACE FUNCTION get_email_analytics(
    p_user_id UUID,
    p_start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
    p_end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    total_sent BIGINT,
    total_delivered BIGINT,
    total_opens BIGINT,
    total_clicks BIGINT,
    total_bounces BIGINT,
    total_unsubscribes BIGINT,
    unique_opens BIGINT,
    unique_clicks BIGINT,
    open_rate NUMERIC,
    click_rate NUMERIC,
    bounce_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH email_stats AS (
        SELECT
            COUNT(*) as sent,
            COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) as delivered,
            SUM(COALESCE(open_count, 0)) as opens,
            SUM(COALESCE(click_count, 0)) as clicks,
            COUNT(*) FILTER (WHERE bounced_at IS NOT NULL) as bounces,
            COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as unique_opens,
            COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) as unique_clicks
        FROM email_logs
        WHERE user_id = p_user_id
        AND created_at BETWEEN p_start_date AND p_end_date
    ),
    unsub_stats AS (
        SELECT COUNT(*) as unsubs
        FROM email_unsubscribes
        WHERE user_id = p_user_id
        AND unsubscribed_at BETWEEN p_start_date AND p_end_date
    )
    SELECT
        es.sent,
        es.delivered,
        es.opens,
        es.clicks,
        es.bounces,
        us.unsubs,
        es.unique_opens,
        es.unique_clicks,
        CASE WHEN es.delivered > 0 THEN ROUND((es.unique_opens::NUMERIC / es.delivered) * 100, 2) ELSE 0 END,
        CASE WHEN es.delivered > 0 THEN ROUND((es.unique_clicks::NUMERIC / es.delivered) * 100, 2) ELSE 0 END,
        CASE WHEN es.sent > 0 THEN ROUND((es.bounces::NUMERIC / es.sent) * 100, 2) ELSE 0 END
    FROM email_stats es, unsub_stats us;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. COMMENTS
-- ============================================

COMMENT ON TABLE email_sequences IS 'Multi-step email sequences for cold email campaigns';
COMMENT ON TABLE email_sequence_steps IS 'Individual steps within an email sequence';
COMMENT ON TABLE email_sequence_enrollments IS 'Tracks lead progress through email sequences';
COMMENT ON TABLE email_tracking_events IS 'Records all email engagement events (opens, clicks, bounces)';
COMMENT ON TABLE email_unsubscribes IS 'Suppression list for unsubscribed emails';

COMMENT ON COLUMN email_sequences.send_days IS 'Days of week to send (1=Monday, 7=Sunday)';
COMMENT ON COLUMN email_sequence_enrollments.personalized_data IS 'AI-generated personalized content cached per lead';
COMMENT ON COLUMN email_tracking_events.tracking_id IS 'Unique ID embedded in tracking pixel and links';
