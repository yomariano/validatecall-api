/**
 * User Settings Routes
 * Endpoints for managing user-specific settings like Resend API key
 */

import { Router } from 'express';
import {
    getResendApiKeyStatus,
    saveResendApiKey,
    deleteResendApiKey,
    verifyResendApiKey,
    getUserResendDomains,
} from '../services/userSettings.js';

const router = Router();

/**
 * GET /api/settings/resend
 * Get user's Resend API key status (masked)
 * Query: userId (required)
 */
router.get('/resend', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await getResendApiKeyStatus(userId);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Get Resend API key status error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/settings/resend
 * Save user's Resend API key
 * Body: { userId, apiKey }
 */
router.post('/resend', async (req, res) => {
    try {
        const { userId, apiKey } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!apiKey) {
            return res.status(400).json({ error: 'apiKey is required' });
        }

        const result = await saveResendApiKey(userId, apiKey);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Save Resend API key error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/settings/resend
 * Delete user's Resend API key
 * Query: userId (required)
 */
router.delete('/resend', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await deleteResendApiKey(userId);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, message: 'Resend API key deleted' });
    } catch (error) {
        console.error('Delete Resend API key error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/settings/resend/verify
 * Verify user's Resend API key works
 * Body: { userId }
 */
router.post('/resend/verify', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await verifyResendApiKey(userId);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Verify Resend API key error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/settings/resend/domains
 * Get user's verified domains from their Resend account
 * Query: userId (required)
 */
router.get('/resend/domains', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await getUserResendDomains(userId);

        if (!result.success) {
            return res.status(400).json({ error: result.error, domains: [] });
        }

        res.json(result);
    } catch (error) {
        console.error('Get user Resend domains error:', error);
        res.status(500).json({ error: error.message, domains: [] });
    }
});

export default router;
