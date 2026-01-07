import { Router } from 'express';

const router = Router();

// Clean up URL and API key (remove ALL quotes, semicolons, whitespace)
const cleanEnvVar = (val) => val?.replace(/["';]/g, '').trim();
const claudeApiUrl = cleanEnvVar(process.env.CLAUDE_API_URL);
const claudeApiKey = cleanEnvVar(process.env.CLAUDE_API_KEY);

console.log('Claude API URL configured:', claudeApiUrl ? `${claudeApiUrl.substring(0, 20)}...` : 'NOT SET');

// Helper to call Claude API
const promptClaude = async (prompt, model = 'haiku') => {
    if (!claudeApiUrl || !claudeApiKey) {
        throw new Error('Claude API not configured');
    }

    const url = `${claudeApiUrl}/prompt`;
    const body = { prompt, model };

    console.log(`Calling Claude API at: ${url}`);
    console.log(`Request body:`, JSON.stringify(body).substring(0, 200) + '...');

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000); // 60 second timeout

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

        console.log(`Claude API response status: ${response.status}`);

        if (!response.ok) {
            const error = await response.text();
            console.error('Claude API response error:', response.status, error);
            throw new Error(`Claude API error (${response.status}): ${error}`);
        }

        const data = await response.json();
        console.log('Claude API response received:', typeof data);
        return data.result || data.response || data.content || data;
    } catch (err) {
        console.error('Claude API fetch error:', err.message);
        console.error('Full error:', err);
        throw err;
    }
};

// Generate improved text for AI voice agent product pitch
router.post('/generate', async (req, res) => {
    try {
        const { input, type } = req.body;

        if (!input || !input.trim()) {
            return res.status(400).json({ error: 'Input text is required' });
        }

        // Build the prompt based on type
        let systemPrompt = '';

        if (type === 'product') {
            systemPrompt = `You are helping create a compelling product/service pitch for an AI voice agent that will call potential customers for market research. The AI agent needs to explain the product/service clearly and concisely in a phone conversation.

Based on the user's simple description below, generate a professional, conversational pitch text that:
- Is clear and easy to understand when spoken aloud
- Highlights the key value proposition
- Is between 2-4 sentences
- Sounds natural and engaging, not salesy
- Is suitable for a cold call market research conversation

User's description: "${input.trim()}"

Generate only the improved pitch text, nothing else:`;
        } else if (type === 'context') {
            systemPrompt = `You are helping provide company context for an AI voice agent that will call potential customers for market research. This context helps the AI agent understand the company making the calls.

Based on the user's simple description below, generate professional company context that:
- Clearly explains what the company does
- Establishes credibility
- Is between 2-3 sentences
- Provides relevant background for market research calls

User's description: "${input.trim()}"

Generate only the improved company context text, nothing else:`;
        } else if (type === 'agent') {
            // For agent generation, the input is already a complete prompt
            // Just pass it through directly
            systemPrompt = input.trim();
        } else {
            systemPrompt = `Improve and expand the following text to be more professional and clear. Keep it concise (2-4 sentences):

"${input.trim()}"

Generate only the improved text, nothing else:`;
        }

        const result = await promptClaude(systemPrompt, 'haiku');

        res.json({
            generated: typeof result === 'string' ? result.trim() : result,
            original: input
        });
    } catch (error) {
        console.error('Claude generation error:', error);
        res.status(500).json({
            error: error.message || 'Failed to generate text'
        });
    }
});

// Classify a lead's industry based on name and available info
router.post('/classify-industry', async (req, res) => {
    try {
        const { leads } = req.body;

        if (!leads || !Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ error: 'leads array is required' });
        }

        // Build a batch prompt for efficiency
        const leadsInfo = leads.map((lead, i) =>
            `${i + 1}. "${lead.name}"${lead.category ? ` (${lead.category})` : ''}${lead.address ? ` - ${lead.address}` : ''}`
        ).join('\n');

        const prompt = `Classify these businesses into HIGH-LEVEL industry categories ONLY.

IMPORTANT: Use ONLY these exact industry names (pick the closest match):
- Real Estate
- Restaurant (for sit-down restaurants, fast food, takeaway)
- Coffee Shop (for cafés, coffee roasters, espresso bars, coffeehouses)
- Dental
- Legal
- Automotive
- Healthcare
- Retail
- Construction
- Beauty & Spa
- Fitness
- Education
- Technology
- Finance
- Hotel & Lodging
- Professional Services
- Home Services
- Manufacturing
- Transportation
- Entertainment
- Food & Beverage (for bakeries, bars, pubs, catering - NOT restaurants or coffee shops)
- Non-Profit
- Other

DO NOT use subcategories like "Real estate agent" or "Real estate agency" - just use "Real Estate".
DO NOT use subcategories like "Italian Restaurant" - just use "Restaurant".
Coffee shops, cafés, coffeehouses should ALL be classified as "Coffee Shop".

Businesses:
${leadsInfo}

Return ONLY a JSON array with "index" (1-based) and "industry" fields.
Example: [{"index":1,"industry":"Restaurant"},{"index":2,"industry":"Real Estate"}]

JSON:`;

        const result = await promptClaude(prompt, 'haiku');

        // Parse the JSON response
        let classifications;
        try {
            // Handle various response formats
            const jsonStr = typeof result === 'string'
                ? result.trim().replace(/^```json\n?|\n?```$/g, '')
                : JSON.stringify(result);
            classifications = JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('Failed to parse classification response:', result);
            return res.status(500).json({ error: 'Failed to parse AI response' });
        }

        // Map back to lead IDs
        const classified = leads.map((lead, i) => {
            const match = classifications.find(c => c.index === i + 1);
            return {
                id: lead.id,
                industry: match?.industry || 'Other'
            };
        });

        res.json({ classifications: classified });
    } catch (error) {
        console.error('Classification error:', error);
        res.status(500).json({ error: error.message || 'Failed to classify leads' });
    }
});

// Check if Claude API is configured
router.get('/status', (req, res) => {
    res.json({
        configured: !!(claudeApiUrl && claudeApiKey)
    });
});

export default router;
