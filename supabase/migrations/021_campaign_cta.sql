-- Migration: Add CTA button fields to campaigns
-- Allows per-campaign CTA buttons in emails

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS cta_text TEXT;

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS cta_url TEXT;

COMMENT ON COLUMN campaigns.cta_text IS 'Call-to-action button text for campaign emails';
COMMENT ON COLUMN campaigns.cta_url IS 'Call-to-action button URL for campaign emails';
