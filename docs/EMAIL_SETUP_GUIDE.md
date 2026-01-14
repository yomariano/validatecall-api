# Email System Setup Guide

A complete guide to setting up transactional emails using **Resend** (sending) and **Cloudflare Email Routing** (receiving) for any project.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Part 1: Resend Setup (Sending Emails)](#part-1-resend-setup-sending-emails)
4. [Part 2: Cloudflare Email Routing (Receiving Emails)](#part-2-cloudflare-email-routing-receiving-emails)
5. [Part 3: Backend Implementation](#part-3-backend-implementation)
6. [Part 4: Database Schema](#part-4-database-schema)
7. [Part 5: Frontend Integration](#part-5-frontend-integration)
8. [Part 6: Testing](#part-6-testing)
9. [Troubleshooting](#troubleshooting)

---

## Overview

This setup provides:
- **Outbound emails** via Resend (welcome emails, notifications, receipts)
- **Inbound emails** via Cloudflare Email Routing (support@, contact@, etc.)
- **Email logging** for tracking and deduplication
- **HTML templates** with consistent branding

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Your App      │────▶│     Resend      │────▶│   User Inbox    │
│   (Backend)     │     │   (Send API)    │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   User sends    │────▶│   Cloudflare    │────▶│   Your Inbox    │
│   to support@   │     │  Email Routing  │     │  (Gmail, etc)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## Prerequisites

- Domain managed by **Cloudflare** (for DNS)
- **Node.js** backend (Express, Fastify, etc.)
- Database (PostgreSQL/Supabase recommended)
- Accounts:
  - [Resend](https://resend.com) (free tier: 3,000 emails/month)
  - [Cloudflare](https://cloudflare.com) (free tier includes email routing)

---

## Part 1: Resend Setup (Sending Emails)

### Step 1.1: Create Resend Account

1. Go to [resend.com](https://resend.com)
2. Sign up with email or GitHub
3. Verify your email address

### Step 1.2: Add Your Domain

1. Go to **Resend Dashboard → Domains**
2. Click **"Add Domain"**
3. Enter your domain (e.g., `yourdomain.com`)
4. Choose verification method:
   - **Automatic (Cloudflare)**: Click "Sign in to Cloudflare" - DNS records added automatically
   - **Manual**: Copy the DNS records and add them yourself

### Step 1.3: Manual DNS Records (if not using automatic)

Add these records in Cloudflare DNS:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3...` (from Resend) | Auto |
| TXT | `@` | `v=spf1 include:spf.resend.com ~all` | Auto |

**If you already have an SPF record**, merge them:
```
v=spf1 include:_spf.mx.cloudflare.net include:spf.resend.com ~all
```

### Step 1.4: Verify Domain

1. Wait 1-5 minutes for DNS propagation
2. Click **"Verify"** in Resend dashboard
3. Status should change to **"Verified"**

### Step 1.5: Create API Key

1. Go to **Resend Dashboard → API Keys**
2. Click **"Create API Key"**
3. Name it (e.g., `myproject-production`)
4. Select **"Full access"** permission
5. Copy the key immediately (starts with `re_`)

---

## Part 2: Cloudflare Email Routing (Receiving Emails)

### Step 2.1: Enable Email Routing

1. Go to **Cloudflare Dashboard**
2. Select your domain
3. Navigate to **Email → Email Routing**
4. Click **"Enable Email Routing"** if not enabled
5. Cloudflare will add MX records automatically

### Step 2.2: Add Destination Address

1. Go to **Email Routing → Destination addresses**
2. Click **"Add destination address"**
3. Enter your personal/team email (e.g., `team@gmail.com`)
4. Check your inbox and click the verification link

### Step 2.3: Create Routing Rules

1. Go to **Email Routing → Routing rules**
2. Click **"Create address"**
3. Configure:
   - **Custom address**: `support` (becomes support@yourdomain.com)
   - **Action**: Send to an email
   - **Destination**: Select your verified destination
4. Click **"Save"**

Repeat for other addresses (contact@, hello@, etc.)

### Step 2.4: Optional - Enable Catch-All

To receive ALL emails to your domain:
1. Find **"Catch-all address"** section
2. Toggle from "Disabled" to enabled
3. Set action to forward to your destination

---

## Part 3: Backend Implementation

### Step 3.1: Install Dependencies

```bash
npm install resend
```

### Step 3.2: Environment Variables

Create/update your `.env` file:

```env
# Resend Configuration
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM_ADDRESS=YourApp <noreply@yourdomain.com>
EMAIL_REPLY_TO=support@yourdomain.com

# App Configuration
FRONTEND_URL=https://yourdomain.com
APP_NAME=YourApp
```

### Step 3.3: Create Email Service

Create `services/email.js`:

```javascript
/**
 * Email Service
 * Handles all transactional emails using Resend
 */

import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'noreply@yourdomain.com';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@yourdomain.com';
const APP_NAME = process.env.APP_NAME || 'YourApp';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://yourdomain.com';

// Brand colors - customize these
const BRAND_COLOR = '#3B82F6';
const BRAND_COLOR_DARK = '#1E40AF';

/**
 * Base HTML email template
 */
function baseTemplate(content, previewText = '') {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${APP_NAME}</title>
    ${previewText ? `<span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>` : ''}
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_COLOR_DARK} 100%);padding:30px;text-align:center;">
                            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:600;">${APP_NAME}</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding:40px 30px;">
                            ${content}
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#f9fafb;padding:20px 30px;text-align:center;border-top:1px solid #e5e7eb;">
                            <p style="margin:0;color:#6b7280;font-size:12px;">
                                &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
                            </p>
                            <p style="margin:8px 0 0;color:#9ca3af;font-size:11px;">
                                <a href="${FRONTEND_URL}" style="color:#9ca3af;">Visit our website</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

/**
 * Reusable button component
 */
function buttonHtml(text, url) {
    return `
    <table cellpadding="0" cellspacing="0" style="margin:25px 0;">
        <tr>
            <td style="background-color:${BRAND_COLOR};border-radius:6px;padding:12px 24px;">
                <a href="${url}" style="color:#ffffff;text-decoration:none;font-weight:500;display:inline-block;">${text}</a>
            </td>
        </tr>
    </table>`;
}

// ============================================
// EMAIL TEMPLATES
// ============================================

/**
 * Welcome email for new users
 */
export async function sendWelcomeEmail({ email, name }) {
    if (!resend) {
        console.warn('Resend not configured - skipping welcome email');
        return null;
    }

    const firstName = name?.split(' ')[0] || 'there';

    const content = `
        <h2 style="margin:0 0 20px;color:#111827;font-size:20px;">Welcome to ${APP_NAME}!</h2>
        <p style="color:#374151;line-height:1.6;margin:0 0 15px;">
            Hi ${firstName},
        </p>
        <p style="color:#374151;line-height:1.6;margin:0 0 15px;">
            Thanks for signing up! We're excited to have you on board.
        </p>
        <p style="color:#374151;line-height:1.6;margin:0 0 15px;">
            Here's what you can do next:
        </p>
        <ul style="color:#374151;line-height:1.8;margin:0 0 15px;padding-left:20px;">
            <li>Complete your profile</li>
            <li>Explore our features</li>
            <li>Check out our documentation</li>
        </ul>
        ${buttonHtml('Get Started', `${FRONTEND_URL}/dashboard`)}
        <p style="color:#6b7280;font-size:14px;margin:20px 0 0;">
            Questions? Reply to this email or contact us at ${REPLY_TO}
        </p>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            replyTo: REPLY_TO,
            to: email,
            subject: `Welcome to ${APP_NAME}!`,
            html: baseTemplate(content, `Welcome aboard, ${firstName}!`),
        });

        if (error) throw error;
        console.log(`✓ Welcome email sent to ${email}`);
        return data;
    } catch (err) {
        console.error('Failed to send welcome email:', err);
        throw err;
    }
}

/**
 * Payment confirmation email
 */
export async function sendPaymentConfirmationEmail({ email, name, planName, amount, currency = 'USD' }) {
    if (!resend) {
        console.warn('Resend not configured - skipping payment email');
        return null;
    }

    const firstName = name?.split(' ')[0] || 'there';
    const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
    }).format(amount / 100);

    const content = `
        <h2 style="margin:0 0 20px;color:#111827;font-size:20px;">Payment Confirmed!</h2>
        <p style="color:#374151;line-height:1.6;margin:0 0 15px;">
            Hi ${firstName},
        </p>
        <p style="color:#374151;line-height:1.6;margin:0 0 20px;">
            Thank you for your payment. Your subscription has been activated.
        </p>

        <table style="background-color:#f9fafb;border-radius:8px;padding:20px;width:100%;margin:0 0 20px;">
            <tr>
                <td style="color:#6b7280;padding:5px 0;">Plan:</td>
                <td style="color:#111827;font-weight:600;text-align:right;">${planName}</td>
            </tr>
            <tr>
                <td style="color:#6b7280;padding:5px 0;">Amount:</td>
                <td style="color:#111827;font-weight:600;text-align:right;">${formattedAmount}</td>
            </tr>
            <tr>
                <td style="color:#6b7280;padding:5px 0;">Date:</td>
                <td style="color:#111827;text-align:right;">${new Date().toLocaleDateString()}</td>
            </tr>
        </table>

        ${buttonHtml('View Dashboard', `${FRONTEND_URL}/dashboard`)}

        <p style="color:#6b7280;font-size:14px;margin:20px 0 0;">
            Need help? Contact us at ${REPLY_TO}
        </p>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            replyTo: REPLY_TO,
            to: email,
            subject: `Payment Confirmed - ${planName} Plan`,
            html: baseTemplate(content, `Your ${planName} plan is now active!`),
        });

        if (error) throw error;
        console.log(`✓ Payment confirmation sent to ${email}`);
        return data;
    } catch (err) {
        console.error('Failed to send payment email:', err);
        throw err;
    }
}

/**
 * Usage alert email (e.g., approaching limits)
 */
export async function sendUsageAlertEmail({ email, name, resourceType, currentUsage, limit, percentUsed }) {
    if (!resend) {
        console.warn('Resend not configured - skipping usage alert');
        return null;
    }

    const firstName = name?.split(' ')[0] || 'there';

    const content = `
        <h2 style="margin:0 0 20px;color:#111827;font-size:20px;">Usage Alert</h2>
        <p style="color:#374151;line-height:1.6;margin:0 0 15px;">
            Hi ${firstName},
        </p>
        <p style="color:#374151;line-height:1.6;margin:0 0 20px;">
            You've used <strong>${percentUsed}%</strong> of your ${resourceType} this month.
        </p>

        <table style="background-color:#fef3c7;border-radius:8px;padding:20px;width:100%;margin:0 0 20px;border-left:4px solid #f59e0b;">
            <tr>
                <td>
                    <p style="margin:0;color:#92400e;font-weight:500;">
                        ${currentUsage} / ${limit} ${resourceType} used
                    </p>
                </td>
            </tr>
        </table>

        <p style="color:#374151;line-height:1.6;margin:0 0 15px;">
            Consider upgrading your plan for higher limits.
        </p>

        ${buttonHtml('Upgrade Plan', `${FRONTEND_URL}/billing`)}
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            replyTo: REPLY_TO,
            to: email,
            subject: `Usage Alert: ${percentUsed}% of ${resourceType} used`,
            html: baseTemplate(content, `You've used ${percentUsed}% of your ${resourceType}`),
        });

        if (error) throw error;
        console.log(`✓ Usage alert sent to ${email}`);
        return data;
    } catch (err) {
        console.error('Failed to send usage alert:', err);
        throw err;
    }
}

/**
 * Password reset email
 */
export async function sendPasswordResetEmail({ email, name, resetUrl }) {
    if (!resend) {
        console.warn('Resend not configured - skipping password reset email');
        return null;
    }

    const firstName = name?.split(' ')[0] || 'there';

    const content = `
        <h2 style="margin:0 0 20px;color:#111827;font-size:20px;">Reset Your Password</h2>
        <p style="color:#374151;line-height:1.6;margin:0 0 15px;">
            Hi ${firstName},
        </p>
        <p style="color:#374151;line-height:1.6;margin:0 0 15px;">
            We received a request to reset your password. Click the button below to create a new password:
        </p>

        ${buttonHtml('Reset Password', resetUrl)}

        <p style="color:#6b7280;font-size:14px;margin:20px 0 0;">
            This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
        </p>
    `;

    try {
        const { data, error } = await resend.emails.send({
            from: FROM_ADDRESS,
            replyTo: REPLY_TO,
            to: email,
            subject: `Reset your ${APP_NAME} password`,
            html: baseTemplate(content, 'Reset your password'),
        });

        if (error) throw error;
        console.log(`✓ Password reset email sent to ${email}`);
        return data;
    } catch (err) {
        console.error('Failed to send password reset email:', err);
        throw err;
    }
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured() {
    return !!resend;
}

export default {
    sendWelcomeEmail,
    sendPaymentConfirmationEmail,
    sendUsageAlertEmail,
    sendPasswordResetEmail,
    isEmailConfigured,
};
```

### Step 3.4: Create Email Routes

Create `routes/email.js`:

```javascript
/**
 * Email Routes
 * API endpoints for sending emails
 */

import { Router } from 'express';
import {
    sendWelcomeEmail,
    sendUsageAlertEmail,
    isEmailConfigured
} from '../services/email.js';

const router = Router();

// Optional: Initialize Supabase for email logging
// import { createClient } from '@supabase/supabase-js';
// const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Check email service status
 */
router.get('/status', (req, res) => {
    res.json({
        configured: isEmailConfigured(),
        fromAddress: process.env.EMAIL_FROM_ADDRESS || 'not set',
    });
});

/**
 * Send welcome email
 * POST /api/email/welcome
 */
router.post('/welcome', async (req, res) => {
    try {
        const { userId, email, name } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Optional: Check for duplicate (deduplication)
        // const { data: existing } = await supabase
        //     .from('email_logs')
        //     .select('id')
        //     .eq('user_id', userId)
        //     .eq('email_type', 'welcome')
        //     .single();
        //
        // if (existing) {
        //     return res.json({ message: 'Welcome email already sent', skipped: true });
        // }

        const result = await sendWelcomeEmail({ email, name });

        // Optional: Log the email
        // await supabase.from('email_logs').insert({
        //     user_id: userId,
        //     email_type: 'welcome',
        //     recipient: email,
        //     resend_id: result?.id,
        //     status: 'sent',
        // });

        res.json({ success: true, id: result?.id });
    } catch (error) {
        console.error('Welcome email error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Send usage alert email
 * POST /api/email/usage-alert
 */
router.post('/usage-alert', async (req, res) => {
    try {
        const { email, name, resourceType, currentUsage, limit, percentUsed } = req.body;

        if (!email || !resourceType) {
            return res.status(400).json({ error: 'Email and resourceType are required' });
        }

        const result = await sendUsageAlertEmail({
            email,
            name,
            resourceType,
            currentUsage,
            limit,
            percentUsed,
        });

        res.json({ success: true, id: result?.id });
    } catch (error) {
        console.error('Usage alert email error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
```

### Step 3.5: Register Routes

In your main `index.js` or `app.js`:

```javascript
import express from 'express';
import emailRoutes from './routes/email.js';

const app = express();

app.use(express.json());

// Register email routes
app.use('/api/email', emailRoutes);

// Health check - include email status
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        email: isEmailConfigured() ? 'configured' : 'not configured',
    });
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
```

---

## Part 4: Database Schema

### For PostgreSQL / Supabase

```sql
-- Email logs table for tracking and deduplication
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email_type VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    resend_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'sent',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by user and email type (for deduplication)
CREATE INDEX IF NOT EXISTS idx_email_logs_user_type ON email_logs(user_id, email_type);

-- Index for finding recent emails
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

-- Enable Row Level Security (Supabase)
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access
CREATE POLICY "Service role full access" ON email_logs
    FOR ALL USING (auth.role() = 'service_role');

-- Policy: Users can view their own email logs
CREATE POLICY "Users can view own email logs" ON email_logs
    FOR SELECT USING (auth.uid() = user_id);
```

### Email Types Reference

| email_type | Description |
|------------|-------------|
| `welcome` | New user signup |
| `payment_confirmation` | Successful payment |
| `usage_alert_80` | 80% usage threshold |
| `usage_alert_100` | 100% usage reached |
| `password_reset` | Password reset request |

---

## Part 5: Frontend Integration

### Trigger Welcome Email on Signup

In your auth context or signup handler:

```javascript
// Example: React with Supabase Auth
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function sendWelcomeEmail(user) {
    if (!user?.email) return;

    try {
        await fetch(`${API_URL}/api/email/welcome`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: user.id,
                email: user.email,
                name: user.user_metadata?.full_name || user.user_metadata?.name,
            }),
        });
    } catch (err) {
        console.warn('Failed to send welcome email:', err.message);
    }
}

// In your auth state change listener
supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
        sendWelcomeEmail(session.user);
    }
});
```

---

## Part 6: Testing

### Test Checklist

- [ ] **Email service status**: `GET /api/email/status` returns `{ configured: true }`
- [ ] **Welcome email**: Sends on new user signup
- [ ] **Payment email**: Sends after successful payment
- [ ] **Usage alerts**: Trigger at 80% threshold
- [ ] **Inbound routing**: Email to support@yourdomain.com arrives at destination
- [ ] **Mobile rendering**: Emails display correctly on mobile
- [ ] **Spam check**: Emails not going to spam folder

### Manual Test Commands

```bash
# Check email service status
curl http://localhost:3000/api/email/status

# Send test welcome email
curl -X POST http://localhost:3000/api/email/welcome \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","name":"Test User"}'
```

### Test Inbound Email

Send an email to support@yourdomain.com and verify it arrives at your forwarding address.

---

## Troubleshooting

### Resend Issues

| Problem | Solution |
|---------|----------|
| Domain not verifying | Check DNS records in Cloudflare, wait 5 min |
| Emails going to spam | Add DKIM/SPF records, warm up domain gradually |
| API key not working | Ensure key has "Full access" permission |
| Rate limiting | Free tier: 100 emails/day, 3,000/month |

### Cloudflare Email Routing Issues

| Problem | Solution |
|---------|----------|
| MX records not found | Enable Email Routing, Cloudflare adds them automatically |
| Destination not verified | Check spam folder for verification email |
| Emails not forwarding | Ensure rule status is "Active" |

### Common Errors

```javascript
// Error: Resend not configured
// Solution: Add RESEND_API_KEY to .env file

// Error: Domain not verified
// Solution: Complete domain verification in Resend dashboard

// Error: Rate limit exceeded
// Solution: Upgrade Resend plan or wait until reset
```

---

## Quick Reference

### Environment Variables

```env
# Required
RESEND_API_KEY=re_xxxxxxxxxx

# Optional (have defaults)
EMAIL_FROM_ADDRESS=YourApp <noreply@yourdomain.com>
EMAIL_REPLY_TO=support@yourdomain.com
FRONTEND_URL=https://yourdomain.com
APP_NAME=YourApp
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/email/status` | Check if email is configured |
| POST | `/api/email/welcome` | Send welcome email |
| POST | `/api/email/usage-alert` | Send usage alert |

### File Structure

```
your-project/
├── services/
│   └── email.js          # Email service + templates
├── routes/
│   └── email.js          # Email API endpoints
├── index.js              # Main app (register routes)
└── .env                  # Environment variables
```

---

## License

MIT - Use this guide freely in your projects.
