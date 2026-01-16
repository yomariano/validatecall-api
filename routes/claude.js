import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// Allow self-signed certificates in development
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.log('[Claude] Development mode - allowing self-signed certificates');
}

// Initialize Supabase for free tier checks
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Atomically reserve leads for a free tier user
 * This prevents race conditions by checking AND incrementing in a single operation
 * Returns the number of leads that can actually be generated (capped to remaining)
 */
async function reserveFreeTierLeads(userId, requestedCount = 1) {
    if (!userId) return { canGenerate: true, isFreeTier: false, reserved: requestedCount };

    // Check for active subscription first
    const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('status')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();

    if (subscription) {
        return { canGenerate: true, isFreeTier: false, reserved: requestedCount };
    }

    // Get current usage
    let { data: usage } = await supabase
        .from('free_tier_usage')
        .select('leads_used, leads_limit')
        .eq('user_id', userId)
        .single();

    // Create record if doesn't exist
    if (!usage) {
        const { data: newUsage, error: createError } = await supabase
            .from('free_tier_usage')
            .insert({ user_id: userId, leads_used: 0 })
            .select()
            .single();

        if (createError) {
            console.error('Error creating usage record:', createError);
            return { canGenerate: false, isFreeTier: true, remaining: 0, error: 'Failed to create usage record' };
        }
        usage = newUsage;
    }

    const currentUsed = usage.leads_used;
    const limit = usage.leads_limit;
    const remaining = Math.max(0, limit - currentUsed);

    // If no remaining leads, reject
    if (remaining === 0) {
        return {
            canGenerate: false,
            isFreeTier: true,
            remaining: 0,
            used: currentUsed,
            limit: limit
        };
    }

    // Cap the requested count to remaining
    const toReserve = Math.min(requestedCount, remaining);
    const newTotal = currentUsed + toReserve;

    // ATOMIC: Update with condition to prevent race condition
    // Only update if the current value matches what we read (optimistic locking)
    const { data: updated, error: updateError } = await supabase
        .from('free_tier_usage')
        .update({ leads_used: newTotal })
        .eq('user_id', userId)
        .eq('leads_used', currentUsed) // Optimistic lock: only update if unchanged
        .select()
        .single();

    if (updateError || !updated) {
        // Race condition detected - another request modified the value
        // Retry once with fresh data
        console.log('[LeadGen] Race condition detected, retrying reservation...');

        const { data: freshUsage } = await supabase
            .from('free_tier_usage')
            .select('leads_used, leads_limit')
            .eq('user_id', userId)
            .single();

        if (!freshUsage) {
            return { canGenerate: false, isFreeTier: true, remaining: 0, error: 'Usage record not found' };
        }

        const freshRemaining = Math.max(0, freshUsage.leads_limit - freshUsage.leads_used);

        if (freshRemaining === 0) {
            return {
                canGenerate: false,
                isFreeTier: true,
                remaining: 0,
                used: freshUsage.leads_used,
                limit: freshUsage.leads_limit
            };
        }

        const toReserveRetry = Math.min(requestedCount, freshRemaining);
        const newTotalRetry = freshUsage.leads_used + toReserveRetry;

        const { data: retryUpdate, error: retryError } = await supabase
            .from('free_tier_usage')
            .update({ leads_used: newTotalRetry })
            .eq('user_id', userId)
            .eq('leads_used', freshUsage.leads_used)
            .select()
            .single();

        if (retryError || !retryUpdate) {
            // Still failing, reject the request
            return {
                canGenerate: false,
                isFreeTier: true,
                remaining: freshRemaining,
                error: 'Unable to reserve leads due to concurrent requests. Please try again.'
            };
        }

        return {
            canGenerate: true,
            isFreeTier: true,
            reserved: toReserveRetry,
            remaining: freshRemaining - toReserveRetry,
            used: newTotalRetry,
            limit: freshUsage.leads_limit
        };
    }

    return {
        canGenerate: true,
        isFreeTier: true,
        reserved: toReserve,
        remaining: remaining - toReserve,
        used: newTotal,
        limit: limit
    };
}

/**
 * Increment leads used count for free tier user
 */
async function incrementLeadsUsed(userId, count) {
    if (!userId) return;

    // Check if subscribed (don't track for paid users)
    const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('status')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();

    if (subscription) return;

    // Upsert usage
    const { data: currentUsage } = await supabase
        .from('free_tier_usage')
        .select('leads_used')
        .eq('user_id', userId)
        .single();

    if (currentUsage) {
        await supabase
            .from('free_tier_usage')
            .update({ leads_used: currentUsage.leads_used + count })
            .eq('user_id', userId);
    } else {
        await supabase
            .from('free_tier_usage')
            .insert({ user_id: userId, leads_used: count });
    }
}

