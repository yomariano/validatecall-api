-- Add unique constraint to prevent duplicate welcome emails
-- This prevents race conditions where multiple requests try to send at the same time

-- Create a unique index on recipient + email_type for welcome emails only
-- This allows the same recipient to receive different types of emails,
-- but only one welcome email ever
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_logs_welcome_unique
ON email_logs(recipient, email_type)
WHERE email_type = 'welcome' AND status = 'sent';

-- Add a comment explaining the constraint
COMMENT ON INDEX idx_email_logs_welcome_unique IS
'Ensures each email address only receives one welcome email (prevents duplicates from race conditions)';
