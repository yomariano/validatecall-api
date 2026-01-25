-- Migration: Add Resend API Key to profiles
-- Allows users to provide their own Resend API key for cold email sending
-- This enables multi-tenant email sending where users can use their own verified domains

-- =============================================
-- ADD RESEND API KEY COLUMN TO PROFILES
-- =============================================

-- Add resend_api_key column to profiles table
-- This stores the user's personal Resend API key (encrypted at rest by Supabase)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS resend_api_key TEXT;

-- Add a column to track if the API key has been verified
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS resend_api_key_verified BOOLEAN DEFAULT FALSE;

-- Add a column to store the last verification date
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS resend_api_key_verified_at TIMESTAMPTZ;

-- =============================================
-- ADD IS_USER_OWNED COLUMN TO USER_DOMAINS
-- =============================================

-- Track whether domain is in user's own Resend account vs platform account
ALTER TABLE user_domains
ADD COLUMN IF NOT EXISTS is_user_owned BOOLEAN DEFAULT FALSE;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON COLUMN profiles.resend_api_key IS 'User''s personal Resend API key for sending cold emails from their own domains';
COMMENT ON COLUMN profiles.resend_api_key_verified IS 'Whether the Resend API key has been verified to work';
COMMENT ON COLUMN profiles.resend_api_key_verified_at IS 'When the Resend API key was last verified';
COMMENT ON COLUMN user_domains.is_user_owned IS 'Whether domain is managed in user''s own Resend account';

-- =============================================
-- RLS POLICIES (already exist for profiles, but ensure API key is protected)
-- The existing policies already protect this column since they're row-level
-- =============================================

-- Service role needs full access for backend API operations
-- Drop existing policy if it exists, then create it
DO $$
BEGIN
    DROP POLICY IF EXISTS "Service role has full access to profiles" ON profiles;
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "Service role has full access to profiles" ON profiles
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- VERIFICATION
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'Added resend_api_key column to profiles table';
END $$;
