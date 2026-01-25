-- Migration: Add SendGrid Support
-- Allows users to choose between Resend and SendGrid for email sending

-- =============================================
-- ADD EMAIL PROVIDER COLUMNS TO PROFILES
-- =============================================

-- Add email_provider column to track which provider the user prefers
-- Options: 'resend', 'sendgrid', or NULL (use platform default)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS email_provider TEXT DEFAULT NULL;

-- Add SendGrid API key column
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS sendgrid_api_key TEXT;

-- Add verification status for SendGrid
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS sendgrid_api_key_verified BOOLEAN DEFAULT FALSE;

-- Add verification timestamp for SendGrid
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS sendgrid_api_key_verified_at TIMESTAMPTZ;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON COLUMN profiles.email_provider IS 'User''s preferred email provider: resend, sendgrid, or NULL for platform default';
COMMENT ON COLUMN profiles.sendgrid_api_key IS 'User''s SendGrid API key for sending cold emails';
COMMENT ON COLUMN profiles.sendgrid_api_key_verified IS 'Whether the SendGrid API key has been verified to work';
COMMENT ON COLUMN profiles.sendgrid_api_key_verified_at IS 'When the SendGrid API key was last verified';

-- =============================================
-- VERIFICATION
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'Added SendGrid support columns to profiles table';
END $$;
