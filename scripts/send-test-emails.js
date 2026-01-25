/**
 * Send all marketing email templates to a test address
 * Run: node scripts/send-test-emails.js yomariano05@gmail.com
 */

import 'dotenv/config';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'ValidateCall <noreply@validatecall.com>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://validatecall.com';

// Sample data for template variables
const sampleData = {
    firstName: 'Mariano',
    used: 8,
    limit: 10,
    resourceType: 'leads',
    percentUsed: 80,
    upgradeUrl: `${FRONTEND_URL}/billing`,
};

// Email wrapper template
const wrapEmail = (content, previewText = '') => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${previewText ? `<meta name="description" content="${previewText}">` : ''}
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #7c3aed; margin: 0; font-size: 28px;">ValidateCall</h1>
            <p style="color: #666; margin-top: 5px;">AI-Powered Market Research</p>
        </div>
        ${content}
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #666; font-size: 14px; margin-bottom: 0;">
            Questions? Reply to this email or contact us at <a href="mailto:support@validatecall.com" style="color: #7c3aed;">support@validatecall.com</a>
        </p>
    </div>
    <p style="text-align: center; color: #999; font-size: 12px; margin-top: 20px;">
        &copy; ${new Date().getFullYear()} ValidateCall. All rights reserved.<br>
        <a href="${FRONTEND_URL}/unsubscribe" style="color: #999;">Unsubscribe</a>
    </p>
