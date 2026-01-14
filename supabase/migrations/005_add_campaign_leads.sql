-- Add lead_ids column to campaigns table
-- This stores the selected lead IDs for the campaign
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS lead_ids UUID[] DEFAULT '{}';

-- Add selected_agent_id to campaigns
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS selected_agent_id TEXT;

-- Create index for lead_ids array queries
CREATE INDEX IF NOT EXISTS idx_campaigns_lead_ids ON campaigns USING GIN (lead_ids);
