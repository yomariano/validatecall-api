#!/usr/bin/env node

/**
 * Test Call Script
 *
 * Usage:
 *   node scripts/test-call.js +1234567890
 *   node scripts/test-call.js +353838454183 --product "AI testing tool"
 *
 * Environment variables required:
 *   - VAPI_API_KEY
 *   - VAPI_PHONE_NUMBER_IDS (or VAPI_PHONE_NUMBER_ID)
 *   - VOIPCLOUD_API_TOKEN (for Irish numbers)
 *   - VOIPCLOUD_USER_NUMBER (for Irish numbers)
 */

import 'dotenv/config';

// Parse command line arguments
const args = process.argv.slice(2);
const phoneNumber = args[0];
const productIdx = args.indexOf('--product');
const product = productIdx !== -1 ? args[productIdx + 1] : 'Test Product - AI Voice Assistant';
const nameIdx = args.indexOf('--name');
const customerName = nameIdx !== -1 ? args[nameIdx + 1] : 'Test Call';

if (!phoneNumber) {
  console.error('❌ Error: Phone number required');
  console.log('\nUsage:');
  console.log('  node scripts/test-call.js <phone-number> [--product "description"] [--name "customer"]');
  console.log('\nExamples:');
  console.log('  node scripts/test-call.js +1234567890');
  console.log('  node scripts/test-call.js +353838454183 --product "AI appointment scheduler"');
  console.log('  node scripts/test-call.js +1234567890 --name "John Doe" --product "CRM software"');
  process.exit(1);
}

// Configuration
const VAPI_API_URL = 'https://api.vapi.ai';
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_IDS?.split(',')[0] || process.env.VAPI_PHONE_NUMBER_ID;
const VOIPCLOUD_API_URL = 'https://ie.voipcloud.online';
const VOIPCLOUD_TOKEN = process.env.VOIPCLOUD_API_TOKEN;
const VOIPCLOUD_USER_NUMBER = process.env.VOIPCLOUD_USER_NUMBER || '1001';
const VOIPCLOUD_CALLER_ID = process.env.VOIPCLOUD_CALLER_ID || VOIPCLOUD_USER_NUMBER;

// Check if number is Irish
function isIrishNumber(phone) {
  const cleaned = phone.replace(/\s/g, '');
  return cleaned.startsWith('+353') || cleaned.startsWith('353') || cleaned.startsWith('08');
}

// Make call via VoIPcloud (for Irish numbers)
async function makeVoIPcloudCall(destinationNumber) {
  if (!VOIPCLOUD_TOKEN) {
    throw new Error('VOIPCLOUD_API_TOKEN not configured in environment');
  }

  console.log(`\n📞 [VoIPcloud] Routing Irish number via VoIPcloud SIP trunk`);

  const payload = {
    user_number: VOIPCLOUD_USER_NUMBER,
    number_to_call: destinationNumber,
    caller_id: VOIPCLOUD_CALLER_ID,
  };

  console.log(`📤 Request payload:`, JSON.stringify(payload, null, 2));

  const response = await fetch(`${VOIPCLOUD_API_URL}/api/integration/v2/call-to-number`, {
    method: 'POST',
    headers: {
      'token': VOIPCLOUD_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  console.log(`📥 Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ VoIPcloud error response:`, errorText);
    throw new Error(`VoIPcloud call failed: ${response.status}`);
  }

  const result = await response.json();
  console.log(`✅ VoIPcloud response:`, JSON.stringify(result, null, 2));
  return result;
}

// Make call via VAPI (for non-Irish numbers)
async function makeVapiCall(destinationNumber) {
  if (!VAPI_API_KEY) {
    throw new Error('VAPI_API_KEY not configured in environment');
  }
  if (!VAPI_PHONE_NUMBER_ID) {
    throw new Error('VAPI_PHONE_NUMBER_ID or VAPI_PHONE_NUMBER_IDS not configured in environment');
  }

  console.log(`\n📞 [VAPI] Making call via VAPI API`);

  const payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: {
      number: destinationNumber,
      name: customerName,
    },
    assistant: {
      firstMessage: `Hi! This is a test call from ValidateCall. I'm calling about ${product}. Is this a good time to talk?`,
      model: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
      },
      voice: {
        provider: 'elevenlabs',
        voiceId: 'burt',
      },
      recordingEnabled: true,
      endCallFunctionEnabled: true,
    },
  };

  console.log(`📤 Request payload:`, JSON.stringify(payload, null, 2));

  const response = await fetch(`${VAPI_API_URL}/call/phone`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  console.log(`📥 Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ VAPI error response:`, errorText);
    throw new Error(`VAPI call failed: ${response.status}`);
  }

  const result = await response.json();
  console.log(`✅ VAPI response:`, JSON.stringify(result, null, 2));
  return result;
}

// Main execution
async function main() {
  console.log('\n🎯 ValidateCall Test Call Script');
  console.log('=================================\n');
  console.log(`📞 Phone Number: ${phoneNumber}`);
  console.log(`👤 Customer Name: ${customerName}`);
  console.log(`📦 Product: ${product}`);

  const isIrish = isIrishNumber(phoneNumber);
  console.log(`🌍 Number Type: ${isIrish ? 'Irish (+353)' : 'International'}`);

  try {
    let result;

    if (isIrish) {
      result = await makeVoIPcloudCall(phoneNumber);
      console.log('\n✅ Call initiated via VoIPcloud!');
      console.log(`📞 Call ID: ${result.call_id || result.id || 'N/A'}`);
    } else {
      result = await makeVapiCall(phoneNumber);
      console.log('\n✅ Call initiated via VAPI!');
      console.log(`📞 Call ID: ${result.id || result.callId || 'N/A'}`);
    }

    console.log('\n📊 Full Response:');
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('\n❌ Call failed!');
    console.error(`Error: ${error.message}`);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

main();
