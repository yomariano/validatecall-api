import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

const VAPI_API_URL = 'https://api.vapi.ai';
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PUBLIC_KEY = process.env.VAPI_PUBLIC_KEY;

// VoIPcloud configuration for Irish calls
const VOIPCLOUD_API_URL = 'https://ie.voipcloud.online';
const VOIPCLOUD_TOKEN = process.env.VOIPCLOUD_API_TOKEN;
const VOIPCLOUD_USER_NUMBER = process.env.VOIPCLOUD_USER_NUMBER || '1001'; // Extension that routes to VAPI
const VOIPCLOUD_CALLER_ID = process.env.VOIPCLOUD_CALLER_ID; // Irish caller ID

/**
 * Check if a phone number is Irish (+353)
 */
function isIrishNumber(phoneNumber) {
    const cleaned = phoneNumber.replace(/\s/g, '');
    return cleaned.startsWith('+353') || cleaned.startsWith('353') || cleaned.startsWith('08');
}

/**
 * Make a call via VoIPcloud (for Irish numbers)
 * VoIPcloud calls VAPI (via SIP trunk) → VAPI answers → bridges to destination
 */
async function makeVoIPcloudCall(destinationNumber, callerId) {
    if (!VOIPCLOUD_TOKEN) {
        throw new Error('VoIPcloud API token not configured');
    }

    console.log(`📞 [VoIPcloud] Calling ${destinationNumber} via Irish trunk`);

    const response = await fetch(`${VOIPCLOUD_API_URL}/api/integration/v2/call-to-number`, {
        method: 'POST',
        headers: {
            'token': VOIPCLOUD_TOKEN,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            user_number: VOIPCLOUD_USER_NUMBER,
            number_to_call: destinationNumber,
            caller_id: callerId || VOIPCLOUD_CALLER_ID || VOIPCLOUD_USER_NUMBER,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'VoIPcloud call failed' }));
        throw new Error(error.message || `VoIPcloud error: ${response.status}`);
    }

    return response.json();
}

/**
 * Determine the call outcome based on endedReason and transcript
 * Returns: 'human', 'voicemail', 'ivr', 'no_answer', 'busy', 'failed'
 */
function determineCallOutcome(endedReason, transcript, messages) {
    // Check VAPI's endedReason first
    const reason = (endedReason || '').toLowerCase();

    // Voicemail detection via AMD
    if (reason.includes('voicemail') || reason.includes('machine')) {
        return 'voicemail';
    }

    // No answer / busy signals
    if (reason.includes('no-answer') || reason.includes('timeout')) {
        return 'no_answer';
    }
    if (reason.includes('busy')) {
        return 'busy';
    }
    if (reason.includes('failed') || reason.includes('error')) {
        return 'failed';
    }

    // Check if endCall function was called with IVR reason
    if (messages && Array.isArray(messages)) {
        for (const msg of messages) {
            if (msg.role === 'tool_calls' || msg.toolCalls) {
                const toolCalls = msg.toolCalls || msg.tool_calls || [];
                for (const tool of toolCalls) {
                    if (tool.function?.name === 'endCall') {
                        const args = typeof tool.function.arguments === 'string'
                            ? JSON.parse(tool.function.arguments)
                            : tool.function.arguments;
                        if (args?.reason === 'ivr_detected') {
                            return 'ivr';
                        }
                        if (args?.reason === 'voicemail_detected') {
                            return 'voicemail';
                        }
                    }
                }
            }
        }
    }

    // Check transcript for IVR patterns (fallback detection)
    const transcriptLower = (transcript || '').toLowerCase();
    const ivrPatterns = [
        'press 1', 'press 2', 'press 3', 'press 4',
        'for sales', 'for support', 'for billing',
        'your call is important', 'please hold',
        'all representatives are busy', 'leave a message',
        'after the beep', 'after the tone'
    ];

    for (const pattern of ivrPatterns) {
        if (transcriptLower.includes(pattern)) {
            return 'ivr';
        }
    }

    // Default: assume human interaction
    return 'human';
}

// Initialize Supabase for multi-tenant phone rotation
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =============================================
// MULTI-TENANT PHONE ROTATION (Database-based)
// =============================================

/**
 * Get next available phone number for a user from database
 * Uses the database function for atomic operation
 */
async function getUserPhoneNumber(userId) {
    // First, reset any numbers that need daily reset
    const today = new Date().toISOString().split('T')[0];

    await supabase
        .from('user_phone_numbers')
        .update({ daily_calls_used: 0, last_reset_date: today })
        .eq('user_id', userId)
        .lt('last_reset_date', today);

    // Get the phone number with lowest usage that's under limit
    const { data: phoneNumber, error } = await supabase
        .from('user_phone_numbers')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('daily_calls_used', { ascending: true })
        .limit(1)
        .single();

    if (error || !phoneNumber) {
        return null;
    }

    // Check if under limit
    if (phoneNumber.daily_calls_used >= phoneNumber.daily_calls_limit) {
        return null;
    }

    return phoneNumber;
}

/**
 * Increment usage for a phone number
 */
async function incrementPhoneUsage(phoneNumberId, userId, callId = null) {
    // Update the phone number usage
    const { error } = await supabase.rpc('increment_phone_usage', {
        p_phone_number_id: phoneNumberId,
        p_user_id: userId,
        p_call_id: callId
    });

    // Fallback if RPC doesn't exist
    if (error) {
        await supabase
            .from('user_phone_numbers')
            .update({
                daily_calls_used: supabase.raw('daily_calls_used + 1'),
                total_calls_made: supabase.raw('total_calls_made + 1'),
            })
            .eq('phone_number_id', phoneNumberId)
            .eq('user_id', userId);
    }

    return true;
}

