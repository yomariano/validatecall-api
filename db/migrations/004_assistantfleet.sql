-- Keep legacy resource IDs for historical campaign/call references. New resources
-- must explicitly identify AssistantFleet; never adopt a previous provider's IDs.
ALTER TABLE vapi_assistants ADD COLUMN provider text NOT NULL DEFAULT 'vapi';
ALTER TABLE vapi_calls ADD COLUMN provider text NOT NULL DEFAULT 'vapi';
ALTER TABLE user_phone_numbers ADD COLUMN voice_provider text NOT NULL DEFAULT 'vapi';
CREATE INDEX phone_country_routing ON user_phone_numbers(user_id, country_code, provider, voice_provider, status);
