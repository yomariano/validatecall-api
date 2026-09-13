import { jest } from '@jest/globals';
import { testDatabase } from './postgresHarness.js';
import { database } from '../db/database.js';
import scheduler from '../services/workflowScheduler.js';
import { runClaimedJob } from '../services/jobClaims.js';
let pg;
beforeAll(async()=>{({pg}=await testDatabase());},30000);
afterAll(async()=>{await pg.close();});
test('uncertain outbound delivery pauses the enrollment and cannot be executed by another worker',async()=>{
    const user=(await database.from('profiles').insert({email:'worker@example.test'}).select().single()).data;
    const lead=(await database.from('leads').insert({user_id:user.id,name:'Test',email:'lead@example.test'}).select().single()).data;
    const workflow=(await database.from('outreach_workflows').insert({user_id:user.id,name:'Test'}).select().single()).data;
    const step=await database.from('workflow_steps').insert({workflow_id:workflow.id,step_number:1,step_type:'email'});
    expect(step.error).toBeNull();
    const enrollment=(await database.from('workflow_enrollments').insert({user_id:user.id,workflow_id:workflow.id,lead_id:lead.id,next_action_at:new Date().toISOString()}).select().single()).data;
    const send=jest.spyOn(scheduler,'executeEmailStep').mockResolvedValue({success:false,error:'Provider timeout'});
    try {
        await expect(runClaimedJob(database,'uncertain-workflow',()=>scheduler.processEnrollment({...enrollment,workflow,lead}))).rejects.toThrow('review');
        const saved=(await database.from('workflow_enrollments').select().eq('id',enrollment.id).single()).data;
        expect(saved.status).toBe('paused');
        expect(saved.next_action_at).toBeNull();
        expect((await database.from('outbound_job_claims').select().eq('job_key','uncertain-workflow').single()).data.state).toBe('needs_review');
        expect(await runClaimedJob(database,'uncertain-workflow',()=>scheduler.processEnrollment({...enrollment,workflow,lead}))).toBe(false);
        expect(send).toHaveBeenCalledTimes(1);
    } finally {send.mockRestore();}
});
