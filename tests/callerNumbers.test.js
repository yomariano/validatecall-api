import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { testDatabase } from './postgresHarness.js';
import { database as db } from '../db/database.js';
import { createSession, SESSION_COOKIE } from '../services/sessions.js';
import { dispatchFleetCall } from '../services/assistantFleet.js';
import callScheduler from '../services/callScheduler.js';

const user='61111111-1111-4111-8111-111111111111', other='62222222-2222-4222-8222-222222222222';
let pg, session, callCounter=0;
const originalFetch=global.fetch;
const auth=req=>req.set('Cookie',`${SESSION_COOKIE}=${session.token}`).set('X-CSRF-Token',session.csrfToken);
beforeAll(async()=>{
    ({pg}=await testDatabase());
    await db.query('INSERT INTO profiles(id,email) VALUES($1,$2),($3,$4)',[user,'caller-qa@example.test',other,'other@example.test']);
    await db.query("INSERT INTO vapi_assistants(id,user_id,provider) VALUES('caller-agent',$1,'assistantfleet')",[user]);
    session=await createSession(user);
},30000);
beforeEach(async()=>{
    await db.query('DELETE FROM scheduled_calls');
    await db.query('DELETE FROM user_phone_numbers');
    process.env.ASSISTANTFLEET_API_KEY='test-af';
    process.env.VOICE_OUTBOUND_ENABLED='true';
    global.fetch=jest.fn(()=>{throw new Error('Unexpected external request');});
});
afterAll(async()=>{global.fetch=originalFetch;await pg.close();});
async function number(phone,extra={}) {
    const result=await db.from('user_phone_numbers').insert({user_id:user,phone_number:phone,phone_number_id:phone,
        country_code:'IE',provider:'telnyx',voice_provider:'assistantfleet',...extra}).select().single();
    if(result.error) throw new Error(result.error.message);
    return result.data;
}
function mockProvider(expectedFrom) {
    global.fetch=jest.fn(async(url,options)=>{
        const path=new URL(url).pathname;
        const ok=data=>({ok:true,status:200,json:async()=>data});
        if(path==='/assistants/caller-agent') return ok({id:'caller-agent',name:'QA'});
        if(path==='/numbers') return ok([{phone_number:expectedFrom,provider:'telnyx'}]);
        if(path==='/calls/outbound') {
            expect(JSON.parse(options.body)).toEqual({assistant_id:'caller-agent',from:expectedFrom,to:'+35316875367'});
            return ok({call_sid:`caller-selection-${++callCounter}`});
        }
        throw new Error(`Unexpected provider path ${path}`);
    });
}
test('options list only this account’s active numbers and explain country/capacity restrictions without dialing',async()=>{
    const available=await number('+35312345678');
    const full=await number('+35312345679',{daily_calls_used:2,daily_calls_limit:2});
    const usa=await number('+12025550101',{country_code:'US'});
    await number('+35312345670',{user_id:other});
    await number('+35312345671',{status:'suspended'});
    await number('+35312345672',{flagged_as_spam:true});
    await number('+35312345673',{provider:'twilio'});
    const {body}=await auth(request(app).get('/api/telephony/caller-numbers').query({phoneNumber:'+35316875367'})).expect(200);
    expect(body.recommendedNumberId).toBe(available.id);
    expect(body.numbers).toHaveLength(3);
    expect(body.numbers.find(n=>n.id===available.id)).toMatchObject({available:true,unavailableReason:null});
    expect(body.numbers.find(n=>n.id===full.id)).toMatchObject({available:false,unavailableReason:'DAILY_LIMIT_REACHED'});
    expect(body.numbers.find(n=>n.id===usa.id)).toMatchObject({available:false,unavailableReason:'COUNTRY_MISMATCH'});
    expect(body.numbers.every(n=>!('user_id' in n)&&!('phone_number_id' in n))).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
});
test('options handle blank/invalid destinations and require authentication',async()=>{
    await number('+35312345678');
    const {body}=await auth(request(app).get('/api/telephony/caller-numbers')).expect(200);
    expect(body.recommendedNumberId).toBeNull();
    expect(body.numbers[0]).toMatchObject({available:false,unavailableReason:'DESTINATION_REQUIRED'});
    await auth(request(app).get('/api/telephony/caller-numbers').query({phoneNumber:'bad'})).expect(400);
    await request(app).get('/api/telephony/caller-numbers').expect(401);
    expect(global.fetch).not.toHaveBeenCalled();
});
test.each([
    [{user_id:other},'FROM_NUMBER_UNAVAILABLE'],
    [{status:'suspended'},'FROM_NUMBER_UNAVAILABLE'],
    [{flagged_as_spam:true},'FROM_NUMBER_UNAVAILABLE'],
    [{country_code:'US'},'FROM_NUMBER_COUNTRY_MISMATCH'],
    [{daily_calls_limit:1,daily_calls_used:1},'PHONE_CAPACITY_REACHED'],
])('dispatch refuses an unavailable explicit number instead of falling back (%j)',async(extra,code)=>{
    await number('+35312345678');
    const selected=await number('+35312345679',extra);
    await expect(dispatchFleetCall(user,{phoneNumber:'+35316875367',assistantId:'caller-agent',fromNumberId:selected.id})).rejects.toMatchObject({code});
    expect(global.fetch).not.toHaveBeenCalled();
});
test('malformed and missing selected IDs fail before any provider request',async()=>{
    await number('+35312345678');
    for(const id of ['',{},'63333333-3333-4333-8333-333333333333']) {
        const response=await auth(request(app).post(`/api/voice/user/${user}/call`)).send({phoneNumber:'+35316875367',assistantId:'caller-agent',fromNumberId:id});
        expect([400,409]).toContain(response.status);
    }
    expect(global.fetch).not.toHaveBeenCalled();
});
test('call endpoint honors a selected number over the automatic default and records that number',async()=>{
    const automatic=await number('+35312345678');
    const chosen=await number('+35312345679',{daily_calls_used:2});
    mockProvider(chosen.phone_number);
    const {body}=await auth(request(app).post(`/api/voice/user/${user}/call`)).send({phoneNumber:'+35316875367',assistantId:'caller-agent',fromNumberId:chosen.id}).expect(200);
    const {rows:[saved]}=await db.query('SELECT outbound_phone_number FROM calls WHERE vapi_call_id=$1',[body.id]);
    expect(saved.outbound_phone_number).toBe(chosen.phone_number);
    const {rows:[unused]}=await db.query('SELECT daily_calls_used FROM user_phone_numbers WHERE id=$1',[automatic.id]);
    expect(unused.daily_calls_used).toBe(0);
});
test('a scheduled call persists the selection and dispatches it when executed',async()=>{
    await number('+35312345678');
    const chosen=await number('+35312345679',{daily_calls_used:2});
    const {body}=await auth(request(app).post('/api/scheduled/calls')).send({userId:user,phoneNumber:'+35316875367',assistantId:'caller-agent',fromNumberId:chosen.id,scheduledAt:new Date(Date.now()+600000).toISOString()}).expect(201);
    expect(body.data.from_number_id).toBe(chosen.id);
    expect(global.fetch).not.toHaveBeenCalled();
    mockProvider(chosen.phone_number);
    await callScheduler.executeScheduledCall(body.data);
    const {rows:[saved]}=await db.query('SELECT status,from_number_id FROM scheduled_calls WHERE id=$1',[body.data.id]);
    expect(saved).toMatchObject({status:'completed',from_number_id:chosen.id});
});
test('removed scheduled caller cannot fall back to another available number',async()=>{
    await number('+35312345678');
    const chosen=await number('+35312345679');
    const {body}=await auth(request(app).post('/api/scheduled/calls')).send({userId:user,phoneNumber:'+35316875367',assistantId:'caller-agent',fromNumberId:chosen.id,maxRetries:0,scheduledAt:new Date(Date.now()+600000).toISOString()}).expect(201);
    await db.query('DELETE FROM user_phone_numbers WHERE id=$1',[chosen.id]);
    await callScheduler.executeScheduledCall(body.data);
    const {rows:[saved]}=await db.query('SELECT status,last_error FROM scheduled_calls WHERE id=$1',[body.data.id]);
    expect(saved.status).toBe('failed');
    expect(saved.last_error).toContain('no longer available');
    expect(global.fetch).not.toHaveBeenCalled();
});
test('scheduled caller changes also enforce ownership',async()=>{
    const own=await number('+35312345678');
    const foreign=await number('+35312345679',{user_id:other});
    const {body}=await auth(request(app).post('/api/scheduled/calls')).send({userId:user,phoneNumber:'+35316875367',assistantId:'caller-agent',fromNumberId:own.id,scheduledAt:new Date(Date.now()+600000).toISOString()}).expect(201);
    await auth(request(app).patch(`/api/scheduled/calls/${body.data.id}`)).send({fromNumberId:foreign.id}).expect(409);
    expect((await db.query('SELECT from_number_id FROM scheduled_calls WHERE id=$1',[body.data.id])).rows[0].from_number_id).toBe(own.id);
    expect(global.fetch).not.toHaveBeenCalled();
});
