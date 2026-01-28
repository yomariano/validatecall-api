# VAPI Assistant Configuration for Irish Calls

**Last Updated**: 2026-01-27
**Status**: ✅ Configured and Working

---

## Overview

Irish outbound calls (+353 numbers) use VoIPcloud routing which connects to VAPI via SIP trunk. The VAPI phone numbers that receive these SIP trunk calls have pre-configured assistants that handle all Irish calls.

---

## Current Configuration

### Irish Phone Numbers in VAPI

| Phone Number     | Phone ID                             | Assistant ID                         | Assistant Name |
|------------------|--------------------------------------|--------------------------------------|----------------|
| +35312655193     | a18d1d9c-92cf-416c-a332-47043a3f8e2d | d2fa6729-3273-4f46-82af-7e503e4bd0fd | rachel         |
| +35312655181     | f5d8f479-a6db-45a0-ad1e-041e39635425 | d2fa6729-3273-4f46-82af-7e503e4bd0fd | rachel         |

### Current Assistant: "rachel"

**Assistant ID**: `d2fa6729-3273-4f46-82af-7e503e4bd0fd`

**First Message**:
> "Hi there! This is Alex from a quick market research study. Do you have about 2 minutes to share your thoughts on a new product idea? Your feedback would be really helpful!"

**System Prompt Summary**:
- Conducts generic market research surveys
- Follows structured call script (Opening → Qualification → Product Pitch → Feedback → Closing)
- Professional and conversational tone
- Respects respondent's time
- Does NOT have specific product details (generic approach)

**Call Script**:
1. **Opening** (15 seconds): Introduce and ask for 2 minutes
2. **Qualification** (30 seconds): Identify pain points
3. **Product Pitch** (45 seconds): Present product idea (generic)
4. **Gather Feedback** (60 seconds): Interest level, must-haves, hesitations, pricing
5. **Closing** (15 seconds): Thank them, ask about launch notification

---

## Call Flow for Irish Numbers

```
┌─────────────┐
│  Frontend   │
│  (User)     │
└──────┬──────┘
       │
       │ POST /vapi/user/:userId/call
       │ { phoneNumber: "+353838454183", productIdea: "..." }
       │
       ↓
┌──────────────────┐
│  API Server      │
│  (vapi.js)       │
│                  │
│  Detects Irish   │
│  number (+353)   │
└──────┬───────────┘
       │
       │ POST VoIPcloud API
       │ { user_number: "1001", number_to_call: "+353838454183" }
       │
       ↓
┌──────────────────┐
│  VoIPcloud       │
│  (Irish trunk)   │
│                  │
│  1. Calls ext    │
│     1001 first   │
└──────┬───────────┘
       │
       │ SIP Call to extension 1001
       │
       ↓
┌──────────────────┐
│  VAPI            │
│  SIP Endpoint    │
│                  │
│  Answers with    │
│  "rachel"        │
│  assistant       │
└──────┬───────────┘
       │
       │ VoIPcloud bridges the call
       │
       ↓
┌──────────────────┐
│  Destination     │
│  +353838454183   │
│                  │
│  Hears: "Hi      │
│  there! This is  │
│  Alex from..."   │
└──────────────────┘
```

---

## Important Limitation

### ❌ Custom Product Pitches Don't Work with VoIPcloud

**Problem**:
- Frontend can send custom `productIdea` and `companyContext`
- API receives this data
- But VoIPcloud routing **cannot pass** this to VAPI
- VAPI uses the pre-configured assistant (static, no product details)
- The assistant conducts **generic** market research, not product-specific pitches

**Why**:
- VoIPcloud click-to-call only bridges calls
- It calls extension 1001 (SIP trunk to VAPI)
- VAPI answers with whatever assistant is configured on that phone number
- No way to dynamically change the assistant per call

**Workaround**:
- For calls requiring custom product pitches, use non-Irish phone numbers
- Non-Irish calls use VAPI direct routing which supports dynamic assistants
- Irish calls through VoIPcloud will be generic market research only

---

## Available VAPI Assistants

You can change which assistant handles Irish calls by updating the phone number configuration.

### Market Research Assistants

| Name              | ID                                   | First Message                                                                                           | Use Case                  |
|-------------------|--------------------------------------|---------------------------------------------------------------------------------------------------------|---------------------------|
| **rachel** ⭐     | d2fa6729-3273-4f46-82af-7e503e4bd0fd | "Hi there! This is Alex from a quick market research study..."                                         | Generic market research   |
| English - Raquel  | bd9f9318-5b61-4e13-9d7b-67d9085159e9 | "Hi! I'm calling from ValidateCall. We're reaching out to local businesses..."                         | ValidateCall sales pitch  |

### Sales/Outreach Assistants

| Name    | ID                                   | First Message                                                                                           | Use Case                        |
|---------|--------------------------------------|---------------------------------------------------------------------------------------------------------|---------------------------------|
| irish   | d6698ae4-7441-45ad-8d7d-d9d3478b7ced | "Hi, this is Rory calling from VoiceFleet. I'm reaching out to local businesses in Ireland..."         | VoiceFleet sales (Irish market) |
| rachel  | f2df5ca9-018e-4d43-a3e2-783aeedf900e | "Hi there, this is Alex. We are an AI company building solutions to simplify your work..."             | Restaurant AI sales             |

