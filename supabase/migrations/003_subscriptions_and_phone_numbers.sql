-- =============================================
-- SUBSCRIPTION PLANS TABLE - Plan definitions
-- =============================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,  -- 'basic', 'pro', 'enterprise'

  name TEXT NOT NULL,
  description TEXT,

  -- Pricing (in cents)
  price_monthly INTEGER NOT NULL,
  price_yearly INTEGER,

  -- Limits
  phone_numbers_included INTEGER NOT NULL DEFAULT 2,
  daily_calls_per_number INTEGER NOT NULL DEFAULT 50,
  max_leads INTEGER DEFAULT 1000,
  max_campaigns INTEGER DEFAULT 10,

  -- Features
  features JSONB DEFAULT '[]'::jsonb,

  -- Stripe IDs (set these after creating products in Stripe)
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT,
  stripe_payment_link TEXT,  -- Direct payment link

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

-- =============================================
-- USER SUBSCRIPTIONS TABLE - User's active subscription
-- =============================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Owner
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

  -- Plan
  plan_id TEXT REFERENCES subscription_plans(id) NOT NULL,

  -- Stripe info
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_payment_intent_id TEXT,

  -- Status
  status TEXT DEFAULT 'active',  -- active, canceled, past_due, trialing

  -- Billing period
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies for user_subscriptions
CREATE POLICY "Users can view their own subscription" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can manage subscriptions (for webhooks)
CREATE POLICY "Service role can manage subscriptions" ON user_subscriptions
  FOR ALL USING (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer ON user_subscriptions(stripe_customer_id);

-- =============================================
-- USER PHONE NUMBERS TABLE - Per-user phone numbers
-- =============================================
CREATE TABLE IF NOT EXISTS user_phone_numbers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Owner
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Phone number info
  phone_number TEXT NOT NULL,              -- E.164 format: +353561234567
  phone_number_id TEXT NOT NULL,           -- VAPI phone number ID

  -- Provider info
  provider TEXT DEFAULT 'twilio',          -- twilio, telnyx
  provider_sid TEXT,                       -- Twilio SID or Telnyx ID

  -- Location
  country_code TEXT DEFAULT 'IE',          -- ISO country code
  area_code TEXT,

  -- Usage tracking
  daily_calls_used INTEGER DEFAULT 0,
  daily_calls_limit INTEGER DEFAULT 50,
  last_reset_date DATE DEFAULT CURRENT_DATE,
  total_calls_made INTEGER DEFAULT 0,

  -- Status
  status TEXT DEFAULT 'active',            -- active, flagged, exhausted, released
  flagged_as_spam BOOLEAN DEFAULT false,
  spam_flagged_at TIMESTAMPTZ,

  -- Metadata
  friendly_name TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(phone_number),
  UNIQUE(phone_number_id)
);

-- Enable Row Level Security
ALTER TABLE user_phone_numbers ENABLE ROW LEVEL SECURITY;

-- Policies for user_phone_numbers
CREATE POLICY "Users can view their own phone numbers" ON user_phone_numbers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own phone numbers" ON user_phone_numbers
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role can manage phone numbers (for provisioning)
CREATE POLICY "Service role can manage phone numbers" ON user_phone_numbers
  FOR ALL USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_user_id ON user_phone_numbers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_status ON user_phone_numbers(status);
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_provider ON user_phone_numbers(provider);

-- =============================================
-- PHONE NUMBER USAGE LOG - Track call distribution
-- =============================================
CREATE TABLE IF NOT EXISTS phone_number_usage_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  phone_number_id UUID REFERENCES user_phone_numbers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,

  -- Usage date for aggregation
  usage_date DATE DEFAULT CURRENT_DATE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE phone_number_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own usage log" ON phone_number_usage_log
  FOR SELECT USING (auth.uid() = user_id);

-- Index for fast daily aggregation
CREATE INDEX IF NOT EXISTS idx_phone_usage_date ON phone_number_usage_log(phone_number_id, usage_date);

