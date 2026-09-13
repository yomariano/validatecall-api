import { fleetConfigured, outboundEnabled } from '../services/assistantFleet.js';
import { Router } from 'express';
import { database } from '../db/database.js';
import { phoneReadiness } from '../services/phoneRouting.js';
const router = Router();
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
