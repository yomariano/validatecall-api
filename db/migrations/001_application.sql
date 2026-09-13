-- Standalone PostgreSQL application schema. No Supabase extensions or auth service.

DO $$
DECLARE
    missing_tables TEXT := '';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
        missing_tables := missing_tables || 'profiles, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads') THEN
        missing_tables := missing_tables || 'leads, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'campaigns') THEN
        missing_tables := missing_tables || 'campaigns, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'calls') THEN
        missing_tables := missing_tables || 'calls, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'scrape_jobs') THEN
        missing_tables := missing_tables || 'scrape_jobs, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscription_plans') THEN
        missing_tables := missing_tables || 'subscription_plans, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_subscriptions') THEN
        missing_tables := missing_tables || 'user_subscriptions, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_phone_numbers') THEN
        missing_tables := missing_tables || 'user_phone_numbers, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'scheduled_calls') THEN
        missing_tables := missing_tables || 'scheduled_calls, ';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'free_tier_usage') THEN
        missing_tables := missing_tables || 'free_tier_usage, ';
    END IF;

    IF missing_tables != '' THEN
        RAISE NOTICE 'Missing tables: %', missing_tables;
    ELSE
        RAISE NOTICE 'All required tables exist!';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free',
  company_name TEXT,
  company_website TEXT,
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  website TEXT,
  rating DECIMAL(2,1),
  review_count INTEGER,
  category TEXT,
  place_id TEXT,
  google_maps_url TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  source TEXT DEFAULT 'google_maps',
  search_keyword TEXT,
  search_location TEXT,
  status TEXT DEFAULT 'new',
  call_count INTEGER DEFAULT 0,
  last_called_at TIMESTAMPTZ,
  notes TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_user_id_place_id_key'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_user_id_place_id_key UNIQUE(user_id, place_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_search ON leads(search_keyword, search_location);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product_idea TEXT NOT NULL,
  company_context TEXT,
  status TEXT DEFAULT 'draft',
  total_leads INTEGER DEFAULT 0,
  calls_made INTEGER DEFAULT 0,
  calls_completed INTEGER DEFAULT 0,
  calls_failed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS lead_ids UUID[] DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS selected_agent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_lead_ids ON campaigns USING GIN (lead_ids);

CREATE TABLE IF NOT EXISTS calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  vapi_call_id TEXT UNIQUE,
  phone_number TEXT NOT NULL,
  customer_name TEXT,
  status TEXT DEFAULT 'initiated',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url TEXT,
  transcript TEXT,
  transcript_json JSONB,
  summary TEXT,
  sentiment TEXT,
  interest_score INTEGER,
  key_objections TEXT[],
  willing_to_pay TEXT,
  wants_notification BOOLEAN,
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_outcome TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_reason TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outbound_phone_number_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outbound_phone_number TEXT;

CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_campaign_id ON calls(campaign_id);
CREATE INDEX IF NOT EXISTS idx_calls_vapi_call_id ON calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_call_outcome ON calls(call_outcome);

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  apify_run_id TEXT,
  keyword TEXT NOT NULL,
  location TEXT NOT NULL,
  max_results INTEGER DEFAULT 100,
  status TEXT DEFAULT 'running',
  leads_found INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_user_id ON scrape_jobs(user_id);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_monthly INTEGER NOT NULL,
  price_yearly INTEGER,
  phone_numbers_included INTEGER NOT NULL DEFAULT 2,
  daily_calls_per_number INTEGER NOT NULL DEFAULT 50,
  max_leads INTEGER DEFAULT 1000,
  max_campaigns INTEGER DEFAULT 10,
  features JSONB DEFAULT '[]'::jsonb,
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT,
  stripe_payment_link TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO subscription_plans (id, name, description, price_monthly, phone_numbers_included, daily_calls_per_number, max_leads, max_campaigns, sort_order, features) VALUES
  ('basic', 'Basic', 'Perfect for getting started', 4900, 2, 50, 500, 5, 1,
   '["2 phone numbers", "100 calls/day", "500 leads", "5 campaigns", "Email support"]'::jsonb),
  ('pro', 'Pro', 'For growing businesses', 14900, 5, 50, 2000, 20, 2,
   '["5 phone numbers", "250 calls/day", "2,000 leads", "20 campaigns", "Priority support", "Call analytics"]'::jsonb),
  ('enterprise', 'Enterprise', 'For high-volume teams', 39900, 10, 100, 10000, 100, 3,
   '["10 phone numbers", "1,000 calls/day", "10,000 leads", "Unlimited campaigns", "Dedicated support", "Custom integrations", "API access"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  plan_id TEXT REFERENCES subscription_plans(id) NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_payment_intent_id TEXT,
  status TEXT DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer ON user_subscriptions(stripe_customer_id);

CREATE TABLE IF NOT EXISTS user_phone_numbers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  phone_number TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  provider TEXT DEFAULT 'twilio',
  provider_sid TEXT,
  country_code TEXT DEFAULT 'IE',
  area_code TEXT,
  daily_calls_used INTEGER DEFAULT 0,
  daily_calls_limit INTEGER DEFAULT 50,
  last_reset_date DATE DEFAULT CURRENT_DATE,
  total_calls_made INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  flagged_as_spam BOOLEAN DEFAULT false,
  spam_flagged_at TIMESTAMPTZ,
  friendly_name TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(phone_number),
  UNIQUE(phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_user_id ON user_phone_numbers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_status ON user_phone_numbers(status);
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_provider ON user_phone_numbers(provider);

CREATE TABLE IF NOT EXISTS phone_number_usage_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number_id UUID REFERENCES user_phone_numbers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  usage_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_usage_date ON phone_number_usage_log(phone_number_id, usage_date);

CREATE TABLE IF NOT EXISTS scheduled_calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  customer_name TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  product_idea TEXT NOT NULL,
  company_context TEXT,
  assistant_id TEXT,
  status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  vapi_call_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scheduled_calls_user_id ON scheduled_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_status ON scheduled_calls(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_scheduled_at ON scheduled_calls(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_next_retry_at ON scheduled_calls(next_retry_at);

CREATE TABLE IF NOT EXISTS free_tier_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  leads_used INTEGER DEFAULT 0,
  leads_limit INTEGER DEFAULT 10,
  calls_used INTEGER DEFAULT 0,
  calls_limit INTEGER DEFAULT 5,
  call_seconds_per_call INTEGER DEFAULT 120,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_free_tier_usage_user_id ON free_tier_usage(user_id);

CREATE OR REPLACE FUNCTION update_free_tier_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_free_tier_usage_timestamp ON free_tier_usage;
CREATE TRIGGER update_free_tier_usage_timestamp
  BEFORE UPDATE ON free_tier_usage
  FOR EACH ROW EXECUTE FUNCTION update_free_tier_usage_updated_at();

UPDATE free_tier_usage ftu
SET
  leads_used = COALESCE((
    SELECT COUNT(*)
    FROM leads l
    WHERE l.user_id = ftu.user_id
  ), 0),
  updated_at = NOW();

INSERT INTO free_tier_usage (user_id, leads_used, leads_limit, calls_used, calls_limit, call_seconds_per_call)
SELECT
  p.id as user_id,
  COUNT(l.id) as leads_used,
  10 as leads_limit,
  0 as calls_used,
  5 as calls_limit,
  120 as call_seconds_per_call
FROM profiles p
LEFT JOIN leads l ON l.user_id = p.id
WHERE NOT EXISTS (
  SELECT 1 FROM free_tier_usage ftu WHERE ftu.user_id = p.id
)
GROUP BY p.id
HAVING COUNT(l.id) > 0;

CREATE OR REPLACE FUNCTION increment_leads_used()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE free_tier_usage
  SET leads_used = leads_used + 1, updated_at = NOW()
  WHERE user_id = NEW.user_id;

  IF NOT FOUND THEN
    INSERT INTO free_tier_usage (user_id, leads_used, leads_limit, calls_used, calls_limit, call_seconds_per_call)
    VALUES (NEW.user_id, 1, 10, 0, 5, 120)
    ON CONFLICT (user_id) DO UPDATE SET leads_used = free_tier_usage.leads_used + 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_leads_used()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE free_tier_usage
  SET leads_used = GREATEST(leads_used - 1, 0), updated_at = NOW()
  WHERE user_id = OLD.user_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_lead_created ON leads;
CREATE TRIGGER on_lead_created
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION increment_leads_used();

DROP TRIGGER IF EXISTS on_lead_deleted ON leads;
CREATE TRIGGER on_lead_deleted
  AFTER DELETE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION decrement_leads_used();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_leads_updated_at ON leads;
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_calls_updated_at ON calls;
CREATE TRIGGER update_calls_updated_at
  BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_subscriptions_updated_at ON user_subscriptions;
CREATE TRIGGER update_user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_phone_numbers_updated_at ON user_phone_numbers;
CREATE TRIGGER update_user_phone_numbers_updated_at
  BEFORE UPDATE ON user_phone_numbers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheduled_calls_updated_at ON scheduled_calls;
CREATE TRIGGER update_scheduled_calls_updated_at
  BEFORE UPDATE ON scheduled_calls FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
DECLARE
    table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN (
        'profiles', 'leads', 'campaigns', 'calls', 'scrape_jobs',
        'subscription_plans', 'user_subscriptions', 'user_phone_numbers',
        'phone_number_usage_log', 'scheduled_calls', 'free_tier_usage'
    );

    IF table_count = 11 THEN
        RAISE NOTICE '✅ SUCCESS: All 11 required tables exist!';
    ELSE
        RAISE NOTICE '⚠️ WARNING: Only % of 11 tables exist. Some migrations may have failed.', table_count;
    END IF;
END $$;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY table_name;

CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    email_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    resend_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'sent',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_user_type ON email_logs(user_id, email_type);

CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

COMMENT ON TABLE email_logs IS 'Tracks all transactional emails sent via Resend';
COMMENT ON COLUMN email_logs.email_type IS 'Type of email: welcome, payment_confirmation, usage_alert_leads_80, usage_alert_calls_80';
COMMENT ON COLUMN email_logs.resend_id IS 'Email ID returned by Resend API';

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

COMMENT ON TABLE user_domains IS 'Stores user-verified email domains for sending cold emails';
COMMENT ON COLUMN user_domains.domain_name IS 'The domain name (e.g., abc.com)';
COMMENT ON COLUMN user_domains.resend_domain_id IS 'Domain ID from Resend API';
COMMENT ON COLUMN user_domains.status IS 'Verification status: pending, verified, or failed';
COMMENT ON COLUMN user_domains.dns_records IS 'DNS records required for verification (from Resend)';

CREATE INDEX idx_user_domains_user_id ON user_domains(user_id);
CREATE INDEX idx_user_domains_status ON user_domains(status);
CREATE INDEX idx_user_domains_domain_name ON user_domains(domain_name);

CREATE TRIGGER update_user_domains_updated_at
    BEFORE UPDATE ON user_domains
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,

  segment TEXT DEFAULT 'all', -- all, free, paid, churned, inactive_7d, inactive_14d, inactive_30d

  status TEXT DEFAULT 'draft', -- draft, scheduled, sending, sent, paused
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,

  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  name TEXT NOT NULL,
  description TEXT,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,

  template_type TEXT DEFAULT 'marketing', -- marketing, transactional, trigger

  variables TEXT[] DEFAULT ARRAY['firstName', 'email', 'planName'],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automated_triggers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  name TEXT NOT NULL,
  description TEXT,

  trigger_type TEXT NOT NULL, -- usage_50, usage_80, usage_100, inactive_3d, inactive_7d, inactive_14d, abandoned_upgrade, trial_ending

  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,

  discount_code TEXT,
  discount_percent INTEGER,
  discount_expires_hours INTEGER DEFAULT 24,

  is_active BOOLEAN DEFAULT true,

  delay_minutes INTEGER DEFAULT 0,

  times_triggered INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS trigger_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  trigger_id UUID REFERENCES automated_triggers(id) ON DELETE SET NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  trigger_type TEXT NOT NULL,
  email TEXT NOT NULL,

  status TEXT DEFAULT 'sent', -- sent, failed
  resend_id TEXT,
  error_message TEXT,

  context JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_scheduled ON email_campaigns(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_user ON campaign_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_user ON trigger_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_trigger_logs_type ON trigger_logs(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automated_triggers_type ON automated_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automated_triggers_active ON automated_triggers(is_active) WHERE is_active = true;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ DEFAULT NOW();

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

DELETE FROM automated_triggers WHERE name IN (
    'Usage 50% Warning',
    'Usage 80% Alert',
    'Usage 90% Urgent',
    'Usage 100% Maxed Out',
    'Inactive 3 Days',
    'Inactive 7 Days',
    'Inactive 14 Days',
    'Abandoned Upgrade - 1 Hour',
    'Abandoned Upgrade - 24 Hours',
    'Welcome Sequence - Day 2',
    'Welcome Sequence - Day 5',
    'Social Proof Weekly',
    'Feature Announcement'
);

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES

(
    'Usage 50% Warning',
    'Gentle nudge at 50% usage - plant the seed for upgrade',
    'usage_50',
    'You''re making great progress, {{firstName}}!',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Halfway there!</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve already used <strong>{{used}} of {{limit}} {{resourceType}}</strong> - that''s awesome progress!</p>
    <p>At this pace, you might hit your limit soon. Here''s what Pro users get:</p>
    <ul>
        <li><strong>Unlimited leads</strong> - never stop prospecting</li>
        <li><strong>Unlimited calls</strong> - validate faster</li>
        <li><strong>Priority support</strong> - we''re here for you</li>
    </ul>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">See Pro Plans</a>
    </p>
    <p style="color: #666; font-size: 14px;">Keep validating - you''re doing great!</p>',
    'Hi {{firstName}}, You''ve used {{used}} of {{limit}} {{resourceType}} - great progress! Upgrade to Pro for unlimited access: {{upgradeUrl}}',
    false, 0, NULL, NULL, NULL
),

(
    'Usage 80% Alert',
    'Urgency trigger at 80% - emphasize scarcity',
    'usage_80',
    '⚠️ {{firstName}}, you''re running low on {{resourceType}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">You''re at 80% capacity</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve used <strong>{{used}} of {{limit}} {{resourceType}}</strong>.</p>

    <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
        <p style="margin: 0; color: #92400e;">
            <strong>Don''t let your momentum stop.</strong><br>
            You''re validating faster than most users - that''s a sign you''re onto something!
        </p>
    </div>

    <p>Upgrade now and get <strong>15% off</strong> your first month:</p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=MOMENTUM15" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Claim 15% Off</a>
    </p>
    <p style="color: #666; font-size: 14px;">Code: <strong>MOMENTUM15</strong> (expires in 48 hours)</p>',
    'Hi {{firstName}}, You''ve used 80% of your {{resourceType}}. Don''t stop now! Use code MOMENTUM15 for 15% off: {{upgradeUrl}}',
    false, 0, 'MOMENTUM15', 15, 48
),

(
    'Usage 90% Urgent',
    'High urgency at 90% - fear of losing progress',
    'usage_90',
    '🚨 Almost out of {{resourceType}}, {{firstName}} - special offer inside',
    '<h2 style="color: #dc2626; margin-top: 0;">You''re almost at your limit!</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve used <strong>{{percentUsed}}% of your {{resourceType}}</strong>.</p>

    <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
        <p style="margin: 0; color: #991b1b;">
            <strong>Your validated leads are waiting.</strong><br>
            Don''t lose the insights you''ve gathered. One more call could be the breakthrough.
        </p>
    </div>

    <p>Because you''re so close to your next validation, here''s our <strong>best offer</strong>:</p>
    <p style="text-align: center; font-size: 24px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
        20% OFF with code KEEPGOING20
    </p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=KEEPGOING20" style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade Now - 20% Off</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">⏰ Offer expires in 24 hours</p>',
    'Hi {{firstName}}, You''ve used {{percentUsed}}% of your {{resourceType}}! Use code KEEPGOING20 for 20% off - expires in 24 hours: {{upgradeUrl}}',
    false, 0, 'KEEPGOING20', 20, 24
),

(
    'Usage 100% Maxed Out',
    'User hit their limit - remove friction to upgrade',
    'usage_100',
    '{{firstName}}, you''ve maxed out - let''s fix that',
    '<h2 style="color: #1a1a2e; margin-top: 0;">You''ve hit your limit!</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve used all <strong>{{limit}} {{resourceType}}</strong> on your free plan.</p>

    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0;"><strong>What happens now?</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
            <li>You can''t generate more leads or make calls</li>
            <li>Your existing data is safe</li>
            <li>Upgrade takes 30 seconds</li>
        </ul>
    </div>

    <p>We know you''re validating something important. Here''s <strong>25% off</strong> to keep going:</p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=NOLIMITS25" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Unlock Unlimited - 25% Off</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">Code: <strong>NOLIMITS25</strong> | Valid for 48 hours</p>',
    'Hi {{firstName}}, You''ve maxed out your free plan. Use code NOLIMITS25 for 25% off and keep validating: {{upgradeUrl}}',
    false, 0, 'NOLIMITS25', 25, 48
);

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES

(
    'Inactive 3 Days',
    'Gentle nudge after 3 days - remind value',
    'inactive_3d',
    'Your leads miss you, {{firstName}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Quick check-in</h2>
    <p>Hi {{firstName}},</p>
    <p>We noticed you haven''t logged in for a few days. Everything okay?</p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>Did you know?</strong><br>
            Leads contacted within 48 hours have a 3x higher conversion rate. Don''t let them go cold!
        </p>
    </div>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Back to Dashboard</a>
    </p>
    <p style="color: #666; font-size: 14px;">Your business idea deserves validation. We''re here to help.</p>',
    'Hi {{firstName}}, Your leads are waiting! Leads contacted within 48 hours convert 3x better. Come back: https://validatecall.com/dashboard',
    false, 0, NULL, NULL, NULL
),

(
    'Inactive 7 Days',
    'Win-back with discount after 7 days',
    'inactive_7d',
    'We miss you, {{firstName}} - here''s 20% off to come back',
    '<h2 style="color: #1a1a2e; margin-top: 0;">It''s been a week...</h2>
    <p>Hi {{firstName}},</p>
    <p>A week without validation is a week of uncertainty. Your business idea deserves answers.</p>

    <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
        <p style="margin: 0; color: #92400e;">
            <strong>While you were away:</strong><br>
            Other entrepreneurs validated 1,247 business ideas on ValidateCall. Don''t fall behind.
        </p>
    </div>

    <p>To welcome you back, here''s <strong>20% off</strong> any plan:</p>
    <p style="text-align: center; font-size: 24px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
        COMEBACK20
    </p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=COMEBACK20" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Come Back & Save 20%</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">Offer expires in 72 hours</p>',
    'Hi {{firstName}}, It''s been a week! Use code COMEBACK20 for 20% off any plan. Your idea deserves validation: {{upgradeUrl}}',
    false, 0, 'COMEBACK20', 20, 72
),

(
    'Inactive 14 Days',
    'Last chance win-back with best offer',
    'inactive_14d',
    '{{firstName}}, we''re about to pause your account - 30% off inside',
    '<h2 style="color: #dc2626; margin-top: 0;">Last chance, {{firstName}}</h2>
    <p>Hi {{firstName}},</p>
    <p>It''s been 2 weeks since your last login. We''re about to pause your account.</p>

    <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
        <p style="margin: 0; color: #991b1b;">
            <strong>What you''ll lose:</strong>
            <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                <li>Access to your saved leads</li>
                <li>Call recordings and transcripts</li>
                <li>Validation insights</li>
            </ul>
        </p>
    </div>

    <p>We don''t want to see you go. Here''s our <strong>best offer ever</strong>:</p>
    <p style="text-align: center; font-size: 28px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
        30% OFF with LASTCHANCE30
    </p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=LASTCHANCE30" style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Save My Account - 30% Off</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">⏰ This offer expires in 48 hours</p>',
    'Hi {{firstName}}, Your account will be paused soon. Use code LASTCHANCE30 for 30% off - our best offer: {{upgradeUrl}}',
    false, 0, 'LASTCHANCE30', 30, 48
);

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES

(
    'Abandoned Upgrade - 1 Hour',
    'Quick follow-up 1 hour after viewing pricing',
    'abandoned_upgrade_1h',
    'Still thinking about it, {{firstName}}?',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Need help deciding?</h2>
    <p>Hi {{firstName}},</p>
    <p>We noticed you were checking out our plans earlier. Have questions?</p>

    <p><strong>Here''s what most users ask:</strong></p>
    <ul>
        <li><strong>Can I cancel anytime?</strong> Yes, no contracts.</li>
        <li><strong>Is there a setup fee?</strong> Nope, just the plan price.</li>
        <li><strong>What if I need help?</strong> Our support team responds in under 2 hours.</li>
    </ul>

    <p>Still not sure? Reply to this email and I''ll personally help you decide.</p>

    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Plans Again</a>
    </p>',
    'Hi {{firstName}}, Still thinking about upgrading? Reply to this email if you have questions - happy to help!',
    false, 60, NULL, NULL, NULL
),

(
    'Abandoned Upgrade - 24 Hours',
    'Discount offer 24 hours after viewing pricing',
    'abandoned_upgrade_24h',
    '{{firstName}}, here''s 15% off to help you decide',
    '<h2 style="color: #1a1a2e; margin-top: 0;">We want to help you succeed</h2>
    <p>Hi {{firstName}},</p>
    <p>You were looking at our plans yesterday. We know choosing the right tool is a big decision.</p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>Here''s a little push:</strong><br>
            Use code <strong>READY15</strong> for 15% off your first month. No risk - cancel anytime.
        </p>
    </div>

    <p><strong>Why customers choose ValidateCall:</strong></p>
    <ul>
        <li>✓ Save 40+ hours on manual market research</li>
        <li>✓ Get real customer feedback, not assumptions</li>
        <li>✓ Validate ideas before spending thousands</li>
    </ul>

    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=READY15" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Get 15% Off Now</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">Code expires in 24 hours</p>',
    'Hi {{firstName}}, Use code READY15 for 15% off your first month. Validate your idea before spending thousands: {{upgradeUrl}}',
    false, 1440, 'READY15', 15, 24
);

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES

(
    'Welcome Sequence - Day 2',
    'Day 2: Tips for getting the most out of ValidateCall',
    'welcome_day_2',
    '3 tips to validate your idea faster, {{firstName}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Get the most out of ValidateCall</h2>
    <p>Hi {{firstName}},</p>
    <p>Welcome to day 2! Here are 3 tips successful users swear by:</p>

    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0 0 15px 0;"><strong>1. Be specific with your search</strong></p>
        <p style="margin: 0 0 20px 0; color: #666;">Instead of "restaurants", try "Italian restaurants in Brooklyn with 4+ stars". Better leads = better calls.</p>

        <p style="margin: 0 0 15px 0;"><strong>2. Call during business hours</strong></p>
        <p style="margin: 0 0 20px 0; color: #666;">9 AM - 11 AM local time has the highest answer rate. Schedule your calls smartly.</p>

        <p style="margin: 0 0 15px 0;"><strong>3. Review every transcript</strong></p>
        <p style="margin: 0; color: #666;">The AI summary is great, but reading the full transcript reveals hidden gems.</p>
    </div>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/leads" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Find Your First Leads</a>
    </p>',
    'Hi {{firstName}}, Day 2 tips: 1) Be specific with searches, 2) Call during business hours (9-11 AM), 3) Read full transcripts. Start now: https://validatecall.com/leads',
    false, 2880, NULL, NULL, NULL
),

(
    'Welcome Sequence - Day 5',
    'Day 5: Check-in and offer help',
    'welcome_day_5',
    'How''s it going, {{firstName}}?',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Quick check-in</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve been with us for 5 days now. How''s the validation going?</p>

    <p><strong>Quick self-assessment:</strong></p>
    <ul>
        <li>✓ Found promising leads?</li>
        <li>✓ Made your first calls?</li>
        <li>✓ Got actionable feedback?</li>
    </ul>

    <p>If you checked all three, amazing! You''re on track.</p>
    <p>If not, reply to this email and tell me where you''re stuck. I read every response.</p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>Pro tip:</strong> Users who make at least 5 calls in their first week are 4x more likely to find product-market fit.
        </p>
    </div>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Continue Validating</a>
    </p>',
    'Hi {{firstName}}, Day 5 check-in: Made calls? Got feedback? Reply if you need help - I read every email. Keep validating: https://validatecall.com/dashboard',
    false, 7200, NULL, NULL, NULL
);

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES
(
    'Social Proof Weekly',
    'Weekly social proof email with stats and success stories',
    'social_proof_weekly',
    'This week on ValidateCall: 847 ideas validated',
    '<h2 style="color: #1a1a2e; margin-top: 0;">What happened this week</h2>
    <p>Hi {{firstName}},</p>
    <p>Here''s what the ValidateCall community accomplished this week:</p>

    <div style="display: flex; gap: 15px; margin: 25px 0;">
        <div style="flex: 1; background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="font-size: 32px; font-weight: bold; color: #7c3aed; margin: 0;">847</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Ideas Validated</p>
        </div>
        <div style="flex: 1; background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="font-size: 32px; font-weight: bold; color: #22c55e; margin: 0;">2,341</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Calls Made</p>
        </div>
        <div style="flex: 1; background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="font-size: 32px; font-weight: bold; color: #f59e0b; margin: 0;">156</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Products Launched</p>
        </div>
    </div>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>"ValidateCall saved me from building the wrong product."</strong><br>
            <span style="font-size: 14px;">- Sarah K., Founder @ TechStartup</span>
        </p>
    </div>

    <p>Your turn. What will you validate this week?</p>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Start Validating</a>
    </p>',
    'This week: 847 ideas validated, 2,341 calls made. What will you validate? https://validatecall.com/dashboard',
    false, 0, NULL, NULL, NULL
);

DELETE FROM email_templates WHERE name IN (
    'Discount Offer',
    'Feature Announcement',
    'Survey Request',
    'Milestone Celebration',
    'Referral Request'
);

INSERT INTO email_templates (
    name, description, subject, body_html, body_text, template_type, variables
) VALUES

(
    'Discount Offer',
    'Generic discount offer template',
    '{{discountPercent}}% off ValidateCall - Limited Time',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Special Offer for You</h2>
    <p>Hi {{firstName}},</p>
    <p>{{customMessage}}</p>
    <p style="text-align: center; font-size: 32px; font-weight: bold; color: #7c3aed; margin: 30px 0;">
        {{discountPercent}}% OFF
    </p>
    <p style="text-align: center;">Use code: <strong>{{discountCode}}</strong></p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code={{discountCode}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Claim Your Discount</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">Expires: {{expiresIn}}</p>',
    'Hi {{firstName}}, {{customMessage}} Use code {{discountCode}} for {{discountPercent}}% off: {{upgradeUrl}}',
    'marketing',
    ARRAY['firstName', 'discountPercent', 'discountCode', 'customMessage', 'expiresIn', 'upgradeUrl']
),

(
    'Feature Announcement',
    'Announce new features',
    'New in ValidateCall: {{featureName}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Introducing {{featureName}}</h2>
    <p>Hi {{firstName}},</p>
    <p>We''ve been working hard and we''re excited to announce: <strong>{{featureName}}</strong></p>

    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0;">{{featureDescription}}</p>
    </div>

    <p><strong>How to use it:</strong></p>
    <p>{{howToUse}}</p>

    <p style="text-align: center; margin: 30px 0;">
        <a href="{{ctaUrl}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Try It Now</a>
    </p>',
    'Hi {{firstName}}, Introducing {{featureName}}: {{featureDescription}}. Try it now: {{ctaUrl}}',
    'marketing',
    ARRAY['firstName', 'featureName', 'featureDescription', 'howToUse', 'ctaUrl']
),

(
    'Milestone Celebration',
    'Celebrate user achievements',
    'Congrats {{firstName}}! You hit {{milestone}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">You did it!</h2>
    <p>Hi {{firstName}},</p>

    <div style="text-align: center; margin: 30px 0;">
        <div style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 30px 50px; border-radius: 12px;">
            <p style="font-size: 48px; margin: 0;">🎉</p>
            <p style="font-size: 24px; font-weight: bold; margin: 10px 0 0 0;">{{milestone}}</p>
        </div>
    </div>

    <p>{{celebrationMessage}}</p>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Keep Going</a>
    </p>',
    'Hi {{firstName}}, Congrats on hitting {{milestone}}! {{celebrationMessage}}',
    'marketing',
    ARRAY['firstName', 'milestone', 'celebrationMessage']
),

(
    'Referral Request',
    'Ask for referrals',
    '{{firstName}}, know someone who needs ValidateCall?',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Spread the word</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve been using ValidateCall for a while now. If it''s been helpful, would you mind sharing it with a friend?</p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>You both win:</strong><br>
            They get 20% off their first month, and you get a $20 credit.
        </p>
    </div>

    <p style="text-align: center; margin: 30px 0;">
        <a href="{{referralUrl}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Get Your Referral Link</a>
    </p>
    <p style="color: #666; font-size: 14px;">Thanks for being part of the ValidateCall community!</p>',
    'Hi {{firstName}}, Share ValidateCall with a friend - they get 20% off, you get $20 credit: {{referralUrl}}',
    'marketing',
    ARRAY['firstName', 'referralUrl']
);

CREATE TABLE IF NOT EXISTS user_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL, -- pricing_page_view, feature_used, etc.
  event_data JSONB,

  page_url TEXT,
  referrer TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_id ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_type_created ON user_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS email_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email_log_id UUID REFERENCES email_logs(id) ON DELETE SET NULL,

    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

    resend_email_id VARCHAR(100) NOT NULL,

    from_email VARCHAR(255) NOT NULL,
    from_name VARCHAR(255),
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500),
    body_text TEXT,
    body_html TEXT,

    in_reply_to VARCHAR(255),      -- Original Message-ID
    references_header TEXT,         -- Email references chain

    attachments JSONB DEFAULT '[]'::jsonb,

    status VARCHAR(20) DEFAULT 'unread', -- unread, read, replied, archived

    received_at TIMESTAMPTZ NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_responses_user_id ON email_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_email_responses_lead_id ON email_responses(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_responses_email_log_id ON email_responses(email_log_id);
CREATE INDEX IF NOT EXISTS idx_email_responses_from_email ON email_responses(from_email);
CREATE INDEX IF NOT EXISTS idx_email_responses_status ON email_responses(status);
CREATE INDEX IF NOT EXISTS idx_email_responses_received_at ON email_responses(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_responses_resend_id ON email_responses(resend_email_id);

COMMENT ON TABLE email_responses IS 'Stores inbound email replies from leads via Resend webhooks';
COMMENT ON COLUMN email_responses.email_log_id IS 'Reference to the original outbound email in email_logs';
COMMENT ON COLUMN email_responses.resend_email_id IS 'Email ID from Resend inbound webhook';
COMMENT ON COLUMN email_responses.attachments IS 'JSON array of attachment metadata [{filename, content_type, size, download_url}]';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'email_logs' AND column_name = 'metadata') THEN
        ALTER TABLE email_logs ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'email_logs' AND column_name = 'message_id') THEN
        ALTER TABLE email_logs ADD COLUMN message_id VARCHAR(255);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_logs_message_id ON email_logs(message_id);

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

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS resend_api_key TEXT;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS resend_api_key_verified BOOLEAN DEFAULT FALSE;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS resend_api_key_verified_at TIMESTAMPTZ;

ALTER TABLE user_domains
ADD COLUMN IF NOT EXISTS is_user_owned BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN profiles.resend_api_key IS 'User''s personal Resend API key for sending cold emails from their own domains';
COMMENT ON COLUMN profiles.resend_api_key_verified IS 'Whether the Resend API key has been verified to work';
COMMENT ON COLUMN profiles.resend_api_key_verified_at IS 'When the Resend API key was last verified';
COMMENT ON COLUMN user_domains.is_user_owned IS 'Whether domain is managed in user''s own Resend account';

DO $$
BEGIN
    
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    RAISE NOTICE 'Added resend_api_key column to profiles table';
END $$;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS email_provider TEXT DEFAULT NULL;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS sendgrid_api_key TEXT;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS sendgrid_api_key_verified BOOLEAN DEFAULT FALSE;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS sendgrid_api_key_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.email_provider IS 'User''s preferred email provider: resend, sendgrid, or NULL for platform default';
COMMENT ON COLUMN profiles.sendgrid_api_key IS 'User''s SendGrid API key for sending cold emails';
COMMENT ON COLUMN profiles.sendgrid_api_key_verified IS 'Whether the SendGrid API key has been verified to work';
COMMENT ON COLUMN profiles.sendgrid_api_key_verified_at IS 'When the SendGrid API key was last verified';

DO $$
BEGIN
    RAISE NOTICE 'Added SendGrid support columns to profiles table';
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_logs_welcome_unique
ON email_logs(recipient, email_type)
WHERE email_type = 'welcome' AND status = 'sent';

COMMENT ON INDEX idx_email_logs_welcome_unique IS
'Ensures each email address only receives one welcome email (prevents duplicates from race conditions)';

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sender_email TEXT;

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS email_subject TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS email_body TEXT;

COMMENT ON COLUMN campaigns.sender_name IS 'Name shown as email sender';
COMMENT ON COLUMN campaigns.sender_email IS 'Email address used for sending';
COMMENT ON COLUMN campaigns.email_subject IS 'Email subject template';
COMMENT ON COLUMN campaigns.email_body IS 'Email body template (HTML)';
COMMENT ON COLUMN campaigns.product_idea IS 'Product/service description used for generating content';
COMMENT ON COLUMN campaigns.company_context IS 'Manual call pitch (optional if using voice agent)';
COMMENT ON COLUMN campaigns.selected_agent_id IS 'VAPI voice agent ID for calls';

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_logo_url TEXT;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_color TEXT;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_name TEXT;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_cta_text TEXT;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_cta_url TEXT;

COMMENT ON COLUMN profiles.brand_logo_url IS 'URL to the user''s brand logo for email headers';
COMMENT ON COLUMN profiles.brand_color IS 'Primary brand color in hex format (e.g., #6366f1) for email styling';
COMMENT ON COLUMN profiles.brand_name IS 'Company/brand name to display in email headers and footers';
COMMENT ON COLUMN profiles.brand_cta_text IS 'Call-to-action button text for emails';
COMMENT ON COLUMN profiles.brand_cta_url IS 'Call-to-action button URL for emails';

DO $$
BEGIN
    RAISE NOTICE 'Added brand settings columns (brand_logo_url, brand_color, brand_name, brand_cta_text, brand_cta_url) to profiles table';
END $$;

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS cta_text TEXT;

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS cta_url TEXT;

COMMENT ON COLUMN campaigns.cta_text IS 'Call-to-action button text for campaign emails';
COMMENT ON COLUMN campaigns.cta_url IS 'Call-to-action button URL for campaign emails';

CREATE TABLE IF NOT EXISTS email_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'draft', -- draft, active, paused, completed

    timezone TEXT DEFAULT 'UTC',
    send_window_start TIME DEFAULT '09:00',
    send_window_end TIME DEFAULT '17:00',
    send_days INTEGER[] DEFAULT '{1,2,3,4,5}', -- Mon-Fri (1=Monday, 7=Sunday)

    stop_on_reply BOOLEAN DEFAULT TRUE,
    stop_on_click BOOLEAN DEFAULT FALSE,
    stop_on_bounce BOOLEAN DEFAULT TRUE,

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

CREATE TABLE IF NOT EXISTS email_sequence_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID REFERENCES email_sequences(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,

    current_step INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- active, completed, stopped_reply, stopped_click, stopped_bounce, paused, unsubscribed

    next_email_at TIMESTAMPTZ,
    last_email_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    stopped_reason TEXT,

    personalized_data JSONB DEFAULT '{}',

    emails_sent INTEGER DEFAULT 0,
    opens INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(sequence_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_pending ON email_sequence_enrollments(next_email_at, status)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_enrollments_sequence_id ON email_sequence_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_lead_id ON email_sequence_enrollments(lead_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON email_sequence_enrollments(user_id);

CREATE TABLE IF NOT EXISTS email_tracking_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_log_id UUID REFERENCES email_logs(id) ON DELETE SET NULL,
    enrollment_id UUID REFERENCES email_sequence_enrollments(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

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

CREATE TABLE IF NOT EXISTS email_unsubscribes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    reason TEXT,
    source TEXT, -- manual, link, complaint
    unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_unsubscribes_user_email ON email_unsubscribes(user_id, email);

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

CREATE INDEX IF NOT EXISTS idx_email_logs_tracking_id ON email_logs(tracking_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sequence_id ON email_logs(sequence_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_enrollment_id ON email_logs(enrollment_id);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_status TEXT DEFAULT 'none'; -- none, contacted, engaged, replied, bounced, unsubscribed
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_email_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_emails_sent INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_opens INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_clicks INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_replied_at TIMESTAMPTZ;

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

COMMENT ON TABLE email_sequences IS 'Multi-step email sequences for cold email campaigns';
COMMENT ON TABLE email_sequence_steps IS 'Individual steps within an email sequence';
COMMENT ON TABLE email_sequence_enrollments IS 'Tracks lead progress through email sequences';
COMMENT ON TABLE email_tracking_events IS 'Records all email engagement events (opens, clicks, bounces)';
COMMENT ON TABLE email_unsubscribes IS 'Suppression list for unsubscribed emails';

COMMENT ON COLUMN email_sequences.send_days IS 'Days of week to send (1=Monday, 7=Sunday)';
COMMENT ON COLUMN email_sequence_enrollments.personalized_data IS 'AI-generated personalized content cached per lead';
COMMENT ON COLUMN email_tracking_events.tracking_id IS 'Unique ID embedded in tracking pixel and links';

CREATE TABLE IF NOT EXISTS outreach_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft', -- draft, active, paused, completed

    timezone TEXT DEFAULT 'UTC',
    send_window_start TIME DEFAULT '09:00',
    send_window_end TIME DEFAULT '17:00',
    send_days INTEGER[] DEFAULT '{1,2,3,4,5}', -- Mon-Fri

    stop_on_reply BOOLEAN DEFAULT TRUE,
    stop_on_call_answered BOOLEAN DEFAULT TRUE,
    stop_on_meeting_booked BOOLEAN DEFAULT FALSE,
    stop_on_click BOOLEAN DEFAULT FALSE,
    stop_on_bounce BOOLEAN DEFAULT TRUE,

    default_assistant_id TEXT,
    call_max_retries INTEGER DEFAULT 2,

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

CREATE TABLE IF NOT EXISTS workflow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES outreach_workflows(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL, -- email, call, sms, wait

    delay_days INTEGER NOT NULL DEFAULT 0,
    delay_hours INTEGER DEFAULT 0,
    delay_minutes INTEGER DEFAULT 0,

    condition TEXT DEFAULT 'always',

    email_subject TEXT,
    email_body TEXT,
    email_cta_text TEXT,
    email_cta_url TEXT,

    call_assistant_id TEXT, -- Override workflow default
    call_script_context TEXT, -- Additional context for AI
    call_max_duration_seconds INTEGER DEFAULT 300,

    sms_message TEXT,

    wait_for TEXT, -- reply, open, click, call_answer

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

CREATE TABLE IF NOT EXISTS workflow_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES outreach_workflows(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,

    current_step INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- active, completed, stopped_reply, stopped_call, stopped_click, stopped_bounce, paused, unsubscribed

    next_action_at TIMESTAMPTZ,
    next_action_type TEXT, -- email, call, sms

    last_action_at TIMESTAMPTZ,
    last_action_type TEXT,
    last_action_result TEXT, -- sent, answered, voicemail, bounced, etc.

    stopped_at TIMESTAMPTZ,
    stopped_reason TEXT,

    personalized_data JSONB DEFAULT '{}',

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

CREATE TABLE IF NOT EXISTS workflow_action_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES outreach_workflows(id) ON DELETE CASCADE,
    enrollment_id UUID REFERENCES workflow_enrollments(id) ON DELETE CASCADE,
    step_id UUID REFERENCES workflow_steps(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

    action_type TEXT NOT NULL, -- email_sent, call_initiated, call_answered, call_voicemail, sms_sent
    action_result TEXT, -- success, failed, bounced, answered, voicemail, no_answer

    email_log_id UUID REFERENCES email_logs(id) ON DELETE SET NULL,
    call_id TEXT, -- VAPI call ID
    tracking_id TEXT,

    metadata JSONB DEFAULT '{}',

    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_action_log_enrollment_id ON workflow_action_log(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_workflow_action_log_workflow_id ON workflow_action_log(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_action_log_executed_at ON workflow_action_log(executed_at DESC);

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

COMMENT ON TABLE outreach_workflows IS 'Multi-channel outreach workflows combining email, voice calls, and SMS';
COMMENT ON TABLE workflow_steps IS 'Individual steps in a workflow - can be email, call, sms, or wait';
COMMENT ON TABLE workflow_enrollments IS 'Tracks lead progress through multi-channel workflows';
COMMENT ON TABLE workflow_action_log IS 'Detailed log of all actions taken in workflows';

COMMENT ON COLUMN workflow_steps.step_type IS 'Type of step: email, call, sms, or wait';
COMMENT ON COLUMN workflow_steps.condition IS 'Condition to execute: always, no_reply, no_open, no_answer';
COMMENT ON COLUMN workflow_enrollments.next_action_type IS 'Type of next scheduled action: email, call, sms';