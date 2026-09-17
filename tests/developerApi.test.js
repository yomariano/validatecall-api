import request from 'supertest';
import app from '../app.js';
import { database } from '../db/database.js';
import { testDatabase } from './postgresHarness.js';
import { createSession, SESSION_COOKIE } from '../services/sessions.js';
import { resetApiRateLimitsForTests } from '../middleware/apiKeyAuth.js';

const userId='33333333-3333-4333-8333-333333333333';
const otherId='44444444-4444-4444-8444-444444444444';
let pg,session;
const web=req=>req.set('Cookie',`${SESSION_COOKIE}=${session.token}`).set('X-CSRF-Token',session.csrfToken);
const api=(req,key)=>req.set('Authorization',`Bearer ${key}`);

beforeAll(async()=>{
    ({pg}=await testDatabase());
    await database.query('INSERT INTO profiles(id,email) VALUES($1,$2),($3,$4)',[userId,'developer@example.test',otherId,'other-developer@example.test']);
    session=await createSession(userId);
},30000);
afterAll(async()=>{await pg?.close();});
beforeEach(()=>resetApiRateLimitsForTests());

async function createKey(scopes=['data:read','data:write']){
    return (await web(request(app).post('/api/developer/keys')).send({name:'Test integration',scopes}).expect(201)).body;
}

test('developer key secret is returned once and stored only as a hash',async()=>{
    const created=await createKey();
    expect(created.secret).toMatch(/^vc_live_[A-Za-z0-9_-]+$/);
    expect(created.prefix).toBe(created.secret.slice(0,15));
    const listed=await web(request(app).get('/api/developer/keys')).expect(200);
    expect(listed.body[0]).not.toHaveProperty('secret');
    expect(listed.body[0]).not.toHaveProperty('key_hash');
    const stored=await database.query('SELECT key_hash FROM api_keys WHERE id=$1',[created.id]);
    expect(stored.rows[0].key_hash).not.toContain(created.secret);
    expect(stored.rows[0].key_hash).toHaveLength(64);
});

test('API keys authenticate bearer requests and enforce scopes',async()=>{
    const readKey=await createKey(['data:read']);
    const account=await api(request(app).get('/v1/account'),readKey.secret).expect(200);
    expect(account.body.email).toBe('developer@example.test');
    await api(request(app).get('/v1/leads'),readKey.secret).expect(200);
    const denied=await api(request(app).post('/v1/leads'),readKey.secret).send({name:'Blocked'}).expect(403);
    expect(denied.body.error.code).toBe('insufficient_scope');
});

test('public API data is tenant scoped',async()=>{
    await database.query('INSERT INTO leads(user_id,name,phone) VALUES($1,$2,$3)',[otherId,'Private lead','+35311111111']);
    const key=await createKey(['data:read','data:write']);
    const created=await api(request(app).post('/v1/leads'),key.secret).send({name:'Owned lead',phone:'+35312223333'}).expect(201);
    expect(created.body.data[0].name).toBe('Owned lead');
    const listed=await api(request(app).get('/v1/leads'),key.secret).expect(200);
    expect(listed.body.data.map(item=>item.name)).toEqual(['Owned lead']);
    expect(listed.body.data[0]).not.toHaveProperty('user_id');
});

test('revocation immediately disables a developer key',async()=>{
    const key=await createKey(['data:read']);
    await api(request(app).get('/v1/account'),key.secret).expect(200);
    await web(request(app).delete(`/api/developer/keys/${key.id}`)).expect(200);
    await api(request(app).get('/v1/account'),key.secret).expect(401);
});

test('call creation requires and replays an idempotency key without a second side effect',async()=>{
    const key=await createKey(['calls:write']);
    await api(request(app).post('/v1/calls'),key.secret).send({}).expect(400);
    const first=await api(request(app).post('/v1/calls'),key.secret).set('Idempotency-Key','same-call-request').send({}).expect(400);
    expect(first.body.error.message).toMatch(/phone_number/);
    const replay=await api(request(app).post('/v1/calls'),key.secret).set('Idempotency-Key','same-call-request').send({}).expect(400);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const conflict=await api(request(app).post('/v1/calls'),key.secret).set('Idempotency-Key','same-call-request').send({phone_number:'+35319696333'}).expect(409);
    expect(conflict.body.error.code).toBe('idempotency_conflict');
    const rows=await database.query('SELECT count(*)::int AS count FROM api_idempotency WHERE user_id=$1',[userId]);
    expect(rows.rows[0].count).toBe(1);
});

test('call creation blocks suppressed contacts before reaching a provider',async()=>{
    const key=await createKey(['calls:write']);
    const {rows}=await database.query(`INSERT INTO leads(user_id,name,phone,status)
        VALUES($1,$2,$3,'do_not_contact') RETURNING id`,[userId,'Suppressed lead','+35319696333']);
    const result=await api(request(app).post('/v1/calls'),key.secret).set('Idempotency-Key','suppressed-call-attempt')
        .send({lead_id:rows[0].id,assistant_id:'assistant-not-reached'}).expect(409);
    expect(result.body.error.code).toBe('contact_suppressed');
});

test('campaign reconciliation derives counters from owned call records',async()=>{
    const key=await createKey(['data:write']);
    const {rows:[lead]}=await database.query("INSERT INTO leads(user_id,name,phone,status) VALUES($1,'Campaign lead','+35315550123','contacted') RETURNING id",[userId]);
    const {rows:[campaign]}=await database.query("INSERT INTO campaigns(user_id,name,product_idea,lead_ids) VALUES($1,'Counter QA','QA',ARRAY[$2]::uuid[]) RETURNING id",[userId,lead.id]);
    await database.query(`INSERT INTO calls(user_id,lead_id,campaign_id,phone_number,status,created_at) VALUES
        ($1,$2,$3,'+35315550123','completed',now()-interval '1 minute'),
        ($1,$2,$3,'+35315550123','failed',now())`,[userId,lead.id,campaign.id]);
    const result=await api(request(app).post(`/v1/campaigns/${campaign.id}/recalculate`),key.secret).expect(200);
    expect(result.body).toMatchObject({calls_made:2,calls_completed:1,calls_failed:1});
    const stored=await database.query('SELECT call_count,last_called_at FROM leads WHERE id=$1',[lead.id]);
    expect(stored.rows[0].call_count).toBe(2);
    expect(stored.rows[0].last_called_at).toBeTruthy();
});

test('key creation requires the signed-in session CSRF token',async()=>{
    await request(app).post('/api/developer/keys').set('Cookie',`${SESSION_COOKIE}=${session.token}`).send({name:'No CSRF',scopes:['data:read']}).expect(403);
    await request(app).get('/v1/account').expect(401);
    await request(app).get('/v1/openapi.json').expect(200);
});
