/**
 * Domain Verification Service using Resend
 * Handles domain management for custom email sending
 */

import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Check if domain service is configured
 */
export function isConfigured() {
    return !!process.env.RESEND_API_KEY;
}

/**
 * Map Resend status to our internal status
 * Resend uses: not_started, pending, verified, failed, temporary_failure
 * We use: pending, verified, failed
 */
function mapResendStatus(resendStatus) {
    switch (resendStatus) {
        case 'verified':
            return 'verified';
        case 'failed':
        case 'temporary_failure':
            return 'failed';
        case 'not_started':
        case 'pending':
        default:
            return 'pending';
    }
}

/**
 * Create a new domain for verification
 * @param {string} userId - The user's ID
 * @param {string} domainName - The domain to verify (e.g., "abc.com")
 */
export async function createDomain(userId, domainName) {
    if (!resend) {
        return { success: false, error: 'Email service not configured' };
    }

    // Normalize domain name (lowercase, remove any protocol/path)
    const normalizedDomain = domainName.toLowerCase().replace(/^(https?:\/\/)?/, '').split('/')[0];

    try {
        // Check if domain already exists for this user
        const { data: existing } = await supabase
            .from('user_domains')
            .select('id, status')
            .eq('user_id', userId)
            .eq('domain_name', normalizedDomain)
            .single();

        if (existing) {
            return {
                success: false,
                error: `Domain "${normalizedDomain}" already exists. Status: ${existing.status}`
            };
        }

        // Create domain in Resend
        const { data: resendDomain, error: resendError } = await resend.domains.create({
            name: normalizedDomain,
        });

        if (resendError) {
            console.error('Resend domain creation error:', resendError);
            return { success: false, error: resendError.message };
        }

        // Store in database (map Resend status to our allowed values)
        const { data: dbDomain, error: dbError } = await supabase
            .from('user_domains')
            .insert({
                user_id: userId,
                domain_name: normalizedDomain,
                resend_domain_id: resendDomain.id,
                status: mapResendStatus(resendDomain.status),
                dns_records: resendDomain.records || [],
            })
            .select()
            .single();

        if (dbError) {
            console.error('Database insert error:', dbError);
            // Try to clean up Resend domain
            try {
                await resend.domains.remove(resendDomain.id);
            } catch (cleanupErr) {
                console.error('Failed to cleanup Resend domain:', cleanupErr);
            }
            return { success: false, error: dbError.message };
        }

        console.log(`Domain "${normalizedDomain}" created for user ${userId}`);
        return {
            success: true,
            domain: {
                id: dbDomain.id,
                domainName: dbDomain.domain_name,
                status: dbDomain.status,
                dnsRecords: dbDomain.dns_records,
                createdAt: dbDomain.created_at,
            }
        };
    } catch (err) {
        console.error('Domain creation exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get all domains for a user
 * @param {string} userId - The user's ID
 */
export async function listDomains(userId) {
    try {
        const { data, error } = await supabase
            .from('user_domains')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Failed to list domains:', error);
            return { success: false, error: error.message };
        }

        return {
            success: true,
            domains: data.map(d => ({
                id: d.id,
                domainName: d.domain_name,
                resendDomainId: d.resend_domain_id,
                status: d.status,
                dnsRecords: d.dns_records,
                createdAt: d.created_at,
                verifiedAt: d.verified_at,
            })),
        };
    } catch (err) {
        console.error('List domains exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get a specific domain by ID
 * @param {string} userId - The user's ID
 * @param {string} domainId - The domain's ID
 */
export async function getDomain(userId, domainId) {
    try {
        const { data, error } = await supabase
            .from('user_domains')
            .select('*')
            .eq('id', domainId)
            .eq('user_id', userId)
            .single();

        if (error) {
            return { success: false, error: 'Domain not found' };
        }

        return {
            success: true,
            domain: {
                id: data.id,
                domainName: data.domain_name,
                resendDomainId: data.resend_domain_id,
                status: data.status,
                dnsRecords: data.dns_records,
                createdAt: data.created_at,
                verifiedAt: data.verified_at,
            },
        };
    } catch (err) {
        console.error('Get domain exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Check and update domain verification status
 * @param {string} userId - The user's ID
 * @param {string} domainId - The domain's ID
 */
export async function verifyDomain(userId, domainId) {
    if (!resend) {
        return { success: false, error: 'Email service not configured' };
    }

    try {
        // Get domain from database
        const { data: dbDomain, error: dbError } = await supabase
            .from('user_domains')
            .select('*')
            .eq('id', domainId)
            .eq('user_id', userId)
            .single();

        if (dbError || !dbDomain) {
            return { success: false, error: 'Domain not found' };
        }

        if (!dbDomain.resend_domain_id) {
            return { success: false, error: 'Domain not linked to Resend' };
        }

        // Trigger verification in Resend
        const { data: verifyResult, error: verifyError } = await resend.domains.verify(dbDomain.resend_domain_id);

        if (verifyError) {
            console.error('Resend verify error:', verifyError);
            // Don't fail completely, try to get current status
        }

        // Get updated status from Resend
        const { data: resendDomain, error: getError } = await resend.domains.get(dbDomain.resend_domain_id);

        if (getError) {
            console.error('Failed to get domain status:', getError);
            return { success: false, error: 'Failed to check verification status' };
        }

        // Map Resend status to our allowed status values
        const newStatus = mapResendStatus(resendDomain.status);

        // Update database with new status and records
        const updateData = {
            status: newStatus,
            dns_records: resendDomain.records || dbDomain.dns_records,
        };

        if (newStatus === 'verified' && !dbDomain.verified_at) {
            updateData.verified_at = new Date().toISOString();
        }

        const { error: updateError } = await supabase
            .from('user_domains')
            .update(updateData)
            .eq('id', domainId);

        if (updateError) {
            console.error('Failed to update domain status:', updateError);
        }

        console.log(`Domain ${dbDomain.domain_name} verification status: ${newStatus}`);
        return {
            success: true,
            domain: {
                id: dbDomain.id,
                domainName: dbDomain.domain_name,
                status: newStatus,
                dnsRecords: resendDomain.records || dbDomain.dns_records,
                verifiedAt: newStatus === 'verified' ? updateData.verified_at || dbDomain.verified_at : null,
            },
        };
    } catch (err) {
        console.error('Verify domain exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Delete a domain
 * @param {string} userId - The user's ID
 * @param {string} domainId - The domain's ID
 */
export async function deleteDomain(userId, domainId) {
    try {
        // Get domain from database
        const { data: dbDomain, error: dbError } = await supabase
            .from('user_domains')
            .select('*')
            .eq('id', domainId)
            .eq('user_id', userId)
            .single();

        if (dbError || !dbDomain) {
            return { success: false, error: 'Domain not found' };
        }

        // Delete from Resend if we have an ID
        if (resend && dbDomain.resend_domain_id) {
            try {
                await resend.domains.remove(dbDomain.resend_domain_id);
            } catch (resendErr) {
                console.warn('Failed to delete domain from Resend:', resendErr);
                // Continue with database deletion anyway
            }
        }

        // Delete from database
        const { error: deleteError } = await supabase
            .from('user_domains')
            .delete()
            .eq('id', domainId)
            .eq('user_id', userId);

        if (deleteError) {
            console.error('Failed to delete domain from database:', deleteError);
            return { success: false, error: deleteError.message };
        }

        console.log(`Domain "${dbDomain.domain_name}" deleted for user ${userId}`);
        return { success: true };
    } catch (err) {
        console.error('Delete domain exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get verified domains for a user (for use in sender dropdown)
 * @param {string} userId - The user's ID
 */
export async function getVerifiedDomains(userId) {
    try {
        const { data, error } = await supabase
            .from('user_domains')
            .select('id, domain_name')
            .eq('user_id', userId)
            .eq('status', 'verified')
            .order('domain_name', { ascending: true });

        if (error) {
            console.error('Failed to get verified domains:', error);
            return { success: false, error: error.message };
        }

        return {
            success: true,
            domains: data.map(d => ({
                id: d.id,
                domainName: d.domain_name,
            })),
        };
    } catch (err) {
        console.error('Get verified domains exception:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Check if an email address uses a verified domain for a user
 * @param {string} userId - The user's ID
 * @param {string} email - The email address to check
 */
export async function isEmailDomainVerified(userId, email) {
    if (!email || !email.includes('@')) {
        return false;
    }

    const domain = email.split('@')[1].toLowerCase();

    try {
        const { data, error } = await supabase
            .from('user_domains')
            .select('id')
            .eq('user_id', userId)
            .eq('domain_name', domain)
            .eq('status', 'verified')
            .single();

        return !error && !!data;
    } catch {
        return false;
    }
}