/**
 * Get user's phone stats from database
 */
async function getUserPhoneStats(userId) {
    const { data: numbers, error } = await supabase
        .from('user_phone_numbers')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

    if (error || !numbers) {
        return {
            totalNumbers: 0,
            activeNumbers: 0,
            totalDailyCapacity: 0,
            usedToday: 0,
            remainingToday: 0,
            numbers: [],
        };
    }

    const totalDailyCapacity = numbers.reduce((sum, n) => sum + n.daily_calls_limit, 0);
    const usedToday = numbers.reduce((sum, n) => sum + n.daily_calls_used, 0);

    return {
        totalNumbers: numbers.length,
        activeNumbers: numbers.filter(n => n.status === 'active').length,
        totalDailyCapacity,
        usedToday,
        remainingToday: totalDailyCapacity - usedToday,
        numbers: numbers.map(n => ({
            id: n.id,
            phoneNumber: n.phone_number,
            phoneNumberId: n.phone_number_id,
            dailyCallsUsed: n.daily_calls_used,
            dailyCallsLimit: n.daily_calls_limit,
            remaining: n.daily_calls_limit - n.daily_calls_used,
            available: n.daily_calls_used < n.daily_calls_limit,
            totalCallsMade: n.total_calls_made,
        })),
    };
}

// Phone Number Rotation System
class PhoneNumberRotator {
    constructor() {
        // Parse phone numbers from env (comma-separated)
        const phoneNumberIds = process.env.VAPI_PHONE_NUMBER_IDS || '';
        this.phoneNumbers = phoneNumberIds.split(',').map(id => id.trim()).filter(Boolean);

        // Fallback to legacy single number if new env not set
        if (this.phoneNumbers.length === 0 && process.env.VAPI_PHONE_NUMBER_ID) {
            this.phoneNumbers = [process.env.VAPI_PHONE_NUMBER_ID];
        }

        // Max calls per number per day
        this.maxCallsPerDay = parseInt(process.env.VAPI_MAX_CALLS_PER_NUMBER_PER_DAY) || 50;

        // Track usage: { phoneNumberId: { date: 'YYYY-MM-DD', count: number } }
        this.usage = {};

        // Current index for round-robin
        this.currentIndex = 0;

        console.log(`📞 Phone Rotator initialized with ${this.phoneNumbers.length} number(s), max ${this.maxCallsPerDay} calls/day each`);
    }

    getTodayDate() {
        return new Date().toISOString().split('T')[0];
    }

    getUsageForNumber(phoneNumberId) {
        const today = this.getTodayDate();
        if (!this.usage[phoneNumberId] || this.usage[phoneNumberId].date !== today) {
            this.usage[phoneNumberId] = { date: today, count: 0 };
        }
        return this.usage[phoneNumberId];
    }

    incrementUsage(phoneNumberId) {
        const usage = this.getUsageForNumber(phoneNumberId);
        usage.count++;
    }

    isNumberAvailable(phoneNumberId) {
        const usage = this.getUsageForNumber(phoneNumberId);
        return usage.count < this.maxCallsPerDay;
    }

    // Get next available phone number using round-robin with daily limit check
    getNextPhoneNumber() {
        if (this.phoneNumbers.length === 0) {
            return null;
        }

        // Try each number starting from current index
        for (let i = 0; i < this.phoneNumbers.length; i++) {
            const index = (this.currentIndex + i) % this.phoneNumbers.length;
            const phoneNumberId = this.phoneNumbers[index];

            if (this.isNumberAvailable(phoneNumberId)) {
                this.currentIndex = (index + 1) % this.phoneNumbers.length;
                return phoneNumberId;
            }
        }

        // All numbers exhausted for today
        return null;
    }

    // Use a phone number and track it
    usePhoneNumber() {
        const phoneNumberId = this.getNextPhoneNumber();
        if (phoneNumberId) {
            this.incrementUsage(phoneNumberId);
        }
        return phoneNumberId;
    }

    // Get stats for all numbers
    getStats() {
        return this.phoneNumbers.map(id => ({
            phoneNumberId: id,
            todayCalls: this.getUsageForNumber(id).count,
            maxCallsPerDay: this.maxCallsPerDay,
            available: this.isNumberAvailable(id),
            remainingCalls: this.maxCallsPerDay - this.getUsageForNumber(id).count,
        }));
    }

    // Get total remaining capacity
    getTotalRemainingCapacity() {
        return this.phoneNumbers.reduce((total, id) => {
            return total + (this.maxCallsPerDay - this.getUsageForNumber(id).count);
        }, 0);
    }
}

// Initialize global rotator instance
const phoneRotator = new PhoneNumberRotator();

// Check if Vapi is configured
router.get('/status', (req, res) => {
    res.json({
        configured: !!VAPI_API_KEY,
        hasPhoneNumber: phoneRotator.phoneNumbers.length > 0,
        phoneNumberCount: phoneRotator.phoneNumbers.length,
        totalRemainingCapacity: phoneRotator.getTotalRemainingCapacity(),
    });
});

