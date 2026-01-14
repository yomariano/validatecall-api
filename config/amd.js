/**
 * Answering Machine Detection (AMD) Configuration
 *
 * This module provides optimized AMD settings to:
 * 1. Quickly detect voicemail/answering machines
 * 2. Automatically hang up to avoid wasting money
 * 3. Minimize false positives while maximizing detection speed
 */

/**
 * AMD Configuration Presets
 */
export const AMD_PRESETS = {
    /**
     * Aggressive detection - fastest hangup, may have more false positives
     * Use for high-volume calling where cost savings are critical
     */
    aggressive: {
        provider: "twilio",
        enabled: true,
        voicemailDetectionTypes: [
            "machine_end_beep",
            "machine_end_silence",
            "machine_end_other"
        ],
        // Reduced timeout for faster detection (5 seconds vs default 30)
        machineDetectionTimeout: 5,
        // Shorter speech threshold - if speech continues this long, likely a machine greeting
        machineDetectionSpeechThreshold: 1800,
        // Shorter end threshold - quicker to determine speech has ended
        machineDetectionSpeechEndThreshold: 800,
        // Shorter silence timeout before deciding
        machineDetectionSilenceTimeout: 3000,
    },

    /**
     * Balanced detection - good balance of speed and accuracy
     * Recommended for most use cases
     */
    balanced: {
        provider: "twilio",
        enabled: true,
        voicemailDetectionTypes: [
            "machine_end_beep",
            "machine_end_silence",
            "machine_end_other"
        ],
        // Moderate timeout (10 seconds)
        machineDetectionTimeout: 10,
        // Standard speech threshold
        machineDetectionSpeechThreshold: 2200,
        // Standard end threshold
        machineDetectionSpeechEndThreshold: 1000,
        // Standard silence timeout
        machineDetectionSilenceTimeout: 4000,
    },

    /**
     * Conservative detection - fewer false positives, slower detection
     * Use when it's critical to not hang up on humans
     */
    conservative: {
        provider: "twilio",
        enabled: true,
        voicemailDetectionTypes: [
            "machine_end_beep",
            "machine_end_silence",
            "machine_end_other"
        ],
        // Longer timeout for more certainty
        machineDetectionTimeout: 15,
        // Longer speech threshold
        machineDetectionSpeechThreshold: 2800,
        // Longer end threshold
        machineDetectionSpeechEndThreshold: 1400,
        // Longer silence timeout
        machineDetectionSilenceTimeout: 5000,
    },

    /**
     * Disabled - no AMD detection
     */
    disabled: {
        provider: "twilio",
        enabled: false,
    }
};

/**
 * Default AMD preset to use
 */
export const DEFAULT_AMD_PRESET = 'balanced';

/**
 * Get AMD configuration by preset name
 * @param {string} preset - Preset name: 'aggressive', 'balanced', 'conservative', 'disabled'
 * @returns {object} AMD configuration object
 */
export function getAMDConfig(preset = DEFAULT_AMD_PRESET) {
    return AMD_PRESETS[preset] || AMD_PRESETS[DEFAULT_AMD_PRESET];
}

/**
 * Create custom AMD configuration with overrides
 * @param {string} basePreset - Base preset to start from
 * @param {object} overrides - Custom overrides to apply
 * @returns {object} Customized AMD configuration
 */
export function createCustomAMDConfig(basePreset = DEFAULT_AMD_PRESET, overrides = {}) {
    const base = getAMDConfig(basePreset);
    return {
        ...base,
        ...overrides,
    };
}

/**
 * IVR/Voicemail detection patterns for transcript analysis
 * Used as fallback when Twilio AMD doesn't catch it
 */
export const IVR_DETECTION_PATTERNS = [
    // Menu navigation
    'press 1', 'press 2', 'press 3', 'press 4', 'press 5',
    'press 6', 'press 7', 'press 8', 'press 9', 'press 0',
    'press star', 'press pound', 'press hash',
    'dial 1', 'dial 2', 'dial 3',
    'enter your', 'please enter',

    // Department routing
    'for sales', 'for support', 'for billing', 'for service',
    'for english', 'for spanish', 'para espanol',
    'to speak to', 'to speak with',

    // Hold messages
    'your call is important', 'please hold',
    'all representatives are busy', 'all agents are busy',
    'please stay on the line', 'your call will be answered',
    'estimated wait time', 'you are number',
    'high call volume', 'longer than usual',

    // Voicemail indicators
    'leave a message', 'leave your message',
    'after the beep', 'after the tone',
    'record your message', 'leave a detailed message',
    'at the sound of the beep', 'at the tone',
    'mailbox is full', 'voicemail box',
    'the person you are trying to reach',
    'is not available', 'cannot take your call',
    'please try again later',

    // Automated greetings
    'thank you for calling', 'thanks for calling',
    'welcome to', 'you have reached',
    'our office hours are', 'we are currently closed',
    'this call may be recorded', 'this call is being recorded',
    'for quality assurance',

    // Music/hold detection (heuristics)
    'hold music', 'please wait',
];

