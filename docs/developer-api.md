# ValidateCall Developer API

The versioned API is served from `https://api.validatecall.com/v1`. Create and revoke bearer keys from **Developer API** in the signed-in ValidateCall application. A key's plaintext secret is returned once; ValidateCall stores a SHA-256 hash.

The complete machine-readable contract is available at:

```text
https://api.validatecall.com/v1/openapi.json
```

## Authentication

```bash
curl https://api.validatecall.com/v1/account \
  -H "Authorization: Bearer $VALIDATECALL_API_KEY"
```

Keys have explicit scopes. API responses include per-minute rate-limit headers. Revocation takes effect on the next request.

## Place a call

Create or select a lead, campaign and GPT Live assistant first. Call creation requires an idempotency key so a retry cannot dial twice.

```bash
curl https://api.validatecall.com/v1/calls \
  -X POST \
  -H "Authorization: Bearer $VALIDATECALL_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: campaign-123-lead-456-attempt-1" \
  -d '{
    "lead_id": "LEAD_UUID",
    "campaign_id": "CAMPAIGN_UUID",
    "from_number_id": "CALLER_NUMBER_UUID"
  }'
```

When a lead and campaign are supplied, the API inherits the lead phone number and campaign assistant/context. It rejects suppressed contacts, mismatched campaign leads, mismatched phone overrides and another active call to the same number within five minutes.

The calling client remains responsible for using an authorised caller ID, applying the appropriate contact permissions and suppression rules, and observing local business hours. ValidateCall also applies the account's caller-number routing, capacity and outbound-call controls before a provider request is made.

## Main resources

- `/research/leads` — find business contacts from cited public web sources; saving remains an explicit `/leads` request.
- `/leads` — create, list, read, update and delete contacts.
- `/campaigns` — create, list, read, update and delete campaign definitions.
- `/campaigns/{id}/recalculate` — reconcile campaign and lead call counters from stored call records.
- `/assistants` — create and manage AssistantFleet GPT Live assistants.
- `/phone-numbers` — list caller numbers and check destination readiness.
- `/calls` — start a call and retrieve outcomes, transcripts and summaries.
- `/calls/{id}/recording` — download authenticated WAV audio.

All database reads and writes are scoped to the account that owns the key. API keys cannot manage other API keys; key lifecycle remains behind the signed-in web session and CSRF protection.
