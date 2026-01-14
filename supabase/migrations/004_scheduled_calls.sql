-- =============================================
-- SCHEDULED_CALLS TABLE - Queue for scheduled phone calls
-- =============================================
CREATE TABLE IF NOT EXISTS scheduled_calls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Owner
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Links
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,

  -- Contact info
  phone_number TEXT NOT NULL,
  customer_name TEXT,

  -- Scheduling
  scheduled_at TIMESTAMPTZ NOT NULL,

  -- Call configuration (stored for retry)
  product_idea TEXT NOT NULL,
  company_context TEXT,
  assistant_id TEXT,  -- VAPI assistant ID if using pre-configured

  -- Status tracking
  -- Values: 'pending', 'in_progress', 'completed', 'failed', 'retry_scheduled', 'cancelled'
  status TEXT DEFAULT 'pending',

  -- Retry logic
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,

  -- Call result reference
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  vapi_call_id TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Enable Row Level Security
ALTER TABLE scheduled_calls ENABLE ROW LEVEL SECURITY;

-- Policies for scheduled_calls (users can manage their own)
CREATE POLICY "Users can view their own scheduled calls" ON scheduled_calls
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scheduled calls" ON scheduled_calls
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scheduled calls" ON scheduled_calls
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scheduled calls" ON scheduled_calls
  FOR DELETE USING (auth.uid() = user_id);

-- Allow nullable user_id for dev mode (matches pattern from 001_nullable_user_id.sql)
DROP POLICY IF EXISTS "Users can view their own scheduled calls" ON scheduled_calls;
DROP POLICY IF EXISTS "Users can insert their own scheduled calls" ON scheduled_calls;
DROP POLICY IF EXISTS "Users can update their own scheduled calls" ON scheduled_calls;
DROP POLICY IF EXISTS "Users can delete their own scheduled calls" ON scheduled_calls;

CREATE POLICY "Users can view their own scheduled calls" ON scheduled_calls
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert their own scheduled calls" ON scheduled_calls
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own scheduled calls" ON scheduled_calls
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete their own scheduled calls" ON scheduled_calls
  FOR DELETE USING (auth.uid() = user_id OR user_id IS NULL);

-- Indexes for efficient polling
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_user_id ON scheduled_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_status ON scheduled_calls(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_scheduled_at ON scheduled_calls(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_next_retry_at ON scheduled_calls(next_retry_at);

-- Composite index for scheduler query (pending calls due now)
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_pending_due
  ON scheduled_calls(scheduled_at)
  WHERE status = 'pending';

-- Composite index for retry query
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_retry_due
  ON scheduled_calls(next_retry_at)
  WHERE status = 'retry_scheduled';

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_scheduled_calls_updated_at ON scheduled_calls;
CREATE TRIGGER update_scheduled_calls_updated_at
  BEFORE UPDATE ON scheduled_calls
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
