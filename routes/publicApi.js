import { Router } from 'express';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { database } from '../db/database.js';
import { createApiKeyAuth, requireScope } from '../middleware/apiKeyAuth.js';
import { assistantInput, createAssistant, dispatchFleetCall, fleetRequest, fleetResponse, ownedAssistant } from '../services/assistantFleet.js';
import { availableUserNumbers, callerNumberOptions, phoneReadiness } from '../services/phoneRouting.js';
import { historyRows, presentCall, providerCall, refreshCallAnalytics } from '../services/callHistory.js';
import { openApiDocument } from '../services/openApi.js';
import { researchConfigured, researchWeb, validateResearchInput } from '../services/webResearch.js';

const router = Router();
const safeError = error => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error('Developer API request failed:', error);
    return {
        status,
        body: { error: {
            code: error.code || (status===404?'not_found':status>=500?'internal_error':'request_failed'),
            message: status>=500 ? 'The request could not be completed.' : error.message,
        } },
    };
};
const handler = fn => async (req,res) => {
    try { await fn(req,res); }
    catch (error) {
        const failure=safeError(error);
        res.status(failure.status).json(failure.body);
    }
};
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const limit = value => Math.max(1,Math.min(100,Number(value)||50));
const offset = value => Math.max(0,Math.min(100000,Number(value)||0));
const withoutUser = row => { if (!row) return row; const { user_id, raw_response, ...safe }=row; return safe; };
const fail = (message,status=400,code='invalid_request') => { throw Object.assign(new Error(message),{status,code}); };
const requireOwned = async (table,id,userId,label) => {
    if (!uuid(id)) fail(`Invalid ${label} ID.`);
    const { rows }=await database.query(`SELECT * FROM ${table} WHERE id=$1 AND user_id=$2`,[id,userId]);
    if (!rows[0]) fail(`${label} not found.`,404,'not_found');
    return rows[0];
};
const page = (data,req,total=null) => ({ data:data.map(withoutUser), pagination:{ limit:limit(req.query.limit), offset:offset(req.query.offset), count:data.length, total } });
const apiBase = req => (process.env.PUBLIC_API_URL || `${process.env.NODE_ENV==='production'?'https':req.protocol}://${req.get('host')}/v1`).replace(/\/$/,'');
const publicCall = (row,req) => {
    const presented=presentCall(row,'');
    const {user_id,recordingUrl,...safe}=presented;
    const recording=presented.recording_url ? `${apiBase(req)}/calls/${encodeURIComponent(row.id)}/recording` : null;
    return {...safe,recording_url:recording};
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
let activeResearchJobs=0;

router.get('/health', (_req,res) => res.json({ status:'ok', version:'1.0.0', time:new Date().toISOString() }));
router.get('/openapi.json', (_req,res) => res.json(openApiDocument));
router.use(createApiKeyAuth());

router.get('/account', (req,res) => res.json({
    id:req.user.id, email:req.user.email, name:req.user.full_name || null,
    api_key:{ id:req.apiKey.id, name:req.apiKey.name, scopes:req.apiKey.scopes, rate_limit_per_minute:req.apiKey.rateLimit },
}));

router.post('/research/leads', requireScope('research:write'), handler(async (req,res) => {
    if(!researchConfigured())fail('Web research is not configured.',503,'research_unavailable');
    if(activeResearchJobs>=2)fail('Two research jobs are already running. Try again shortly.',429,'research_busy');
    const controller=new AbortController();
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};
    res.on('close',disconnect);
    activeResearchJobs++;
    try {
        const input=validateResearchInput(req.body || {});
        const {data:allowed,error}=await database.rpc('reserve_research_request',{
            p_user_id:req.user.id,
            p_user_limit:Math.min(100,Math.max(1,Number(process.env.RESEARCH_DAILY_USER_LIMIT)||20)),
            p_global_limit:Math.min(10000,Math.max(1,Number(process.env.RESEARCH_DAILY_GLOBAL_LIMIT)||200)),
        });
        if(error)fail('Research budget is unavailable.',503,'research_unavailable');
        if(!allowed)fail('Daily research limit reached.',429,'research_limit_reached');
        res.json(await researchWeb(input,{mode:'leads',signal:controller.signal}));
    }
    finally { activeResearchJobs--;res.off('close',disconnect); }
}));

