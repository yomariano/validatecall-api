/**
 * Unit tests for Security Functions
 * Tests webhook verification, user validation, and rollback functionality
 */

// Mock crypto for signature verification tests
const crypto = require('crypto');

describe('Stripe Webhook Signature Verification', () => {
    const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

    function verifyStripeSignature(payload, signature, secret) {
        if (!signature || !secret) return false;

        try {
            const parts = signature.split(',');
            const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
            const v1Signature = parts.find(p => p.startsWith('v1='))?.split('=')[1];

            if (!timestamp || !v1Signature) return false;

            const signedPayload = `${timestamp}.${payload}`;
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(signedPayload)
                .digest('hex');

            return crypto.timingSafeEqual(
                Buffer.from(v1Signature),
                Buffer.from(expectedSignature)
            );
        } catch (error) {
            return false;
        }
    }

    test('should return false for missing signature', () => {
        expect(verifyStripeSignature('payload', null, STRIPE_WEBHOOK_SECRET)).toBe(false);
        expect(verifyStripeSignature('payload', '', STRIPE_WEBHOOK_SECRET)).toBe(false);
    });

    test('should return false for missing secret', () => {
        expect(verifyStripeSignature('payload', 't=123,v1=abc', null)).toBe(false);
        expect(verifyStripeSignature('payload', 't=123,v1=abc', '')).toBe(false);
    });

    test('should return false for malformed signature', () => {
        expect(verifyStripeSignature('payload', 'invalid', STRIPE_WEBHOOK_SECRET)).toBe(false);
        expect(verifyStripeSignature('payload', 't=123', STRIPE_WEBHOOK_SECRET)).toBe(false);
        expect(verifyStripeSignature('payload', 'v1=abc', STRIPE_WEBHOOK_SECRET)).toBe(false);
    });

    test('should validate correct signature', () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const payload = '{"type":"checkout.session.completed"}';
        const signedPayload = `${timestamp}.${payload}`;
        const signature = crypto
            .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
            .update(signedPayload)
            .digest('hex');

        const signatureHeader = `t=${timestamp},v1=${signature}`;

        expect(verifyStripeSignature(payload, signatureHeader, STRIPE_WEBHOOK_SECRET)).toBe(true);
    });

    test('should reject invalid signature', () => {
        const timestamp = Math.floor(Date.now() / 1000);
        const payload = '{"type":"checkout.session.completed"}';
        const signatureHeader = `t=${timestamp},v1=invalid_signature`;

        expect(verifyStripeSignature(payload, signatureHeader, STRIPE_WEBHOOK_SECRET)).toBe(false);
    });
});

describe('User Access Validation', () => {
    const MOCK_USER_ID = '00000000-0000-0000-0000-000000000000';
    const VALID_USER_ID = '11111111-1111-1111-1111-111111111111';

    // Simulated validation function
    function validateUserAccess(token, paramUserId, isDev = false) {
        // In dev mode without token, allow mock user
        if (!token && isDev) {
            if (paramUserId === MOCK_USER_ID) {
                return { valid: true, userId: MOCK_USER_ID };
            }
            return { valid: true, userId: paramUserId }; // Dev mode allows any
        }

        if (!token) {
            return { valid: false, error: 'Authentication required' };
        }

        // Simulate token validation
        const tokenUserId = token.userId; // Assuming decoded token

        if (tokenUserId !== paramUserId) {
            return { valid: false, error: 'Access denied: User ID mismatch' };
        }

        return { valid: true, userId: tokenUserId };
    }

    test('should require authentication in production mode', () => {
        const result = validateUserAccess(null, VALID_USER_ID, false);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Authentication required');
    });

    test('should allow mock user in dev mode without token', () => {
        const result = validateUserAccess(null, MOCK_USER_ID, true);
        expect(result.valid).toBe(true);
        expect(result.userId).toBe(MOCK_USER_ID);
    });

    test('should allow any user in dev mode without token', () => {
        const result = validateUserAccess(null, VALID_USER_ID, true);
        expect(result.valid).toBe(true);
        expect(result.userId).toBe(VALID_USER_ID);
    });

    test('should reject mismatched user IDs', () => {
        const token = { userId: VALID_USER_ID };
        const differentUserId = '22222222-2222-2222-2222-222222222222';

        const result = validateUserAccess(token, differentUserId, false);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Access denied: User ID mismatch');
    });

    test('should allow matching user IDs', () => {
        const token = { userId: VALID_USER_ID };

        const result = validateUserAccess(token, VALID_USER_ID, false);
        expect(result.valid).toBe(true);
        expect(result.userId).toBe(VALID_USER_ID);
    });
});

