-- Migration: Multi-Channel Outreach Workflows
-- Unified workflows combining email sequences + AI voice calls + SMS

-- ============================================
-- 1. OUTREACH WORKFLOWS - Multi-channel workflow definitions
-- ============================================
CREATE TABLE IF NOT EXISTS outreach_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft', -- draft, active, paused, completed

    -- Send window settings (applies to all steps)
    timezone TEXT DEFAULT 'UTC',
    send_window_start TIME DEFAULT '09:00',
    send_window_end TIME DEFAULT '17:00',
    send_days INTEGER[] DEFAULT '{1,2,3,4,5}', -- Mon-Fri

    -- Global stop conditions
    stop_on_reply BOOLEAN DEFAULT TRUE,
    stop_on_call_answered BOOLEAN DEFAULT TRUE,
    stop_on_meeting_booked BOOLEAN DEFAULT FALSE,
    stop_on_click BOOLEAN DEFAULT FALSE,
    stop_on_bounce BOOLEAN DEFAULT TRUE,

    -- Voice call settings (shared across call steps)
    default_assistant_id TEXT,
    call_max_retries INTEGER DEFAULT 2,

    -- Stats (denormalized)
    total_enrolled INTEGER DEFAULT 0,
    total_emails_sent INTEGER DEFAULT 0,
    total_calls_made INTEGER DEFAULT 0,
    total_opens INTEGER DEFAULT 0,
    total_clicks INTEGER DEFAULT 0,
    total_replies INTEGER DEFAULT 0,
    total_calls_answered INTEGER DEFAULT 0,
    total_meetings_booked INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_workflows_user_id ON outreach_workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_outreach_workflows_campaign_id ON outreach_workflows(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_workflows_status ON outreach_workflows(status);

-- ============================================
-- 2. WORKFLOW STEPS - Individual steps (email, call, wait, sms)
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES outreach_workflows(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL, -- email, call, sms, wait

    -- Timing
    delay_days INTEGER NOT NULL DEFAULT 0,
    delay_hours INTEGER DEFAULT 0,
    delay_minutes INTEGER DEFAULT 0,

    -- Condition to execute this step (optional)
    -- e.g., "no_reply", "no_open", "no_answer", "always"
    condition TEXT DEFAULT 'always',

    -- Email-specific fields
    email_subject TEXT,
    email_body TEXT,
    email_cta_text TEXT,
    email_cta_url TEXT,

    -- Call-specific fields
    call_assistant_id TEXT, -- Override workflow default
    call_script_context TEXT, -- Additional context for AI
    call_max_duration_seconds INTEGER DEFAULT 300,

    -- SMS-specific fields (future)
    sms_message TEXT,

    -- Wait-specific fields
    wait_for TEXT, -- reply, open, click, call_answer

    -- Stats per step
    executed INTEGER DEFAULT 0,
    emails_sent INTEGER DEFAULT 0,
    calls_made INTEGER DEFAULT 0,
    opens INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    calls_answered INTEGER DEFAULT 0,
    calls_voicemail INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(workflow_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow_id ON workflow_steps(workflow_id);

-- ============================================
-- 3. WORKFLOW ENROLLMENTS - Lead progress through workflow
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES outreach_workflows(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    current_step INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- active, completed, stopped_reply, stopped_call, stopped_click, stopped_bounce, paused, unsubscribed

    -- Scheduling
    next_action_at TIMESTAMPTZ,
    next_action_type TEXT, -- email, call, sms

    -- History tracking
    last_action_at TIMESTAMPTZ,
    last_action_type TEXT,
    last_action_result TEXT, -- sent, answered, voicemail, bounced, etc.

    -- Engagement tracking
    stopped_at TIMESTAMPTZ,
    stopped_reason TEXT,

    -- AI personalization cache
    personalized_data JSONB DEFAULT '{}',

    -- Aggregated stats
    emails_sent INTEGER DEFAULT 0,
    calls_made INTEGER DEFAULT 0,
    opens INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(workflow_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_pending ON workflow_enrollments(next_action_at, status)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_workflow_id ON workflow_enrollments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_lead_id ON workflow_enrollments(lead_id);
CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_user_id ON workflow_enrollments(user_id);

-- ============================================
-- 4. WORKFLOW ACTION LOG - Detailed action history
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_action_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES outreach_workflows(id) ON DELETE CASCADE,
    enrollment_id UUID REFERENCES workflow_enrollments(id) ON DELETE CASCADE,
    step_id UUID REFERENCES workflow_steps(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    action_type TEXT NOT NULL, -- email_sent, call_initiated, call_answered, call_voicemail, sms_sent
    action_result TEXT, -- success, failed, bounced, answered, voicemail, no_answer

    -- References to external systems
    email_log_id UUID REFERENCES email_logs(id) ON DELETE SET NULL,
    call_id TEXT, -- VAPI call ID
    tracking_id TEXT,

    -- Details
    metadata JSONB DEFAULT '{}',

    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_action_log_enrollment_id ON workflow_action_log(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_workflow_action_log_workflow_id ON workflow_action_log(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_action_log_executed_at ON workflow_action_log(executed_at DESC);

-- ============================================
-- 5. ROW LEVEL SECURITY
-- ============================================

ALTER TABLE outreach_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_action_log ENABLE ROW LEVEL SECURITY;

-- Service role policies
CREATE POLICY "Service role full access on outreach_workflows" ON outreach_workflows
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on workflow_steps" ON workflow_steps
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on workflow_enrollments" ON workflow_enrollments
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on workflow_action_log" ON workflow_action_log
    FOR ALL USING (auth.role() = 'service_role');

-- User policies
CREATE POLICY "Users can view own workflows" ON outreach_workflows
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own workflows" ON outreach_workflows
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own workflow steps" ON workflow_steps
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM outreach_workflows w
            WHERE w.id = workflow_steps.workflow_id
            AND w.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view own enrollments" ON workflow_enrollments
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own action log" ON workflow_action_log
    FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- 6. HELPER FUNCTIONS
-- ============================================

-- Function to increment workflow stats
CREATE OR REPLACE FUNCTION increment_workflow_stats(
    p_workflow_id UUID,
    p_stat_name TEXT,
    p_increment INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
    EXECUTE format(
        'UPDATE outreach_workflows SET %I = COALESCE(%I, 0) + $1, updated_at = NOW() WHERE id = $2',
        p_stat_name, p_stat_name
    )
    USING p_increment, p_workflow_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get workflow analytics
CREATE OR REPLACE FUNCTION get_workflow_analytics(
    p_workflow_id UUID
)
RETURNS TABLE (
    total_enrolled BIGINT,
    active_count BIGINT,
    completed_count BIGINT,
    stopped_count BIGINT,
    emails_sent BIGINT,
    calls_made BIGINT,
    email_open_rate NUMERIC,
    call_answer_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH enrollment_stats AS (
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'active') as active,
            COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status LIKE 'stopped_%') as stopped,
            SUM(emails_sent) as emails,
            SUM(calls_made) as calls,
            SUM(opens) as opens
        FROM workflow_enrollments
        WHERE workflow_id = p_workflow_id
    ),
    call_stats AS (
        SELECT
            COUNT(*) FILTER (WHERE action_type = 'call_initiated') as total_calls,
            COUNT(*) FILTER (WHERE action_result = 'answered') as answered_calls
        FROM workflow_action_log
        WHERE workflow_id = p_workflow_id
    )
    SELECT
        es.total,
        es.active,
        es.completed,
        es.stopped,
        es.emails,
        es.calls,
        CASE WHEN es.emails > 0 THEN ROUND((es.opens::NUMERIC / es.emails) * 100, 2) ELSE 0 END,
        CASE WHEN cs.total_calls > 0 THEN ROUND((cs.answered_calls::NUMERIC / cs.total_calls) * 100, 2) ELSE 0 END
    FROM enrollment_stats es, call_stats cs;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. COMMENTS
-- ============================================

COMMENT ON TABLE outreach_workflows IS 'Multi-channel outreach workflows combining email, voice calls, and SMS';
COMMENT ON TABLE workflow_steps IS 'Individual steps in a workflow - can be email, call, sms, or wait';
COMMENT ON TABLE workflow_enrollments IS 'Tracks lead progress through multi-channel workflows';
COMMENT ON TABLE workflow_action_log IS 'Detailed log of all actions taken in workflows';

COMMENT ON COLUMN workflow_steps.step_type IS 'Type of step: email, call, sms, or wait';
COMMENT ON COLUMN workflow_steps.condition IS 'Condition to execute: always, no_reply, no_open, no_answer';
COMMENT ON COLUMN workflow_enrollments.next_action_type IS 'Type of next scheduled action: email, call, sms';
