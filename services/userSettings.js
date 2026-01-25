/**
 * User Settings Service
 * Handles user-specific settings like email provider API key management
 * Supports: Resend, SendGrid
 */

import { Resend } from 'resend';
import sgMail from '@sendgrid/mail';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =============================================
// EMAIL PROVIDER SETTINGS
// =============================================

/**
 * Get user's email provider settings
 * @param {string} userId - The user's ID
 * @returns {Object} - Complete email settings status
 */
export async function getEmailProviderSettings(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select(`
                email_provider,
                resend_api_key,
                resend_api_key_verified,
                resend_api_key_verified_at,
                sendgrid_api_key,
                sendgrid_api_key_verified,
                sendgrid_api_key_verified_at
            `)
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Failed to get email provider settings:', error);
            return { success: false, error: error.message };
        }

        return {
            success: true,
            provider: data.email_provider || null,
            resend: {
                hasApiKey: !!data.resend_api_key,
                maskedKey: maskApiKey(data.resend_api_key),
                verified: data.resend_api_key_verified || false,
                verifiedAt: data.resend_api_key_verified_at,
            },
            sendgrid: {
                hasApiKey: !!data.sendgrid_api_key,
                maskedKey: maskApiKey(data.sendgrid_api_key),
                verified: data.sendgrid_api_key_verified || false,
                verifiedAt: data.sendgrid_api_key_verified_at,
            },
        };
    } catch (err) {
        console.error('Get email provider settings exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Set user's preferred email provider
 * @param {string} userId - The user's ID
 * @param {string} provider - 'resend' or 'sendgrid'
 */
export async function setEmailProvider(userId, provider) {
    if (!['resend', 'sendgrid', null].includes(provider)) {
        return { success: false, error: 'Invalid provider. Must be "resend" or "sendgrid"' };
    }

    try {
        const { error } = await supabase
            .from('profiles')
            .update({ email_provider: provider })
            .eq('id', userId);

        if (error) {
            return { success: false, error: error.message };
        }

        return { success: true, provider };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Get user's active email provider and API key
 * @param {string} userId - The user's ID
 * @returns {Object} - { provider, apiKey } or null
 */
export async function getActiveEmailProvider(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('email_provider, resend_api_key, sendgrid_api_key')
            .eq('id', userId)
            .single();

        if (error || !data) {
            return null;
        }

        const provider = data.email_provider;

        if (provider === 'sendgrid' && data.sendgrid_api_key) {
            return { provider: 'sendgrid', apiKey: data.sendgrid_api_key };
        }

        if (provider === 'resend' && data.resend_api_key) {
            return { provider: 'resend', apiKey: data.resend_api_key };
        }

        // Auto-detect: prefer whichever has an API key
        if (data.resend_api_key) {
            return { provider: 'resend', apiKey: data.resend_api_key };
        }

        if (data.sendgrid_api_key) {
            return { provider: 'sendgrid', apiKey: data.sendgrid_api_key };
        }

        return null;
    } catch {
        return null;
    }
}

// =============================================
// RESEND API KEY MANAGEMENT
// =============================================

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

        return {
            success: true,
            hasApiKey: !!data.resend_api_key,
            maskedKey: maskApiKey(data.resend_api_key),
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
            const { error: resendError } = await testResend.domains.list();
            verified = !resendError;
        } catch (verifyErr) {
            console.warn('Failed to verify Resend API key:', verifyErr.message);
        }

        // Save the API key and set as active provider
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                resend_api_key: apiKey,
                resend_api_key_verified: verified,
                resend_api_key_verified_at: verified ? new Date().toISOString() : null,
                email_provider: 'resend', // Auto-set as active provider
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
        // Check if user has SendGrid configured to fall back to
        const { data } = await supabase
            .from('profiles')
            .select('sendgrid_api_key, email_provider')
            .eq('id', userId)
            .single();

        const updates = {
            resend_api_key: null,
            resend_api_key_verified: false,
            resend_api_key_verified_at: null,
        };

        // If current provider is resend, switch to sendgrid if available, otherwise null
        if (data?.email_provider === 'resend') {
            updates.email_provider = data.sendgrid_api_key ? 'sendgrid' : null;
        }

        const { error } = await supabase
            .from('profiles')
            .update(updates)
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
        const apiKey = await getUserResendApiKey(userId);

        if (!apiKey) {
            return { success: false, error: 'No Resend API key configured' };
        }

        const testResend = new Resend(apiKey);

        try {
            const { data: domainsData, error: resendError } = await testResend.domains.list();

            if (resendError) {
                await supabase
                    .from('profiles')
                    .update({ resend_api_key_verified: false })
                    .eq('id', userId);

                return {
                    success: false,
                    error: `API key verification failed: ${resendError.message}`
                };
            }

            await supabase
                .from('profiles')
                .update({
                    resend_api_key_verified: true,
                    resend_api_key_verified_at: new Date().toISOString(),
                })
                .eq('id', userId);

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

// =============================================
// SENDGRID API KEY MANAGEMENT
// =============================================

/**
 * Get user's SendGrid API key status (masked for display)
 * @param {string} userId - The user's ID
 */
export async function getSendGridApiKeyStatus(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('sendgrid_api_key, sendgrid_api_key_verified, sendgrid_api_key_verified_at')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Failed to get SendGrid settings:', error);
            return { success: false, error: error.message };
        }

        return {
            success: true,
            hasApiKey: !!data.sendgrid_api_key,
            maskedKey: maskApiKey(data.sendgrid_api_key),
            verified: data.sendgrid_api_key_verified || false,
            verifiedAt: data.sendgrid_api_key_verified_at,
        };
    } catch (err) {
        console.error('Get SendGrid API key status exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get user's actual SendGrid API key (for internal use only)
 * @param {string} userId - The user's ID
 */
export async function getUserSendGridApiKey(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('sendgrid_api_key')
            .eq('id', userId)
            .single();

        if (error || !data) {
            return null;
        }

        return data.sendgrid_api_key || null;
    } catch {
        return null;
    }
}

/**
 * Save user's SendGrid API key
 * @param {string} userId - The user's ID
 * @param {string} apiKey - The SendGrid API key
 */
export async function saveSendGridApiKey(userId, apiKey) {
    try {
        // Validate the API key format (SendGrid keys start with 'SG.')
        if (!apiKey || !apiKey.startsWith('SG.')) {
            return {
                success: false,
                error: 'Invalid API key format. SendGrid API keys start with "SG."'
            };
        }

        // Verify the API key works by checking scopes
        let verified = false;

        try {
            sgMail.setApiKey(apiKey);
            // SendGrid doesn't have a simple "list domains" like Resend
            // We'll verify by checking API key scopes
            const response = await fetch('https://api.sendgrid.com/v3/scopes', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            });

            verified = response.ok;

            if (!verified) {
                const errorData = await response.json().catch(() => ({}));
                console.warn('SendGrid API key verification failed:', errorData);
            }
        } catch (verifyErr) {
            console.warn('Failed to verify SendGrid API key:', verifyErr.message);
        }

        // Save the API key and set as active provider
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                sendgrid_api_key: apiKey,
                sendgrid_api_key_verified: verified,
                sendgrid_api_key_verified_at: verified ? new Date().toISOString() : null,
                email_provider: 'sendgrid', // Auto-set as active provider
            })
            .eq('id', userId);

        if (updateError) {
            console.error('Failed to save SendGrid API key:', updateError);
            return { success: false, error: updateError.message };
        }

        console.log(`SendGrid API key saved for user ${userId}, verified: ${verified}`);
        return {
            success: true,
            verified,
            message: verified
                ? 'API key saved and verified successfully!'
                : 'API key saved but could not be verified. Please check your key is correct.'
        };
    } catch (err) {
        console.error('Save SendGrid API key exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Delete user's SendGrid API key
 * @param {string} userId - The user's ID
 */
export async function deleteSendGridApiKey(userId) {
    try {
        // Check if user has Resend configured to fall back to
        const { data } = await supabase
            .from('profiles')
            .select('resend_api_key, email_provider')
            .eq('id', userId)
            .single();

        const updates = {
            sendgrid_api_key: null,
            sendgrid_api_key_verified: false,
            sendgrid_api_key_verified_at: null,
        };

        // If current provider is sendgrid, switch to resend if available, otherwise null
        if (data?.email_provider === 'sendgrid') {
            updates.email_provider = data.resend_api_key ? 'resend' : null;
        }

        const { error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userId);

        if (error) {
            console.error('Failed to delete SendGrid API key:', error);
            return { success: false, error: error.message };
        }

        console.log(`SendGrid API key deleted for user ${userId}`);
        return { success: true };
    } catch (err) {
        console.error('Delete SendGrid API key exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Verify user's SendGrid API key works
 * @param {string} userId - The user's ID
 */
export async function verifySendGridApiKey(userId) {
    try {
        const apiKey = await getUserSendGridApiKey(userId);

        if (!apiKey) {
            return { success: false, error: 'No SendGrid API key configured' };
        }

        try {
            // Verify by checking API scopes
            const response = await fetch('https://api.sendgrid.com/v3/scopes', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                await supabase
                    .from('profiles')
                    .update({ sendgrid_api_key_verified: false })
                    .eq('id', userId);

                return {
                    success: false,
                    error: 'API key verification failed. Please check your key is correct.'
                };
            }

            await supabase
                .from('profiles')
                .update({
                    sendgrid_api_key_verified: true,
                    sendgrid_api_key_verified_at: new Date().toISOString(),
                })
                .eq('id', userId);

            // Get verified sender identities
            const sendersResponse = await fetch('https://api.sendgrid.com/v3/verified_senders', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            });

            let senders = [];
            if (sendersResponse.ok) {
                const sendersData = await sendersResponse.json();
                senders = (sendersData.results || []).map(s => ({
                    id: s.id,
                    email: s.from_email,
                    name: s.from_name,
                    verified: s.verified,
                }));
            }

            return {
                success: true,
                verified: true,
                senders,
                message: `API key verified! Found ${senders.length} verified sender(s).`
            };
        } catch (verifyErr) {
            return {
                success: false,
                error: `Failed to verify API key: ${verifyErr.message}`
            };
        }
    } catch (err) {
        console.error('Verify SendGrid API key exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get user's verified senders from their SendGrid account
 * @param {string} userId - The user's ID
 */
export async function getUserSendGridSenders(userId) {
    try {
        const apiKey = await getUserSendGridApiKey(userId);

        if (!apiKey) {
            return { success: false, error: 'No SendGrid API key configured', senders: [] };
        }

        try {
            const response = await fetch('https://api.sendgrid.com/v3/verified_senders', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                return { success: false, error: 'Failed to fetch senders', senders: [] };
            }

            const data = await response.json();
            const senders = (data.results || []).map(s => ({
                id: s.id,
                email: s.from_email,
                name: s.from_name,
                verified: s.verified,
            }));

            return { success: true, senders };
        } catch (err) {
            return { success: false, error: err.message, senders: [] };
        }
    } catch (err) {
        console.error('Get user SendGrid senders exception:', err);
        return { success: false, error: err.message, senders: [] };
    }
}

// =============================================
// BRAND SETTINGS
// =============================================

/**
 * Get user's brand settings
 * @param {string} userId - The user's ID
 * @returns {Object} - Brand settings
 */
export async function getBrandSettings(userId) {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('brand_logo_url, brand_color, brand_name, brand_cta_text, brand_cta_url')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Get brand settings error:', error);
            return { success: false, error: error.message };
        }

        return {
            success: true,
            brandLogoUrl: data?.brand_logo_url || null,
            brandColor: data?.brand_color || null,
            brandName: data?.brand_name || null,
            brandCtaText: data?.brand_cta_text || null,
            brandCtaUrl: data?.brand_cta_url || null,
        };
    } catch (err) {
        console.error('Get brand settings exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Save user's brand settings
 * @param {string} userId - The user's ID
 * @param {Object} settings - Brand settings to save
 * @returns {Object} - Result
 */
export async function saveBrandSettings(userId, { brandLogoUrl, brandColor, brandName, brandCtaText, brandCtaUrl }) {
    try {
        // Validate color format if provided
        if (brandColor && !/^#[0-9A-Fa-f]{6}$/.test(brandColor)) {
            return { success: false, error: 'Invalid color format. Use hex format like #6366f1' };
        }

        // Validate URL format if provided
        if (brandCtaUrl && brandCtaUrl.trim()) {
            try {
                new URL(brandCtaUrl);
            } catch {
                return { success: false, error: 'Invalid CTA URL format' };
            }
        }

        const updates = {};
        if (brandLogoUrl !== undefined) updates.brand_logo_url = brandLogoUrl || null;
        if (brandColor !== undefined) updates.brand_color = brandColor || null;
        if (brandName !== undefined) updates.brand_name = brandName || null;
        if (brandCtaText !== undefined) updates.brand_cta_text = brandCtaText || null;
        if (brandCtaUrl !== undefined) updates.brand_cta_url = brandCtaUrl || null;

        const { error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', userId);

        if (error) {
            console.error('Save brand settings error:', error);
            return { success: false, error: error.message };
        }

        return { success: true, message: 'Brand settings saved' };
    } catch (err) {
        console.error('Save brand settings exception:', err);
        return { success: false, error: err.message };
    }
}

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Mask an API key for display
 * @param {string} apiKey - The API key to mask
 * @returns {string|null} - Masked key or null
 */
function maskApiKey(apiKey) {
    if (!apiKey || apiKey.length < 10) {
        return null;
    }
    return `${apiKey.substring(0, 6)}${'*'.repeat(Math.min(apiKey.length - 10, 20))}${apiKey.substring(apiKey.length - 4)}`;
}

export default {
    // Provider settings
    getEmailProviderSettings,
    setEmailProvider,
    getActiveEmailProvider,
    // Resend
    getResendApiKeyStatus,
    getUserResendApiKey,
    saveResendApiKey,
    deleteResendApiKey,
    verifyResendApiKey,
    getUserResendDomains,
    // SendGrid
    getSendGridApiKeyStatus,
    getUserSendGridApiKey,
    saveSendGridApiKey,
    deleteSendGridApiKey,
    verifySendGridApiKey,
    getUserSendGridSenders,
    // Brand settings
    getBrandSettings,
    saveBrandSettings,
};
