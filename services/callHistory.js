import { database as db } from '../db/database.js';
import { fleetConfigured, fleetRequest } from './assistantFleet.js';

const columns = `SELECT c.*, l.name AS business_name, l.email AS business_email, l.status AS lead_status
 FROM calls c LEFT JOIN leads l ON l.id=c.lead_id AND l.user_id=c.user_id`;
export async function historyRows(userId, { id, limit=100 } = {}) {
    const { rows } = await db.query(`${columns} WHERE c.user_id=$1 ${id ? 'AND (c.id::text=$2 OR c.vapi_call_id=$2)' : ''}
        ORDER BY c.created_at DESC LIMIT ${id ? '1' : '$2'}`, [userId,id || Math.max(1,Math.min(100,Number(limit)||100))]);
    return rows;
}
export const providerCall = row => row.raw_response?.assistantfleet_call || {};

// Analytics finish after the end-of-call webhook. Refresh only locally owned
// calls, matching both their assistant and their signed call identity.
export async function refreshCallAnalytics(rows) {
    const candidates=rows.filter(row=>row.raw_response?.provider==='assistantfleet');
    if (!candidates.length || !fleetConfigured()) return;
    const dates=candidates.map(row=>new Date(row.created_at).getTime()).filter(Number.isFinite);
    if (!dates.length) return;
    const params=new URLSearchParams({limit:'100',date_from:new Date(Math.min(...dates)-86400000).toISOString(),date_to:new Date(Math.max(...dates)+86400000).toISOString()});
    const pending=new Map(candidates.map(row=>[row.id,row]));
    for(let page=1;page<=20 && pending.size;page++) {
        const result=await fleetRequest(`/calls?${params}&page=${page}`);
        const calls=Array.isArray(result)?result:result.calls || [];
        for(const call of calls) {
            const row=[...pending.values()].find(row=>call.assistant_id===row.raw_response.assistant_id &&
                (call.id===providerCall(row).id || (call.telnyx_call_control_id && call.telnyx_call_control_id===(row.raw_response.call_control_id || row.vapi_call_id))));
            if(!row) continue;
            const stored=Object.fromEntries(['id','assistant_id','telnyx_call_control_id','recording_available','summary','sentiment','outcome','action_items','analytics_at','started_at','ended_at','duration_seconds','transcript','ended_reason'].map(key=>[key,call[key]]));
            await db.query(`UPDATE calls SET summary=COALESCE($1,summary), sentiment=COALESCE($2,sentiment),
                raw_response=raw_response || $3::jsonb WHERE id=$4 AND user_id=$5`,
                [call.summary||null,call.sentiment||null,JSON.stringify({assistantfleet_call:stored}),row.id,row.user_id]);
            row.summary=call.summary || row.summary;
            row.raw_response={...row.raw_response,assistantfleet_call:stored};
            pending.delete(row.id);
        }
        if(Array.isArray(result) || page >= (result.pagination?.total_pages || 1)) break;
    }
}

export function presentCall(row, apiBase='') {
    const upstream=providerCall(row);
    const {raw_response, ...safe}=row; // Provider payloads may contain signed URLs.
    const messages=Array.isArray(row.transcript_json)?row.transcript_json:Array.isArray(upstream.transcript)?upstream.transcript:[];
    const summary=row.summary || upstream.summary || null;
    const suppressed=row.lead_status==='do_not_contact';
    const actionItems=suppressed ? ['Do not contact this business again.'] : (Array.isArray(upstream.action_items)?upstream.action_items.filter(x=>typeof x==='string'):[]);
    const recording=upstream.id && upstream.recording_available ? `${apiBase}/api/voice/calls/${encodeURIComponent(row.id)}/recording` : null;
    return {...safe, customer_name:row.business_name || row.customer_name, business_email:row.business_email || null,
        customer:{number:row.phone_number,name:row.business_name || row.customer_name},
        createdAt:row.created_at, duration:row.duration_seconds, messages:messages.map(m=>({...m,message:m.text || m.message})),
        summary,analysis:{summary},recording_url:recording,recordingUrl:recording,
        call_outcome:suppressed?'do_not_contact':row.call_outcome || upstream.outcome || null,
        action_items:actionItems,contact_allowed:!suppressed,
    };
}
