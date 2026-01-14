-- Migration: Make user_id nullable for development mode
-- This allows saving data without authentication in localhost development
-- Run this in Supabase SQL Editor after the main schema.sql

-- =============================================
-- MAKE USER_ID NULLABLE
-- =============================================

-- Leads table
ALTER TABLE leads ALTER COLUMN user_id DROP NOT NULL;

-- Campaigns table  
ALTER TABLE campaigns ALTER COLUMN user_id DROP NOT NULL;

-- Calls table
ALTER TABLE calls ALTER COLUMN user_id DROP NOT NULL;

-- Scrape jobs table
ALTER TABLE scrape_jobs ALTER COLUMN user_id DROP NOT NULL;

-- =============================================
-- ADD PARTIAL UNIQUE CONSTRAINTS
-- =============================================

-- For leads without user_id (dev mode), ensure place_id is unique
DROP INDEX IF EXISTS leads_place_id_null_user_unique;
CREATE UNIQUE INDEX leads_place_id_null_user_unique 
    ON leads(place_id) 
    WHERE user_id IS NULL;

-- For scrape_jobs without user_id (dev mode), ensure apify_run_id is unique
DROP INDEX IF EXISTS scrape_jobs_apify_run_id_null_user_unique;
CREATE UNIQUE INDEX scrape_jobs_apify_run_id_null_user_unique 
    ON scrape_jobs(apify_run_id) 
    WHERE user_id IS NULL;

-- =============================================
-- VERIFICATION
-- =============================================

-- Verify the changes
DO $$
BEGIN
    RAISE NOTICE 'Migration completed: user_id is now nullable on leads, campaigns, calls, scrape_jobs';
END $$;
