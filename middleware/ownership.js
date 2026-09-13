// Explicit ownership checks protect service-role routes and cross-table references.
export async function ownsRows(db, table, ids, userId, idColumn = 'id') {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return true;
    if (uniqueIds.length > 1000 || uniqueIds.some(id => typeof id !== 'string' || !id)) return false;
    const { data, error } = await db.from(table).select(idColumn)
        .eq('user_id', userId).in(idColumn, uniqueIds);
    if (error) throw error;
    return data?.length === uniqueIds.length;
}

export function ownResource(db, table, idColumn = 'id') {
    return async (req, res, next, id) => {
        try {
            if (!await ownsRows(db, table, [id], req.user.id, idColumn)) {
                return res.status(404).json({ error: 'Resource not found' });
            }
            next();
        } catch (error) {
            console.error('Ownership check failed:', error.message);
            res.status(503).json({ error: 'Unable to verify resource ownership' });
        }
    };
}

const references = {
    vapiCallId: 'vapi_calls', vapi_call_id: 'vapi_calls',
    call_assistant_id: 'vapi_assistants', default_assistant_id: 'vapi_assistants', selectedAgentId: 'vapi_assistants', selected_agent_id: 'vapi_assistants', assistantId: 'vapi_assistants', assistant_id: 'vapi_assistants',
    leadId: 'leads', lead_id: 'leads', leadIds: 'leads', lead_ids: 'leads',
    campaignId: 'campaigns', campaign_id: 'campaigns',
    sequenceId: 'email_sequences', sequence_id: 'email_sequences',
    workflowId: 'outreach_workflows', workflow_id: 'outreach_workflows',
};
export function ownReferences(db) {
    return async (req, res, next) => {
        try {
            const checks = new Map();
            function collect(value) {
                if (!value || typeof value !== 'object') return;
                for (const [key, item] of Object.entries(value)) {
                    if (references[key] && item != null && item !== '') {
                        const ids = checks.get(references[key]) || [];
                        ids.push(...(Array.isArray(item) ? item : [item]));
                        checks.set(references[key], ids);
                    } else collect(item);
                }
            }
            collect(req.body);
            collect(req.query);
            for (const [table, ids] of checks) {
                if (!await ownsRows(db, table, ids, req.user.id)) return res.status(404).json({ error: 'Referenced resource not found' });
            }
            next();
        } catch (error) {
            console.error('Reference ownership check failed:', error.message);
            res.status(503).json({ error: 'Unable to verify resource ownership' });
        }
    };
}
