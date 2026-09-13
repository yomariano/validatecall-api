import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export class PhoneRoutingError extends Error {
    constructor(message, code = 'PHONE_SETUP_REQUIRED', status = 409) {
        super(message); this.code = code; this.status = status;
    }
}

export function destinationPhone(value) {
    const parsed = typeof value === 'string' && value.trim().startsWith('+')
        ? parsePhoneNumberFromString(value.trim(), { extract: false }) : null;
    if (!parsed || !parsed.isPossible() || parsed.ext || !parsed.country) {
        throw new PhoneRoutingError('Enter an international phone number with a country code, for example +12025550123. A destination country must be identifiable.', 'INVALID_PHONE_NUMBER', 400);
    }
    return { number: parsed.number, country: parsed.country };
}

export async function availableUserNumbers(db, userId) {
    const { rows } = await db.query(`SELECT *,
        CASE WHEN last_reset_date < CURRENT_DATE THEN 0 ELSE daily_calls_used END AS used_today
        FROM user_phone_numbers WHERE user_id=$1 AND provider='telnyx'
        AND voice_provider='assistantfleet' AND status='active' AND flagged_as_spam=false
        ORDER BY used_today, created_at, id`, [userId]);
    return rows;
}

export function chooseCountryNumber(numbers, destination) {
    const matching = numbers.filter(number => number.country_code === destination.country);
    if (!matching.length) throw new PhoneRoutingError(`Connect a Telnyx number for ${destination.country} before calling this destination.`);
    const number = matching.find(number => number.used_today < number.daily_calls_limit);
    if (!number) throw new PhoneRoutingError(`The Telnyx numbers for ${destination.country} have reached their daily call limit.`, 'PHONE_CAPACITY_REACHED', 429);
    return number;
}

export async function selectOutboundNumber(db, userId, value) {
    const destination = destinationPhone(value);
    // Preserve the existing usage counter's daily reset for every dispatch path.
    await db.query(`UPDATE user_phone_numbers SET daily_calls_used=0, last_reset_date=CURRENT_DATE
        WHERE user_id=$1 AND last_reset_date<CURRENT_DATE`, [userId]);
    const phone = chooseCountryNumber(await availableUserNumbers(db, userId), destination);
    return { ...destination, phone };
}

export async function phoneReadiness(db, userId, values) {
    const numbers = await availableUserNumbers(db, userId);
    const destinations = values.map(value => {
        let destination;
        try {
            destination = destinationPhone(value);
            const phone = chooseCountryNumber(numbers, destination);
            // Simulate the complete batch, so one remaining slot cannot cover ten leads.
            phone.used_today++;
            return { ...destination, ready: true, callerNumber: phone.phone_number };
        } catch (error) {
            if (!(error instanceof PhoneRoutingError)) throw error;
            return { number: value, country: destination?.country || null, ready: false, code: error.code, error: error.message };
        }
    });
    return { ready: destinations.length > 0 && destinations.every(item => item.ready), destinations };
}
