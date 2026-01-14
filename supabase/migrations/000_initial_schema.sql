-- =============================================
-- PROFILES TABLE - User profiles linked to auth.users
-- Automatically created when a new user signs up
-- =============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  
  -- User info (from Google OAuth)
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  
  -- Subscription/plan
  plan TEXT DEFAULT 'free', -- free, starter, pro, enterprise
  
  -- Company info
  company_name TEXT,
  company_website TEXT,
  
  -- Settings
  timezone TEXT DEFAULT 'UTC',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policies for profiles
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

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

-- Trigger to auto-create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- DEV USER (for localhost development)
-- Run this only for local development
-- =============================================
-- INSERT INTO profiles (id, email, full_name, plan)
-- VALUES (
--   '00000000-0000-0000-0000-000000000000',
--   'dev@localhost.com',
--   'Developer',
--   'free'
-- ) ON CONFLICT (id) DO NOTHING;

-- =============================================
-- LEADS TABLE - Scraped business contacts
-- =============================================
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Owner (user who created this lead)
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  -- Business info
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  website TEXT,

  -- Google Maps data
  rating DECIMAL(2,1),
  review_count INTEGER,
  category TEXT,
  place_id TEXT,
  google_maps_url TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),

  -- Scraping metadata
  source TEXT DEFAULT 'google_maps',
  search_keyword TEXT,
  search_location TEXT,

  -- Status
  status TEXT DEFAULT 'new', -- new, contacted, interested, not_interested, invalid
  call_count INTEGER DEFAULT 0,
  last_called_at TIMESTAMPTZ,

  -- Notes
  notes TEXT,
  tags TEXT[],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint per user
  UNIQUE(user_id, place_id)
);

-- Enable Row Level Security
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Policies for leads
CREATE POLICY "Users can view their own leads" ON leads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own leads" ON leads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own leads" ON leads
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own leads" ON leads
  FOR DELETE USING (auth.uid() = user_id);

-- Indexes for leads
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_search ON leads(search_keyword, search_location);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

-- =============================================
-- CAMPAIGNS TABLE - Calling campaigns
-- =============================================
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Owner
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  product_idea TEXT NOT NULL,
  company_context TEXT,

  -- Status
  status TEXT DEFAULT 'draft', -- draft, running, paused, completed

  -- Stats
  total_leads INTEGER DEFAULT 0,
  calls_made INTEGER DEFAULT 0,
  calls_completed INTEGER DEFAULT 0,
  calls_failed INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Policies for campaigns
CREATE POLICY "Users can view their own campaigns" ON campaigns
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own campaigns" ON campaigns
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns" ON campaigns
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns" ON campaigns
  FOR DELETE USING (auth.uid() = user_id);

-- Index for campaigns
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);

-- =============================================
-- CALLS TABLE - Call records
-- =============================================
CREATE TABLE IF NOT EXISTS calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Owner
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  -- Links
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  vapi_call_id TEXT UNIQUE,

  -- Contact info
  phone_number TEXT NOT NULL,
  customer_name TEXT,

  -- Call metadata
  status TEXT DEFAULT 'initiated',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,

  -- Recording & Transcript
  recording_url TEXT,
  transcript TEXT,
  transcript_json JSONB,

  -- Analysis
  summary TEXT,
  sentiment TEXT,
  interest_score INTEGER,
  key_objections TEXT[],
  willing_to_pay TEXT,
  wants_notification BOOLEAN,

  -- Raw data
  raw_response JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Policies for calls
CREATE POLICY "Users can view their own calls" ON calls
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own calls" ON calls
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own calls" ON calls
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own calls" ON calls
  FOR DELETE USING (auth.uid() = user_id);

-- Indexes for calls
CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_campaign_id ON calls(campaign_id);
CREATE INDEX IF NOT EXISTS idx_calls_vapi_call_id ON calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);

-- =============================================
-- SCRAPE_JOBS TABLE - Track scraping jobs
-- =============================================
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Owner
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,

  apify_run_id TEXT,
  keyword TEXT NOT NULL,
  location TEXT NOT NULL,
  max_results INTEGER DEFAULT 100,

  status TEXT DEFAULT 'running', -- running, completed, failed
  leads_found INTEGER DEFAULT 0,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint per user
  UNIQUE(user_id, apify_run_id)
);

-- Enable Row Level Security
ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;

-- Policies for scrape_jobs
CREATE POLICY "Users can view their own scrape_jobs" ON scrape_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scrape_jobs" ON scrape_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scrape_jobs" ON scrape_jobs
  FOR UPDATE USING (auth.uid() = user_id);

-- Index for scrape_jobs
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_user_id ON scrape_jobs(user_id);

-- =============================================
-- TRIGGERS - Auto-update updated_at
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_leads_updated_at ON leads;
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_calls_updated_at ON calls;
CREATE TRIGGER update_calls_updated_at
  BEFORE UPDATE ON calls
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
