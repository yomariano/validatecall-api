-- =============================================
-- ADMIN MARKETING SYSTEM
-- Tables for platform-wide email campaigns
-- =============================================

-- Add is_admin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- =============================================
-- EMAIL_CAMPAIGNS - Marketing campaigns
-- =============================================
CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Campaign info
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,

  -- Targeting
  segment TEXT DEFAULT 'all', -- all, free, paid, churned, inactive_7d, inactive_14d, inactive_30d

  -- Status
  status TEXT DEFAULT 'draft', -- draft, scheduled, sending, sent, paused
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,

  -- Stats
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,

  -- Metadata
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- No RLS on email_campaigns - admin only access via service role

-- =============================================
-- EMAIL_TEMPLATES - Reusable templates
-- =============================================
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  name TEXT NOT NULL,
  description TEXT,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,

  -- Template type
  template_type TEXT DEFAULT 'marketing', -- marketing, transactional, trigger

  -- Variables available in this template
  variables TEXT[] DEFAULT ARRAY['firstName', 'email', 'planName'],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- AUTOMATED_TRIGGERS - Event-based emails
-- =============================================
CREATE TABLE IF NOT EXISTS automated_triggers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  name TEXT NOT NULL,
  description TEXT,

  -- Trigger conditions
  trigger_type TEXT NOT NULL, -- usage_50, usage_80, usage_100, inactive_3d, inactive_7d, inactive_14d, abandoned_upgrade, trial_ending

  -- Email content
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,

  -- Optional discount
  discount_code TEXT,
  discount_percent INTEGER,
  discount_expires_hours INTEGER DEFAULT 24,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Delay before sending (in minutes)
  delay_minutes INTEGER DEFAULT 0,

  -- Stats
  times_triggered INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- CAMPAIGN_RECIPIENTS - Track who received what
-- =============================================
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, failed, opened, clicked

  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,

  resend_id TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(campaign_id, user_id)
);

