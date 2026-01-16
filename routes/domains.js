/**
 * Domain Routes
 * Endpoints for managing custom email domains
 */

import { Router } from 'express';
import {
    createDomain,
    listDomains,
    getDomain,
    verifyDomain,
    deleteDomain,
    getVerifiedDomains,
    isConfigured,
} from '../services/domains.js';

const router = Router();

/**
 * GET /api/domains/status
 * Check if domain service is configured
 */
router.get('/status', (req, res) => {
    res.json({
        configured: isConfigured(),
        message: isConfigured()
            ? 'Domain service is ready'
            : 'RESEND_API_KEY not configured',
    });
});

/**
 * GET /api/domains
 * List all domains for a user
 * Query: userId (required)
 */
router.get('/', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await listDomains(userId);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('List domains error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/domains/verified
 * Get only verified domains for a user (for sender dropdown)
 * Query: userId (required)
 */
router.get('/verified', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await getVerifiedDomains(userId);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Get verified domains error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/domains/:id
 * Get a specific domain
 * Query: userId (required)
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await getDomain(userId, id);

        if (!result.success) {
            return res.status(404).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Get domain error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/domains
 * Create a new domain for verification
 * Body: { userId, domain }
 */
router.post('/', async (req, res) => {
    try {
        const { userId, domain } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!domain) {
            return res.status(400).json({ error: 'domain is required' });
        }

        // Basic domain validation
        const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
        const normalizedDomain = domain.toLowerCase().replace(/^(https?:\/\/)?/, '').split('/')[0];

        if (!domainRegex.test(normalizedDomain)) {
            return res.status(400).json({ error: 'Invalid domain format. Please enter a valid domain (e.g., yourdomain.com)' });
        }

        const result = await createDomain(userId, normalizedDomain);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.status(201).json(result);
    } catch (error) {
        console.error('Create domain error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/domains/:id/verify
 * Trigger verification check for a domain
 * Body: { userId }
 */
router.post('/:id/verify', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await verifyDomain(userId, id);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Verify domain error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/domains/:id
 * Delete a domain
 * Query: userId (required)
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await deleteDomain(userId, id);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, message: 'Domain deleted successfully' });
    } catch (error) {
        console.error('Delete domain error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
