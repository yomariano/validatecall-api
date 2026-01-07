/**
 * Phone Number Provisioning Service
 * Handles buying phone numbers from Twilio and importing them to VAPI
 */

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_API_URL = 'https://api.vapi.ai';

// Country configurations for phone numbers
const COUNTRY_CONFIG = {
    IE: { code: '+353', name: 'Ireland', areaCode: null },
    US: { code: '+1', name: 'United States', areaCode: null },
    GB: { code: '+44', name: 'United Kingdom', areaCode: null },
    // Add more countries as needed
};

/**
 * Search for available phone numbers from Twilio
 */
export async function searchAvailableNumbers(countryCode = 'IE', options = {}) {
    const { areaCode, limit = 10 } = options;

    const authHeader = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    const params = new URLSearchParams({
        VoiceEnabled: 'true',
        SmsEnabled: 'false',  // We only need voice
        PageSize: limit.toString(),
    });

    if (areaCode) {
        params.set('AreaCode', areaCode);
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/${countryCode}/Local.json?${params}`;

    const response = await fetch(url, {
        headers: { 'Authorization': authHeader }
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Twilio search failed: ${error.message || response.statusText}`);
    }

    const data = await response.json();
    return data.available_phone_numbers || [];
}

/**
 * Purchase a phone number from Twilio
 */
export async function purchasePhoneNumber(phoneNumber) {
    const authHeader = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`,
        {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                PhoneNumber: phoneNumber,
                VoiceMethod: 'POST',
                // VoiceUrl will be set by VAPI after import
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Twilio purchase failed: ${error.message || response.statusText}`);
    }

    return await response.json();
}

/**
 * Import a Twilio phone number to VAPI
 */
export async function importToVapi(phoneNumber, twilioSid) {
    const response = await fetch(`${VAPI_API_URL}/phone-number`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${VAPI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            provider: 'twilio',
            number: phoneNumber,
            twilioAccountSid: TWILIO_ACCOUNT_SID,
            twilioAuthToken: TWILIO_AUTH_TOKEN,
            name: `Auto-provisioned ${phoneNumber}`,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`VAPI import failed: ${error.message || response.statusText}`);
    }

    return await response.json();
}

/**
 * Release/delete a phone number from Twilio
 */
export async function releasePhoneNumber(twilioSid) {
    const authHeader = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${twilioSid}.json`,
        {
            method: 'DELETE',
            headers: { 'Authorization': authHeader },
        }
    );

    return response.ok;
}

/**
 * Delete a phone number from VAPI
 */
export async function deleteFromVapi(phoneNumberId) {
    const response = await fetch(`${VAPI_API_URL}/phone-number/${phoneNumberId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${VAPI_API_KEY}`,
        },
    });

    return response.ok;
}

/**
 * Provision multiple phone numbers for a user
 * This is the main function called after payment
 */
export async function provisionPhoneNumbersForUser(supabase, userId, count, countryCode = 'IE') {
    console.log(`📞 Provisioning ${count} phone numbers for user ${userId} in ${countryCode}`);

    const results = {
        success: [],
        failed: [],
    };

    // Search for available numbers
    const availableNumbers = await searchAvailableNumbers(countryCode, { limit: count + 5 });

    if (availableNumbers.length < count) {
        throw new Error(`Not enough phone numbers available in ${countryCode}. Found: ${availableNumbers.length}, needed: ${count}`);
    }

    // Provision each number
    for (let i = 0; i < count; i++) {
        const availableNumber = availableNumbers[i];

        try {
            console.log(`  [${i + 1}/${count}] Purchasing ${availableNumber.phone_number}...`);

            // 1. Purchase from Twilio
            const twilioResult = await purchasePhoneNumber(availableNumber.phone_number);
            console.log(`    ✓ Purchased from Twilio: ${twilioResult.sid}`);

            // 2. Import to VAPI
            const vapiResult = await importToVapi(availableNumber.phone_number, twilioResult.sid);
            console.log(`    ✓ Imported to VAPI: ${vapiResult.id}`);

            // 3. Store in database
            const { data, error } = await supabase
                .from('user_phone_numbers')
                .insert({
                    user_id: userId,
                    phone_number: availableNumber.phone_number,
                    phone_number_id: vapiResult.id,
                    provider: 'twilio',
                    provider_sid: twilioResult.sid,
                    country_code: countryCode,
                    area_code: availableNumber.local_address_requirements?.area_code || null,
                    friendly_name: availableNumber.friendly_name,
                    metadata: {
                        twilio_sid: twilioResult.sid,
                        vapi_id: vapiResult.id,
                        capabilities: availableNumber.capabilities,
                        provisioned_at: new Date().toISOString(),
                    },
                })
                .select()
                .single();

            if (error) {
                throw new Error(`Database insert failed: ${error.message}`);
            }

            console.log(`    ✓ Stored in database: ${data.id}`);
            results.success.push(data);

        } catch (error) {
            console.error(`    ✗ Failed to provision ${availableNumber.phone_number}:`, error.message);
            results.failed.push({
                phone_number: availableNumber.phone_number,
                error: error.message,
            });
        }

        // Small delay between purchases to avoid rate limiting
        if (i < count - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log(`📞 Provisioning complete: ${results.success.length} success, ${results.failed.length} failed`);
    return results;
}

/**
 * Release all phone numbers for a user (on subscription cancel/downgrade)
 */
export async function releasePhoneNumbersForUser(supabase, userId, count = null) {
    console.log(`📞 Releasing ${count || 'all'} phone numbers for user ${userId}`);

    // Get user's phone numbers
    let query = supabase
        .from('user_phone_numbers')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

    if (count) {
        query = query.limit(count);
    }

    const { data: phoneNumbers, error } = await query;

    if (error) {
        throw new Error(`Failed to get user phone numbers: ${error.message}`);
    }

    const results = {
        released: [],
        failed: [],
    };

    for (const phoneNumber of phoneNumbers) {
        try {
            // 1. Delete from VAPI
            await deleteFromVapi(phoneNumber.phone_number_id);

            // 2. Release from Twilio
            if (phoneNumber.provider_sid) {
                await releasePhoneNumber(phoneNumber.provider_sid);
            }

            // 3. Update database (mark as released instead of delete for audit trail)
            await supabase
                .from('user_phone_numbers')
                .update({ status: 'released', updated_at: new Date().toISOString() })
                .eq('id', phoneNumber.id);

            results.released.push(phoneNumber);
        } catch (error) {
            console.error(`Failed to release ${phoneNumber.phone_number}:`, error.message);
            results.failed.push({
                phone_number: phoneNumber.phone_number,
                error: error.message,
            });
        }
    }

    return results;
}

/**
 * Check if provisioning is configured
 */
export function isProvisioningConfigured() {
    return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && VAPI_API_KEY);
}

export default {
    searchAvailableNumbers,
    purchasePhoneNumber,
    importToVapi,
    releasePhoneNumber,
    deleteFromVapi,
    provisionPhoneNumbersForUser,
    releasePhoneNumbersForUser,
    isProvisioningConfigured,
    COUNTRY_CONFIG,
};
