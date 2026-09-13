// Atomic database writes decide which worker may execute an outbound action.
export async function claimScheduledCall(db, call) {
    if (!['pending', 'retry_scheduled'].includes(call.status)) return false;
    const { data, error } = await db.from('scheduled_calls')
        .update({ status: 'in_progress', executed_at: new Date().toISOString() })
        .eq('id', call.id).eq('status', call.status)
        .eq('updated_at', call.updated_at)
        .select('id');
    if (error) throw error;
    return data?.length === 1;
}

export async function runClaimedJob(db, key, run) {
    const { error } = await db.from('outbound_job_claims').insert({ job_key: key });
    if (error?.code === '23505') return false;
    if (error) throw error;
    try {
        await run();
        const { error: finishError } = await db.from('outbound_job_claims')
            .update({ state: 'finished', finished_at: new Date().toISOString() }).eq('job_key', key);
        if (finishError) throw finishError;
        return true;
    } catch (error) {
        await db.from('outbound_job_claims').update({ state: 'needs_review' }).eq('job_key', key);
        throw error;
    }
}