router.get('/leads', requireScope('data:read'), handler(async (req,res) => {
    const values=[req.user.id]; let where='user_id=$1';
    if(req.query.status){values.push(req.query.status);where+=` AND status=$${values.length}`;}
    if(req.query.has_phone==='true')where+=' AND phone IS NOT NULL';
    values.push(limit(req.query.limit),offset(req.query.offset));
    const {rows}=await database.query(`SELECT * FROM leads WHERE ${where} ORDER BY created_at DESC,id LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    const {rows:counts}=await database.query(`SELECT count(*)::int AS total FROM leads WHERE ${where}` ,values.slice(0,-2));
    res.json(page(rows,req,counts[0].total));
}));
router.get('/leads/:id', requireScope('data:read'), handler(async (req,res) => res.json(withoutUser(await requireOwned('leads',req.params.id,req.user.id,'lead')))));
router.post('/leads', requireScope('data:write'), handler(async (req,res) => {
    const input=Array.isArray(req.body?.leads)?req.body.leads:[req.body];
    if(!input.length || input.length>100)fail('Provide between 1 and 100 leads.');
    const allowed=['name','phone','email','address','city','website','rating','review_count','category','place_id','google_maps_url','source','source_url','source_excerpt','retrieved_at','search_keyword','search_location','status','notes','tags'];
    const rows=input.map(item=>{
        if(!item || typeof item.name!=='string' || !item.name.trim())fail('Every lead needs a name.');
        return Object.fromEntries(allowed.filter(key=>item[key]!==undefined).map(key=>[key,key==='name'?item[key].trim():item[key]]));
    });
    const saved=await database.forUser(req.user.id).from('leads').insert(rows).select();
    if(saved.error)throw new Error(saved.error.message);
    res.status(201).json({data:saved.data.map(withoutUser)});
}));
router.patch('/leads/:id', requireScope('data:write'), handler(async (req,res) => {
    await requireOwned('leads',req.params.id,req.user.id,'lead');
    const allowed=['name','phone','email','address','city','website','category','status','notes','tags'];
    const updates=Object.fromEntries(allowed.filter(key=>req.body[key]!==undefined).map(key=>[key,req.body[key]]));
    if(!Object.keys(updates).length)fail('No supported lead fields were supplied.');
    const result=await database.forUser(req.user.id).from('leads').update(updates).eq('id',req.params.id).select().single();
    if(result.error)throw new Error(result.error.message);
    res.json(withoutUser(result.data));
}));
router.delete('/leads/:id', requireScope('data:write'), handler(async (req,res) => {
    if(!uuid(req.params.id))fail('Invalid lead ID.');
    const {rows}=await database.query('DELETE FROM leads WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.user.id]);
    if(!rows[0])fail('Lead not found.',404,'not_found');
    res.json({deleted:true,id:rows[0].id});
}));

router.get('/campaigns', requireScope('data:read'), handler(async (req,res) => {
    const size=limit(req.query.limit),start=offset(req.query.offset);
    const {rows}=await database.query('SELECT * FROM campaigns WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[req.user.id,size,start]);
    const {rows:counts}=await database.query('SELECT count(*)::int AS total FROM campaigns WHERE user_id=$1',[req.user.id]);
    res.json(page(rows,req,counts[0].total));
}));
router.get('/campaigns/:id', requireScope('data:read'), handler(async (req,res) => res.json(withoutUser(await requireOwned('campaigns',req.params.id,req.user.id,'campaign')))));
router.post('/campaigns', requireScope('data:write'), handler(async (req,res) => {
    if(typeof req.body?.name!=='string'||!req.body.name.trim())fail('Campaign name is required.');
    if(typeof req.body?.product_idea!=='string'||!req.body.product_idea.trim())fail('product_idea is required.');
    const leadIds=Array.isArray(req.body.lead_ids)?req.body.lead_ids:[];
    for(const id of leadIds)await requireOwned('leads',id,req.user.id,'lead');
    if(req.body.selected_agent_id)await ownedAssistant(req.user.id,req.body.selected_agent_id);
    const row={name:req.body.name.trim(),product_idea:req.body.product_idea,company_context:req.body.company_context||null,status:req.body.status||'draft',
        total_leads:leadIds.length,lead_ids:leadIds,selected_agent_id:req.body.selected_agent_id||null,sender_name:req.body.sender_name||null,
        sender_email:req.body.sender_email||null,email_subject:req.body.email_subject||null,email_body:req.body.email_body||null,cta_text:req.body.cta_text||null,cta_url:req.body.cta_url||null};
    const saved=await database.forUser(req.user.id).from('campaigns').insert(row).select().single();
    if(saved.error)throw new Error(saved.error.message);
    res.status(201).json(withoutUser(saved.data));
}));
router.patch('/campaigns/:id', requireScope('data:write'), handler(async (req,res) => {
    await requireOwned('campaigns',req.params.id,req.user.id,'campaign');
    const allowed=['name','product_idea','company_context','status','lead_ids','selected_agent_id','sender_name','sender_email','email_subject','email_body','cta_text','cta_url'];
    const updates=Object.fromEntries(allowed.filter(key=>req.body[key]!==undefined).map(key=>[key,req.body[key]]));
    if(updates.lead_ids){if(!Array.isArray(updates.lead_ids))fail('lead_ids must be an array.');for(const id of updates.lead_ids)await requireOwned('leads',id,req.user.id,'lead');updates.total_leads=updates.lead_ids.length;}
    if(updates.selected_agent_id)await ownedAssistant(req.user.id,updates.selected_agent_id);
    if(!Object.keys(updates).length)fail('No supported campaign fields were supplied.');
    const saved=await database.forUser(req.user.id).from('campaigns').update(updates).eq('id',req.params.id).select().single();
    if(saved.error)throw new Error(saved.error.message);
    res.json(withoutUser(saved.data));
}));
router.delete('/campaigns/:id', requireScope('data:write'), handler(async (req,res) => {
    if(!uuid(req.params.id))fail('Invalid campaign ID.');
    const {rows}=await database.query('DELETE FROM campaigns WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.user.id]);
    if(!rows[0])fail('Campaign not found.',404,'not_found');
    res.json({deleted:true,id:rows[0].id});
}));
router.post('/campaigns/:id/recalculate', requireScope('data:write'), handler(async (req,res) => {
    await requireOwned('campaigns',req.params.id,req.user.id,'campaign');
    const {rows}=await database.query(`UPDATE campaigns campaign SET
        calls_made=stats.calls_made,
        calls_completed=stats.calls_completed,
        calls_failed=stats.calls_failed
        FROM (SELECT count(*)::int AS calls_made,
            count(*) FILTER (WHERE status='completed')::int AS calls_completed,
            count(*) FILTER (WHERE status IN ('failed','no-answer','busy','canceled','cancelled'))::int AS calls_failed
            FROM calls WHERE user_id=$1 AND campaign_id=$2) stats
        WHERE campaign.id=$2 AND campaign.user_id=$1 RETURNING campaign.*`,[req.user.id,req.params.id]);
    await database.query(`UPDATE leads lead SET
        call_count=stats.call_count,
        last_called_at=stats.last_called_at
        FROM (SELECT lead_id,count(*)::int AS call_count,max(created_at) AS last_called_at
            FROM calls WHERE user_id=$1 AND lead_id IS NOT NULL GROUP BY lead_id) stats
        WHERE lead.id=stats.lead_id AND lead.user_id=$1`,[req.user.id]);
    res.json(withoutUser(rows[0]));
}));

router.get('/assistants', requireScope('assistants:read'), handler(async (req,res) => {
    const {rows}=await database.query("SELECT id FROM vapi_assistants WHERE user_id=$1 AND provider='assistantfleet' ORDER BY created_at DESC",[req.user.id]);
    const data=await Promise.all(rows.map(row=>ownedAssistant(req.user.id,row.id)));
    res.json({data});
}));
router.get('/assistants/:id', requireScope('assistants:read'), handler(async (req,res) => res.json(await ownedAssistant(req.user.id,req.params.id))));
router.post('/assistants', requireScope('assistants:write'), handler(async (req,res) => res.status(201).json(await createAssistant(req.user.id,req.body))));
router.patch('/assistants/:id', requireScope('assistants:write'), handler(async (req,res) => {
    const current=await ownedAssistant(req.user.id,req.params.id);
    res.json(await fleetRequest(`/assistants/${encodeURIComponent(req.params.id)}`,{method:'PATCH',body:JSON.stringify(assistantInput({...current,...req.body}))}));
}));
router.delete('/assistants/:id', requireScope('assistants:write'), handler(async (req,res) => {
    await ownedAssistant(req.user.id,req.params.id);
    await fleetRequest(`/assistants/${encodeURIComponent(req.params.id)}`,{method:'DELETE'});
    await database.query("DELETE FROM vapi_assistants WHERE id=$1 AND user_id=$2 AND provider='assistantfleet'",[req.params.id,req.user.id]);
    await database.query('UPDATE campaigns SET selected_agent_id=NULL WHERE user_id=$1 AND selected_agent_id=$2',[req.user.id,req.params.id]);
    res.json({deleted:true});
}));

router.get('/phone-numbers', requireScope('calls:read','calls:write'), handler(async (req,res) => {
    if(req.query.destination)return res.json(await callerNumberOptions(database,req.user.id,req.query.destination));
    const numbers=await availableUserNumbers(database,req.user.id);
    res.json({data:numbers.map(number=>({id:number.id,phone_number:number.phone_number,country:number.country_code,available:number.used_today<number.daily_calls_limit,
        remaining_today:number.daily_calls_limit===2147483647?null:Math.max(0,number.daily_calls_limit-number.used_today),unlimited_daily_calls:number.daily_calls_limit===2147483647}))});
}));
router.post('/phone-numbers/readiness', requireScope('calls:read','calls:write'), handler(async (req,res) => {
    const values=req.body?.phone_numbers;
    if(!Array.isArray(values)||!values.length||values.length>100)fail('Provide 1 to 100 phone_numbers.');
    res.json(await phoneReadiness(database,req.user.id,values));
}));

router.get('/calls', requireScope('calls:read'), handler(async (req,res) => {
    const rows=await historyRows(req.user.id,{limit:limit(req.query.limit)});
    await refreshCallAnalytics(rows);
    const data=rows.map(row=>publicCall(row,req));
    res.json({data});
}));
router.get('/calls/:id', requireScope('calls:read'), handler(async (req,res) => {
    const rows=await historyRows(req.user.id,{id:req.params.id});
    if(!rows[0])fail('Call not found.',404,'not_found');
    await refreshCallAnalytics(rows);
    res.json(publicCall(rows[0],req));
}));
router.get('/calls/:id/recording', requireScope('recordings:read'), handler(async (req,res) => {
    const rows=await historyRows(req.user.id,{id:req.params.id});const row=rows[0];
    if(!row)fail('Call not found.',404,'not_found');
    const call=providerCall(row);
    if(!call.id||!call.recording_available||row.raw_response?.provider!=='assistantfleet')fail('Recording is not available for this call.',404,'not_found');
    const range=req.get('range');if(range&&!/^bytes=\d*-\d*$/.test(range))return res.status(416).end();
    const upstream=await fleetResponse(`/calls/${encodeURIComponent(call.id)}/recording`,{headers:range?{Range:range}:{}});
    res.status(upstream.status).set({'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    for(const name of ['content-length','content-range','accept-ranges'])if(upstream.headers.get(name))res.set(name,upstream.headers.get(name));
    try { await pipeline(Readable.fromWeb(upstream.body),res); }
    catch { if(!res.destroyed)res.destroy(); }
}));

router.post('/calls', requireScope('calls:write'), handler(async (req,res) => {
    const idempotencyKey=req.get('idempotency-key');
    if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)fail('Provide an Idempotency-Key header between 8 and 200 characters.');
    const requestHash=createHash('sha256').update(JSON.stringify(canonical(req.body||{}))).digest('hex');
    await database.query('DELETE FROM api_idempotency WHERE user_id=$1 AND idempotency_key=$2 AND expires_at<=now()',[req.user.id,idempotencyKey]);
    const reservation=await database.query(`INSERT INTO api_idempotency(user_id,api_key_id,idempotency_key,request_hash)
        VALUES($1,$2,$3,$4) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING idempotency_key`,
        [req.user.id,req.apiKey.id,idempotencyKey,requestHash]);
    if(!reservation.rows.length){
        const existing=await database.query('SELECT request_hash,response_status,response_body FROM api_idempotency WHERE user_id=$1 AND idempotency_key=$2',[req.user.id,idempotencyKey]);
        if(existing.rows[0]?.request_hash!==requestHash)fail('This Idempotency-Key was already used with a different request.',409,'idempotency_conflict');
        if(existing.rows[0]?.response_status==null)fail('A request with this Idempotency-Key is already in progress.',409,'request_in_progress');
        res.set('Idempotent-Replayed','true').status(existing.rows[0].response_status).json(existing.rows[0].response_body);return;
    }
    let status=201,body;
    try{
        let lead=null,campaign=null;
        if(req.body.lead_id)lead=await requireOwned('leads',req.body.lead_id,req.user.id,'lead');
        if(req.body.campaign_id)campaign=await requireOwned('campaigns',req.body.campaign_id,req.user.id,'campaign');
        const phoneNumber=req.body.phone_number||lead?.phone;if(!phoneNumber)fail('phone_number is required when the lead has no phone.');
        if(lead?.status==='do_not_contact')fail('This lead is marked do not contact.',409,'contact_suppressed');
        if(lead?.phone&&req.body.phone_number&&lead.phone!==req.body.phone_number)fail('phone_number must match the selected lead.',409,'lead_phone_mismatch');
        const suppressed=await database.query("SELECT id FROM leads WHERE user_id=$1 AND phone=$2 AND status='do_not_contact' LIMIT 1",[req.user.id,phoneNumber]);
        if(suppressed.rows.length)fail('This phone number is marked do not contact.',409,'contact_suppressed');
        if(lead&&campaign&&!(campaign.lead_ids||[]).some(id=>String(id)===String(lead.id)))fail('The lead is not assigned to this campaign.',409,'campaign_lead_mismatch');
        const recent=await database.query(`SELECT id FROM calls WHERE user_id=$1 AND phone_number=$2
            AND created_at>now()-interval '5 minutes' AND status IN ('initiated','queued','ringing','in-progress') LIMIT 1`,[req.user.id,phoneNumber]);
        if(recent.rows.length)fail('A call to this number was already started in the last five minutes.',409,'recent_duplicate_call');
        const assistantId=req.body.assistant_id||campaign?.selected_agent_id;if(!assistantId)fail('assistant_id is required when the campaign has no selected assistant.');
        const result=await dispatchFleetCall(req.user.id,{phoneNumber,customerName:req.body.customer_name||lead?.name,
            assistantId,productIdea:req.body.product_idea??campaign?.product_idea,companyContext:req.body.company_context??campaign?.company_context,fromNumberId:req.body.from_number_id});
        if(lead||campaign)await database.query(`WITH linked AS (
                UPDATE calls SET lead_id=$1,campaign_id=$2
                WHERE user_id=$3 AND vapi_call_id=$4 AND lead_id IS NULL AND campaign_id IS NULL RETURNING id
            ), lead_updated AS (
                UPDATE leads SET call_count=COALESCE(call_count,0)+1,last_called_at=now(),
                    status=CASE WHEN status='new' THEN 'contacted' ELSE status END
                WHERE id=$1 AND user_id=$3 AND EXISTS (SELECT 1 FROM linked) RETURNING id
            )
            UPDATE campaigns SET calls_made=COALESCE(calls_made,0)+1
            WHERE id=$2 AND user_id=$3 AND EXISTS (SELECT 1 FROM linked)`,
            [lead?.id||null,campaign?.id||null,req.user.id,result.id]);
        const rows=await historyRows(req.user.id,{id:result.id});
        body=rows[0]?publicCall(rows[0],req):{id:result.id,status:'initiated',customer:result.customer};
    }catch(error){const failure=safeError(error);status=failure.status;body=failure.body;}
    await database.query('UPDATE api_idempotency SET response_status=$1,response_body=$2::jsonb WHERE user_id=$3 AND idempotency_key=$4',[status,JSON.stringify(body),req.user.id,idempotencyKey]);
    res.status(status).json(body);
}));

export default router;
