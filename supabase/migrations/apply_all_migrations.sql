-- =============================================
-- COMPREHENSIVE MIGRATION CHECK AND APPLY SCRIPT
-- Run this in Supabase SQL Editor to ensure all tables exist
-- =============================================

-- First, let's check what tables exist
DO $$
DECLARE
    missing_tables TEXT := '';
BEGIN
    -- Check for each required table
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

-- =============================================
-- 000: INITIAL SCHEMA - Core tables
-- =============================================

-- Function to update updated_at timestamp (needed by triggers)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- PROFILES TABLE
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
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

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Service role policy for profiles
DROP POLICY IF EXISTS "Service role has full access to profiles" ON profiles;
CREATE POLICY "Service role has full access to profiles" ON profiles
  FOR ALL USING (auth.role() = 'service_role');

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- LEADS TABLE
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

-- Add unique constraint if not exists
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

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own leads" ON leads;
CREATE POLICY "Users can view their own leads" ON leads
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert their own leads" ON leads;
CREATE POLICY "Users can insert their own leads" ON leads
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own leads" ON leads;
CREATE POLICY "Users can update their own leads" ON leads
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete their own leads" ON leads;
CREATE POLICY "Users can delete their own leads" ON leads
  FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Service role has full access to leads" ON leads;
CREATE POLICY "Service role has full access to leads" ON leads
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_search ON leads(search_keyword, search_location);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

-- CAMPAIGNS TABLE
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

-- Add columns that may be missing from existing campaigns table (from migration 005)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS lead_ids UUID[] DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS selected_agent_id TEXT;

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own campaigns" ON campaigns;
CREATE POLICY "Users can view their own campaigns" ON campaigns
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert their own campaigns" ON campaigns;
CREATE POLICY "Users can insert their own campaigns" ON campaigns
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own campaigns" ON campaigns;
CREATE POLICY "Users can update their own campaigns" ON campaigns
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete their own campaigns" ON campaigns;
CREATE POLICY "Users can delete their own campaigns" ON campaigns
  FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Service role has full access to campaigns" ON campaigns;
CREATE POLICY "Service role has full access to campaigns" ON campaigns
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_lead_ids ON campaigns USING GIN (lead_ids);

-- CALLS TABLE
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

-- Add columns that may be missing from existing calls table (from migrations 003 and 006)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_outcome TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_reason TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outbound_phone_number_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outbound_phone_number TEXT;

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own calls" ON calls;
CREATE POLICY "Users can view their own calls" ON calls
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert their own calls" ON calls;
CREATE POLICY "Users can insert their own calls" ON calls
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own calls" ON calls;
CREATE POLICY "Users can update their own calls" ON calls
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete their own calls" ON calls;
CREATE POLICY "Users can delete their own calls" ON calls
  FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Service role has full access to calls" ON calls;
CREATE POLICY "Service role has full access to calls" ON calls
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_campaign_id ON calls(campaign_id);
CREATE INDEX IF NOT EXISTS idx_calls_vapi_call_id ON calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_call_outcome ON calls(call_outcome);

-- SCRAPE_JOBS TABLE
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

ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own scrape_jobs" ON scrape_jobs;
CREATE POLICY "Users can view their own scrape_jobs" ON scrape_jobs
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert their own scrape_jobs" ON scrape_jobs;
CREATE POLICY "Users can insert their own scrape_jobs" ON scrape_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own scrape_jobs" ON scrape_jobs;
CREATE POLICY "Users can update their own scrape_jobs" ON scrape_jobs
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Service role has full access to scrape_jobs" ON scrape_jobs;
CREATE POLICY "Service role has full access to scrape_jobs" ON scrape_jobs
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_user_id ON scrape_jobs(user_id);

-- =============================================
-- 003: SUBSCRIPTIONS AND PHONE NUMBERS
-- =============================================

-- SUBSCRIPTION_PLANS TABLE
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

