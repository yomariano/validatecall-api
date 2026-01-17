/**
 * Admin Authentication Middleware
 * Protects admin-only routes
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// List of admin emails (backup if DB flag not set)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').filter(Boolean);

/**
 * Middleware to require admin access
 * Checks: 1) is_admin flag in DB, 2) email in ADMIN_EMAILS env var
 */
export async function requireAdmin(req, res, next) {
    try {
        // Get user ID from various sources
        const userId = req.body?.adminUserId || req.query?.adminUserId || req.headers['x-admin-user-id'];

        if (!userId) {
            return res.status(401).json({ error: 'Admin user ID required' });
        }

        // Fetch user profile
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('id, email, is_admin')
            .eq('id', userId)
            .single();

        if (error || !profile) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Check admin access
        const isAdmin = profile.is_admin === true || ADMIN_EMAILS.includes(profile.email);

        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        // Attach admin user to request
        req.adminUser = profile;
        next();
    } catch (err) {
        console.error('Admin auth error:', err);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

/**
 * Check if a user is an admin (for use in other middleware/routes)
 */
export async function isAdmin(userId) {
    if (!userId) return false;

    try {
        const { data: profile } = await supabase
            .from('profiles')
            .select('email, is_admin')
            .eq('id', userId)
            .single();

        if (!profile) return false;

        return profile.is_admin === true || ADMIN_EMAILS.includes(profile.email);
    } catch {
        return false;
    }
}

export default { requireAdmin, isAdmin };