/**
 * Voicemail-specific patterns (subset of IVR patterns)
 */
export const VOICEMAIL_PATTERNS = [
    'leave a message', 'leave your message',
    'after the beep', 'after the tone',
    'record your message', 'leave a detailed message',
    'at the sound of the beep', 'at the tone',
    'mailbox is full', 'voicemail box',
    'the person you are trying to reach',
    'is not available', 'cannot take your call',
    'not here right now', 'unavailable',
    'sorry i missed your call', 'sorry we missed your call',
];

/**
 * Detect IVR/automated system from transcript
 * @param {string} transcript - Call transcript text
 * @returns {object} Detection result with type and matched pattern
 */
export function detectAutomatedSystem(transcript) {
    if (!transcript) {
        return { detected: false, type: null, pattern: null };
    }

    const lowerTranscript = transcript.toLowerCase();

    // Check for voicemail patterns first (more specific)
    for (const pattern of VOICEMAIL_PATTERNS) {
        if (lowerTranscript.includes(pattern)) {
            return {
                detected: true,
                type: 'voicemail',
                pattern: pattern,
            };
        }
    }

    // Check for IVR patterns
    for (const pattern of IVR_DETECTION_PATTERNS) {
        if (lowerTranscript.includes(pattern)) {
            return {
                detected: true,
                type: 'ivr',
                pattern: pattern,
            };
        }
    }

    return { detected: false, type: null, pattern: null };
}

/**
 * Determine call outcome based on VAPI endedReason and transcript
 * Enhanced version with better detection
 * @param {string} endedReason - VAPI's ended reason
 * @param {string} transcript - Call transcript
 * @param {Array} messages - VAPI messages array
 * @returns {string} Call outcome: 'human', 'voicemail', 'ivr', 'no_answer', 'busy', 'failed'
 */
export function determineCallOutcome(endedReason, transcript, messages) {
    const reason = (endedReason || '').toLowerCase();

    // Check VAPI's endedReason first - these are most reliable
    if (reason.includes('voicemail') || reason.includes('machine')) {
        return 'voicemail';
    }
    if (reason.includes('no-answer') || reason.includes('timeout')) {
        return 'no_answer';
    }
    if (reason.includes('busy')) {
        return 'busy';
    }
    if (reason.includes('failed') || reason.includes('error')) {
        return 'failed';
    }

    // Check if endCall function was called with specific reason
    if (messages && Array.isArray(messages)) {
        for (const msg of messages) {
            if (msg.role === 'tool_calls' || msg.toolCalls) {
                const toolCalls = msg.toolCalls || msg.tool_calls || [];
                for (const tool of toolCalls) {
                    if (tool.function?.name === 'endCall') {
                        try {
                            const args = typeof tool.function.arguments === 'string'
                                ? JSON.parse(tool.function.arguments)
                                : tool.function.arguments;

                            if (args?.reason === 'ivr_detected') return 'ivr';
                            if (args?.reason === 'voicemail_detected') return 'voicemail';
                            if (args?.reason === 'no_answer') return 'no_answer';
                        } catch (e) {
                            // Ignore JSON parse errors
                        }
                    }
                }
            }
        }
    }

    // Fallback: check transcript for automated system patterns
    const detection = detectAutomatedSystem(transcript);
    if (detection.detected) {
        return detection.type;
    }

    // Default: assume human interaction
    return 'human';
}

/**
 * System prompt instructions for AI to detect and hang up on automated systems
 * Add this to your assistant's system prompt
 */
export const AMD_SYSTEM_PROMPT_INSTRUCTIONS = `
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
`;

/**
 * endCall tool definition for VAPI assistant
 * Include this in your assistant's tools array
 */
export const END_CALL_TOOL = {
    type: "function",
    function: {
        name: "endCall",
        description: "End the call immediately. Use this when you detect an IVR system, automated menu, voicemail, or any non-human answering the call. Also use when the customer declines to participate or when the call is complete.",
        parameters: {
            type: "object",
            properties: {
                reason: {
                    type: "string",
                    enum: [
                        "ivr_detected",
                        "voicemail_detected",
                        "no_answer",
                        "customer_declined",
                        "call_completed"
                    ],
                    description: "The reason for ending the call"
                }
            },
            required: ["reason"]
        }
    }
};

export default {
    AMD_PRESETS,
    DEFAULT_AMD_PRESET,
    getAMDConfig,
    createCustomAMDConfig,
    IVR_DETECTION_PATTERNS,
    VOICEMAIL_PATTERNS,
    detectAutomatedSystem,
    determineCallOutcome,
    AMD_SYSTEM_PROMPT_INSTRUCTIONS,
    END_CALL_TOOL,
};
