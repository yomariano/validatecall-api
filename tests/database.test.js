import { database } from '../db/database.js';
import { testDatabase } from './postgresHarness.js';
import { applyMigrations } from '../db/migrate.js';
import { claimScheduledCall, runClaimedJob } from '../services/jobClaims.js';

let pg, connection;
const alice='11111111-1111-4111-8111-111111111111', bob='22222222-2222-4222-8222-222222222222';
beforeAll(async () => {
    ({ pg, connection }=await testDatabase());
    await connection.query('INSERT INTO profiles(id,email) VALUES($1,$2),($3,$4)',[alice,'alice@example.test',bob,'bob@example.test']);
},30000);
afterAll(async () => { await pg?.close(); });
test('standalone PostgreSQL migrations can be applied repeatedly',async()=>{await applyMigrations(connection);});
test('scoped inserts, reads and updates isolate tenants',async()=>{
    const a=await database.forUser(alice).from('leads').insert({name:'Alice lead',place_id:'alice'}).select().single();
    const b=await database.forUser(bob).from('leads').insert({name:'Bob lead',place_id:'bob'}).select().single();
    expect(a.error).toBeNull();expect(b.error).toBeNull();
    expect((await database.forUser(alice).from('leads').select()).data.map(l=>l.name)).toEqual(['Alice lead']);
    const changed=await database.forUser(alice).from('leads').update({name:'stolen'}).eq('id',b.data.id).select();
    expect(changed.error).toBeNull();expect(changed.data).toEqual([]);
    const hijack=await database.forUser(alice).from('leads').upsert({id:b.data.id,name:'stolen'}).select();
    expect(hijack.error).toBeNull();expect(hijack.data).toEqual([]);
});
test('SQL parameters preserve malicious strings as data',async()=>{
    const name="'); DROP TABLE profiles; --";
    const result=await database.forUser(alice).from('leads').insert({name}).select().single();
    expect(result.error).toBeNull();expect(result.data.name).toBe(name);
    expect((await database.from('profiles').select()).data).toHaveLength(2);
    expect(()=>database.from('leads; DROP TABLE profiles')).toThrow();
});
test('joins, exact pagination counts, arrays and JSON match API data shapes',async()=>{
    const c=await database.from('campaigns').insert({user_id:alice,name:'Campaign',product_idea:'Research',lead_ids:[]}).select().single();
    const seq=await database.from('email_sequences').insert({user_id:alice,name:'Sequence',campaign_id:c.data.id}).select().single();
    const step=await database.from('email_sequence_steps').insert({sequence_id:seq.data.id,step_number:1,subject_template:'Hello',body_template:'Welcome'}).select();
    expect(step.error).toBeNull();
    const query=await database.from('email_sequences').select('*,campaign:campaigns(id,name),steps:email_sequence_steps(*)',{count:'exact'}).eq('user_id',alice).range(0,0);
    expect(query.error).toBeNull();expect(query.count).toBe(1);expect(query.data[0].campaign.name).toBe('Campaign');expect(query.data[0].steps).toHaveLength(1);
    const counted=await database.from('email_sequences').select('steps:email_sequence_steps(count)').eq('id',seq.data.id).single();
    expect(counted.data.steps).toEqual([{count:1}]);
    const update=await database.from('email_sequences').update({total_sent:database.sql`COALESCE(total_sent,0)+1`}).eq('id',seq.data.id).select().single();
    expect(update.error).toBeNull();expect(update.data.total_sent).toBe(1);
});
test('empty IN predicates do not leak all rows',async()=>{expect((await database.from('leads').select().in('id',[])).data).toEqual([]);});
test('concurrent research requests cannot overrun user/global budgets',async()=>{
    const results=await Promise.all(Array.from({length:10},()=>database.rpc('reserve_research_request',{p_user_id:alice,p_user_limit:3,p_global_limit:4})));
    expect(results.every(r=>!r.error)).toBe(true);expect(results.filter(r=>r.data).length).toBe(3);
    const bobResults=await Promise.all(Array.from({length:5},()=>database.rpc('reserve_research_request',{p_user_id:bob,p_user_limit:3,p_global_limit:4})));
    expect(bobResults.filter(r=>r.data).length).toBe(1);
});
test('only one worker can claim a scheduled call; stale snapshots cannot claim edited calls',async()=>{
    const result=await database.from('scheduled_calls').insert({user_id:alice,phone_number:'+35312345678',product_idea:'Test',scheduled_at:new Date().toISOString(),status:'pending'}).select().single();
    expect(result.error).toBeNull();
    const claimed=await Promise.all(Array.from({length:8},()=>claimScheduledCall(database,result.data)));
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(await claimScheduledCall(database,result.data)).toBe(false);
});
test('durable action claims prevent duplicate execution across workers',async()=>{
    let executions=0;
    const results=await Promise.all(Array.from({length:8},()=>runClaimedJob(database,'sequence:one:step:1',async()=>{executions++;})));
    expect(executions).toBe(1);expect(results.filter(Boolean)).toHaveLength(1);
    await expect(runClaimedJob(database,'ambiguous-action',async()=>{throw new Error('Provider timeout');})).rejects.toThrow();
    expect(await runClaimedJob(database,'ambiguous-action',async()=>{executions++;})).toBe(false);
});