-- =============================================
-- FUNCTION: Reset daily phone usage counts
-- Run this daily via cron job or Supabase scheduled function
-- =============================================
CREATE OR REPLACE FUNCTION reset_daily_phone_usage()
RETURNS void AS $$
BEGIN
  UPDATE user_phone_numbers
  SET
    daily_calls_used = 0,
    last_reset_date = CURRENT_DATE
  WHERE last_reset_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- FUNCTION: Get next available phone number for user
-- Used by the backend for round-robin rotation
-- =============================================
CREATE OR REPLACE FUNCTION get_next_available_phone_number(p_user_id UUID)
RETURNS TABLE(
  phone_number_id TEXT,
  phone_number TEXT,
  daily_calls_used INTEGER,
  daily_calls_limit INTEGER
) AS $$
BEGIN
  -- First, reset any numbers that haven't been reset today
  UPDATE user_phone_numbers
  SET daily_calls_used = 0, last_reset_date = CURRENT_DATE
  WHERE user_id = p_user_id AND last_reset_date < CURRENT_DATE;

  -- Return the phone number with lowest usage that's under limit
  RETURN QUERY
  SELECT
    upn.phone_number_id,
    upn.phone_number,
    upn.daily_calls_used,
    upn.daily_calls_limit
  FROM user_phone_numbers upn
  WHERE upn.user_id = p_user_id
    AND upn.status = 'active'
    AND upn.daily_calls_used < upn.daily_calls_limit
  ORDER BY upn.daily_calls_used ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- FUNCTION: Increment phone number usage
-- =============================================
CREATE OR REPLACE FUNCTION increment_phone_usage(p_phone_number_id TEXT, p_user_id UUID, p_call_id UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  v_phone_uuid UUID;
BEGIN
  -- Get the UUID of the phone number
  SELECT id INTO v_phone_uuid
  FROM user_phone_numbers
  WHERE phone_number_id = p_phone_number_id AND user_id = p_user_id;

  IF v_phone_uuid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Increment usage
  UPDATE user_phone_numbers
  SET
    daily_calls_used = daily_calls_used + 1,
    total_calls_made = total_calls_made + 1,
    updated_at = NOW()
  WHERE id = v_phone_uuid;

  -- Log the usage
  INSERT INTO phone_number_usage_log (phone_number_id, user_id, call_id, usage_date)
  VALUES (v_phone_uuid, p_user_id, p_call_id, CURRENT_DATE);

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- FUNCTION: Get user's phone stats
-- =============================================
CREATE OR REPLACE FUNCTION get_user_phone_stats(p_user_id UUID)
RETURNS TABLE(
  total_numbers INTEGER,
  active_numbers INTEGER,
  total_daily_capacity INTEGER,
  used_today INTEGER,
  remaining_today INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_numbers,
    COUNT(*) FILTER (WHERE status = 'active')::INTEGER as active_numbers,
    COALESCE(SUM(daily_calls_limit), 0)::INTEGER as total_daily_capacity,
    COALESCE(SUM(daily_calls_used), 0)::INTEGER as used_today,
    COALESCE(SUM(daily_calls_limit - daily_calls_used), 0)::INTEGER as remaining_today
  FROM user_phone_numbers
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- UPDATE TRIGGERS
-- =============================================
DROP TRIGGER IF EXISTS update_user_subscriptions_updated_at ON user_subscriptions;
CREATE TRIGGER update_user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_phone_numbers_updated_at ON user_phone_numbers;
CREATE TRIGGER update_user_phone_numbers_updated_at
  BEFORE UPDATE ON user_phone_numbers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- UPDATE calls TABLE - Add outbound phone tracking
-- =============================================
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outbound_phone_number_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outbound_phone_number TEXT;

-- =============================================
-- UPDATE profiles TABLE - Sync plan from subscription
-- =============================================
-- The 'plan' field in profiles will be updated when subscription changes
