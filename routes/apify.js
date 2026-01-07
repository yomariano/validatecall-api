import { Router } from 'express';

const router = Router();

// Clean up URL and API key (remove ALL quotes, semicolons, whitespace)
const cleanEnvVar = (val) => val?.replace(/["';]/g, '').trim();
const claudeApiUrl = cleanEnvVar(process.env.CLAUDE_API_URL);
const claudeApiKey = cleanEnvVar(process.env.CLAUDE_API_KEY);

// In-memory storage for lead generation runs (simulates async behavior for frontend compatibility)
const leadRuns = new Map();

// Helper to call Claude API for lead generation
const generateLeadsWithClaude = async (keyword, location, maxResults) => {
    if (!claudeApiUrl || !claudeApiKey) {
        throw new Error('Claude API not configured');
    }

    const prompt = `Generate ${maxResults} SYNTHETIC TEST DATA entries for a lead generation application demo/testing.

Create fictional "${keyword}" business entries for "${location}" with this EXACT JSON structure (no markdown, no explanation, just the JSON array):

[
  {
    "name": "Fictional Business Name",
    "phone": "+353-555-0001",
    "address": "123 Test Street",
    "city": "${location}",
    "website": "https://example.com",
    "rating": 4.5,
    "reviewCount": 125,
    "category": "${keyword}",
    "placeId": "test_place_id_1"
  }
]

Requirements:
- Generate exactly ${maxResults} entries
- Use realistic-looking but clearly FICTIONAL names (e.g., "Test Dental Clinic", "Sample Dentistry")
- Phone numbers should use +353 for Ireland with format +353-555-XXXX (555 indicates test numbers)
- Ratings between 3.5-5.0, review counts 10-500
- Return ONLY the JSON array, nothing else

This is synthetic data for application testing, not real business information.`;

    const url = `${claudeApiUrl}/prompt`;
    const body = { prompt, model: 'sonnet' };

    console.log(`[LeadGen] Calling Claude API to generate ${maxResults} leads for "${keyword}" in "${location}"`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 minute timeout for large requests

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': claudeApiKey,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const error = await response.text();
            console.error('[LeadGen] Claude API error:', response.status, error);
            throw new Error(`Claude API error (${response.status}): ${error}`);
        }

        const data = await response.json();
        const result = data.result || data.response || data.content || data;

        // Parse the JSON response
        let leads;
        try {
            const jsonStr = typeof result === 'string'
                ? result.trim().replace(/^```json\n?|\n?```$/g, '')
                : JSON.stringify(result);
            leads = JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('[LeadGen] Failed to parse Claude response:', result);
            throw new Error('Failed to parse lead generation response');
        }

        console.log(`[LeadGen] Generated ${leads.length} leads`);
        return leads;
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
};

// Check if Claude is configured (replaces Apify status check)
router.get('/status', (req, res) => {
    res.json({ configured: !!(claudeApiUrl && claudeApiKey) });
});

// Start lead generation with Claude (replaces Apify scrape)
router.post('/scrape', async (req, res) => {
    try {
        if (!claudeApiUrl || !claudeApiKey) {
            return res.status(400).json({ error: 'Claude API not configured for lead generation' });
        }

        const { keyword, location, maxResults = 100 } = req.body;

        if (!keyword || !location) {
            return res.status(400).json({ error: 'keyword and location are required' });
        }

        // Generate a unique run ID
        const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store initial run state
        leadRuns.set(runId, {
            status: 'RUNNING',
            keyword,
            location,
            maxResults,
            startedAt: new Date().toISOString(),
            leads: null,
            error: null,
        });

        console.log(`[LeadGen] Starting run ${runId} for "${keyword}" in "${location}"`);

        // Generate leads asynchronously
        generateLeadsWithClaude(keyword, location, maxResults)
            .then((leads) => {
                const run = leadRuns.get(runId);
                if (run) {
                    run.status = 'SUCCEEDED';
                    run.leads = leads;
                    run.finishedAt = new Date().toISOString();
                    console.log(`[LeadGen] Run ${runId} completed with ${leads.length} leads`);
                }
            })
            .catch((err) => {
                const run = leadRuns.get(runId);
                if (run) {
                    run.status = 'FAILED';
                    run.error = err.message;
                    run.finishedAt = new Date().toISOString();
                    console.error(`[LeadGen] Run ${runId} failed:`, err.message);
                }
            });

        // Return immediately with run ID (frontend will poll for status)
        res.json({
            data: {
                id: runId,
                status: 'RUNNING',
            }
        });
    } catch (error) {
        console.error('Lead generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get run status
router.get('/runs/:runId', async (req, res) => {
    try {
        const { runId } = req.params;
        const run = leadRuns.get(runId);

        if (!run) {
            return res.status(404).json({ error: 'Run not found' });
        }

        res.json({
            data: {
                id: runId,
                status: run.status,
                stats: {
                    leadsGenerated: run.leads?.length || 0,
                },
            }
        });
    } catch (error) {
        console.error('Run status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get run results
router.get('/runs/:runId/results', async (req, res) => {
    try {
        const { runId } = req.params;
        const run = leadRuns.get(runId);

        if (!run) {
            return res.status(404).json({ error: 'Run not found' });
        }

        if (run.status === 'FAILED') {
            return res.status(500).json({ error: run.error || 'Lead generation failed' });
        }

        if (run.status !== 'SUCCEEDED' || !run.leads) {
            return res.status(400).json({ error: 'Results not ready yet' });
        }

        // Filter leads with phone numbers (same as before)
        const leads = run.leads.filter(lead => lead.phone);
        console.log(`[LeadGen] Returning ${leads.length} leads for run ${runId}`);

        // Clean up old runs after returning results (keep for 5 minutes)
        setTimeout(() => {
            leadRuns.delete(runId);
        }, 5 * 60 * 1000);

        res.json(leads);
    } catch (error) {
        console.error('Results error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get recent runs (simplified - just returns empty for now)
router.get('/runs', async (req, res) => {
    try {
        const runs = Array.from(leadRuns.entries()).map(([id, run]) => ({
            id,
            status: run.status,
            keyword: run.keyword,
            location: run.location,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
        }));
        res.json({ data: { items: runs } });
    } catch (error) {
        console.error('Recent runs error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