describe('Free Tier Call Reservation and Rollback', () => {
    // Mock usage data store
    let usageStore = {};

    const CALLS_LIMIT = 5;

    function resetStore() {
        usageStore = {};
    }

    function getUsage(userId) {
        if (!usageStore[userId]) {
            usageStore[userId] = { calls_used: 0, calls_limit: CALLS_LIMIT };
        }
        return usageStore[userId];
    }

    function reserveCall(userId) {
        const usage = getUsage(userId);

        if (usage.calls_used >= usage.calls_limit) {
            return {
                canCall: false,
                isFreeTier: true,
                used: usage.calls_used,
                limit: usage.calls_limit,
                remaining: 0
            };
        }

        usage.calls_used++;
        return {
            canCall: true,
            isFreeTier: true,
            reserved: true,
            used: usage.calls_used,
            limit: usage.calls_limit,
            remaining: usage.calls_limit - usage.calls_used
        };
    }

    function rollbackCall(userId) {
        const usage = getUsage(userId);

        if (usage.calls_used <= 0) {
            return { success: true, message: 'No calls to rollback' };
        }

        usage.calls_used--;
        return { success: true, message: 'Call rolled back' };
    }

    beforeEach(() => {
        resetStore();
    });

    test('should reserve a call successfully', () => {
        const result = reserveCall('user-1');

        expect(result.canCall).toBe(true);
        expect(result.reserved).toBe(true);
        expect(result.used).toBe(1);
        expect(result.remaining).toBe(CALLS_LIMIT - 1);
    });

    test('should track multiple reservations', () => {
        reserveCall('user-1');
        reserveCall('user-1');
        const result = reserveCall('user-1');

        expect(result.used).toBe(3);
        expect(result.remaining).toBe(CALLS_LIMIT - 3);
    });

    test('should reject when limit reached', () => {
        for (let i = 0; i < CALLS_LIMIT; i++) {
            reserveCall('user-1');
        }

        const result = reserveCall('user-1');

        expect(result.canCall).toBe(false);
        expect(result.remaining).toBe(0);
    });

    test('should rollback a reserved call', () => {
        reserveCall('user-1');
        reserveCall('user-1');

        const beforeRollback = getUsage('user-1').calls_used;
        rollbackCall('user-1');
        const afterRollback = getUsage('user-1').calls_used;

        expect(beforeRollback).toBe(2);
        expect(afterRollback).toBe(1);
    });

    test('should not rollback below zero', () => {
        const result = rollbackCall('user-1');

        expect(result.success).toBe(true);
        expect(getUsage('user-1').calls_used).toBe(0);
    });

    test('should allow new reservation after rollback', () => {
        // Use all calls
        for (let i = 0; i < CALLS_LIMIT; i++) {
            reserveCall('user-1');
        }

        // Verify limit reached
        expect(reserveCall('user-1').canCall).toBe(false);

        // Rollback one
        rollbackCall('user-1');

        // Should be able to reserve again
        const result = reserveCall('user-1');
        expect(result.canCall).toBe(true);
    });

    test('should isolate usage between users', () => {
        reserveCall('user-1');
        reserveCall('user-1');
        reserveCall('user-2');

        expect(getUsage('user-1').calls_used).toBe(2);
        expect(getUsage('user-2').calls_used).toBe(1);
    });
});

describe('PhoneRotator Memory Management', () => {
    class MockPhoneRotator {
        constructor(phoneNumbers, maxCallsPerDay) {
            this.phoneNumbers = phoneNumbers;
            this.maxCallsPerDay = maxCallsPerDay;
            this.usage = {};
            this.currentIndex = 0;
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

        cleanupOldEntries() {
            const today = this.getTodayDate();
            let cleaned = 0;

            for (const phoneNumberId of Object.keys(this.usage)) {
                if (this.usage[phoneNumberId].date !== today) {
                    delete this.usage[phoneNumberId];
                    cleaned++;
                }
            }

            return cleaned;
        }
    }

    test('should clean up old date entries', () => {
        const rotator = new MockPhoneRotator(['phone-1', 'phone-2'], 50);

        // Add old entries manually
        rotator.usage = {
            'phone-1': { date: '2024-01-01', count: 10 },
            'phone-2': { date: '2024-01-01', count: 5 },
            'phone-3': { date: rotator.getTodayDate(), count: 3 },
        };

        const cleaned = rotator.cleanupOldEntries();

        expect(cleaned).toBe(2);
        expect(rotator.usage['phone-1']).toBeUndefined();
        expect(rotator.usage['phone-2']).toBeUndefined();
        expect(rotator.usage['phone-3']).toBeDefined();
    });

    test('should reset usage for new day', () => {
        const rotator = new MockPhoneRotator(['phone-1'], 50);

        // Simulate old usage
        rotator.usage['phone-1'] = { date: '2024-01-01', count: 50 };

        // getUsageForNumber should reset for new day
        const usage = rotator.getUsageForNumber('phone-1');

        expect(usage.date).toBe(rotator.getTodayDate());
        expect(usage.count).toBe(0);
    });
});

describe('Supabase Increment Functions', () => {
    // Mock read-then-update pattern (replacing invalid supabase.raw)
    function incrementPhoneUsage(current, increment = 1) {
        return {
            daily_calls_used: (current.daily_calls_used || 0) + increment,
            total_calls_made: (current.total_calls_made || 0) + increment,
        };
    }

    test('should increment from zero', () => {
        const current = { daily_calls_used: 0, total_calls_made: 0 };
        const result = incrementPhoneUsage(current);

        expect(result.daily_calls_used).toBe(1);
        expect(result.total_calls_made).toBe(1);
    });

    test('should increment from existing values', () => {
        const current = { daily_calls_used: 5, total_calls_made: 100 };
        const result = incrementPhoneUsage(current);

        expect(result.daily_calls_used).toBe(6);
        expect(result.total_calls_made).toBe(101);
    });

    test('should handle null/undefined values', () => {
        const current = { daily_calls_used: null, total_calls_made: undefined };
        const result = incrementPhoneUsage(current);

        expect(result.daily_calls_used).toBe(1);
        expect(result.total_calls_made).toBe(1);
    });

    test('should support custom increment', () => {
        const current = { daily_calls_used: 5, total_calls_made: 100 };
        const result = incrementPhoneUsage(current, 5);

        expect(result.daily_calls_used).toBe(10);
        expect(result.total_calls_made).toBe(105);
    });
});
