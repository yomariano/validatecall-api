import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { testDatabase } from './postgresHarness.js';
import { database as db } from '../db/database.js';
import { createSession, SESSION_COOKIE } from '../services/sessions.js';
const user='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333', lead='44444444-4444-4444-8444-444444444444';
let pg,session; const originalFetch=global.fetch;
const auth=req=>req.set('Cookie',`${SESSION_COOKIE}=${session.token}`).set('X-CSRF-Token',session.csrfToken);
beforeAll(async()=>{({pg}=await testDatabase());await db.query('INSERT INTO profiles(id,email) VALUES($1,$2),($3,$4)',[user,'history@example.test',other,'other@example.test']);session=await createSession(user);},30000);
afterAll(async()=>{global.fetch=originalFetch;await pg.close();});
beforeEach(async()=>{
 process.env.ASSISTANTFLEET_API_KEY='history-test-key';
 await db.query('DELETE FROM calls');await db.query('DELETE FROM leads');
 await db.query('INSERT INTO leads(id,user_id,name,email) VALUES($1,$2,$3,$4)',[lead,user,'Example Electrical','office@example.test']);
 await db.query('INSERT INTO calls(id,user_id,lead_id,vapi_call_id,phone_number,customer_name,raw_response) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user,lead,'local-control','+35312345678','Old name',JSON.stringify({provider:'assistantfleet',assistant_id:'own-agent',call_control_id:'local-control',raw:{client_state:'secret'},assistantfleet_call:{id:'provider-call',recording_available:true}})]);
 global.fetch=jest.fn(()=>{throw new Error('Unexpected external request');});
});
test('history refresh joins business contacts, retrieves later analytics and excludes unrelated provider records',async()=>{
 const matched={id:'provider-call',assistant_id:'own-agent',telnyx_call_control_id:'local-control',summary:'Asked for a demo on Tuesday.',outcome:'booking_request',action_items:['Confirm the requested time manually.'],recording_available:true,transcript:[{role:'user',text:'Tuesday suits me.'}]};
 global.fetch=jest.fn(async()=>({ok:true,status:200,json:async()=>({calls:[{...matched,id:'foreign-call',assistant_id:'other-agent',summary:'Private foreign summary'},matched],pagination:{total_pages:1}})}));
 const response=await auth(request(app).get('/api/voice/calls')).expect(200);
 expect(response.body).toHaveLength(1);
 expect(response.body[0]).toMatchObject({id,customer_name:'Example Electrical',business_email:'office@example.test',summary:matched.summary,action_items:matched.action_items,call_outcome:'booking_request',customer:{name:'Example Electrical',number:'+35312345678'}});
 expect(response.body[0].recordingUrl).toContain(`/api/voice/calls/${id}/recording`);
 expect(JSON.stringify(response.body)).not.toMatch(/client_state|secret|foreign-call|Private foreign/);
 const detail=await auth(request(app).get(`/api/voice/calls/${id}`)).expect(200);
 expect(detail.body.analysis.summary).toBe(matched.summary);
 expect(detail.body.messages[0].message).toBe('Tuesday suits me.');
 expect(detail.body.createdAt).toBeTruthy();
});
test('opt-out suppresses outreach suggestions even if provider analytics suggests contact',async()=>{
 await db.query("UPDATE leads SET status='do_not_contact' WHERE id=$1",[lead]);
 await db.query('UPDATE calls SET raw_response=raw_response || $1::jsonb WHERE id=$2',[JSON.stringify({assistantfleet_call:{id:'provider-call',action_items:['Call again'],outcome:'follow_up_required'}}),id]);
 const {body}=await auth(request(app).get(`/api/voice/calls/${id}`)).expect(200);
 expect(body.contact_allowed).toBe(false);expect(body.call_outcome).toBe('do_not_contact');expect(body.action_items).toEqual(['Do not contact this business again.']);
});
test('provider outage preserves saved history and communicates stale analytics',async()=>{
 const {body}=await auth(request(app).get('/api/voice/calls')).expect(200);
 expect(body[0]).toMatchObject({id,analytics_unavailable:true,customer_name:'Example Electrical'});
});
test('recording proxy supports seeking, hides credentials and rejects other users before contacting provider',async()=>{
 global.fetch=jest.fn(async(url,options)=>{
  expect(new URL(url).pathname).toBe('/calls/provider-call/recording');
  expect(options.headers.Range).toBe('bytes=0-3');
  expect(options.headers.Authorization).toBe('Bearer history-test-key');
  return new Response(new Uint8Array([82,73,70,70]),{status:206,headers:{'content-length':'4','content-range':'bytes 0-3/44','accept-ranges':'bytes'}});
 });
 const r=await auth(request(app).get(`/api/voice/calls/${id}/recording`)).set('Range','bytes=0-3').expect(206);
 expect(r.headers['content-type']).toMatch(/audio\/wav/);expect(r.headers['content-range']).toBe('bytes 0-3/44');expect(r.headers['cache-control']).toBe('private, no-store');
 expect(r.body).toEqual(Buffer.from('RIFF'));expect(r.headers.authorization).toBeUndefined();
 await db.query('UPDATE calls SET user_id=$1 WHERE id=$2',[other,id]);global.fetch.mockClear();
 await auth(request(app).get(`/api/voice/calls/${id}/recording`)).expect(404);
 expect(global.fetch).not.toHaveBeenCalled();
});
test('recording references cannot be injected through the generic call update',async()=>{
 await auth(request(app).patch(`/api/data/calls/${id}`)).send({raw_response:{assistantfleet_call:{id:'foreign-call',recording_available:true}}}).expect(400);
 await auth(request(app).get(`/api/voice/calls/${id}/recording`)).set('Range','bytes=0-1,4-9').expect(416);
 expect(global.fetch).not.toHaveBeenCalled();
});
test('missing recording and missing transcript remain explicit empty states',async()=>{
 await db.query('UPDATE calls SET raw_response=NULL WHERE id=$1',[id]);
 const {body}=await auth(request(app).get(`/api/voice/calls/${id}`)).expect(200);
 expect(body.recording_url).toBeNull();expect(body.messages).toEqual([]);expect(body.summary).toBeNull();
 await auth(request(app).get(`/api/voice/calls/${id}/recording`)).expect(404);
});