### Other Assistants

| Name                          | ID                                   | First Message                                                                |
|-------------------------------|--------------------------------------|------------------------------------------------------------------------------|
| Assistant-c7e62ca7 (Ludic)    | 4ad19f48-df72-4f14-8ba5-a42482712fb2 | "Hi, thanks for calling Ludic Limited. How can I help you?"                  |
| Assistant-0da73a0e (Test)     | 43c61368-19fa-47a2-b663-550477f20b40 | "Hi! This is Alex from Test Business. How can I help you today?"            |
| Assistant-eea68786 (Plumbers) | b8359bca-af4d-4ca9-bdd7-5b084d729de3 | "Hi, you've reached Tullamore plumbers. How can I help you today?"          |
| Assistant-5439c105 (Pizza)    | cedf7131-b530-40d2-ac49-25de2bdefd4f | "Thank you for calling paulies pizza! This is your restaurant assistant..." |

---

## How to Change the Assistant

### Option 1: Using VAPI API (Recommended)

```bash
# Update +35312655181 to use a different assistant
curl -X PATCH "https://api.vapi.ai/phone-number/f5d8f479-a6db-45a0-ad1e-041e39635425" \
  -H "Authorization: Bearer YOUR_VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "assistantId": "NEW_ASSISTANT_ID"
  }'

# Update +35312655193 to use a different assistant
curl -X PATCH "https://api.vapi.ai/phone-number/a18d1d9c-92cf-416c-a332-47043a3f8e2d" \
  -H "Authorization: Bearer YOUR_VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "assistantId": "NEW_ASSISTANT_ID"
  }'
```

### Option 2: Using VAPI Dashboard

1. Go to https://dashboard.vapi.ai
2. Navigate to Phone Numbers
3. Find +35312655181 or +35312655193
4. Click "Edit"
5. Select a different assistant from the dropdown
6. Save changes

---

## Verification

### Check Current Assistant Configuration

```bash
# List all Irish phone numbers and their assistants
curl -X GET "https://api.vapi.ai/phone-number" \
  -H "Authorization: Bearer YOUR_VAPI_API_KEY" | \
  jq '.[] | select(.number | startswith("+353")) | {number, assistantId}'
```

### Get Assistant Details

```bash
# Get details of the "rachel" assistant
curl -X GET "https://api.vapi.ai/assistant/d2fa6729-3273-4f46-82af-7e503e4bd0fd" \
  -H "Authorization: Bearer YOUR_VAPI_API_KEY" | \
  jq '{name, firstMessage, model: {provider: .model.provider, model: .model.model}}'
```

### Test a Call

```bash
# From the API server
cd /home/dev/validatecall/validatecall-api
node scripts/test-call.js +353838454183 --product "Test Product"
```

Expected: Call connects, recipient hears "Hi there! This is Alex from a quick market research study..."

---

## Recommendations

### ✅ Current Setup (Recommended)

Keep the "rachel" market research assistant for Irish calls:
- Professional and conversational
- Generic market research approach
- Works for various product types
- Established call script

### Alternative Options

**If you want product-specific pitches**:
- Don't use Irish numbers through VoIPcloud
- Use VAPI direct routing with non-Irish numbers
- This allows dynamic product ideas from the frontend

**If you want Irish-specific sales pitch**:
- Use the "irish" assistant (d6698ae4-7441-45ad-8d7d-d9d3478b7ced)
- First message mentions VoiceFleet and Irish businesses
- Better for targeting Irish market specifically

---

## Technical Notes

### Code Location

File: `/home/dev/validatecall/validatecall-api/routes/vapi.js`

Lines: 18-60 (VoIPcloud configuration and documentation)

### Environment Variables

```env
VOIPCLOUD_API_TOKEN=zEickJ5S0VtuokzJjE8F0RbIlftNpXyeWYi8jeNB9VYvmYY002M3uMNnrc1rrvG9
VOIPCLOUD_USER_NUMBER=1001
VOIPCLOUD_CALLER_ID=+35312655181
```

### Database Storage

When Irish calls are made through VoIPcloud, they are logged in the `calls` table:

```sql
{
  user_id: 'uuid',
  vapi_call_id: 'voipcloud-timestamp',
  phone_number: '+353838454183',
  customer_name: 'Lead Name',
  status: 'initiated',
  raw_response: { provider: 'voipcloud', ... }
}
```

---

## Troubleshooting

### Call connects but wrong assistant answers

- Check which assistant is configured on the phone numbers
- Update using the VAPI API or dashboard

### Assistant doesn't know the product

- This is expected with VoIPcloud routing
- The assistant on Irish numbers is static (no dynamic product info)
- Use non-Irish numbers for product-specific pitches

### Call fails to connect

- Check VoIPcloud credits and API token
- Verify extension 1001 is configured as VAPI SIP trunk
- Check VAPI phone numbers are active

---

**Summary**: Irish calls now use the "rachel" market research assistant, which provides professional and generic market research surveys. For calls requiring custom product pitches, use non-Irish phone numbers with VAPI direct routing.
