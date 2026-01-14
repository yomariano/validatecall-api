/**
 * Unit tests for AMD (Answering Machine Detection) configuration module
 */

import {
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
} from './amd.js';

describe('AMD Configuration Module', () => {
    describe('AMD_PRESETS', () => {
        test('should have all expected presets', () => {
            expect(AMD_PRESETS).toHaveProperty('aggressive');
            expect(AMD_PRESETS).toHaveProperty('balanced');
            expect(AMD_PRESETS).toHaveProperty('conservative');
            expect(AMD_PRESETS).toHaveProperty('disabled');
        });

        test('aggressive preset should have shortest timeout', () => {
            expect(AMD_PRESETS.aggressive.machineDetectionTimeout).toBe(5);
            expect(AMD_PRESETS.aggressive.enabled).toBe(true);
        });

        test('balanced preset should have moderate timeout', () => {
            expect(AMD_PRESETS.balanced.machineDetectionTimeout).toBe(10);
            expect(AMD_PRESETS.balanced.enabled).toBe(true);
        });

        test('conservative preset should have longest timeout', () => {
            expect(AMD_PRESETS.conservative.machineDetectionTimeout).toBe(15);
            expect(AMD_PRESETS.conservative.enabled).toBe(true);
        });

        test('disabled preset should have enabled=false', () => {
            expect(AMD_PRESETS.disabled.enabled).toBe(false);
        });

        test('all enabled presets should use twilio provider', () => {
            expect(AMD_PRESETS.aggressive.provider).toBe('twilio');
            expect(AMD_PRESETS.balanced.provider).toBe('twilio');
            expect(AMD_PRESETS.conservative.provider).toBe('twilio');
        });

        test('all enabled presets should have detection types', () => {
            const expectedTypes = ['machine_end_beep', 'machine_end_silence', 'machine_end_other'];
            expect(AMD_PRESETS.aggressive.voicemailDetectionTypes).toEqual(expectedTypes);
            expect(AMD_PRESETS.balanced.voicemailDetectionTypes).toEqual(expectedTypes);
            expect(AMD_PRESETS.conservative.voicemailDetectionTypes).toEqual(expectedTypes);
        });
    });

    describe('DEFAULT_AMD_PRESET', () => {
        test('should be balanced', () => {
            expect(DEFAULT_AMD_PRESET).toBe('balanced');
        });
    });

    describe('getAMDConfig', () => {
        test('should return correct preset config', () => {
            expect(getAMDConfig('aggressive')).toEqual(AMD_PRESETS.aggressive);
            expect(getAMDConfig('balanced')).toEqual(AMD_PRESETS.balanced);
            expect(getAMDConfig('conservative')).toEqual(AMD_PRESETS.conservative);
            expect(getAMDConfig('disabled')).toEqual(AMD_PRESETS.disabled);
        });

        test('should return default preset for invalid input', () => {
            expect(getAMDConfig('invalid')).toEqual(AMD_PRESETS.balanced);
            expect(getAMDConfig()).toEqual(AMD_PRESETS.balanced);
            expect(getAMDConfig(null)).toEqual(AMD_PRESETS.balanced);
        });
    });

    describe('createCustomAMDConfig', () => {
        test('should merge overrides with base preset', () => {
            const custom = createCustomAMDConfig('aggressive', { machineDetectionTimeout: 3 });
            expect(custom.machineDetectionTimeout).toBe(3);
            expect(custom.provider).toBe('twilio');
            expect(custom.enabled).toBe(true);
        });

        test('should use default preset when not specified', () => {
            const custom = createCustomAMDConfig(undefined, { machineDetectionTimeout: 7 });
            expect(custom.machineDetectionTimeout).toBe(7);
            expect(custom.machineDetectionSpeechThreshold).toBe(AMD_PRESETS.balanced.machineDetectionSpeechThreshold);
        });
    });
});

describe('IVR/Voicemail Detection Patterns', () => {
    describe('IVR_DETECTION_PATTERNS', () => {
        test('should contain menu navigation patterns', () => {
            expect(IVR_DETECTION_PATTERNS).toContain('press 1');
            expect(IVR_DETECTION_PATTERNS).toContain('press star');
            expect(IVR_DETECTION_PATTERNS).toContain('enter your');
        });

        test('should contain department routing patterns', () => {
            expect(IVR_DETECTION_PATTERNS).toContain('for sales');
            expect(IVR_DETECTION_PATTERNS).toContain('for support');
            expect(IVR_DETECTION_PATTERNS).toContain('for english');
        });

        test('should contain hold message patterns', () => {
            expect(IVR_DETECTION_PATTERNS).toContain('your call is important');
            expect(IVR_DETECTION_PATTERNS).toContain('please hold');
            expect(IVR_DETECTION_PATTERNS).toContain('all representatives are busy');
        });

        test('should contain voicemail patterns', () => {
            expect(IVR_DETECTION_PATTERNS).toContain('leave a message');
            expect(IVR_DETECTION_PATTERNS).toContain('after the beep');
        });
    });

    describe('VOICEMAIL_PATTERNS', () => {
        test('should contain voicemail-specific patterns', () => {
            expect(VOICEMAIL_PATTERNS).toContain('leave a message');
            expect(VOICEMAIL_PATTERNS).toContain('after the beep');
            expect(VOICEMAIL_PATTERNS).toContain('after the tone');
            expect(VOICEMAIL_PATTERNS).toContain('mailbox is full');
            expect(VOICEMAIL_PATTERNS).toContain('is not available');
        });

        test('core voicemail patterns should be in IVR patterns', () => {
            // Core voicemail patterns that should be in both lists
            const corePatterns = [
                'leave a message',
                'after the beep',
                'after the tone',
                'is not available',
            ];
            for (const pattern of corePatterns) {
                expect(IVR_DETECTION_PATTERNS).toContain(pattern);
                expect(VOICEMAIL_PATTERNS).toContain(pattern);
            }
        });
    });
});

