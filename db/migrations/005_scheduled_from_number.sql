-- Preserve an explicit caller choice even if that number is later removed.
-- Dispatch will reject an unavailable selection instead of silently switching it.
ALTER TABLE scheduled_calls ADD COLUMN IF NOT EXISTS from_number_id UUID;
