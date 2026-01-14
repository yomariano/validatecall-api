-- =============================================
-- ADD CALL OUTCOME TRACKING
-- Tracks whether calls reached humans, voicemail, or IVR systems
-- =============================================

-- Add call_outcome column to track what answered the call
-- Values: 'human', 'voicemail', 'ivr', 'no_answer', 'busy', 'failed'
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_outcome TEXT;

-- Add ended_reason column to store VAPI's raw endedReason
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_reason TEXT;

-- Create index for filtering by call outcome
CREATE INDEX IF NOT EXISTS idx_calls_call_outcome ON calls(call_outcome);

-- Add comment for documentation
COMMENT ON COLUMN calls.call_outcome IS 'What answered the call: human, voicemail, ivr, no_answer, busy, failed';
COMMENT ON COLUMN calls.ended_reason IS 'Raw endedReason from VAPI API';
