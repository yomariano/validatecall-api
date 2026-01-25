-- Migration: Add Brand Settings to profiles
-- Allows users to customize their cold email branding with logo, colors, and company name

-- =============================================
-- ADD BRAND SETTINGS COLUMNS TO PROFILES
-- =============================================

-- Brand logo URL (can be uploaded to Supabase Storage or external URL)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_logo_url TEXT;

-- Brand primary color (hex format, e.g., #6366f1)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_color TEXT;

-- Brand/Company name to display in emails
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_name TEXT;

-- CTA Button text (e.g., "Visit Our Website", "Book a Call")
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_cta_text TEXT;

-- CTA Button URL (e.g., "https://yoursite.com")
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brand_cta_url TEXT;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON COLUMN profiles.brand_logo_url IS 'URL to the user''s brand logo for email headers';
COMMENT ON COLUMN profiles.brand_color IS 'Primary brand color in hex format (e.g., #6366f1) for email styling';
COMMENT ON COLUMN profiles.brand_name IS 'Company/brand name to display in email headers and footers';
COMMENT ON COLUMN profiles.brand_cta_text IS 'Call-to-action button text for emails';
COMMENT ON COLUMN profiles.brand_cta_url IS 'Call-to-action button URL for emails';

-- =============================================
-- VERIFICATION
-- =============================================

DO $$
BEGIN
    RAISE NOTICE 'Added brand settings columns (brand_logo_url, brand_color, brand_name, brand_cta_text, brand_cta_url) to profiles table';
END $$;