describe('detectAutomatedSystem', () => {
    test('should return not detected for null/empty transcript', () => {
        expect(detectAutomatedSystem(null)).toEqual({ detected: false, type: null, pattern: null });
        expect(detectAutomatedSystem('')).toEqual({ detected: false, type: null, pattern: null });
        expect(detectAutomatedSystem(undefined)).toEqual({ detected: false, type: null, pattern: null });
    });

    test('should detect voicemail patterns', () => {
        const result = detectAutomatedSystem('Please leave a message after the beep');
        expect(result.detected).toBe(true);
        expect(result.type).toBe('voicemail');
        expect(result.pattern).toBe('leave a message');
    });

    test('should detect IVR patterns', () => {
        const result = detectAutomatedSystem('Press 1 for sales, press 2 for support');
        expect(result.detected).toBe(true);
        expect(result.type).toBe('ivr');
        expect(result.pattern).toBe('press 1');
    });

    test('should be case-insensitive', () => {
        expect(detectAutomatedSystem('PRESS 1 FOR SALES').detected).toBe(true);
        expect(detectAutomatedSystem('Leave A Message').detected).toBe(true);
        expect(detectAutomatedSystem('YOUR CALL IS IMPORTANT').detected).toBe(true);
    });

    test('should prioritize voicemail over IVR detection', () => {
        // If both voicemail and IVR patterns are present, voicemail should be detected first
        const result = detectAutomatedSystem('Press 1 to leave a message');
        expect(result.type).toBe('voicemail');
    });

    test('should return not detected for normal conversation', () => {
        const result = detectAutomatedSystem('Hello, how can I help you today?');
        expect(result.detected).toBe(false);
    });

    test('should detect hold messages', () => {
        const result = detectAutomatedSystem('Your call is important to us. Please hold.');
        expect(result.detected).toBe(true);
        expect(result.type).toBe('ivr');
    });

    test('should detect unavailability messages', () => {
        const result = detectAutomatedSystem('The person you are trying to reach is not available');
        expect(result.detected).toBe(true);
        expect(result.type).toBe('voicemail');
    });
});

describe('determineCallOutcome', () => {
    describe('based on endedReason', () => {
        test('should return voicemail for machine-related reasons', () => {
            expect(determineCallOutcome('voicemail', '', [])).toBe('voicemail');
            expect(determineCallOutcome('machine_detected', '', [])).toBe('voicemail');
            expect(determineCallOutcome('VOICEMAIL', '', [])).toBe('voicemail');
        });

        test('should return no_answer for timeout reasons', () => {
            expect(determineCallOutcome('no-answer', '', [])).toBe('no_answer');
            expect(determineCallOutcome('timeout', '', [])).toBe('no_answer');
            expect(determineCallOutcome('NO-ANSWER', '', [])).toBe('no_answer');
        });

        test('should return busy for busy signals', () => {
            expect(determineCallOutcome('busy', '', [])).toBe('busy');
            expect(determineCallOutcome('BUSY', '', [])).toBe('busy');
        });

        test('should return failed for error reasons', () => {
            expect(determineCallOutcome('failed', '', [])).toBe('failed');
            expect(determineCallOutcome('error', '', [])).toBe('failed');
            expect(determineCallOutcome('connection_error', '', [])).toBe('failed');
        });
    });

    describe('based on tool calls', () => {
        test('should detect IVR from endCall tool call', () => {
            const messages = [{
                role: 'tool_calls',
                toolCalls: [{
                    function: {
                        name: 'endCall',
                        arguments: JSON.stringify({ reason: 'ivr_detected' })
                    }
                }]
            }];
            expect(determineCallOutcome('', '', messages)).toBe('ivr');
        });

        test('should detect voicemail from endCall tool call', () => {
            const messages = [{
                role: 'tool_calls',
                toolCalls: [{
                    function: {
                        name: 'endCall',
                        arguments: JSON.stringify({ reason: 'voicemail_detected' })
                    }
                }]
            }];
            expect(determineCallOutcome('', '', messages)).toBe('voicemail');
        });

        test('should handle tool_calls array in message', () => {
            const messages = [{
                role: 'tool_calls',
                tool_calls: [{
                    function: {
                        name: 'endCall',
                        arguments: { reason: 'ivr_detected' }
                    }
                }]
            }];
            expect(determineCallOutcome('', '', messages)).toBe('ivr');
        });

        test('should handle string arguments', () => {
            const messages = [{
                toolCalls: [{
                    function: {
                        name: 'endCall',
                        arguments: '{"reason": "voicemail_detected"}'
                    }
                }]
            }];
            expect(determineCallOutcome('', '', messages)).toBe('voicemail');
        });
    });

    describe('based on transcript fallback', () => {
        test('should detect IVR from transcript', () => {
            expect(determineCallOutcome('', 'Press 1 for sales', [])).toBe('ivr');
            expect(determineCallOutcome('', 'Your call is important to us', [])).toBe('ivr');
        });

        test('should detect voicemail from transcript', () => {
            expect(determineCallOutcome('', 'Please leave a message after the beep', [])).toBe('voicemail');
        });

        test('should return human for normal conversation', () => {
            expect(determineCallOutcome('', 'Hello, this is John speaking', [])).toBe('human');
            expect(determineCallOutcome('', 'Yes, I have a few minutes', [])).toBe('human');
        });
    });

    describe('priority order', () => {
        test('endedReason should take priority over transcript', () => {
            // Even if transcript suggests IVR, voicemail endedReason should win
            expect(determineCallOutcome('voicemail', 'Press 1 for sales', [])).toBe('voicemail');
        });

        test('tool calls should take priority over transcript', () => {
            const messages = [{
                toolCalls: [{
                    function: {
                        name: 'endCall',
                        arguments: { reason: 'ivr_detected' }
                    }
                }]
            }];
            expect(determineCallOutcome('', 'Hello, this is John', messages)).toBe('ivr');
        });
    });
});

