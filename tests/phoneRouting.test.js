import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { testDatabase } from './postgresHarness.js';
import { database as db } from '../db/database.js';
import { destinationPhone, selectOutboundNumber, phoneReadiness } from '../services/phoneRouting.js';
import { dispatchFleetCall } from '../services/assistantFleet.js';
import { createSession, SESSION_COOKIE } from '../services/sessions.js';
const user='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
let pg, session; const originalFetch=global.fetch;
beforeAll(async()=>{({pg}=await testDatabase());await db.query('INSERT INTO profiles(id,email) VALUES($1,$2),($3,$4)',[user,'qa@example.test',other,'other@example.test']);session=await createSession(user);},30000);
afterAll(async()=>{await pg.close();});
beforeEach(async()=>{await db.query('DELETE FROM user_phone_numbers');delete process.env.VOICE_OUTBOUND_ENABLED;delete process.env.ASSISTANTFLEET_API_KEY;global.fetch=jest.fn(()=>{throw new Error('Unexpected external request');});});
afterEach(()=>{global.fetch=originalFetch;});
const auth=req=>req.set('Cookie',`${SESSION_COOKIE}=${session.token}`).set('X-CSRF-Token',session.csrfToken);
async function number(country,phone,extra={}) {
 const result=await db.from('user_phone_numbers').insert({user_id:user,phone_number:phone,phone_number_id:phone,provider:'telnyx',voice_provider:'assistantfleet',country_code:country,...extra}).select().single();
 if(result.error)throw new Error(result.error.message);return result.data;
}
test.each([['+12025550123','US'],['+14165550123','CA'],['+442079460123','GB'],['+35312345678','IE']])('identifies country %s → %s including shared calling codes',(phone,country)=>expect(destinationPhone(phone).country).toBe(country));
test.each(['2025550123','+80012345678','call +12025550123','+12025550123 ext 2',null])('rejects ambiguous or non-international destination %s',phone=>expect(()=>destinationPhone(phone)).toThrow());
test('country routing excludes foreign users, legacy providers and flagged numbers',async()=>{
 await number('US','+12025550101');await number('GB','+447700900101',{user_id:other});
 await number('GB','+447700900102',{provider:'twilio'});await number('GB','+447700900103',{flagged_as_spam:true});
 await number('GB','+447700900104',{voice_provider:'vapi'});
 await expect(selectOutboundNumber(db,user,'+442079460123')).rejects.toThrow('Connect a Telnyx number for GB');
 expect(global.fetch).not.toHaveBeenCalled();
});
test('selects an available matching number even when the least-used number has exhausted its lower limit',async()=>{
 await number('US','+12025550101',{daily_calls_used:1,daily_calls_limit:1});
 await number('US','+12025550102',{daily_calls_used:2,daily_calls_limit:10});
 expect((await selectOutboundNumber(db,user,'+12025550123')).phone.phone_number).toBe('+12025550102');
});
test('batch readiness consumes simulated capacity, has no dial or database usage side effects',async()=>{
 const n=await number('US','+12025550101',{daily_calls_used:0,daily_calls_limit:1});
 const result=await phoneReadiness(db,user,['+12025550123','+12025550124']);
 expect(result.ready).toBe(false);expect(result.destinations[1].code).toBe('PHONE_CAPACITY_REACHED');
 expect((await db.query('SELECT daily_calls_used FROM user_phone_numbers WHERE id=$1',[n.id])).rows[0].daily_calls_used).toBe(0);
 expect(global.fetch).not.toHaveBeenCalled();
});
test('daily capacity resets before dispatch selection',async()=>{
 await number('US','+12025550101',{daily_calls_used:50,last_reset_date:'2020-01-01'});
 expect((await selectOutboundNumber(db,user,'+12025550123')).phone.used_today).toBe(0);
});
test('outbound kill switch blocks every provider request even with matching numbers',async()=>{
 await number('US','+12025550101');
 await expect(dispatchFleetCall(user,{phoneNumber:'+12025550123'})).rejects.toThrow('Outbound calling is disabled');
 expect(global.fetch).not.toHaveBeenCalled();
});
test('authenticated mixed-country preflight reports missing countries without calling anyone',async()=>{
 process.env.ASSISTANTFLEET_API_KEY='test';await number('US','+12025550101');
 const result=await auth(request(app).post('/api/telephony/readiness')).send({phoneNumbers:['+12025550123','+442079460123']}).expect(200);
 expect(result.body.ready).toBe(false);expect(result.body.destinations[1].country).toBe('GB');expect(global.fetch).not.toHaveBeenCalled();
});
test('voice agent access cannot reach another user’s AssistantFleet resources',async()=>{
 await db.query("INSERT INTO vapi_assistants(id,user_id,provider) VALUES('foreign',$1,'assistantfleet') ON CONFLICT DO NOTHING",[other]);
 await auth(request(app).get('/api/voice/assistants/foreign')).expect(404);expect(global.fetch).not.toHaveBeenCalled();
});
test('saving campaign references rejects an agent owned by another user',async()=>{
 await db.query("INSERT INTO vapi_assistants(id,user_id,provider) VALUES('foreign',$1,'assistantfleet') ON CONFLICT DO NOTHING",[other]);
 await auth(request(app).post('/api/data/campaigns')).send({name:'QA',selectedAgentId:'foreign',leadIds:[]}).expect(404);
});
test('configured dispatch calls AssistantFleet with explicit country-matched Telnyx caller only',async()=>{
 process.env.ASSISTANTFLEET_API_KEY='test-af';process.env.VOICE_OUTBOUND_ENABLED='true';
 await number('US','+12025550101');await number('CA','+14165550101');
 await db.query("INSERT INTO vapi_assistants(id,user_id,provider) VALUES('own',$1,'assistantfleet') ON CONFLICT DO NOTHING",[user]);
 global.fetch=jest.fn(async(url,options)=>{
  const path=new URL(url).pathname;
  if(path==='/assistants/own')return {ok:true,status:200,json:async()=>({id:'own',name:'QA'})};
  if(path==='/numbers')return {ok:true,status:200,json:async()=>[{phone_number:'12025550101',provider:'telnyx'},{phone_number:'14165550101',provider:'telnyx'}]};
  if(path==='/calls/outbound'){
   expect(JSON.parse(options.body)).toEqual({assistant_id:'own',from:'+14165550101',to:'+14165550123'});
   return {ok:true,status:201,json:async()=>({call_sid:'qa-dial',call_control_id:'qa-control',status:'initiated'})};
  }
  throw new Error('Unexpected provider path');
 });
 const result=await dispatchFleetCall(user,{phoneNumber:'+14165550123',assistantId:'own'});
 expect(result.id).toBe('qa-dial');expect(global.fetch.mock.calls.every(([url])=>new URL(url).host==='assistant.voicefleet.ai')).toBe(true);
});
test('signed call result updates only a locally-owned dispatch and duplicate delivery is harmless',async()=>{
 const { createHmac }=await import('node:crypto');process.env.ASSISTANTFLEET_WEBHOOK_SECRET='test-webhook';
 const payload=JSON.stringify({event:'call.ended',delivery:'qa-delivery',data:{id:'qa-provider-record',assistant_id:'own',telnyx_call_control_id:'qa-control',duration_seconds:15,ended_at:'2026-09-13T13:00:00Z',transcript:[{role:'user',text:'QA test'}]}});
 const signature='sha256='+createHmac('sha256','test-webhook').update(payload).digest('hex');
 await request(app).post('/api/voice/assistantfleet-webhook').set('Content-Type','application/json').send(payload).expect(401);
 for(let i=0;i<2;i++){
  const response=await request(app).post('/api/voice/assistantfleet-webhook').set('Content-Type','application/json').set('x-assistantfleet-signature',signature).send(payload).expect(200);
  expect(response.body.matched).toBe(1);
 }
 expect((await db.query("SELECT status FROM calls WHERE vapi_call_id='qa-dial'")).rows[0].status).toBe('completed');
 delete process.env.ASSISTANTFLEET_WEBHOOK_SECRET;
});
test('assistant list preserves the array contract used by campaign and lead selectors',async()=>{
 await db.query("DELETE FROM vapi_assistants WHERE user_id=$1",[user]);
 const response=await auth(request(app).get('/api/voice/assistants')).expect(200);
 expect(response.body).toEqual([]);
});
