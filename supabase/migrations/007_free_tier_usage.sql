-- Free Tier Usage Tracking (Updated for auth.users)
-- Tracks leads and calls usage for free tier users

-- Create table
CREATE TABLE IF NOT EXISTS free_tier_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  leads_used INTEGER DEFAULT 0,
  leads_limit INTEGER DEFAULT 10,
  calls_used INTEGER DEFAULT 0,
  calls_limit INTEGER DEFAULT 5,
  call_seconds_per_call INTEGER DEFAULT 120, -- 2 min max per call
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_free_tier_usage_user_id ON free_tier_usage(user_id);

-- Update timestamp trigger
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

-- RLS Policies
-- Users can view their own usage
CREATE POLICY "Users can view own free tier usage" ON free_tier_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Users can update their own usage (for incrementing counts)
CREATE POLICY "Users can update own free tier usage" ON free_tier_usage
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can insert their own usage record
CREATE POLICY "Users can insert own free tier usage" ON free_tier_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for backend API)
CREATE POLICY "Service role has full access to free tier usage" ON free_tier_usage
  FOR ALL USING (auth.role() = 'service_role');

-- Create free_tier_usage records for existing users who don't have one
INSERT INTO free_tier_usage (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM free_tier_usage WHERE user_id IS NOT NULL)
ON CONFLICT (user_id) DO NOTHING;

-- Grant permissions
GRANT SELECT, UPDATE, INSERT ON free_tier_usage TO authenticated;
GRANT ALL ON free_tier_usage TO service_role;
