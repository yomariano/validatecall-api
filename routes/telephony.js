import { fleetConfigured, outboundEnabled } from '../services/assistantFleet.js';
import { Router } from 'express';
import { database } from '../db/database.js';
import { phoneReadiness, callerNumberOptions } from '../services/phoneRouting.js';
const router = Router();
router.get('/caller-numbers', async (req, res) => {
    if (req.query.phoneNumber !== undefined && typeof req.query.phoneNumber !== 'string') {
        return res.status(400).json({ error:'Provide one destination phone number.' });
    }
    try {
        const options = await callerNumberOptions(database, req.user.id, req.query.phoneNumber);
        res.set('Cache-Control', 'private, no-store').json({ ...options,
            callingEnabled:fleetConfigured() && outboundEnabled(),
            schedulingEnabled:process.env.RUN_SCHEDULERS === 'true' });
    } catch (error) {
        res.status(error.status || 503).json({ error:error.status ? error.message : 'Unable to load your calling numbers. Try again.', code:error.code });
    }
});
router.post('/readiness', async (req, res) => {
    const { phoneNumbers } = req.body;
    if (!Array.isArray(phoneNumbers) || !phoneNumbers.length || phoneNumbers.length > 1000 || phoneNumbers.some(value => typeof value !== 'string')) {
        return res.status(400).json({ error: 'Provide between 1 and 1000 phone numbers.' });
    }
    try {
        const readiness = await phoneReadiness(database, req.user.id, phoneNumbers);
        if (!fleetConfigured()) return res.json({ ...readiness, ready: false, error: 'AssistantFleet is not configured.' });
        res.json({ ...readiness, ready: readiness.ready && outboundEnabled(), outboundEnabled: outboundEnabled() });
    } catch { res.status(503).json({ error: 'Unable to check phone setup. Try again.' }); }
});
export default router;
