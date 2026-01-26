/**
 * Email Personalization Service
 * Uses Claude AI to generate personalized email content for each lead
 *
 * Generates:
 * - firstName: Extracted or AI-derived first name
 * - openingLine: Custom opening about their business
 * - painPoint: Industry-relevant pain point
 * - valueProposition: Custom value proposition
 * - followUpHook: Reason for follow-up emails
 */

import { createClient } from '@supabase/supabase-js';

// Clean up URL and API key
const cleanEnvVar = (val) => val?.replace(/["';]/g, '').trim();
const claudeApiUrl = cleanEnvVar(process.env.CLAUDE_API_URL);
const claudeApiKey = cleanEnvVar(process.env.CLAUDE_API_KEY);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Rate limiting: minimum delay between API calls
const MIN_DELAY_MS = 1000;
let lastApiCall = 0;

/**
 * Call Claude API with rate limiting
 */
async function promptClaude(prompt, model = 'haiku') {
    if (!claudeApiUrl || !claudeApiKey) {
        throw new Error('Claude API not configured');
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCall;
    if (timeSinceLastCall < MIN_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_DELAY_MS - timeSinceLastCall));
    }
    lastApiCall = Date.now();

    const url = `${claudeApiUrl}/v1/claude`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': claudeApiKey,
        },
        body: JSON.stringify({ prompt, model }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.result || data.response || data.content || data;
}

/**
 * Generate personalized content for a lead
 * @param {Object} lead - Lead data
 * @param {Object} sequence - Email sequence data (includes campaign context)
 * @param {string} userId - User ID for fetching additional context
 * @returns {Object} Personalized content fields
 */
export async function generatePersonalizedContent(lead, sequence, userId) {
    // Default fallback values
    const defaults = {
        firstName: extractFirstName(lead.name) || 'there',
        openingLine: '',
        painPoint: '',
        valueProposition: '',
        followUpHook: '',
    };

    // If Claude not configured, return defaults
    if (!claudeApiUrl || !claudeApiKey) {
        console.warn('Claude API not configured - using default personalization');
        return defaults;
    }

    // Get campaign context if available
    let companyContext = '';
    let productIdea = '';

    if (sequence.campaign_id) {
        const { data: campaign } = await supabase
            .from('campaigns')
            .select('product_idea, company_context')
            .eq('id', sequence.campaign_id)
            .single();

        if (campaign) {
            productIdea = campaign.product_idea || '';
            companyContext = campaign.company_context || '';
        }
    }

    try {
        const prompt = `You are helping personalize a cold email for a specific business. Generate short, natural personalization fields.

LEAD INFORMATION:
- Business Name: ${lead.name || 'Unknown'}
- Industry/Category: ${lead.category || 'Unknown'}
- Location: ${lead.city || lead.address || 'Unknown'}
- Rating: ${lead.rating ? `${lead.rating}/5 (${lead.review_count || 0} reviews)` : 'Not available'}
- Website: ${lead.website || 'Not available'}

SENDER'S PRODUCT/SERVICE:
${productIdea || 'A business solution'}

${companyContext ? `SENDER'S COMPANY CONTEXT:\n${companyContext}` : ''}

Generate the following fields. Keep each one SHORT (1 sentence max). Be conversational, not salesy.

Return ONLY valid JSON in this exact format:
{
  "firstName": "Best guess at a first name or contact name, or 'there' if unknown",
  "openingLine": "A brief, specific observation about their business (use their name, industry, rating, or location)",
  "painPoint": "One specific pain point relevant to their industry that the sender's product solves",
  "valueProposition": "One sentence about how the sender can help them specifically",
  "followUpHook": "A reason to follow up (e.g., 'I wanted to share a quick case study' or 'Just checking if you had a chance to review')"
}`;

        const result = await promptClaude(prompt, 'haiku');

        // Parse JSON response
        let parsed;
        try {
            const jsonStr = typeof result === 'string'
                ? result.trim().replace(/^```json\n?|\n?```$/g, '')
                : JSON.stringify(result);
            parsed = JSON.parse(jsonStr);
        } catch {
            console.warn('Failed to parse personalization response, using defaults');
            return defaults;
        }

        return {
            firstName: parsed.firstName || defaults.firstName,
            openingLine: parsed.openingLine || defaults.openingLine,
            painPoint: parsed.painPoint || defaults.painPoint,
            valueProposition: parsed.valueProposition || defaults.valueProposition,
            followUpHook: parsed.followUpHook || defaults.followUpHook,
        };

    } catch (error) {
        console.error('Error generating personalized content:', error.message);
        return defaults;
    }
}

/**
 * Batch process leads for personalization when sequence activates
 * @param {string} sequenceId - Sequence ID
 * @param {Array} leadIds - Array of lead IDs to process
 */
export async function batchPersonalizeLeads(sequenceId, leadIds) {
    // Get sequence and campaign info
    const { data: sequence } = await supabase
        .from('email_sequences')
        .select('*, campaign:campaigns(*)')
        .eq('id', sequenceId)
        .single();

    if (!sequence) {
        throw new Error('Sequence not found');
    }

    const results = {
        processed: 0,
        failed: 0,
        errors: []
    };

    for (const leadId of leadIds) {
        try {
            // Get lead data
            const { data: lead } = await supabase
                .from('leads')
                .select('*')
                .eq('id', leadId)
                .single();

            if (!lead) {
                results.failed++;
                results.errors.push({ leadId, error: 'Lead not found' });
                continue;
            }

            // Generate personalized content
            const personalizedData = await generatePersonalizedContent(lead, sequence, sequence.user_id);

            // Update enrollment with personalized data
            await supabase
                .from('email_sequence_enrollments')
                .update({
                    personalized_data: personalizedData,
                    updated_at: new Date().toISOString()
                })
                .eq('sequence_id', sequenceId)
                .eq('lead_id', leadId);

            results.processed++;

        } catch (error) {
            results.failed++;
            results.errors.push({ leadId, error: error.message });
        }
    }

    return results;
}

/**
 * Extract first name from business/contact name
 */
function extractFirstName(name) {
    if (!name) return null;

    // Common business suffixes to remove
    const suffixes = ['LLC', 'Inc', 'Corp', 'Corporation', 'Ltd', 'Limited', 'Co', 'Company', 'Services', 'Solutions', 'Group', 'Associates', 'Partners'];
    let cleaned = name;

    for (const suffix of suffixes) {
        cleaned = cleaned.replace(new RegExp(`\\s*,?\\s*${suffix}\\.?\\s*$`, 'i'), '');
    }

    // Remove common prefixes
    const prefixes = ['The', 'Dr\\.?', 'Mr\\.?', 'Mrs\\.?', 'Ms\\.?'];
    for (const prefix of prefixes) {
        cleaned = cleaned.replace(new RegExp(`^${prefix}\\s+`, 'i'), '');
    }

    cleaned = cleaned.trim();

    // If it looks like a person's name (short, no ampersand, no common business words)
    const businessWords = ['dental', 'medical', 'law', 'firm', 'clinic', 'office', 'center', 'centre', 'store', 'shop', 'restaurant', 'cafe', 'bar', 'salon', 'spa', 'studio'];
    const lowerCleaned = cleaned.toLowerCase();
    const hasBusinessWord = businessWords.some(word => lowerCleaned.includes(word));

    const words = cleaned.split(/\s+/);

    // If 2-3 words and doesn't look like a business name, might be a person
    if (words.length >= 1 && words.length <= 3 && !cleaned.includes('&') && !hasBusinessWord) {
        // Return first word capitalized
        return words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
    }

    return null;
}

/**
 * Generate a follow-up email variation based on step number
 */
export function getFollowUpContext(stepNumber) {
    const contexts = {
        2: {
            subject_prefix: 'Quick follow-up: ',
            opening: "I wanted to follow up on my previous email",
            hook: "just checking if you had a chance to review"
        },
        3: {
            subject_prefix: 'Re: ',
            opening: "I hope I'm not being a pest, but I thought I'd reach out one more time",
            hook: "I have some new insights to share"
        },
        4: {
            subject_prefix: 'Final note: ',
            opening: "This will be my last email on this topic",
            hook: "I'd love to connect before moving on"
        },
        5: {
            subject_prefix: 'Breaking up: ',
            opening: "Since I haven't heard back, I'll assume the timing isn't right",
            hook: "Feel free to reach out if things change"
        }
    };

    return contexts[stepNumber] || contexts[2];
}

export default {
    generatePersonalizedContent,
    batchPersonalizeLeads,
    getFollowUpContext,
};