// =============================================
// VAPI WEBHOOK - Receives call updates and transcripts
// =============================================
router.post('/webhook', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(200).json({ received: true });
        }

        const { type, call } = message;

        console.log(`📥 [VAPI Webhook] ${type} for call ${call?.id}`);

        // Handle end-of-call-report - contains transcript, recording, analysis
        if (type === 'end-of-call-report') {
            const {
                transcript,
                recordingUrl,
                summary,
                endedReason,
                messages,
                analysis,
            } = message;

            // Find and update the call in database
            if (call?.id) {
                // Determine if call reached a human, voicemail, or IVR
                const callOutcome = determineCallOutcome(endedReason, transcript, messages);

                console.log(`📊 Call ${call.id} outcome: ${callOutcome} (endedReason: ${endedReason})`);

                const { error } = await supabase
                    .from('calls')
                    .update({
                        status: 'completed',
                        ended_at: new Date().toISOString(),
                        duration_seconds: call.duration ? Math.round(call.duration) : null,
                        recording_url: recordingUrl,
                        transcript: transcript,
                        transcript_json: messages,
                        summary: summary || analysis?.summary,
                        sentiment: analysis?.sentiment,
                        raw_response: message,
                        call_outcome: callOutcome,
                        ended_reason: endedReason,
                    })
                    .eq('vapi_call_id', call.id);

                if (error) {
                    console.error('Failed to update call:', error);
                } else {
                    console.log(`✅ Call ${call.id} updated with transcript (outcome: ${callOutcome})`);
                }
            }
        }

        // Handle status-update - call state changes
        if (type === 'status-update') {
            const { status } = message;

            if (call?.id && status) {
                await supabase
                    .from('calls')
                    .update({
                        status: status,
                        started_at: status === 'in-progress' ? new Date().toISOString() : undefined,
                    })
                    .eq('vapi_call_id', call.id);
            }
        }

        res.status(200).json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(200).json({ received: true, error: error.message });
    }
});

// Get public key for web SDK (real-time voice testing)
router.get('/public-key', (req, res) => {
    if (!VAPI_PUBLIC_KEY) {
        return res.status(400).json({
            error: 'VAPI_PUBLIC_KEY not configured. Add it to server/.env to enable voice testing.',
            configured: false
        });
    }
    res.json({
        publicKey: VAPI_PUBLIC_KEY,
        configured: true
    });
});

// Get phone number rotation stats
router.get('/phone-stats', (req, res) => {
    res.json({
        numbers: phoneRotator.getStats(),
        totalNumbers: phoneRotator.phoneNumbers.length,
        totalRemainingCapacity: phoneRotator.getTotalRemainingCapacity(),
        maxCallsPerNumberPerDay: phoneRotator.maxCallsPerDay,
    });
});

// Create market research assistant configuration
const createMarketResearchAssistant = (productIdea, companyContext) => ({
    name: "Market Research Agent",
    model: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
            {
                role: "system",
                content: `You are a friendly and professional market research agent conducting brief phone surveys. Your goal is to validate a product idea by gathering genuine feedback.

PRODUCT BEING RESEARCHED:
${productIdea}

COMPANY CONTEXT:
${companyContext || 'Independent market research'}

CRITICAL - IVR/AUTOMATED SYSTEM DETECTION:
If you hear ANY of the following, immediately use the endCall function to hang up:
- "Press 1", "Press 2", "Dial", "Enter your", "Press star", "Press pound"
- "Your call is important to us", "Please hold", "All representatives are busy"
- "For sales press", "For support press", "For billing press", "For English press"
- Repetitive menu options or clearly robotic/synthesized voices
- Music on hold for more than 3 seconds without human speech
- "Leave a message after the beep", "Please leave your message"
- "The person you are trying to reach", "is not available"
- "This call may be recorded", followed by menu options
Do NOT attempt to interact with automated systems - just hang up immediately.

CALL SCRIPT:
1. OPENING (Keep brief - 15 seconds max):
   - Greet warmly and introduce yourself
   - Ask: "Do you have 2 minutes for a brief survey? Your feedback would be incredibly valuable."
   - If no: Thank them politely and end call.

2. QUALIFICATION (30 seconds):
   - Ask if they or their business might benefit from a solution in this space
   - Listen actively for pain points

3. PRODUCT PITCH (45 seconds):
   - Present the product idea simply and clearly
   - Ask: "Does this sound like something that would be useful to you?"

4. GATHER FEEDBACK (60 seconds):
   - "On a scale of 1-10, how interested would you be?"
   - "What would make this a must-have for you?"
   - "What's your biggest hesitation?"
   - "What would you expect to pay for something like this?"

5. CLOSING (15 seconds):
   - Thank them genuinely
   - Ask if they'd like to be notified when it launches
   - If yes, confirm their contact info

TONE GUIDELINES:
- Be conversational, not salesy
- Listen more than you talk
- Don't push if they're not interested
- Take notes on objections and enthusiasm levels
- Be respectful of their time

NEGOTIATION APPROACH:
- If they show interest but hesitate on price, explore what features matter most
- If they're skeptical, acknowledge concerns and ask what would change their mind
- Never be pushy - genuine feedback is more valuable than forced positivity`
            }
        ],
        tools: [
            {
                type: "function",
                function: {
                    name: "endCall",
                    description: "End the call immediately. Use this when you detect an IVR system, automated menu, voicemail, or any non-human answering the call.",
                    parameters: {
                        type: "object",
                        properties: {
                            reason: {
                                type: "string",
                                enum: ["ivr_detected", "voicemail_detected", "no_answer", "customer_declined", "call_completed"],
                                description: "The reason for ending the call"
                            }
                        },
                        required: ["reason"]
                    }
                }
            }
        ]
    },
    voice: {
        provider: "11labs",
        voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel - professional female voice
    },
    voicemailDetection: {
        provider: "twilio",
        enabled: true,
        voicemailDetectionTypes: ["machine_end_beep", "machine_end_silence", "machine_end_other"],
        machineDetectionTimeout: 30,
        machineDetectionSpeechThreshold: 2400,
        machineDetectionSpeechEndThreshold: 1200,
        machineDetectionSilenceTimeout: 5000
    },
    firstMessage: "Hi there! I'm calling on behalf of a quick market research study. Do you have about 2 minutes to share your thoughts on a new product idea? Your feedback would be really helpful!",
    endCallMessage: "Thank you so much for your time today! Your feedback is incredibly valuable. Have a great day!",
});

