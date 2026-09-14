import { database as db } from '../db/database.js';
import { selectOutboundNumber, PhoneRoutingError } from './phoneRouting.js';

export const fleetConfigured = () => !!process.env.ASSISTANTFLEET_API_KEY;
export const outboundEnabled = () => process.env.VOICE_OUTBOUND_ENABLED === 'true';
export async function fleetResponse(path, options = {}) {
    if (!fleetConfigured()) throw Object.assign(new Error('AssistantFleet is not configured.'), { status: 503 });
    const base = new URL(process.env.ASSISTANTFLEET_API_URL || 'https://assistant.voicefleet.ai');
    if (base.protocol !== 'https:' || base.username || base.password) throw new Error('AssistantFleet requires an HTTPS base URL.');
    const response = await fetch(new URL(path, base), { ...options, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', ...options.headers, Authorization: `Bearer ${process.env.ASSISTANTFLEET_API_KEY}` } });
    if (!response.ok) {
        // Provider error payloads can include credentials/request details. Keep them server-side.
        throw Object.assign(new Error(`AssistantFleet request failed (${response.status}).`), { status: response.status >= 500 ? 502 : response.status });
    }
    return response;
}
export async function fleetRequest(path, options = {}) {
    const response = await fleetResponse(path, options);
    return response.status === 204 ? null : response.json();
}
export async function ownedAssistant(userId, id) {
    const { rows } = await db.query("SELECT id FROM vapi_assistants WHERE id=$1 AND user_id=$2 AND provider='assistantfleet'", [id, userId]);
    if (!rows.length) throw Object.assign(new Error('Assistant not found'), { status: 404 });
    return fleetRequest(`/assistants/${encodeURIComponent(id)}`);
}
const fields = ['name','instructions','first_message','model','voice','language','realtime_provider','voicemail_action','voicemail_message','turn_detection','turn_eagerness','end_call_enabled','live_settings'];
export function assistantInput(body) {
    const input = Object.fromEntries(fields.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw Object.assign(new Error('Give the voice agent a name (up to 120 characters).'), { status: 400 });
    if (input.instructions != null && (typeof input.instructions !== 'string' || input.instructions.length > 30000)) throw Object.assign(new Error('Instructions must be text, up to 30,000 characters.'), { status: 400 });
    if (input.live_settings != null) {
        const settings = input.live_settings;
        const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
        if (typeof settings !== 'object' || Array.isArray(settings)) fail('Live settings must be an object.');
        const allowed = ['backend_model','reasoning_effort','service_tier','max_output_tokens','voice_instructions','accent_instructions'];
        if (Object.keys(settings).some(key => !allowed.includes(key))) fail('Unknown Live setting.');
        for (const [key, values] of Object.entries({ backend_model:['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol'], reasoning_effort:['none','low','medium','high','xhigh','max'], service_tier:['default','fast'] })) {
            if (settings[key] !== undefined && !values.includes(settings[key])) fail(`Invalid Live ${key}.`);
        }
        if (settings.max_output_tokens !== undefined && (!Number.isInteger(settings.max_output_tokens) || settings.max_output_tokens < 1024 || settings.max_output_tokens > 32768)) fail('Live output tokens must be between 1024 and 32768.');
        for (const key of ['voice_instructions','accent_instructions']) if (settings[key] !== undefined && (typeof settings[key] !== 'string' || settings[key].length > 2000)) fail(`Invalid Live ${key}.`);
    }
    return input;
}
export async function createAssistant(userId, body) {
    const created = await fleetRequest('/assistants', { method: 'POST', body: JSON.stringify(assistantInput(body)) });
    try { await db.query("INSERT INTO vapi_assistants(id,user_id,provider) VALUES($1,$2,'assistantfleet')", [created.id,userId]); }
    catch (error) {
        await fleetRequest(`/assistants/${encodeURIComponent(created.id)}`, { method: 'DELETE' }).catch(() => {});
        throw error;
    }
    return created;
}

export async function dispatchFleetCall(userId, { phoneNumber, customerName, assistantId, productIdea, companyContext }) {
    // Always enforce the local dedicated-number registry before touching any carrier.
    const route = await selectOutboundNumber(db, userId, phoneNumber);
    if (!outboundEnabled()) throw new PhoneRoutingError('Outbound calling is disabled until dedicated ValidateCall numbers are configured.', 'OUTBOUND_DISABLED');
    if (!assistantId) throw Object.assign(new Error('Choose an AssistantFleet voice agent before calling.'), { status: 400 });
    const assistant = await ownedAssistant(userId, assistantId);
    // Confirm the explicit dedicated number still belongs to this tenant/provider.
    const bindings = await fleetRequest('/numbers');
    if (!bindings.some(item => String(item.phone_number).replace(/^\+/, '') === route.phone.phone_number.slice(1) && item.provider === 'telnyx')) {
        throw new PhoneRoutingError('The dedicated Telnyx number is not connected to AssistantFleet.');
    }
    const { rows: subscription } = await db.query("SELECT id FROM user_subscriptions WHERE user_id=$1 AND status='active' LIMIT 1", [userId]);
    let reserved = false, numberReserved = false, started = false;
    if (!subscription.length) {
        await db.query('INSERT INTO free_tier_usage(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [userId]);
        const { rows } = await db.query('UPDATE free_tier_usage SET calls_used=calls_used+1 WHERE user_id=$1 AND calls_used<calls_limit RETURNING calls_used', [userId]);
        if (!rows.length) throw Object.assign(new Error('Your call allowance has been used.'), { status: 403 });
        reserved = true;
    }
    try {
        const capacity = await db.query(`UPDATE user_phone_numbers SET daily_calls_used=daily_calls_used+1
            WHERE id=$1 AND user_id=$2 AND status='active' AND flagged_as_spam=false
            AND daily_calls_used<daily_calls_limit RETURNING id`, [route.phone.id,userId]);
        if (!capacity.rows.length) throw new PhoneRoutingError('This country’s calling numbers have reached their daily limit.', 'PHONE_CAPACITY_REACHED', 429);
        numberReserved = true;
        // Create a per-call snapshot only when campaign context is supplied. Never
        // patch a shared live assistant or change an inbound number binding.
        let selected = assistant;
        if (productIdea || companyContext) selected = await createAssistant(userId, {
            ...Object.fromEntries(fields.filter(key => assistant[key] != null).map(key => [key, assistant[key]])),
            name: `Campaign call — ${assistant.name}`.slice(0,120),
            instructions: `${assistant.instructions || ''}\n\nCAMPAIGN CONTEXT\n${productIdea || ''}\n${companyContext || ''}`,
        });
        started = true;
        const result = await fleetRequest('/calls/outbound', { method: 'POST', body: JSON.stringify({ assistant_id: selected.id, from: route.phone.phone_number, to: route.number }) });
        const id = result.call_sid || result.call_control_id;
        if (!id) throw new Error('Call outcome needs review: AssistantFleet returned no call identifier.');
        await db.query("INSERT INTO vapi_calls(id,user_id,provider) VALUES($1,$2,'assistantfleet')", [id,userId]);
        await db.query('UPDATE user_phone_numbers SET total_calls_made=total_calls_made+1 WHERE id=$1 AND user_id=$2', [route.phone.id,userId]);
        const saved = await db.from('calls').insert({ user_id:userId, vapi_call_id:id, phone_number:route.number,
            customer_name:customerName, outbound_phone_number:route.phone.phone_number, outbound_phone_number_id:route.phone.phone_number_id,
            status:'initiated', raw_response:{ ...result, provider:'assistantfleet', assistant_id:selected.id } });
        if (saved.error) throw new Error('Call started, but saving its record failed. Review before retrying.');
        return { ...result, id, provider:'assistantfleet', customer:{ number:route.number } };
    } catch (error) {
        // Timeouts and provider errors can leave an uncertain dial outcome. Never retry automatically.
        if (numberReserved && !started) await db.query('UPDATE user_phone_numbers SET daily_calls_used=GREATEST(0,daily_calls_used-1) WHERE id=$1 AND user_id=$2', [route.phone.id,userId]);
        if (reserved && !started) await db.query('UPDATE free_tier_usage SET calls_used=GREATEST(0,calls_used-1) WHERE user_id=$1', [userId]);
        error.providerRequestStarted = started;
        throw error;
    }
}