describe('AMD_SYSTEM_PROMPT_INSTRUCTIONS', () => {
    test('should be a non-empty string', () => {
        expect(typeof AMD_SYSTEM_PROMPT_INSTRUCTIONS).toBe('string');
        expect(AMD_SYSTEM_PROMPT_INSTRUCTIONS.length).toBeGreaterThan(100);
    });

    test('should contain IVR detection guidance', () => {
        expect(AMD_SYSTEM_PROMPT_INSTRUCTIONS).toContain('Press 1');
        expect(AMD_SYSTEM_PROMPT_INSTRUCTIONS).toContain('endCall');
        expect(AMD_SYSTEM_PROMPT_INSTRUCTIONS).toContain('hang up');
    });

    test('should contain voicemail detection guidance', () => {
        expect(AMD_SYSTEM_PROMPT_INSTRUCTIONS).toContain('Leave a message');
        expect(AMD_SYSTEM_PROMPT_INSTRUCTIONS).toContain('not available');
    });
});

describe('END_CALL_TOOL', () => {
    test('should have correct structure', () => {
        expect(END_CALL_TOOL.type).toBe('function');
        expect(END_CALL_TOOL.function.name).toBe('endCall');
        expect(END_CALL_TOOL.function.description).toBeTruthy();
    });

    test('should have reason parameter with correct enum values', () => {
        const reasonParam = END_CALL_TOOL.function.parameters.properties.reason;
        expect(reasonParam.type).toBe('string');
        expect(reasonParam.enum).toContain('ivr_detected');
        expect(reasonParam.enum).toContain('voicemail_detected');
        expect(reasonParam.enum).toContain('no_answer');
        expect(reasonParam.enum).toContain('customer_declined');
        expect(reasonParam.enum).toContain('call_completed');
    });

    test('should require reason parameter', () => {
        expect(END_CALL_TOOL.function.parameters.required).toContain('reason');
    });
});

describe('AMD Timeout Comparisons', () => {
    test('aggressive should be faster than balanced', () => {
        expect(AMD_PRESETS.aggressive.machineDetectionTimeout)
            .toBeLessThan(AMD_PRESETS.balanced.machineDetectionTimeout);
        expect(AMD_PRESETS.aggressive.machineDetectionSpeechThreshold)
            .toBeLessThan(AMD_PRESETS.balanced.machineDetectionSpeechThreshold);
    });

    test('balanced should be faster than conservative', () => {
        expect(AMD_PRESETS.balanced.machineDetectionTimeout)
            .toBeLessThan(AMD_PRESETS.conservative.machineDetectionTimeout);
        expect(AMD_PRESETS.balanced.machineDetectionSpeechThreshold)
            .toBeLessThan(AMD_PRESETS.conservative.machineDetectionSpeechThreshold);
    });

    test('aggressive should save the most time compared to original 30s timeout', () => {
        const originalTimeout = 30; // Original hardcoded timeout
        const aggressiveTimeout = AMD_PRESETS.aggressive.machineDetectionTimeout;
        const timeSaved = originalTimeout - aggressiveTimeout;

        // Should save at least 20 seconds
        expect(timeSaved).toBeGreaterThanOrEqual(20);
    });
});
