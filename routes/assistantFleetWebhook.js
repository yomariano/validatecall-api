import { createHmac, timingSafeEqual } from 'node:crypto';
import { database as db } from '../db/database.js';
export async function assistantFleetWebhook(req,res) {
    const secret=process.env.ASSISTANTFLEET_WEBHOOK_SECRET;
    if(!secret)return res.status(503).json({error:'Webhook is not configured.'});
    const signature=req.get('x-assistantfleet-signature')||'';
    const expected='sha256='+createHmac('sha256',secret).update(req.body).digest('hex');
    if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return res.status(401).json({error:'Invalid signature.'});
    let event;try{event=JSON.parse(req.body);}catch{return res.status(400).json({error:'Invalid JSON.'});}
    if(event.event!=='call.ended')return res.json({received:true});
    const call=event.data;
    if(!call?.id||!call.assistant_id||!event.delivery)return res.status(400).json({error:'Missing call identity.'});
    try {
        // Both the agent and the dial ID must belong to a locally recorded call.
        // Never import unrelated client calls from an upstream shared account.
        const {rows}=await db.query(`UPDATE calls c SET status='completed', ended_at=$1,
            duration_seconds=$2, transcript_json=$3, transcript=$4, ended_reason=$5, raw_response=c.raw_response || $6::jsonb
            FROM vapi_assistants a WHERE a.id=$7 AND a.provider='assistantfleet' AND a.user_id=c.user_id
            AND c.raw_response->>'provider'='assistantfleet'
            AND (c.vapi_call_id=$8 OR c.raw_response->>'call_control_id'=$9)
            RETURNING c.id`, [call.ended_at||null,Math.max(0,Math.round(Number(call.duration_seconds)||0)),JSON.stringify(call.transcript||[]),
                (call.transcript||[]).map(item=>`${item.role}: ${item.text}`).join('\n'),call.ended_reason||null,
                JSON.stringify({assistantfleet_call:call}),call.assistant_id,call.id,call.telnyx_call_control_id||null]);
        // Updates are idempotent, including provider redelivery after a timeout.
        res.json({received:true,matched:rows.length});
    }catch{res.status(503).json({error:'Unable to save call event.'});}
}