-- =============================================
-- TRIGGER_LOGS - Track automated trigger sends
-- =============================================
CREATE TABLE IF NOT EXISTS trigger_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  trigger_id UUID REFERENCES automated_triggers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  trigger_type TEXT NOT NULL,
  email TEXT NOT NULL,

  status TEXT DEFAULT 'sent', -- sent, failed
  resend_id TEXT,
  error_message TEXT,

  -- Context data (what triggered it)
  context JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_scheduled ON email_campaigns(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_user ON campaign_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_user ON trigger_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_type ON trigger_logs(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automated_triggers_type ON automated_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automated_triggers_active ON automated_triggers(is_active) WHERE is_active = true;

-- Add last_login_at to profiles for inactivity tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ DEFAULT NOW();

-- Update trigger for updated_at
DROP TRIGGER IF EXISTS update_email_campaigns_updated_at ON email_campaigns;
CREATE TRIGGER update_email_campaigns_updated_at
  BEFORE UPDATE ON email_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_templates_updated_at ON email_templates;
CREATE TRIGGER update_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_automated_triggers_updated_at ON automated_triggers;
CREATE TRIGGER update_automated_triggers_updated_at
  BEFORE UPDATE ON automated_triggers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- DEFAULT TEMPLATES
-- =============================================
INSERT INTO email_templates (name, description, subject, body_html, body_text, template_type, variables) VALUES
(
  'Usage 50% Alert',
  'Sent when user hits 50% of their resource limit',
  'You''re halfway through your {{resourceType}} - unlock more with Pro',
  '<p>Hi {{firstName}},</p><p>You''ve used <strong>50%</strong> of your {{resourceType}}. Upgrade to Pro for unlimited access.</p><p><a href="{{upgradeUrl}}">Upgrade Now</a></p>',
  'Hi {{firstName}}, You''ve used 50% of your {{resourceType}}. Upgrade to Pro for unlimited access.',
  'trigger',
  ARRAY['firstName', 'resourceType', 'used', 'limit', 'upgradeUrl']
),
(
  'Win-back 7 Day',
  'Sent to users inactive for 7 days',
  'We miss you, {{firstName}}! Here''s 20% off',
  '<p>Hi {{firstName}},</p><p>It''s been a week since your last visit. Come back and continue validating your business ideas.</p><p>Use code <strong>COMEBACK20</strong> for 20% off any plan.</p>',
  'Hi {{firstName}}, It''s been a week since your last visit. Use code COMEBACK20 for 20% off any plan.',
  'trigger',
  ARRAY['firstName', 'discountCode', 'discountPercent']
),
(
  'Abandoned Upgrade',
  'Sent when user views pricing but doesn''t upgrade',
  'Still thinking it over? Here''s a special offer',
  '<p>Hi {{firstName}},</p><p>We noticed you were checking out our plans. Ready to take the next step?</p><p>For the next 24 hours, use code <strong>READY15</strong> for 15% off.</p>',
  'Hi {{firstName}}, We noticed you were checking out our plans. Use code READY15 for 15% off - expires in 24 hours.',
  'trigger',
  ARRAY['firstName', 'discountCode', 'discountPercent', 'expiresIn']
)
ON CONFLICT DO NOTHING;

-- =============================================
-- DEFAULT TRIGGERS (inactive by default)
-- =============================================
INSERT INTO automated_triggers (name, description, trigger_type, subject, body_html, body_text, is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours) VALUES
(
  'Usage 50% Warning',
  'Alert users at 50% usage',
  'usage_50',
  'You''re halfway through - unlock unlimited access',
  '<p>Hi {{firstName}},</p><p>You''ve used <strong>{{used}} of {{limit}} {{resourceType}}</strong>. Don''t let limits slow you down.</p><p><a href="https://validatecall.com/billing">Upgrade to Pro</a></p>',
  'Hi {{firstName}}, You''ve used {{used}} of {{limit}} {{resourceType}}. Upgrade to Pro for unlimited access.',
  false,
  0,
  NULL,
  NULL,
  NULL
),
(
  'Usage 90% Urgent',
  'Urgent alert at 90% usage with discount',
  'usage_90',
  '⚠️ Almost at your limit - 20% off to continue',
  '<p>Hi {{firstName}},</p><p>You''ve used <strong>{{percentUsed}}%</strong> of your {{resourceType}}. Upgrade now and get <strong>20% off</strong> with code <strong>KEEPGOING20</strong>.</p><p>This offer expires in 24 hours.</p>',
  'Hi {{firstName}}, You''ve used {{percentUsed}}% of your {{resourceType}}. Use code KEEPGOING20 for 20% off - expires in 24 hours.',
  false,
  0,
  'KEEPGOING20',
  20,
  24
),
(
  'Inactive 3 Days',
  'Gentle reminder after 3 days inactive',
  'inactive_3d',
  'Your leads are waiting, {{firstName}}',
  '<p>Hi {{firstName}},</p><p>You have leads waiting to be contacted. Don''t let them go cold!</p><p><a href="https://validatecall.com/dashboard">Back to Dashboard</a></p>',
  'Hi {{firstName}}, You have leads waiting to be contacted. Don''t let them go cold!',
  false,
  0,
  NULL,
  NULL,
  NULL
),
(
  'Inactive 7 Days',
  'Win-back with discount after 7 days',
  'inactive_7d',
  'We miss you! Here''s 20% off to come back',
  '<p>Hi {{firstName}},</p><p>It''s been a week since we saw you. Your business ideas deserve validation!</p><p>Use code <strong>COMEBACK20</strong> for 20% off any plan.</p>',
  'Hi {{firstName}}, It''s been a week. Use code COMEBACK20 for 20% off any plan.',
  false,
  0,
  'COMEBACK20',
  20,
  72
),
(
  'Inactive 14 Days',
  'Last chance win-back with bigger discount',
  'inactive_14d',
  'Last chance: 30% off before we pause your account',
  '<p>Hi {{firstName}},</p><p>We haven''t seen you in 2 weeks. Before we pause your account, here''s our best offer:</p><p><strong>30% off</strong> with code <strong>LASTCHANCE30</strong></p>',
  'Hi {{firstName}}, Before we pause your account, use code LASTCHANCE30 for 30% off.',
  false,
  0,
  'LASTCHANCE30',
  30,
  48
),
(
  'Abandoned Upgrade',
  'Follow up after viewing pricing',
  'abandoned_upgrade',
  'Ready to upgrade? Here''s 15% off',
  '<p>Hi {{firstName}},</p><p>We noticed you were checking out our plans yesterday. Need help deciding?</p><p>Use code <strong>READY15</strong> for 15% off - expires in 24 hours.</p>',
  'Hi {{firstName}}, Use code READY15 for 15% off your upgrade - expires in 24 hours.',
  false,
  60,
  'READY15',
  15,
  24
)
ON CONFLICT DO NOTHING;