</body>
</html>`;

// Replace template variables
const replaceVars = (template) => {
    return template
        .replace(/\{\{firstName\}\}/g, sampleData.firstName)
        .replace(/\{\{used\}\}/g, sampleData.used)
        .replace(/\{\{limit\}\}/g, sampleData.limit)
        .replace(/\{\{resourceType\}\}/g, sampleData.resourceType)
        .replace(/\{\{percentUsed\}\}/g, sampleData.percentUsed)
        .replace(/\{\{upgradeUrl\}\}/g, sampleData.upgradeUrl);
};

// All email templates
const emailTemplates = [
    // USAGE-BASED
    {
        name: 'Usage 50%',
        subject: `You're making great progress, ${sampleData.firstName}!`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">Halfway there!</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>You've already used <strong>${sampleData.used} of ${sampleData.limit} ${sampleData.resourceType}</strong> - that's awesome progress!</p>
        <p>At this pace, you might hit your limit soon. Here's what Pro users get:</p>
        <ul>
            <li><strong>Unlimited leads</strong> - never stop prospecting</li>
            <li><strong>Unlimited calls</strong> - validate faster</li>
            <li><strong>Priority support</strong> - we're here for you</li>
        </ul>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${sampleData.upgradeUrl}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">See Pro Plans</a>
        </p>
        <p style="color: #666; font-size: 14px;">Keep validating - you're doing great!</p>`
    },
    {
        name: 'Usage 80%',
        subject: `⚠️ ${sampleData.firstName}, you're running low on ${sampleData.resourceType}`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">You're at 80% capacity</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>You've used <strong>${sampleData.used} of ${sampleData.limit} ${sampleData.resourceType}</strong>.</p>
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e;">
                <strong>Don't let your momentum stop.</strong><br>
                You're validating faster than most users - that's a sign you're onto something!
            </p>
        </div>
        <p>Upgrade now and get <strong>15% off</strong> your first month:</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${sampleData.upgradeUrl}?code=MOMENTUM15" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Claim 15% Off</a>
        </p>
        <p style="color: #666; font-size: 14px;">Code: <strong>MOMENTUM15</strong> (expires in 48 hours)</p>`
    },
    {
        name: 'Usage 90%',
        subject: `🚨 Almost out of ${sampleData.resourceType}, ${sampleData.firstName} - special offer inside`,
        html: `<h2 style="color: #dc2626; margin-top: 0;">You're almost at your limit!</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>You've used <strong>90% of your ${sampleData.resourceType}</strong>.</p>
        <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
            <p style="margin: 0; color: #991b1b;">
                <strong>Your validated leads are waiting.</strong><br>
                Don't lose the insights you've gathered. One more call could be the breakthrough.
            </p>
        </div>
        <p>Because you're so close to your next validation, here's our <strong>best offer</strong>:</p>
        <p style="text-align: center; font-size: 24px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
            20% OFF with code KEEPGOING20
        </p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${sampleData.upgradeUrl}?code=KEEPGOING20" style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade Now - 20% Off</a>
        </p>
        <p style="color: #666; font-size: 14px; text-align: center;">⏰ Offer expires in 24 hours</p>`
    },
    {
        name: 'Usage 100%',
        subject: `${sampleData.firstName}, you've maxed out - let's fix that`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">You've hit your limit!</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>You've used all <strong>${sampleData.limit} ${sampleData.resourceType}</strong> on your free plan.</p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>What happens now?</strong></p>
            <ul style="margin: 0; padding-left: 20px;">
                <li>You can't generate more leads or make calls</li>
                <li>Your existing data is safe</li>
                <li>Upgrade takes 30 seconds</li>
            </ul>
        </div>
        <p>We know you're validating something important. Here's <strong>25% off</strong> to keep going:</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${sampleData.upgradeUrl}?code=NOLIMITS25" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Unlock Unlimited - 25% Off</a>
        </p>
        <p style="color: #666; font-size: 14px; text-align: center;">Code: <strong>NOLIMITS25</strong> | Valid for 48 hours</p>`
    },

    // INACTIVITY
    {
        name: 'Inactive 3 Days',
        subject: `Your leads miss you, ${sampleData.firstName}`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">Quick check-in</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>We noticed you haven't logged in for a few days. Everything okay?</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
            <p style="margin: 0; color: #166534;">
                <strong>Did you know?</strong><br>
                Leads contacted within 48 hours have a 3x higher conversion rate. Don't let them go cold!
            </p>
        </div>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Back to Dashboard</a>
        </p>
        <p style="color: #666; font-size: 14px;">Your business idea deserves validation. We're here to help.</p>`
    },
    {
        name: 'Inactive 7 Days',
        subject: `We miss you, ${sampleData.firstName} - here's 20% off to come back`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">It's been a week...</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>A week without validation is a week of uncertainty. Your business idea deserves answers.</p>
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e;">
                <strong>While you were away:</strong><br>
                Other entrepreneurs validated 1,247 business ideas on ValidateCall. Don't fall behind.
            </p>
        </div>
        <p>To welcome you back, here's <strong>20% off</strong> any plan:</p>
        <p style="text-align: center; font-size: 24px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
            COMEBACK20
        </p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${sampleData.upgradeUrl}?code=COMEBACK20" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Come Back & Save 20%</a>
        </p>
        <p style="color: #666; font-size: 14px; text-align: center;">Offer expires in 72 hours</p>`
    },
    {
        name: 'Inactive 14 Days',
        subject: `${sampleData.firstName}, we're about to pause your account - 30% off inside`,
        html: `<h2 style="color: #dc2626; margin-top: 0;">Last chance, ${sampleData.firstName}</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>It's been 2 weeks since your last login. We're about to pause your account.</p>
        <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
            <p style="margin: 0; color: #991b1b;">
                <strong>What you'll lose:</strong>
                <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                    <li>Access to your saved leads</li>
                    <li>Call recordings and transcripts</li>
                    <li>Validation insights</li>
                </ul>
            </p>
        </div>
        <p>We don't want to see you go. Here's our <strong>best offer ever</strong>:</p>
        <p style="text-align: center; font-size: 28px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
            30% OFF with LASTCHANCE30
        </p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${sampleData.upgradeUrl}?code=LASTCHANCE30" style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Save My Account - 30% Off</a>
        </p>
        <p style="color: #666; font-size: 14px; text-align: center;">⏰ This offer expires in 48 hours</p>`
    },

    // ABANDONED UPGRADE
    {
        name: 'Abandoned Upgrade 1hr',
        subject: `Still thinking about it, ${sampleData.firstName}?`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">Need help deciding?</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>We noticed you were checking out our plans earlier. Have questions?</p>
        <p><strong>Here's what most users ask:</strong></p>
        <ul>
            <li><strong>Can I cancel anytime?</strong> Yes, no contracts.</li>
            <li><strong>Is there a setup fee?</strong> Nope, just the plan price.</li>
            <li><strong>What if I need help?</strong> Our support team responds in under 2 hours.</li>
        </ul>
        <p>Still not sure? Reply to this email and I'll personally help you decide.</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${sampleData.upgradeUrl}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Plans Again</a>
        </p>`
    },
    {
        name: 'Abandoned Upgrade 24hr',
        subject: `${sampleData.firstName}, here's 15% off to help you decide`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">We want to help you succeed</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>You were looking at our plans yesterday. We know choosing the right tool is a big decision.</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
            <p style="margin: 0; color: #166534;">
                <strong>Here's a little push:</strong><br>
                Use code <strong>READY15</strong> for 15% off your first month. No risk - cancel anytime.
            </p>
        </div>
        <p><strong>Why customers choose ValidateCall:</strong></p>
        <ul>
            <li>✓ Save 40+ hours on manual market research</li>
            <li>✓ Get real customer feedback, not assumptions</li>
            <li>✓ Validate ideas before spending thousands</li>
        </ul>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${sampleData.upgradeUrl}?code=READY15" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Get 15% Off Now</a>
        </p>
        <p style="color: #666; font-size: 14px; text-align: center;">Code expires in 24 hours</p>`
    },

    // WELCOME SEQUENCE
    {
        name: 'Welcome Day 2',
        subject: `3 tips to validate your idea faster, ${sampleData.firstName}`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">Get the most out of ValidateCall</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>Welcome to day 2! Here are 3 tips successful users swear by:</p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 15px 0;"><strong>1. Be specific with your search</strong></p>
            <p style="margin: 0 0 20px 0; color: #666;">Instead of "restaurants", try "Italian restaurants in Brooklyn with 4+ stars". Better leads = better calls.</p>
            <p style="margin: 0 0 15px 0;"><strong>2. Call during business hours</strong></p>
            <p style="margin: 0 0 20px 0; color: #666;">9 AM - 11 AM local time has the highest answer rate. Schedule your calls smartly.</p>
            <p style="margin: 0 0 15px 0;"><strong>3. Review every transcript</strong></p>
            <p style="margin: 0; color: #666;">The AI summary is great, but reading the full transcript reveals hidden gems.</p>
        </div>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/leads" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Find Your First Leads</a>
        </p>`
    },
    {
        name: 'Welcome Day 5',
        subject: `How's it going, ${sampleData.firstName}?`,
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">Quick check-in</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>You've been with us for 5 days now. How's the validation going?</p>
        <p><strong>Quick self-assessment:</strong></p>
        <ul>
            <li>✓ Found promising leads?</li>
            <li>✓ Made your first calls?</li>
            <li>✓ Got actionable feedback?</li>
        </ul>
        <p>If you checked all three, amazing! You're on track.</p>
        <p>If not, reply to this email and tell me where you're stuck. I read every response.</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
            <p style="margin: 0; color: #166534;">
                <strong>Pro tip:</strong> Users who make at least 5 calls in their first week are 4x more likely to find product-market fit.
            </p>
        </div>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Continue Validating</a>
        </p>`
    },

    // SOCIAL PROOF
    {
        name: 'Social Proof Weekly',
        subject: 'This week on ValidateCall: 847 ideas validated',
        html: `<h2 style="color: #1a1a2e; margin-top: 0;">What happened this week</h2>
        <p>Hi ${sampleData.firstName},</p>
        <p>Here's what the ValidateCall community accomplished this week:</p>
        <table style="width: 100%; margin: 25px 0; border-spacing: 10px;">
            <tr>
                <td style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; width: 33%;">
                    <p style="font-size: 32px; font-weight: bold; color: #7c3aed; margin: 0;">847</p>
                    <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Ideas Validated</p>
                </td>
                <td style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; width: 33%;">
                    <p style="font-size: 32px; font-weight: bold; color: #22c55e; margin: 0;">2,341</p>
                    <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Calls Made</p>
                </td>
                <td style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; width: 33%;">
                    <p style="font-size: 32px; font-weight: bold; color: #f59e0b; margin: 0;">156</p>
                    <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Products Launched</p>
                </td>
            </tr>
        </table>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
            <p style="margin: 0; color: #166534;">
                <strong>"ValidateCall saved me from building the wrong product."</strong><br>
                <span style="font-size: 14px;">- Sarah K., Founder @ TechStartup</span>
            </p>
        </div>
        <p>Your turn. What will you validate this week?</p>
        <p style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Start Validating</a>
        </p>`
    },
];

async function sendTestEmails(testEmail) {
    console.log(`\n📧 Sending ${emailTemplates.length} test emails to ${testEmail}\n`);
    console.log('=' .repeat(60));

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < emailTemplates.length; i++) {
        const template = emailTemplates[i];
        const subjectWithPrefix = `[TEST ${i + 1}/${emailTemplates.length}] ${template.subject}`;

        try {
            const { data, error } = await resend.emails.send({
                from: FROM_ADDRESS,
                to: testEmail,
                subject: subjectWithPrefix,
                html: wrapEmail(template.html),
            });

            if (error) {
                console.log(`❌ ${template.name}: ${error.message}`);
                failed++;
            } else {
                console.log(`✅ ${template.name} - sent (${data.id})`);
                sent++;
            }

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            console.log(`❌ ${template.name}: ${err.message}`);
            failed++;
        }
    }

    console.log('=' .repeat(60));
    console.log(`\n📊 Summary: ${sent} sent, ${failed} failed\n`);
}

// Run
const testEmail = process.argv[2];
if (!testEmail) {
    console.error('Usage: node scripts/send-test-emails.js <email>');
    process.exit(1);
}

if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY environment variable not set');
    process.exit(1);
}

sendTestEmails(testEmail);