// Clean up URL and API key (remove ALL quotes, semicolons, whitespace)
const cleanEnvVar = (val) => val?.replace(/["';]/g, '').trim();
const claudeApiUrl = cleanEnvVar(process.env.CLAUDE_API_URL);
const claudeApiKey = cleanEnvVar(process.env.CLAUDE_API_KEY);

console.log('Claude API URL configured:', claudeApiUrl ? `${claudeApiUrl.substring(0, 20)}...` : 'NOT SET');

// Helper to call Claude API
// Updated to use new /prompt endpoint with provider parameter
const promptClaude = async (prompt, model = 'sonnet', provider = 'claude') => {
    if (!claudeApiUrl || !claudeApiKey) {
        throw new Error('Claude API not configured');
    }

    const url = `${claudeApiUrl}/v1/claude`;
    const body = { prompt, model, provider };

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

        const result = await promptClaude(systemPrompt);

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

        const result = await promptClaude(prompt);

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

// Generate leads using Claude AI
router.post('/generate-leads', async (req, res) => {
    try {
        if (!claudeApiUrl || !claudeApiKey) {
            return res.status(400).json({ error: 'Claude API not configured for lead generation' });
        }

        const { keyword, location, maxResults = 100, userId } = req.body;

        if (!keyword || !location) {
            return res.status(400).json({ error: 'keyword and location are required' });
        }

        // Skip free tier limits in development mode
        const isDevelopment = process.env.NODE_ENV !== 'production';

        let reservation = { canGenerate: true, isFreeTier: false, reserved: maxResults };

        if (!isDevelopment) {
            // Atomically reserve leads (prevents race conditions) - only in production
            reservation = await reserveFreeTierLeads(userId, maxResults);

            if (!reservation.canGenerate) {
                return res.status(403).json({
                    error: reservation.error || 'Free tier lead limit reached',
                    upgradeRequired: true,
                    isFreeTier: true,
                    used: reservation.used,
                    limit: reservation.limit,
                    remaining: reservation.remaining
                });
            }
        } else {
            console.log('[LeadGen] Development mode - skipping free tier limits');
        }

        // Use the reserved count (already capped to remaining for free tier)
        const effectiveMaxResults = reservation.isFreeTier
            ? reservation.reserved
            : maxResults;

        // Generate unique prefix for place_ids to avoid duplicates
        const uniquePrefix = `${keyword.replace(/\s+/g, '_')}_${location.replace(/\s+/g, '_')}_${Date.now()}`;

        const prompt = `Generate ${effectiveMaxResults} SYNTHETIC TEST DATA entries for a lead generation application demo/testing.

Create fictional "${keyword}" business entries for "${location}" with this EXACT JSON structure (no markdown, no explanation, just the JSON array):

[
  {
    "name": "Fictional Business Name",
    "phone": "+353-555-0001",
    "email": "contact@fictional-business.com",
    "address": "123 Test Street",
    "city": "${location}",
    "website": "https://example.com",
    "rating": 4.5,
    "reviewCount": 125,
    "category": "${keyword}",
    "placeId": "${uniquePrefix}_001"
  }
]

Requirements:
- Generate exactly ${effectiveMaxResults} entries
- Use realistic-looking but clearly FICTIONAL names (e.g., "Test Dental Clinic", "Sample Dentistry")
- Phone numbers should use +353 for Ireland with format +353-555-XXXX (555 indicates test numbers)
- Email addresses should be realistic business emails (e.g., info@businessname.com, contact@businessname.ie)
- Ratings between 3.5-5.0, review counts 10-500
- Each placeId MUST be unique and start with "${uniquePrefix}_" followed by a unique number (001, 002, etc.)
- Return ONLY the JSON array, nothing else

This is synthetic data for application testing, not real business information.`;

        console.log(`[LeadGen] Generating ${maxResults} leads for "${keyword}" in "${location}"`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

        try {
            const response = await fetch(`${claudeApiUrl}/v1/claude`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': claudeApiKey,
                },
                body: JSON.stringify({ prompt, model: 'sonnet', provider: 'claude' }),
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

            // Filter leads with phone numbers
            const filteredLeads = leads.filter(lead => lead.phone);
            console.log(`[LeadGen] Generated ${filteredLeads.length} leads (reserved: ${reservation.reserved})`);

            // Note: Usage was already reserved atomically before generation
            // No need to increment again - prevents race conditions

            res.json({ leads: filteredLeads, isFreeTier: reservation.isFreeTier });
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    } catch (error) {
        console.error('Lead generation error:', error);
        console.error('Claude API URL:', claudeApiUrl ? 'configured' : 'NOT SET');
        console.error('Claude API Key:', claudeApiKey ? 'configured' : 'NOT SET');
        res.status(500).json({
            error: error.message,
            claudeConfigured: !!(claudeApiUrl && claudeApiKey)
        });
    }
});

export default router;
