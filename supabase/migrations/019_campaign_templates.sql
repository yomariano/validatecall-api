-- Add email template columns to campaigns table
-- This allows saving campaign-level settings for calls and emails

-- Email sender settings
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sender_email TEXT;

-- Email template
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS email_subject TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS email_body TEXT;

-- Comments
COMMENT ON COLUMN campaigns.sender_name IS 'Name shown as email sender';
COMMENT ON COLUMN campaigns.sender_email IS 'Email address used for sending';
COMMENT ON COLUMN campaigns.email_subject IS 'Email subject template';
COMMENT ON COLUMN campaigns.email_body IS 'Email body template (HTML)';
COMMENT ON COLUMN campaigns.product_idea IS 'Product/service description used for generating content';
COMMENT ON COLUMN campaigns.company_context IS 'Manual call pitch (optional if using voice agent)';
COMMENT ON COLUMN campaigns.selected_agent_id IS 'VAPI voice agent ID for calls';
