import { Router } from 'express';
import { createDatabase } from '../db/database.js';
import { researchWeb, researchConfigured, validateResearchInput } from '../services/webResearch.js';

export function createResearchRouter({ db, research = researchWeb, configured = researchConfigured } = {}) {
    const router = Router();
    router.get('/status', (req, res) => res.json({ configured: configured(), maxResults: 20 }));
    for (const mode of ['leads', 'industry']) {
        router.post(`/${mode}`, async (req, res) => {
            try {
                const input = validateResearchInput(req.body);
                if (!configured()) return res.status(503).json({ error: 'Web research is not configured. Import a CSV to continue.' });
                const { data: allowed, error } = await db.rpc('reserve_research_request', {
                    p_user_id: req.user.id,
                    p_user_limit: Math.min(100, Math.max(1, Number(process.env.RESEARCH_DAILY_USER_LIMIT) || 20)),
                    p_global_limit: Math.min(10000, Math.max(1, Number(process.env.RESEARCH_DAILY_GLOBAL_LIMIT) || 200)),
                });
                if (error) throw Object.assign(new Error('Research budget is unavailable'), { status: 503 });
                if (!allowed) return res.status(429).json({ error: 'Daily research limit reached. Try again tomorrow or import a CSV.' });
                res.json(await research(input, { mode }));
            } catch (error) {
                console.error('Research failed:', error.message);
                res.status(error.status || 502).json({ error: error.message });
            }
        });
    }
    return router;
}
const db = createDatabase();
export default createResearchRouter({ db });
