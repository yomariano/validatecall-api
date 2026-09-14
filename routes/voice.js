import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { historyRows, refreshCallAnalytics, presentCall, providerCall } from '../services/callHistory.js';
import { database as db } from '../db/database.js';
import { requireOwnUser } from '../middleware/auth.js';
import { availableUserNumbers, destinationPhone } from '../services/phoneRouting.js';
import { fleetConfigured, fleetRequest, fleetResponse, ownedAssistant, createAssistant, assistantInput, dispatchFleetCall } from '../services/assistantFleet.js';
const router = Router();
router.param('userId', requireOwnUser);
const handler = fn => async (req,res) => { try { await fn(req,res); } catch (error) { res.status(error.status || 500).json({ error:error.message, code:error.code }); } };
router.get('/status', (req,res) => res.json({ configured:fleetConfigured(), provider:'assistantfleet' }));
router.post('/webhook', (req,res) => res.status(503).json({ error:'Legacy voice webhooks are disabled.' }));
router.get('/assistants', handler(async (req,res) => {
    const { rows } = await db.query("SELECT id FROM vapi_assistants WHERE user_id=$1 AND provider='assistantfleet' ORDER BY created_at DESC", [req.user.id]);
    const assistants = await Promise.all(rows.map(row => ownedAssistant(req.user.id,row.id)));
    res.json(assistants);
}));
router.post('/assistants', handler(async (req,res) => res.status(201).json(await createAssistant(req.user.id,req.body))));
router.get('/assistants/:id', handler(async (req,res) => res.json(await ownedAssistant(req.user.id,req.params.id))));
router.patch('/assistants/:id', handler(async (req,res) => {
    await ownedAssistant(req.user.id,req.params.id);
    res.json(await fleetRequest(`/assistants/${encodeURIComponent(req.params.id)}`, { method:'PATCH', body:JSON.stringify(assistantInput(req.body)) }));
}));
router.delete('/assistants/:id', handler(async (req,res) => {
    await ownedAssistant(req.user.id,req.params.id);
    await fleetRequest(`/assistants/${encodeURIComponent(req.params.id)}`, { method:'DELETE' });
    await db.query("DELETE FROM vapi_assistants WHERE id=$1 AND user_id=$2 AND provider='assistantfleet'", [req.params.id,req.user.id]);
    res.json({ deleted:true });
}));
router.post('/assistants/:id/test-token', handler(async (req,res) => {
    await ownedAssistant(req.user.id,req.params.id);
    res.json(await fleetRequest(`/assistants/${encodeURIComponent(req.params.id)}/test-token`, {
        method:'POST', body:JSON.stringify({ ttl_seconds:300, max_duration_seconds:120 }) }));
}));
router.get('/voices', (req,res) => res.json({ openai:[{id:'marin',name:'Marin'},{id:'cedar',name:'Cedar'}], gemini:[{id:'Aoede',name:'Aoede'}] }));
async function phoneStats(req,res) {
    const numbers = await availableUserNumbers(db,req.user.id);
    res.json({ totalNumbers:numbers.length, activeNumbers:numbers.length,
        totalDailyCapacity:numbers.reduce((sum,n)=>sum+n.daily_calls_limit,0),
        usedToday:numbers.reduce((sum,n)=>sum+n.used_today,0),
        remainingToday:numbers.reduce((sum,n)=>sum+Math.max(0,n.daily_calls_limit-n.used_today),0),
        numbers:numbers.map(n=>({id:n.id,phoneNumber:n.phone_number,country:n.country_code,dailyCallsUsed:n.used_today,dailyCallsLimit:n.daily_calls_limit})) });
}
router.get('/user/:userId/phone-stats', handler(phoneStats));
router.get('/user/:userId/phone-numbers', handler(phoneStats));
router.post(['/call','/user/:userId/call'], handler(async (req,res) => res.json(await dispatchFleetCall(req.user.id,req.body))));
router.post(['/calls/batch','/user/:userId/calls/batch'], handler(async (req,res) => {
    const { phoneNumbers, productIdea, companyContext, assistantId } = req.body;
    if (!Array.isArray(phoneNumbers) || !phoneNumbers.length || phoneNumbers.length>100) return res.status(400).json({error:'Provide 1–100 destinations.'});
    const results=[];
    for (const item of phoneNumbers) {
        try { const result=await dispatchFleetCall(req.user.id,{phoneNumber:item?.number,customerName:item?.name,productIdea,companyContext,assistantId});
            results.push({phoneNumber:item?.number,status:'initiated',callId:result.id,result}); }
        catch(error) { results.push({phoneNumber:item?.number,status:'failed',error:error.message}); }
    }
    res.json({results,summary:{total:results.length,initiated:results.filter(r=>r.status==='initiated').length,failed:results.filter(r=>r.status==='failed').length}});
}));
router.get('/calls', handler(async (req,res) => {
    const rows=await historyRows(req.user.id,{limit:req.query.limit});
    let analyticsUnavailable=false;
    try { await refreshCallAnalytics(rows); } catch { analyticsUnavailable=true; }
    res.set('Cache-Control','private, no-store').json(rows.map(row=>({...presentCall(row,apiBase(req)),analytics_unavailable:analyticsUnavailable})));
}));
const apiBase=req=>`${process.env.NODE_ENV==='production'?'https':req.protocol}://${req.get('host')}`;
router.get('/calls/:id', handler(async (req,res) => {
    const [row]=await historyRows(req.user.id,{id:req.params.id});
    if(!row) return res.status(404).json({error:'Call not found'});
    res.set('Cache-Control','private, no-store').json(presentCall(row,apiBase(req)));
}));
router.get('/calls/:id/recording', handler(async (req,res) => {
    const [row]=await historyRows(req.user.id,{id:req.params.id});
    if(!row) return res.status(404).json({error:'Call not found'});
    const call=providerCall(row);
    if(!call.id || !call.recording_available || row.raw_response?.provider!=='assistantfleet') return res.status(404).json({error:'Recording is not available for this call.'});
    const range=req.get('range');
    if(range && !/^bytes=\d*-\d*$/.test(range)) return res.status(416).end();
    const upstream=await fleetResponse(`/calls/${encodeURIComponent(call.id)}/recording`,{headers:range?{Range:range}:{}});
    res.status(upstream.status).set({'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    for(const name of ['content-length','content-range','accept-ranges']) if(upstream.headers.get(name)) res.set(name,upstream.headers.get(name));
    try { await pipeline(Readable.fromWeb(upstream.body),res); } catch { if(!res.destroyed) res.destroy(); }
}));
router.post('/parse-phones',(req,res)=>res.json(String(req.body.input||'').split(/[\n,]+/).flatMap(value=>{
    try {return [destinationPhone(value.trim())];} catch {return [];}
})));
export default router;
