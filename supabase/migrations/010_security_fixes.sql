-- Security and Consistency Fixes Migration
-- Fixes:
-- 1. FK consistency: free_tier_usage should reference profiles(id) like other tables
-- 2. RLS: Remove NULL user_id access policies in production (security fix)
-- 3. Add missing indexes for performance

-- =============================================
-- 1. Fix free_tier_usage FK to reference profiles instead of auth.users
-- =============================================

-- Drop existing foreign key constraint
ALTER TABLE free_tier_usage DROP CONSTRAINT IF EXISTS free_tier_usage_user_id_fkey;

-- Add new foreign key to profiles
-- Note: This assumes all user_ids in free_tier_usage already exist in profiles
-- If not, you may need to clean up orphaned records first
ALTER TABLE free_tier_usage
    ADD CONSTRAINT free_tier_usage_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- =============================================
-- 2. Fix RLS policies - Remove NULL user_id access (security)
-- =============================================

-- Drop old insecure policies that allow NULL user_id access
DROP POLICY IF EXISTS "Users can view their own leads or null user_id leads" ON leads;
DROP POLICY IF EXISTS "Users can update their own leads or null user_id leads" ON leads;
DROP POLICY IF EXISTS "Users can delete their own leads or null user_id leads" ON leads;
DROP POLICY IF EXISTS "Users can insert leads for themselves or with null user_id" ON leads;

DROP POLICY IF EXISTS "Users can view their own campaigns or null user_id campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users can update their own campaigns or null user_id campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users can delete their own campaigns or null user_id campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users can insert campaigns for themselves or with null user_id" ON campaigns;

DROP POLICY IF EXISTS "Users can view their own calls or null user_id calls" ON calls;
DROP POLICY IF EXISTS "Users can update their own calls or null user_id calls" ON calls;
DROP POLICY IF EXISTS "Users can insert calls for themselves or with null user_id" ON calls;

DROP POLICY IF EXISTS "Users can view their own scrape_jobs or null user_id jobs" ON scrape_jobs;
DROP POLICY IF EXISTS "Users can update their own scrape_jobs or null user_id jobs" ON scrape_jobs;
DROP POLICY IF EXISTS "Users can insert scrape_jobs for themselves or with null user_id" ON scrape_jobs;

-- Create secure policies that ONLY allow access to user's own data
-- Leads
CREATE POLICY "Users can view their own leads" ON leads
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own leads" ON leads
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own leads" ON leads
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert leads for themselves" ON leads
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Campaigns
CREATE POLICY "Users can view their own campaigns" ON campaigns
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns" ON campaigns
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns" ON campaigns
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert campaigns for themselves" ON campaigns
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Calls
CREATE POLICY "Users can view their own calls" ON calls
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own calls" ON calls
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert calls for themselves" ON calls
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Scrape Jobs
CREATE POLICY "Users can view their own scrape_jobs" ON scrape_jobs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own scrape_jobs" ON scrape_jobs
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert scrape_jobs for themselves" ON scrape_jobs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =============================================
-- 3. Add missing indexes for performance
-- =============================================

-- Index on campaigns.status (frequently filtered)
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- Composite index for campaigns user+status
CREATE INDEX IF NOT EXISTS idx_campaigns_user_status ON campaigns(user_id, status);

-- Index on user_phone_numbers spam flag
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_spam ON user_phone_numbers(flagged_as_spam) WHERE flagged_as_spam = true;

-- Composite index for scheduled_calls
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_user_status ON scheduled_calls(user_id, status);

-- =============================================
-- 4. Fix rating column precision (DECIMAL(2,1) -> DECIMAL(3,1))
-- =============================================

ALTER TABLE leads ALTER COLUMN rating TYPE DECIMAL(3,1);

-- =============================================
-- 5. Add CHECK constraints for data validation
-- =============================================

-- Ensure at least phone or email exists for leads (optional constraint)
-- ALTER TABLE leads ADD CONSTRAINT leads_contact_info_check
--     CHECK (phone IS NOT NULL OR email IS NOT NULL);

-- Ensure interest_score is within valid range (1-10)
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_interest_score_check;
ALTER TABLE calls ADD CONSTRAINT calls_interest_score_check
    CHECK (interest_score IS NULL OR (interest_score >= 1 AND interest_score <= 10));

-- Ensure rating is within valid range (0-5)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_rating_check;
ALTER TABLE leads ADD CONSTRAINT leads_rating_check
    CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5));

-- =============================================
-- Grant permissions
-- =============================================

GRANT SELECT, INSERT, UPDATE, DELETE ON leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE ON calls TO authenticated;
GRANT SELECT, INSERT, UPDATE ON scrape_jobs TO authenticated;
