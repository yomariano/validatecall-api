/**
 * User Settings Service
 * Handles user-specific settings like Resend API key management
 */

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Get user's Resend API key (masked for display)
 * @param {string} userId - The user's ID
 * @returns {Object} - { success, hasApiKey, maskedKey, verified, verifiedAt }
 */
export async function getResendApiKeyStatus(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('resend_api_key, resend_api_key_verified, resend_api_key_verified_at')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Failed to get user settings:', error);
            return { success: false, error: error.message };
        }

        const hasApiKey = !!data.resend_api_key;
        let maskedKey = null;

        if (hasApiKey && data.resend_api_key.length > 8) {
            // Show first 6 chars and last 4 chars, mask the rest
            const key = data.resend_api_key;
            maskedKey = `${key.substring(0, 6)}${'*'.repeat(key.length - 10)}${key.substring(key.length - 4)}`;
        }

        return {
            success: true,
            hasApiKey,
            maskedKey,
            verified: data.resend_api_key_verified || false,
            verifiedAt: data.resend_api_key_verified_at,
        };
    } catch (err) {
        console.error('Get Resend API key status exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get user's actual Resend API key (for internal use only)
 * @param {string} userId - The user's ID
 * @returns {string|null} - The API key or null
 */
export async function getUserResendApiKey(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('resend_api_key')
            .eq('id', userId)
            .single();

        if (error || !data) {
            return null;
        }

        return data.resend_api_key || null;
    } catch {
        return null;
    }
}

/**
 * Save user's Resend API key
 * @param {string} userId - The user's ID
 * @param {string} apiKey - The Resend API key
 * @returns {Object} - { success, verified, error }
 */
export async function saveResendApiKey(userId, apiKey) {
    try {
        // Validate the API key format
        if (!apiKey || !apiKey.startsWith('re_')) {
            return {
                success: false,
                error: 'Invalid API key format. Resend API keys start with "re_"'
            };
        }

        // Verify the API key works by making a test request to Resend
        const testResend = new Resend(apiKey);
        let verified = false;

        try {
            // Try to list domains - this verifies the key works
            const { error: resendError } = await testResend.domains.list();
            verified = !resendError;
        } catch (verifyErr) {
            console.warn('Failed to verify Resend API key:', verifyErr.message);
            // Still save the key, but mark as not verified
        }

        // Save the API key to the database
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                resend_api_key: apiKey,
                resend_api_key_verified: verified,
                resend_api_key_verified_at: verified ? new Date().toISOString() : null,
            })
            .eq('id', userId);

        if (updateError) {
            console.error('Failed to save Resend API key:', updateError);
            return { success: false, error: updateError.message };
        }

        console.log(`Resend API key saved for user ${userId}, verified: ${verified}`);
        return {
            success: true,
            verified,
            message: verified
                ? 'API key saved and verified successfully!'
                : 'API key saved but could not be verified. Please check your key is correct.'
        };
    } catch (err) {
        console.error('Save Resend API key exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Delete user's Resend API key
 * @param {string} userId - The user's ID
 * @returns {Object} - { success, error }
 */
export async function deleteResendApiKey(userId) {
    try {
        const { error } = await supabase
            .from('profiles')
            .update({
                resend_api_key: null,
                resend_api_key_verified: false,
                resend_api_key_verified_at: null,
            })
            .eq('id', userId);

        if (error) {
            console.error('Failed to delete Resend API key:', error);
            return { success: false, error: error.message };
        }

        console.log(`Resend API key deleted for user ${userId}`);
        return { success: true };
    } catch (err) {
        console.error('Delete Resend API key exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Verify user's Resend API key works
 * @param {string} userId - The user's ID
 * @returns {Object} - { success, verified, domains, error }
 */
export async function verifyResendApiKey(userId) {
    try {
        // Get the user's API key
        const apiKey = await getUserResendApiKey(userId);

        if (!apiKey) {
            return { success: false, error: 'No Resend API key configured' };
        }

        // Test the API key
        const testResend = new Resend(apiKey);

        try {
            const { data: domainsData, error: resendError } = await testResend.domains.list();

            if (resendError) {
                // Update verification status to failed
                await supabase
                    .from('profiles')
                    .update({
                        resend_api_key_verified: false,
                    })
                    .eq('id', userId);

                return {
                    success: false,
                    error: `API key verification failed: ${resendError.message}`
                };
            }

            // Update verification status to success
            await supabase
                .from('profiles')
                .update({
                    resend_api_key_verified: true,
                    resend_api_key_verified_at: new Date().toISOString(),
                })
                .eq('id', userId);

            // Return verified domains from the user's Resend account
            const verifiedDomains = (domainsData?.data || [])
                .filter(d => d.status === 'verified')
                .map(d => ({ id: d.id, name: d.name }));

            return {
                success: true,
                verified: true,
                domains: verifiedDomains,
                message: `API key verified! Found ${verifiedDomains.length} verified domain(s).`
            };
        } catch (verifyErr) {
            return {
                success: false,
                error: `Failed to verify API key: ${verifyErr.message}`
            };
        }
    } catch (err) {
        console.error('Verify Resend API key exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get user's verified domains from their Resend account
 * @param {string} userId - The user's ID
 * @returns {Object} - { success, domains, error }
 */
export async function getUserResendDomains(userId) {
    try {
        const apiKey = await getUserResendApiKey(userId);

        if (!apiKey) {
            return { success: false, error: 'No Resend API key configured', domains: [] };
        }

        const userResend = new Resend(apiKey);

        try {
            const { data: domainsData, error: resendError } = await userResend.domains.list();

            if (resendError) {
                return { success: false, error: resendError.message, domains: [] };
            }

            // Return all domains with their status
            const domains = (domainsData?.data || []).map(d => ({
                id: d.id,
                name: d.name,
                status: d.status,
                createdAt: d.created_at,
            }));

            return { success: true, domains };
        } catch (err) {
            return { success: false, error: err.message, domains: [] };
        }
    } catch (err) {
        console.error('Get user Resend domains exception:', err);
        return { success: false, error: err.message, domains: [] };
    }
}

export default {
    getResendApiKeyStatus,
    getUserResendApiKey,
    saveResendApiKey,
    deleteResendApiKey,
    verifyResendApiKey,
    getUserResendDomains,
};
