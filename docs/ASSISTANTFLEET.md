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

## Dedicated numbers — deliberately not configured

Per the owner's instruction, do not import, bind, purchase, reassign or call from any existing client number. Subscription upgrades/cancellations no longer buy or release carrier numbers.

When new dedicated ValidateCall numbers are explicitly authorized in the future:

1. Configure the ValidateCall AssistantFleet workspace's Telnyx credentials and TeXML application per the upstream guide. Never alter the existing client application or number bindings.
2. Add each newly authorized number to the ValidateCall workspace in AssistantFleet as provider `telnyx`.
3. Register only those explicit dedicated numbers against the relevant ValidateCall `user_id` in `user_phone_numbers`, using `provider='telnyx'`, `voice_provider='assistantfleet'`, verified E.164 `phone_number`, ISO `country_code`, carrier ID in `provider_sid` and a unique local resource ID in the legacy `phone_number_id` column.
4. Review carrier destinations, billing, call-duration policy and webhook delivery. Run an authorized test to an owned destination before enabling outbound calls or schedulers.

Routing uses the actual destination country (including US/Canada sharing +1), rejects ambiguous numbers and extensions, excludes other users, flags, legacy providers and depleted numbers, and never falls back to a foreign or shared demo number. Campaign readiness simulates remaining batch capacity without placing calls or charging quota. The outbound switch defaults to off and is checked by immediate, batch, scheduled and workflow dispatch.

No end-to-end telephone call has been performed during this setup. Country routing and provider payloads are tested with mocked HTTP requests; live telephone validation remains intentionally disabled.
