/**
 * User Settings Routes
 * Endpoints for managing user-specific settings like email provider API keys
 * Supports: Resend, SendGrid
 */

import { Router } from 'express';
import {
    // Provider settings
    getEmailProviderSettings,
    setEmailProvider,
    // Resend
    getResendApiKeyStatus,
    saveResendApiKey,
    deleteResendApiKey,
    verifyResendApiKey,
    getUserResendDomains,
    // SendGrid
    getSendGridApiKeyStatus,
    saveSendGridApiKey,
    deleteSendGridApiKey,
    verifySendGridApiKey,
    getUserSendGridSenders,
    // Brand settings
    getBrandSettings,
    saveBrandSettings,
} from '../services/userSettings.js';

const router = Router();

// =============================================
// EMAIL PROVIDER SETTINGS
// =============================================

/**
 * GET /api/settings/email-provider
 * Get complete email provider settings (both Resend and SendGrid status)
 * Query: userId (required)
 */
router.get('/email-provider', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await getEmailProviderSettings(userId);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Get email provider settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/settings/email-provider
 * Set user's preferred email provider
 * Body: { userId, provider: 'resend' | 'sendgrid' }
 */
router.post('/email-provider', async (req, res) => {
    try {
        const { userId, provider } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await setEmailProvider(userId, provider);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Set email provider error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// RESEND API KEY ROUTES
// =============================================

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

// =============================================
// SENDGRID API KEY ROUTES
// =============================================

/**
 * GET /api/settings/sendgrid
 * Get user's SendGrid API key status (masked)
 * Query: userId (required)
 */
router.get('/sendgrid', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await getSendGridApiKeyStatus(userId);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Get SendGrid API key status error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/settings/sendgrid
 * Save user's SendGrid API key
 * Body: { userId, apiKey }
 */
router.post('/sendgrid', async (req, res) => {
    try {
        const { userId, apiKey } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        if (!apiKey) {
            return res.status(400).json({ error: 'apiKey is required' });
        }

        const result = await saveSendGridApiKey(userId, apiKey);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Save SendGrid API key error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/settings/sendgrid
 * Delete user's SendGrid API key
 * Query: userId (required)
 */
router.delete('/sendgrid', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await deleteSendGridApiKey(userId);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, message: 'SendGrid API key deleted' });
    } catch (error) {
        console.error('Delete SendGrid API key error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/settings/sendgrid/verify
 * Verify user's SendGrid API key works
 * Body: { userId }
 */
router.post('/sendgrid/verify', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await verifySendGridApiKey(userId);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Verify SendGrid API key error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/settings/sendgrid/senders
 * Get user's verified senders from their SendGrid account
 * Query: userId (required)
 */
router.get('/sendgrid/senders', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await getUserSendGridSenders(userId);

        if (!result.success) {
            return res.status(400).json({ error: result.error, senders: [] });
        }

        res.json(result);
    } catch (error) {
        console.error('Get user SendGrid senders error:', error);
        res.status(500).json({ error: error.message, senders: [] });
    }
});

// =============================================
// BRAND SETTINGS ROUTES
// =============================================

/**
 * GET /api/settings/brand
 * Get user's brand settings (logo, color, company name)
 * Query: userId (required)
 */
router.get('/brand', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await getBrandSettings(userId);

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Get brand settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/settings/brand
 * Save user's brand settings
 * Body: { userId, brandLogoUrl?, brandColor?, brandName? }
 */
router.post('/brand', async (req, res) => {
    try {
        const { userId, brandLogoUrl, brandColor, brandName } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const result = await saveBrandSettings(userId, { brandLogoUrl, brandColor, brandName });

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Save brand settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
