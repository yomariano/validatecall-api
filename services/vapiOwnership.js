import { ownsRows } from '../middleware/ownership.js';

export function guardVapiResources(db) {
    return async (req, res, next) => {
        if (!req.user) return next();
        try {
            const assistantIds = [];
            function collect(value) {
                if (!value || typeof value !== 'object') return;
                for (const [key, item] of Object.entries(value)) {
                    if (['assistantId', 'assistant_id'].includes(key) && item) assistantIds.push(item);
                    else collect(item);
                }
            }
            collect(req.body);
            const assistantMatch = /^\/assistants\/([^/]+)$/.exec(req.path);
            if (assistantMatch) assistantIds.push(decodeURIComponent(assistantMatch[1]));
            if (!await ownsRows(db, 'vapi_assistants', assistantIds, req.user.id)) return res.status(404).json({ error: 'Assistant not found' });
            const callMatch = /^\/calls\/([^/]+)$/.exec(req.path);
            const callId = callMatch ? decodeURIComponent(callMatch[1]) : req.body?.callId;
            if (callId && !await ownsRows(db, 'vapi_calls', [callId], req.user.id)) return res.status(404).json({ error: 'Call not found' });
            next();
        } catch (error) {
            console.error('Voice ownership check failed:', error.message);
            res.status(503).json({ error: 'Unable to verify voice resource ownership' });
        }
    };
}

export async function recordVapiCallOwner(db, callId, userId) {
    if (!callId || !userId) throw new Error('Call ownership is missing');
    const { error } = await db.from('vapi_calls').insert({ id: callId, user_id: userId });
    if (error) throw new Error('Call started, but ownership could not be recorded. Review the provider call before retrying.');
}