-- Insert default plans
INSERT INTO subscription_plans (id, name, description, price_monthly, phone_numbers_included, daily_calls_per_number, max_leads, max_campaigns, sort_order, features) VALUES
  ('basic', 'Basic', 'Perfect for getting started', 4900, 2, 50, 500, 5, 1,
   '["2 phone numbers", "100 calls/day", "500 leads", "5 campaigns", "Email support"]'::jsonb),
  ('pro', 'Pro', 'For growing businesses', 14900, 5, 50, 2000, 20, 2,
   '["5 phone numbers", "250 calls/day", "2,000 leads", "20 campaigns", "Priority support", "Call analytics"]'::jsonb),
  ('enterprise', 'Enterprise', 'For high-volume teams', 39900, 10, 100, 10000, 100, 3,
   '["10 phone numbers", "1,000 calls/day", "10,000 leads", "Unlimited campaigns", "Dedicated support", "Custom integrations", "API access"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- USER_SUBSCRIPTIONS TABLE
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

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own subscription" ON user_subscriptions;
CREATE POLICY "Users can view their own subscription" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage subscriptions" ON user_subscriptions;
CREATE POLICY "Service role can manage subscriptions" ON user_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer ON user_subscriptions(stripe_customer_id);

-- USER_PHONE_NUMBERS TABLE
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

ALTER TABLE user_phone_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own phone numbers" ON user_phone_numbers;
CREATE POLICY "Users can view their own phone numbers" ON user_phone_numbers
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own phone numbers" ON user_phone_numbers;
CREATE POLICY "Users can update their own phone numbers" ON user_phone_numbers
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage phone numbers" ON user_phone_numbers;
CREATE POLICY "Service role can manage phone numbers" ON user_phone_numbers
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_user_id ON user_phone_numbers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_status ON user_phone_numbers(status);
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_provider ON user_phone_numbers(provider);

-- PHONE_NUMBER_USAGE_LOG TABLE
CREATE TABLE IF NOT EXISTS phone_number_usage_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number_id UUID REFERENCES user_phone_numbers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  usage_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE phone_number_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own usage log" ON phone_number_usage_log;
CREATE POLICY "Users can view their own usage log" ON phone_number_usage_log
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage usage log" ON phone_number_usage_log;
CREATE POLICY "Service role can manage usage log" ON phone_number_usage_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_phone_usage_date ON phone_number_usage_log(phone_number_id, usage_date);

-- =============================================
-- 004: SCHEDULED_CALLS TABLE
-- =============================================

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

ALTER TABLE scheduled_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own scheduled calls" ON scheduled_calls;
CREATE POLICY "Users can view their own scheduled calls" ON scheduled_calls
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert their own scheduled calls" ON scheduled_calls;
CREATE POLICY "Users can insert their own scheduled calls" ON scheduled_calls
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update their own scheduled calls" ON scheduled_calls;
CREATE POLICY "Users can update their own scheduled calls" ON scheduled_calls
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can delete their own scheduled calls" ON scheduled_calls;
CREATE POLICY "Users can delete their own scheduled calls" ON scheduled_calls
  FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Service role can manage scheduled calls" ON scheduled_calls;
CREATE POLICY "Service role can manage scheduled calls" ON scheduled_calls
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_scheduled_calls_user_id ON scheduled_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_status ON scheduled_calls(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_scheduled_at ON scheduled_calls(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_next_retry_at ON scheduled_calls(next_retry_at);

-- =============================================
-- 007: FREE_TIER_USAGE TABLE (Critical for usage endpoint!)
-- =============================================

CREATE TABLE IF NOT EXISTS free_tier_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  leads_used INTEGER DEFAULT 0,
  leads_limit INTEGER DEFAULT 10,
  calls_used INTEGER DEFAULT 0,
  calls_limit INTEGER DEFAULT 5,
  call_seconds_per_call INTEGER DEFAULT 120,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_free_tier_usage_user_id ON free_tier_usage(user_id);

-- Update timestamp trigger for free_tier_usage
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

-- Enable Row Level Security
ALTER TABLE free_tier_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies for free_tier_usage
DROP POLICY IF EXISTS "Users can view own free tier usage" ON free_tier_usage;
CREATE POLICY "Users can view own free tier usage" ON free_tier_usage
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own free tier usage" ON free_tier_usage;
CREATE POLICY "Users can update own free tier usage" ON free_tier_usage
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own free tier usage" ON free_tier_usage;
CREATE POLICY "Users can insert own free tier usage" ON free_tier_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role has full access to free tier usage" ON free_tier_usage;
CREATE POLICY "Service role has full access to free tier usage" ON free_tier_usage
  FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions
GRANT SELECT, UPDATE, INSERT ON free_tier_usage TO authenticated;
GRANT ALL ON free_tier_usage TO service_role;

-- =============================================
-- 008: SYNC FREE TIER USAGE - Fix leads_used counter
-- =============================================

-- Update leads_used for all existing free_tier_usage records
-- by counting actual leads in the leads table
UPDATE free_tier_usage ftu
SET
  leads_used = COALESCE((
    SELECT COUNT(*)
    FROM leads l
    WHERE l.user_id = ftu.user_id
  ), 0),
  updated_at = NOW();

-- Create free_tier_usage records for users who have leads
-- but don't have a usage record yet
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

-- Function to increment leads_used when a new lead is created
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

-- Function to decrement leads_used when a lead is deleted
CREATE OR REPLACE FUNCTION decrement_leads_used()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE free_tier_usage
  SET leads_used = GREATEST(leads_used - 1, 0), updated_at = NOW()
  WHERE user_id = OLD.user_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for lead inserts
DROP TRIGGER IF EXISTS on_lead_created ON leads;
CREATE TRIGGER on_lead_created
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION increment_leads_used();

-- Trigger for lead deletes
DROP TRIGGER IF EXISTS on_lead_deleted ON leads;
CREATE TRIGGER on_lead_deleted
  AFTER DELETE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION decrement_leads_used();

-- =============================================
-- UPDATE TRIGGERS
-- =============================================

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

-- =============================================
-- FINAL VERIFICATION
-- =============================================

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

-- List all tables to confirm
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY table_name;