// Initiate a single call
router.post('/call', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const {
            phoneNumber,
            customerName,
            productIdea,
            companyContext,
            assistant: customAssistant,
            assistantId // ID of pre-configured assistant from Vapi
        } = req.body;

        if (!phoneNumber) {
            return res.status(400).json({ error: 'phoneNumber is required' });
        }

        // Route Irish calls through VoIPcloud
        if (isIrishNumber(phoneNumber)) {
            if (!VOIPCLOUD_TOKEN) {
                return res.status(400).json({
                    error: 'Irish calls require VoIPcloud configuration. Set VOIPCLOUD_API_TOKEN in .env',
                    isIrishNumber: true,
                });
            }

            console.log(`📞 Routing Irish number ${phoneNumber} via VoIPcloud`);
            try {
                const voipcloudData = await makeVoIPcloudCall(phoneNumber);
                return res.json({
                    id: voipcloudData.call_id || `voipcloud-${Date.now()}`,
                    provider: 'voipcloud',
                    status: 'initiated',
                    phoneNumber,
                    customerName,
                    ...voipcloudData,
                });
            } catch (voipError) {
                console.error('VoIPcloud call failed:', voipError.message);
                return res.status(500).json({ error: voipError.message });
            }
        }

        // Get next available phone number from rotation
        const phoneNumberId = phoneRotator.usePhoneNumber();
        if (!phoneNumberId) {
            return res.status(429).json({
                error: 'All phone numbers have reached their daily limit',
                remainingCapacity: 0,
                suggestion: 'Add more phone numbers or wait until tomorrow'
            });
        }

        // Build the call payload
        const callPayload = {
            phoneNumberId: phoneNumberId,
            customer: {
                number: phoneNumber,
                name: customerName || 'Prospect',
            },
        };

        // If an assistantId is provided, use the pre-configured assistant
        if (assistantId) {
            callPayload.assistantId = assistantId;

            // If product idea is also provided, override the assistant's messages
            if (productIdea) {
                const researchAssistant = createMarketResearchAssistant(productIdea, companyContext);
                callPayload.assistantOverrides = {
                    // Override the model with IVR detection prompt and tools
                    model: {
                        provider: researchAssistant.model.provider,
                        model: researchAssistant.model.model,
                        messages: researchAssistant.model.messages,
                        tools: researchAssistant.model.tools, // Include endCall tool for IVR detection
                    },
                    firstMessage: researchAssistant.firstMessage,
                    voicemailDetection: researchAssistant.voicemailDetection, // Include AMD
                };
            } else {
                // Even without product idea, add voicemail detection to the pre-configured assistant
                const researchAssistant = createMarketResearchAssistant('', '');
                callPayload.assistantOverrides = {
                    voicemailDetection: researchAssistant.voicemailDetection,
                    model: {
                        tools: researchAssistant.model.tools,
                    },
                };
            }
        } else {
            // Otherwise, use the custom assistant or create a dynamic one
            callPayload.assistant = customAssistant || createMarketResearchAssistant(productIdea, companyContext);
        }

        // Log the payload for debugging
        console.log('📞 Vapi Call Payload:', JSON.stringify(callPayload, null, 2));

        const response = await fetch(`${VAPI_API_URL}/call/phone`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(callPayload),
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                error: error.message || 'Failed to initiate call'
            });
        }

        const data = await response.json();
        res.json({
            ...data,
            _rotation: {
                phoneNumberIdUsed: phoneNumberId,
                remainingCapacity: phoneRotator.getTotalRemainingCapacity(),
            }
        });
    } catch (error) {
        console.error('Vapi call error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch initiate calls
router.post('/calls/batch', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const { phoneNumbers, productIdea, companyContext, delayMs = 2000 } = req.body;

        if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
            return res.status(400).json({ error: 'phoneNumbers array is required' });
        }

        // Check if we have enough capacity
        const remainingCapacity = phoneRotator.getTotalRemainingCapacity();
        if (remainingCapacity === 0) {
            return res.status(429).json({
                error: 'All phone numbers have reached their daily limit',
                remainingCapacity: 0,
                requestedCalls: phoneNumbers.length,
                suggestion: 'Add more phone numbers or wait until tomorrow'
            });
        }

        // Warn if not enough capacity for all calls
        const capacityWarning = phoneNumbers.length > remainingCapacity
            ? `Warning: Only ${remainingCapacity} of ${phoneNumbers.length} calls can be made today`
            : null;

        const assistant = createMarketResearchAssistant(productIdea, companyContext);
        const results = [];
        let skippedDueToCapacity = 0;

        for (let i = 0; i < phoneNumbers.length; i++) {
            // Get next available phone number from rotation
            const outboundPhoneNumberId = phoneRotator.usePhoneNumber();

            if (!outboundPhoneNumberId) {
                // No more capacity - mark remaining as skipped
                results.push({
                    phoneNumber: phoneNumbers[i].number,
                    status: 'skipped',
                    error: 'Daily call limit reached for all phone numbers',
                });
                skippedDueToCapacity++;
                continue;
            }

            try {
                const response = await fetch(`${VAPI_API_URL}/call/phone`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${VAPI_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        phoneNumberId: outboundPhoneNumberId,
                        customer: {
                            number: phoneNumbers[i].number,
                            name: phoneNumbers[i].name || 'Prospect',
                        },
                        assistant,
                    }),
                });

                if (response.ok) {
                    const result = await response.json();
                    results.push({
                        phoneNumber: phoneNumbers[i].number,
                        status: 'initiated',
                        callId: result.id,
                        outboundPhoneNumberId,
                        result,
                    });
                } else {
                    const error = await response.json();
                    results.push({
                        phoneNumber: phoneNumbers[i].number,
                        status: 'failed',
                        outboundPhoneNumberId,
                        error: error.message,
                    });
                }
            } catch (error) {
                results.push({
                    phoneNumber: phoneNumbers[i].number,
                    status: 'failed',
                    outboundPhoneNumberId,
                    error: error.message,
                });
            }

            // Add delay between calls to avoid rate limiting
            if (i < phoneNumbers.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        res.json({
            results,
            summary: {
                total: phoneNumbers.length,
                initiated: results.filter(r => r.status === 'initiated').length,
                failed: results.filter(r => r.status === 'failed').length,
                skipped: skippedDueToCapacity,
                remainingCapacity: phoneRotator.getTotalRemainingCapacity(),
                capacityWarning,
            }
        });
    } catch (error) {
        console.error('Vapi batch call error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get call status
router.get('/calls/:callId', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const { callId } = req.params;

        const response = await fetch(`${VAPI_API_URL}/call/${callId}`, {
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
            },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to get call status' });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Vapi call status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all calls
router.get('/calls', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const limit = req.query.limit || 100;

        const response = await fetch(`${VAPI_API_URL}/call?limit=${limit}`, {
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
            },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch calls' });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Vapi get all calls error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all assistants
router.get('/assistants', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const limit = req.query.limit || 100;

        const response = await fetch(`${VAPI_API_URL}/assistant?limit=${limit}`, {
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
            },
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                error: error.message || 'Failed to fetch assistants'
            });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Vapi get assistants error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single assistant by ID
router.get('/assistants/:assistantId', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const { assistantId } = req.params;

        const response = await fetch(`${VAPI_API_URL}/assistant/${assistantId}`, {
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
            },
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                error: error.message || 'Failed to fetch assistant'
            });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Vapi get assistant error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create new assistant
router.post('/assistants', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const assistantConfig = req.body;

        const response = await fetch(`${VAPI_API_URL}/assistant`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(assistantConfig),
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                error: error.message || 'Failed to create assistant'
            });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Vapi create assistant error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update assistant
router.patch('/assistants/:assistantId', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const { assistantId } = req.params;
        const updates = req.body;

        const response = await fetch(`${VAPI_API_URL}/assistant/${assistantId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updates),
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                error: error.message || 'Failed to update assistant'
            });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Vapi update assistant error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete assistant
router.delete('/assistants/:assistantId', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const { assistantId } = req.params;

        const response = await fetch(`${VAPI_API_URL}/assistant/${assistantId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
            },
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                error: error.message || 'Failed to delete assistant'
            });
        }

        res.json({ success: true, message: 'Assistant deleted' });
    } catch (error) {
        console.error('Vapi delete assistant error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get available voices from different providers
router.get('/voices', async (req, res) => {
    // Return comprehensive list of voices available in VAPI
    // VAPI doesn't have a public API to list voices, so we maintain this list
    res.json({
        '11labs': ELEVENLABS_VOICES,
        'openai': OPENAI_VOICES,
        'deepgram': DEEPGRAM_VOICES,
    });
});

// Comprehensive ElevenLabs voices available in VAPI (unique IDs only)
const ELEVENLABS_VOICES = [
    // Core ElevenLabs voices
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', description: 'Calm, young - American' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female', description: 'Soft, warm - American' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'female', description: 'Emotional range - American' },
    { id: 'jsCqWAovK2LkecY7zXl4', name: 'Freya', gender: 'female', description: 'Expressive, dramatic - American' },
    { id: 'oWAxZDx7w5VEj9dCyTzz', name: 'Grace', gender: 'female', description: 'Southern accent - American' },
    { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', description: 'Seductive, calm - Swedish' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', description: 'Warm, clear - British' },
    { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', gender: 'female', description: 'Childlike, cute - American' },
    { id: 'z9fAnlkpzviPz146aGWa', name: 'Glinda', gender: 'female', description: 'Mysterious - American' },
    { id: 'piTKgcLEGmPE4e6mEKli', name: 'Nicole', gender: 'female', description: 'Soft, whisper - American' },
    { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', description: 'Warm, friendly - American' },
    { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', gender: 'female', description: 'Pleasant, young - British' },
    { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'female', description: 'Strong, confident - American' },
    { id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily', gender: 'female', description: 'Calm, gentle - American' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Lana', gender: 'female', description: 'Young, soft - American' },
    { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', gender: 'female', description: 'Confident, bold - American' },
    { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', description: 'Expressive, upbeat - American' },
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female', description: 'Upbeat, friendly - American' },
    { id: 'pqHfZKP75CvOlQylNhV4', name: 'Serena', gender: 'female', description: 'Soft, pleasant - American' },
    { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'female', description: 'Confident - British' },

    // Male voices
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', description: 'Deep narrator - British' },
    { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', description: 'Intense - Transatlantic' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', description: 'Conversational - Australian' },
    { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', gender: 'male', description: 'Friendly - American' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', description: 'Warm - British' },
    { id: 'SOYHLrjzK2X1ezoPC6cr', name: 'Harry', gender: 'male', description: 'Anxious - British' },
    { id: 'ODq5zmih8GrVes37Dizd', name: 'Patrick', gender: 'male', description: 'Shouty - Irish' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'male', description: 'Well-rounded - American' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'male', description: 'Crisp, narrative - American' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', description: 'Deep, authoritative - American' },
    { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'male', description: 'Raspy, dynamic - American' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', description: 'Deep, young - American' },
    { id: 'ZQe5CZNOzWyzPSCn5a3c', name: 'James', gender: 'male', description: 'Calm - Australian' },
    { id: 'bVMeCyTHy58xNoL34h3p', name: 'Jeremy', gender: 'male', description: 'Excited - Irish' },
    { id: 'flq6f7yk4E4fJM5XTYuZ', name: 'Michael', gender: 'male', description: 'Older, deep - American' },
    { id: 'GBv7mTt0atIp3Br8iCZE', name: 'Thomas', gender: 'male', description: 'Calm, young - American' },
    { id: 'Yko7PKHZNXotIFUBG7I9', name: 'Ethan', gender: 'male', description: 'Deep - American' },
    { id: 'g5CIjZEefAph4nQFvHAz', name: 'Clyde', gender: 'male', description: 'War veteran - American' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', description: 'Deep - British' },
    { id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', gender: 'male', description: 'Conversational - Essex' },
    { id: 'D38z5RcWu1voky8WS1ja', name: 'Fin', gender: 'male', description: 'Sailor, old - Irish' },
    { id: 't0jbNlBVZ17f02VDIeMI', name: 'Jessie', gender: 'male', description: 'Raspy, old - American' },
    { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'male', description: 'Casual, young - American' },
    { id: '5Q0t7uMcjvnagumLfvZi', name: 'Paul', gender: 'male', description: 'Narrative - American' },

    // Additional VAPI featured voices
    { id: 'bIHbv24MWmeRgasZH58o', name: 'Payne', gender: 'male', description: 'Conversational - American' },
    { id: 'knrPHWnBmmDHMoiMeP3l', name: 'Raquel', gender: 'female', description: 'Conversational - Brazilian' },
    { id: 'pMsXgVXv3BLzUgSXRplE', name: 'Sean', gender: 'male', description: 'Natural - American' },
    { id: '9BWtsMINqrJLrRacOk9x', name: 'Louise', gender: 'female', description: 'Customer service - Swedish' },
    { id: 'zcAOhNBS3c14rBihAFp1', name: 'Giovanni', gender: 'male', description: 'Italian' },
    { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Kira', gender: 'female', description: 'Storytelling - American' },
    { id: '2EiwWnXFnvU5JabPnv8n', name: 'Alex Oreyn', gender: 'female', description: 'Strong - American' },
    { id: 'wViXBPUnnJRPcNdNzerl', name: 'Manav', gender: 'male', description: 'Husky - Indian' },
    { id: 'OYTbf65OHHFELVut7v2H', name: 'Bex', gender: 'female', description: 'UK Female - British' },
    { id: 'XkYSoYzXfA0XM8DgA0Xv', name: 'Kina', gender: 'female', description: 'Social media - Standard' },
    { id: 'yDkJq4YzMxJbGJCJ2E3L', name: 'Calistria', gender: 'female', description: 'Enchanting - British' },

    // Custom voice option - user provides their own ElevenLabs voice ID
    { id: 'custom', name: '⚙️ Custom Voice ID', gender: 'neutral', description: 'Enter your own ElevenLabs voice ID' },
];

const OPENAI_VOICES = [
    { id: 'alloy', name: 'Alloy', gender: 'neutral', description: 'Balanced, neutral voice' },
    { id: 'echo', name: 'Echo', gender: 'male', description: 'Warm male voice' },
    { id: 'fable', name: 'Fable', gender: 'neutral', description: 'British accent, expressive' },
    { id: 'onyx', name: 'Onyx', gender: 'male', description: 'Deep, authoritative male' },
    { id: 'nova', name: 'Nova', gender: 'female', description: 'Friendly female voice' },
    { id: 'shimmer', name: 'Shimmer', gender: 'female', description: 'Warm, expressive female' },
];

const DEEPGRAM_VOICES = [
    { id: 'asteria-en', name: 'Asteria', gender: 'female', description: 'Clear female voice' },
    { id: 'luna-en', name: 'Luna', gender: 'female', description: 'Warm female voice' },
    { id: 'stella-en', name: 'Stella', gender: 'female', description: 'Natural female voice' },
    { id: 'athena-en', name: 'Athena', gender: 'female', description: 'Professional female' },
    { id: 'hera-en', name: 'Hera', gender: 'female', description: 'Friendly female voice' },
    { id: 'orion-en', name: 'Orion', gender: 'male', description: 'Clear male voice' },
    { id: 'arcas-en', name: 'Arcas', gender: 'male', description: 'Deep male voice' },
    { id: 'perseus-en', name: 'Perseus', gender: 'male', description: 'Warm male voice' },
    { id: 'angus-en', name: 'Angus', gender: 'male', description: 'Irish accent' },
    { id: 'orpheus-en', name: 'Orpheus', gender: 'male', description: 'Natural male voice' },
    { id: 'helios-en', name: 'Helios', gender: 'male', description: 'British accent' },
    { id: 'zeus-en', name: 'Zeus', gender: 'male', description: 'Authoritative male' },
];

// Parse phone numbers utility endpoint
router.post('/parse-phones', (req, res) => {
    const { input } = req.body;

    if (!input) {
        return res.json([]);
    }

    // Split by newlines or commas
    const lines = input.split(/[\n,]+/).map(line => line.trim()).filter(Boolean);

    const parsed = lines.map(line => {
        // Try to parse "Name: Number" or just "Number"
        const match = line.match(/^(.+?):\s*(.+)$/) || [null, null, line];
        let number = match[2]?.trim().replace(/[^\d+]/g, '') || '';
        // Ensure number starts with + for international format
        if (number && !number.startsWith('+')) {
            number = '+' + number;
        }
        return {
            name: match[1]?.trim() || null,
            number,
        };
    }).filter(p => p.number.length >= 10);

    res.json(parsed);
});

// =============================================
// MULTI-TENANT ENDPOINTS (Per-user phone numbers)
// =============================================

/**
 * Get phone stats for a specific user (multi-tenant)
 */
router.get('/user/:userId/phone-stats', async (req, res) => {
    try {
        const { userId } = req.params;
        const stats = await getUserPhoneStats(userId);
        res.json(stats);
    } catch (error) {
        console.error('Error getting user phone stats:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Initiate a call for a specific user (multi-tenant)
 * Uses the user's own phone numbers from the database
 */
router.post('/user/:userId/call', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const { userId } = req.params;
        const {
            phoneNumber,
            customerName,
            productIdea,
            companyContext,
            assistant: customAssistant,
            assistantId
        } = req.body;

        if (!phoneNumber) {
            return res.status(400).json({ error: 'phoneNumber is required' });
        }

        // Debug logging
        console.log(`📞 [User: ${userId}] Call request for: "${phoneNumber}"`);
        console.log(`   Is Irish: ${isIrishNumber(phoneNumber)}, VoIPcloud configured: ${!!VOIPCLOUD_TOKEN}`);

        // Route Irish calls through VoIPcloud
        if (isIrishNumber(phoneNumber)) {
            if (!VOIPCLOUD_TOKEN) {
                return res.status(400).json({
                    error: 'Irish calls require VoIPcloud configuration. Set VOIPCLOUD_API_TOKEN in .env',
                    isIrishNumber: true,
                });
            }

            console.log(`📞 [User: ${userId}] Routing Irish number ${phoneNumber} via VoIPcloud`);
            try {
                const voipcloudData = await makeVoIPcloudCall(phoneNumber);

                // Store call in database
                await supabase.from('calls').insert({
                    user_id: userId,
                    vapi_call_id: voipcloudData.call_id || `voipcloud-${Date.now()}`,
                    phone_number: phoneNumber,
                    customer_name: customerName,
                    status: 'initiated',
                    raw_response: { provider: 'voipcloud', ...voipcloudData },
                });

                return res.json({
                    id: voipcloudData.call_id || `voipcloud-${Date.now()}`,
                    provider: 'voipcloud',
                    status: 'initiated',
                    phoneNumber,
                    customerName,
                    ...voipcloudData,
                });
            } catch (voipError) {
                console.error('VoIPcloud call failed:', voipError.message);
                return res.status(500).json({ error: voipError.message });
            }
        }

        // Get next available phone number for this user from database
        const userPhone = await getUserPhoneNumber(userId);

        if (!userPhone) {
            const stats = await getUserPhoneStats(userId);
            return res.status(429).json({
                error: stats.totalNumbers === 0
                    ? 'No phone numbers configured. Please subscribe to a plan.'
                    : 'All phone numbers have reached their daily limit',
                remainingCapacity: stats.remainingToday,
                totalNumbers: stats.totalNumbers,
                suggestion: stats.totalNumbers === 0
                    ? 'Subscribe to a plan to get phone numbers'
                    : 'Wait until tomorrow or upgrade your plan for more capacity'
            });
        }

        // Build the call payload
        const callPayload = {
            phoneNumberId: userPhone.phone_number_id,
            customer: {
                number: phoneNumber,
                name: customerName || 'Prospect',
            },
        };

        // Configure assistant
        if (assistantId) {
            callPayload.assistantId = assistantId;
            if (productIdea) {
                const researchAssistant = createMarketResearchAssistant(productIdea, companyContext);
                callPayload.assistantOverrides = {
                    model: {
                        provider: researchAssistant.model.provider,
                        model: researchAssistant.model.model,
                        messages: researchAssistant.model.messages,
                    },
                    firstMessage: researchAssistant.firstMessage,
                };
            }
        } else {
            callPayload.assistant = customAssistant || createMarketResearchAssistant(productIdea, companyContext);
        }

        console.log(`📞 [User: ${userId}] Calling ${phoneNumber} from ${userPhone.phone_number}`);

        const response = await fetch(`${VAPI_API_URL}/call/phone`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(callPayload),
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                error: error.message || 'Failed to initiate call'
            });
        }

        const data = await response.json();

        // Increment usage in database
        await incrementPhoneUsage(userPhone.phone_number_id, userId, data.id);

        // Store call in database
        await supabase.from('calls').insert({
            user_id: userId,
            vapi_call_id: data.id,
            phone_number: phoneNumber,
            customer_name: customerName,
            outbound_phone_number_id: userPhone.phone_number_id,
            outbound_phone_number: userPhone.phone_number,
            status: 'initiated',
            raw_response: data,
        });

        // Get updated stats
        const stats = await getUserPhoneStats(userId);

        res.json({
            ...data,
            _rotation: {
                phoneNumberIdUsed: userPhone.phone_number_id,
                phoneNumberUsed: userPhone.phone_number,
                remainingCapacity: stats.remainingToday,
            }
        });
    } catch (error) {
        console.error('Vapi user call error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Batch initiate calls for a specific user (multi-tenant)
 */
router.post('/user/:userId/calls/batch', async (req, res) => {
    try {
        if (!VAPI_API_KEY) {
            return res.status(400).json({ error: 'Vapi API key not configured' });
        }

        const { userId } = req.params;
        const { phoneNumbers, productIdea, companyContext, delayMs = 2000 } = req.body;

        if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
            return res.status(400).json({ error: 'phoneNumbers array is required' });
        }

        // Check user's capacity
        const stats = await getUserPhoneStats(userId);

        if (stats.totalNumbers === 0) {
            return res.status(400).json({
                error: 'No phone numbers configured. Please subscribe to a plan.',
                remainingCapacity: 0,
                suggestion: 'Subscribe to a plan to get phone numbers'
            });
        }

        if (stats.remainingToday === 0) {
            return res.status(429).json({
                error: 'All phone numbers have reached their daily limit',
                remainingCapacity: 0,
                requestedCalls: phoneNumbers.length,
                suggestion: 'Wait until tomorrow or upgrade your plan'
            });
        }

        const capacityWarning = phoneNumbers.length > stats.remainingToday
            ? `Warning: Only ${stats.remainingToday} of ${phoneNumbers.length} calls can be made today`
            : null;

        const assistant = createMarketResearchAssistant(productIdea, companyContext);
        const results = [];
        let skippedDueToCapacity = 0;

        for (let i = 0; i < phoneNumbers.length; i++) {
            // Get next available phone number for this user
            const userPhone = await getUserPhoneNumber(userId);

            if (!userPhone) {
                results.push({
                    phoneNumber: phoneNumbers[i].number,
                    status: 'skipped',
                    error: 'Daily call limit reached for all phone numbers',
                });
                skippedDueToCapacity++;
                continue;
            }

            try {
                const response = await fetch(`${VAPI_API_URL}/call/phone`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${VAPI_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        phoneNumberId: userPhone.phone_number_id,
                        customer: {
                            number: phoneNumbers[i].number,
                            name: phoneNumbers[i].name || 'Prospect',
                        },
                        assistant,
                    }),
                });

                if (response.ok) {
                    const result = await response.json();

                    // Increment usage
                    await incrementPhoneUsage(userPhone.phone_number_id, userId, result.id);

                    // Store call
                    await supabase.from('calls').insert({
                        user_id: userId,
                        vapi_call_id: result.id,
                        phone_number: phoneNumbers[i].number,
                        customer_name: phoneNumbers[i].name,
                        outbound_phone_number_id: userPhone.phone_number_id,
                        outbound_phone_number: userPhone.phone_number,
                        status: 'initiated',
                        raw_response: result,
                    });

                    results.push({
                        phoneNumber: phoneNumbers[i].number,
                        status: 'initiated',
                        callId: result.id,
                        outboundPhoneNumber: userPhone.phone_number,
                        result,
                    });
                } else {
                    const error = await response.json();
                    results.push({
                        phoneNumber: phoneNumbers[i].number,
                        status: 'failed',
                        outboundPhoneNumber: userPhone.phone_number,
                        error: error.message,
                    });
                }
            } catch (error) {
                results.push({
                    phoneNumber: phoneNumbers[i].number,
                    status: 'failed',
                    error: error.message,
                });
            }

            // Delay between calls
            if (i < phoneNumbers.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        // Get final stats
        const finalStats = await getUserPhoneStats(userId);

        res.json({
            results,
            summary: {
                total: phoneNumbers.length,
                initiated: results.filter(r => r.status === 'initiated').length,
                failed: results.filter(r => r.status === 'failed').length,
                skipped: skippedDueToCapacity,
                remainingCapacity: finalStats.remainingToday,
                capacityWarning,
            }
        });
    } catch (error) {
        console.error('Vapi batch call error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get user's phone numbers
 */
router.get('/user/:userId/phone-numbers', async (req, res) => {
    try {
        const { userId } = req.params;

        const { data: numbers, error } = await supabase
            .from('user_phone_numbers')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json(numbers || []);
    } catch (error) {
        console.error('Error getting user phone numbers:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
