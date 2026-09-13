import { Router } from 'express';
import { createDatabase } from '../db/database.js';
import { researchWeb, researchConfigured, validateResearchInput, RESEARCH_LIMITS } from '../services/webResearch.js';

export function createResearchRouter({ db, research = researchWeb, configured = researchConfigured } = {}) {
    const router = Router();
    let active = 0;
    router.get('/status', (req, res) => res.json({ configured: configured(), maxResults: 20, discovery: 'direct_web', maxPages: RESEARCH_LIMITS.pages }));
    for (const mode of ['leads', 'industry']) {
        router.post(`/${mode}`, async (req, res) => {
            let reserved = false;
            const controller = new AbortController();
            const disconnect = () => { if (!res.writableEnded) controller.abort(); };
            res.on('close', disconnect);
            try {
                const input = validateResearchInput(req.body);
                if (!configured()) return res.status(503).json({ error: 'Web research is not configured. Import a CSV to continue.' });
                if (active >= 2) return res.status(429).json({ error: 'Two research jobs are already running. Please try again shortly.' });
                active++;
                reserved = true;
                const { data: allowed, error } = await db.rpc('reserve_research_request', {
                    p_user_id: req.user.id,
                    p_user_limit: Math.min(100, Math.max(1, Number(process.env.RESEARCH_DAILY_USER_LIMIT) || 20)),
                    p_global_limit: Math.min(10000, Math.max(1, Number(process.env.RESEARCH_DAILY_GLOBAL_LIMIT) || 200)),
                });
                if (error) throw Object.assign(new Error('Research budget is unavailable'), { status: 503 });
                if (!allowed) return res.status(429).json({ error: 'Daily research limit reached. Try again tomorrow or import a CSV.' });
                res.json(await research(input, { mode, signal: controller.signal }));
            } catch (error) {
                console.error('Research failed:', error.message);
                if (!res.destroyed) res.status(error.status || 502).json({ error: ['TimeoutError', 'AbortError'].includes(error.name) ? 'Research timed out. Try fewer starting websites.' : error.message });
            } finally {
                if (reserved) active--;
                res.off('close', disconnect);
            }
        });
    }
    return router;
}
const db = createDatabase();
export default createResearchRouter({ db });
