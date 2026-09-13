import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../app.js';
import { testDatabase } from './postgresHarness.js';
import { database } from '../db/database.js';
import { createSession, SESSION_COOKIE } from '../services/sessions.js';
const originalFetch = global.fetch;
const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
let pg, session;
beforeAll(async () => {
    ({ pg } = await testDatabase());
    await database.query('INSERT INTO profiles(id,email) VALUES($1,$2),($3,$4)', [userId,'member@example.test',otherId,'other@example.test']);
    session = await createSession(userId);
},30000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => { global.fetch = jest.fn(async () => { throw new Error('Unexpected external request'); }); });
afterEach(() => { global.fetch = originalFetch; });
const authorized = req => req.set('Cookie', `${SESSION_COOKIE}=${session.token}`).set('X-CSRF-Token', session.csrfToken);

test.each([
    ['get', '/api/sequences'], ['post', '/api/workflows'], ['get', '/api/admin/users'],
    ['patch', '/api/scheduled/calls/other-call'], ['get', '/api/usage/other-user'],
    ['get', '/api/vapi/assistants'], ['post', '/api/vapi/call'], ['post', '/api/research/leads'],
    ['get', '/api/settings/resend?userId=other-user'], ['post', '/api/email/send-cold-email'],
])('actual app rejects unauthenticated %s %s before database/provider calls', async (method, path) => {
    await request(app)[method](path).expect(401);
    expect(global.fetch).not.toHaveBeenCalled();
});
test.each(['/api/stripe/webhook', '/api/billing/webhook', '/api/resend/webhook', '/api/vapi/webhook', '/api/email/inbound'])('unsigned webhook fails closed: %s', async path => {
    await request(app).post(path).send({ type: 'checkout.session.completed' }).expect(503);
    expect(global.fetch).not.toHaveBeenCalled();
});
test('scheduled call update cannot target another tenant', async () => {
    const call = await database.from('scheduled_calls').insert({ user_id: otherId, phone_number: '+35312345678', product_idea: 'Private', scheduled_at: new Date().toISOString() }).select().single();
    expect(call.error).toBeNull();
    await authorized(request(app).patch(`/api/scheduled/calls/${call.data.id}`)).send({ productIdea: 'malicious change' }).expect(404);
    expect(global.fetch).not.toHaveBeenCalled();
});
test('retired fictional lead endpoint fails explicitly', async () => {
    await authorized(request(app).post('/api/claude/generate-leads')).send({ keyword: 'dentist', location: 'Dublin' }).expect(410);
    expect(global.fetch).not.toHaveBeenCalled();
});
test('server sessions require CSRF tokens for mutations and reject foreign identities',async()=>{
    await request(app).post('/api/research/leads').set('Cookie',`${SESSION_COOKIE}=${session.token}`).send({keyword:'dentists',location:'Dublin'}).expect(403);
    await authorized(request(app).post('/api/research/leads')).send({userId:otherId,keyword:'dentists',location:'Dublin'}).expect(403);
    await authorized(request(app).post('/api/research/leads')).set('Origin','https://attacker.example').send({keyword:'dentists',location:'Dublin'}).expect(403);
});
test('admin permissions come from the authenticated database profile',async()=>{
    await authorized(request(app).get('/api/admin/users')).expect(403);
    await authorized(request(app).get('/api/admin/users')).set('x-admin-user-id',otherId).expect(403);
    await database.query('UPDATE profiles SET is_admin=true WHERE id=$1',[userId]);
    await authorized(request(app).get('/api/admin/users')).expect(200);
    await database.query('UPDATE profiles SET is_admin=false WHERE id=$1',[userId]);
});
test('data routes can save and read only the current user’s leads',async()=>{
    const saved=await authorized(request(app).post('/api/data/leads')).send({leads:[{name:'My lead',phone:'+35312345678',placeId:'mine'}],searchKeyword:'dentists',searchLocation:'Dublin'}).expect(200);
    expect(saved.body.saved).toBe(1);
    const read=await authorized(request(app).get('/api/data/leads')).expect(200);
    expect(read.body.every(lead=>lead.user_id===userId)).toBe(true);
    const profile=await authorized(request(app).patch('/api/data/profile')).send({company_name:'New company',is_admin:true}).expect(200);
    expect(profile.body.is_admin).toBe(false);
});
test('logout revokes the database session',async()=>{
    const fresh=await createSession(userId);
    await request(app).post('/api/auth/logout').set('Cookie',`${SESSION_COOKIE}=${fresh.token}`).set('X-CSRF-Token',fresh.csrfToken).expect(200);
    await request(app).get('/api/sequences').set('Cookie',`${SESSION_COOKIE}=${fresh.token}`).expect(401);
});

test.each(['/api/data/dashboard','/api/data/campaigns','/api/data/calls','/api/sequences','/api/workflows'])(
    'authenticated database-backed list works: %s', async path => {
        await authorized(request(app).get(path)).expect(200);
        expect(global.fetch).not.toHaveBeenCalled();
    }
);
