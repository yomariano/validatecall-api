-- =============================================
-- SYNC FREE TIER USAGE - Fix leads_used counter
-- This migration syncs the leads_used counter with actual lead count
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
  10 as leads_limit,  -- default free tier limit
  0 as calls_used,
  5 as calls_limit,   -- default free tier limit
  120 as call_seconds_per_call
FROM profiles p
LEFT JOIN leads l ON l.user_id = p.id
WHERE NOT EXISTS (
  SELECT 1 FROM free_tier_usage ftu WHERE ftu.user_id = p.id
)
GROUP BY p.id
HAVING COUNT(l.id) > 0;

-- =============================================
-- TRIGGER: Auto-increment leads_used on lead insert
-- This ensures the counter stays in sync going forward
-- =============================================

-- Function to increment leads_used when a new lead is created
CREATE OR REPLACE FUNCTION increment_leads_used()
RETURNS TRIGGER AS $$
BEGIN
  -- Increment leads_used for this user
  UPDATE free_tier_usage
  SET leads_used = leads_used + 1, updated_at = NOW()
  WHERE user_id = NEW.user_id;

  -- If no record exists, create one with leads_used = 1
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

-- Create trigger for lead inserts
DROP TRIGGER IF EXISTS on_lead_created ON leads;
CREATE TRIGGER on_lead_created
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION increment_leads_used();

-- Create trigger for lead deletes
DROP TRIGGER IF EXISTS on_lead_deleted ON leads;
CREATE TRIGGER on_lead_deleted
  AFTER DELETE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION decrement_leads_used();
