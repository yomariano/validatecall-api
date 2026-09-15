# ValidateCall voice setup

Voice calls now use AssistantFleet (https://assistant.voicefleet.ai/docs) with Telnyx. The browser no longer includes the Vapi SDK. `/api/vapi` remains a compatibility alias to the native AssistantFleet routes for older browser tabs. The historical database columns/tables retain their names; a provider discriminator prevents using legacy resources.

Configure the API application in Coolify:

- `ASSISTANTFLEET_API_URL=https://assistant.voicefleet.ai`
- `ASSISTANTFLEET_API_KEY`: issue in the **mariano@validatecall.com** AssistantFleet workspace only.
- `ASSISTANTFLEET_WEBHOOK_SECRET`: signing secret of a webhook in that same workspace.
- `VOICE_OUTBOUND_ENABLED=false`
- `RUN_SCHEDULERS=false`

Register the AssistantFleet webhook for `call.ended` at `https://api.validatecall.com/api/voice/assistantfleet-webhook`. Signature verification uses the raw body and constant-time HMAC comparison. Only calls associated with locally-owned AssistantFleet agents and recorded dial identifiers are updated. Repeated completion events are idempotent.

Create agents through ValidateCall's Voice Agents screen. Only agents created in this local workspace are listed and editable. Browser tests use a five-minute, assistant-scoped token and a two-minute test duration. The carrier is not involved in browser tests.

## Dedicated numbers

On 13 September 2026, the owner explicitly assigned +35316875367 to ValidateCall and authorized one test to their own phone. That number is configured for the mariano@validatecall.com AssistantFleet workspace, with the ValidateCall TeXML connection and native local registry. The test completed in 63 seconds and its signed webhook updated ValidateCall successfully. Do not import, bind, purchase, reassign or call from other client numbers. Subscription upgrades/cancellations do not buy or release carrier numbers.

For additional dedicated numbers explicitly authorized in the future:

1. Configure the ValidateCall AssistantFleet workspace's Telnyx credentials and TeXML application per the upstream guide. Never alter the existing client application or number bindings.
2. Add each newly authorized number to the ValidateCall workspace in AssistantFleet as provider `telnyx`.
3. Register only those explicit dedicated numbers against the relevant ValidateCall `user_id` in `user_phone_numbers`, using `provider='telnyx'`, `voice_provider='assistantfleet'`, verified E.164 `phone_number`, ISO `country_code`, carrier ID in `provider_sid` and a unique local resource ID in the legacy `phone_number_id` column.
4. Review carrier destinations, billing, call-duration policy and webhook delivery. Run an authorized test to an owned destination before enabling outbound calls or schedulers.

Routing uses the actual destination country (including US/Canada sharing +1), rejects ambiguous numbers and extensions, excludes other users, flags, legacy providers and depleted numbers, and never falls back to a foreign or shared demo number. Campaign readiness simulates remaining batch capacity without placing calls or charging quota. The outbound switch defaults to off and is checked by immediate, batch, scheduled and workflow dispatch.

## Selecting a caller number for a contact

The contact call panel and telephone test forms offer a **From number** selector. `GET /api/telephony/caller-numbers?phoneNumber=...` lists only the signed-in user's active Telnyx/AssistantFleet numbers, with destination eligibility and remaining daily capacity. No provider request or usage reservation happens when listing numbers.

Single-call requests accept `fromNumberId`, the local `user_phone_numbers.id`. Dispatch rechecks ownership, country, capacity and the provider binding. An explicit unavailable selection fails instead of falling back to another number; clients that omit the field retain automatic country routing. Scheduled calls persist the selection in `scheduled_calls.from_number_id` and revalidate it at execution. Removing a number leaves the stored ID intact so a queued call cannot silently acquire a different caller ID. Migration `005_scheduled_from_number.sql` must precede serving the updated scheduling API.

Outbound calling was restored to disabled after the authorized test; schedulers remain disabled. The current agent is **VoiceFleet — Trades Demo Outreach** (GPT Live / Luna / low). See [the versioned sales playbook](agents/voicefleet-trades-outreach.md) for its instructions, product sources and operating limits. Calendar booking and automated follow-up are not attached to this agent; it captures requests for confirmation instead of claiming actions occurred.
