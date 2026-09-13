/** Dedicated Telnyx numbers are connected explicitly; subscriptions never buy,
 * reassign, or release numbers from the shared carrier account. */
export async function provisionPhoneNumbersForUser(_db, _userId, count, countryCode) {
    return { success: [], failed: Array.from({ length: Math.max(0, Math.min(100, Number(count) || 0)) }, () => ({
        error: 'Connect a dedicated Telnyx number to the ValidateCall AssistantFleet account.', country: countryCode || null
    })) };
}
export async function releasePhoneNumbersForUser() {
    return { released: [], failed: [], message: 'Dedicated numbers require operator review; no carrier resources were changed.' };
}
export function isProvisioningConfigured() { return false; }
export default { provisionPhoneNumbersForUser, releasePhoneNumbersForUser, isProvisioningConfigured };
