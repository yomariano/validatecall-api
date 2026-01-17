-- =============================================
-- DEFAULT MARKETING EMAILS
-- All essential email triggers and templates
-- =============================================

-- Clear existing default triggers to avoid duplicates
DELETE FROM automated_triggers WHERE name IN (
    'Usage 50% Warning',
    'Usage 80% Alert',
    'Usage 90% Urgent',
    'Usage 100% Maxed Out',
    'Inactive 3 Days',
    'Inactive 7 Days',
    'Inactive 14 Days',
    'Abandoned Upgrade - 1 Hour',
    'Abandoned Upgrade - 24 Hours',
    'Welcome Sequence - Day 2',
    'Welcome Sequence - Day 5',
    'Social Proof Weekly',
    'Feature Announcement'
);

-- =============================================
-- USAGE-BASED TRIGGERS (Loss Aversion + Urgency)
-- =============================================

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES

-- 50% Usage - Gentle nudge
(
    'Usage 50% Warning',
    'Gentle nudge at 50% usage - plant the seed for upgrade',
    'usage_50',
    'You''re making great progress, {{firstName}}!',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Halfway there!</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve already used <strong>{{used}} of {{limit}} {{resourceType}}</strong> - that''s awesome progress!</p>
    <p>At this pace, you might hit your limit soon. Here''s what Pro users get:</p>
    <ul>
        <li><strong>Unlimited leads</strong> - never stop prospecting</li>
        <li><strong>Unlimited calls</strong> - validate faster</li>
        <li><strong>Priority support</strong> - we''re here for you</li>
    </ul>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">See Pro Plans</a>
    </p>
    <p style="color: #666; font-size: 14px;">Keep validating - you''re doing great!</p>',
    'Hi {{firstName}}, You''ve used {{used}} of {{limit}} {{resourceType}} - great progress! Upgrade to Pro for unlimited access: {{upgradeUrl}}',
    false, 0, NULL, NULL, NULL
),

-- 80% Usage - Create urgency
(
    'Usage 80% Alert',
    'Urgency trigger at 80% - emphasize scarcity',
    'usage_80',
    '⚠️ {{firstName}}, you''re running low on {{resourceType}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">You''re at 80% capacity</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve used <strong>{{used}} of {{limit}} {{resourceType}}</strong>.</p>

    <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
        <p style="margin: 0; color: #92400e;">
            <strong>Don''t let your momentum stop.</strong><br>
            You''re validating faster than most users - that''s a sign you''re onto something!
        </p>
    </div>

    <p>Upgrade now and get <strong>15% off</strong> your first month:</p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=MOMENTUM15" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Claim 15% Off</a>
    </p>
    <p style="color: #666; font-size: 14px;">Code: <strong>MOMENTUM15</strong> (expires in 48 hours)</p>',
    'Hi {{firstName}}, You''ve used 80% of your {{resourceType}}. Don''t stop now! Use code MOMENTUM15 for 15% off: {{upgradeUrl}}',
    false, 0, 'MOMENTUM15', 15, 48
),

-- 90% Usage - High urgency with bigger discount
(
    'Usage 90% Urgent',
    'High urgency at 90% - fear of losing progress',
    'usage_90',
    '🚨 Almost out of {{resourceType}}, {{firstName}} - special offer inside',
    '<h2 style="color: #dc2626; margin-top: 0;">You''re almost at your limit!</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve used <strong>{{percentUsed}}% of your {{resourceType}}</strong>.</p>

    <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
        <p style="margin: 0; color: #991b1b;">
            <strong>Your validated leads are waiting.</strong><br>
            Don''t lose the insights you''ve gathered. One more call could be the breakthrough.
        </p>
    </div>

    <p>Because you''re so close to your next validation, here''s our <strong>best offer</strong>:</p>
    <p style="text-align: center; font-size: 24px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
        20% OFF with code KEEPGOING20
    </p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=KEEPGOING20" style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade Now - 20% Off</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">⏰ Offer expires in 24 hours</p>',
    'Hi {{firstName}}, You''ve used {{percentUsed}}% of your {{resourceType}}! Use code KEEPGOING20 for 20% off - expires in 24 hours: {{upgradeUrl}}',
    false, 0, 'KEEPGOING20', 20, 24
),

-- 100% Usage - Maxed out
(
    'Usage 100% Maxed Out',
    'User hit their limit - remove friction to upgrade',
    'usage_100',
    '{{firstName}}, you''ve maxed out - let''s fix that',
    '<h2 style="color: #1a1a2e; margin-top: 0;">You''ve hit your limit!</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve used all <strong>{{limit}} {{resourceType}}</strong> on your free plan.</p>

    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0;"><strong>What happens now?</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
            <li>You can''t generate more leads or make calls</li>
            <li>Your existing data is safe</li>
            <li>Upgrade takes 30 seconds</li>
        </ul>
    </div>

    <p>We know you''re validating something important. Here''s <strong>25% off</strong> to keep going:</p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=NOLIMITS25" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Unlock Unlimited - 25% Off</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">Code: <strong>NOLIMITS25</strong> | Valid for 48 hours</p>',
    'Hi {{firstName}}, You''ve maxed out your free plan. Use code NOLIMITS25 for 25% off and keep validating: {{upgradeUrl}}',
    false, 0, 'NOLIMITS25', 25, 48
);

-- =============================================
-- INACTIVITY TRIGGERS (Win-back + Loss Aversion)
-- =============================================

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES

-- 3 Days Inactive - Gentle reminder
(
    'Inactive 3 Days',
    'Gentle nudge after 3 days - remind value',
    'inactive_3d',
    'Your leads miss you, {{firstName}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Quick check-in</h2>
    <p>Hi {{firstName}},</p>
    <p>We noticed you haven''t logged in for a few days. Everything okay?</p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>Did you know?</strong><br>
            Leads contacted within 48 hours have a 3x higher conversion rate. Don''t let them go cold!
        </p>
    </div>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Back to Dashboard</a>
    </p>
    <p style="color: #666; font-size: 14px;">Your business idea deserves validation. We''re here to help.</p>',
    'Hi {{firstName}}, Your leads are waiting! Leads contacted within 48 hours convert 3x better. Come back: https://validatecall.com/dashboard',
    false, 0, NULL, NULL, NULL
),

-- 7 Days Inactive - Offer incentive
(
    'Inactive 7 Days',
    'Win-back with discount after 7 days',
    'inactive_7d',
    'We miss you, {{firstName}} - here''s 20% off to come back',
    '<h2 style="color: #1a1a2e; margin-top: 0;">It''s been a week...</h2>
    <p>Hi {{firstName}},</p>
    <p>A week without validation is a week of uncertainty. Your business idea deserves answers.</p>

    <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
        <p style="margin: 0; color: #92400e;">
            <strong>While you were away:</strong><br>
            Other entrepreneurs validated 1,247 business ideas on ValidateCall. Don''t fall behind.
        </p>
    </div>

    <p>To welcome you back, here''s <strong>20% off</strong> any plan:</p>
    <p style="text-align: center; font-size: 24px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
        COMEBACK20
    </p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=COMEBACK20" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Come Back & Save 20%</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">Offer expires in 72 hours</p>',
    'Hi {{firstName}}, It''s been a week! Use code COMEBACK20 for 20% off any plan. Your idea deserves validation: {{upgradeUrl}}',
    false, 0, 'COMEBACK20', 20, 72
),

-- 14 Days Inactive - Last chance, bigger discount
(
    'Inactive 14 Days',
    'Last chance win-back with best offer',
    'inactive_14d',
    '{{firstName}}, we''re about to pause your account - 30% off inside',
    '<h2 style="color: #dc2626; margin-top: 0;">Last chance, {{firstName}}</h2>
    <p>Hi {{firstName}},</p>
    <p>It''s been 2 weeks since your last login. We''re about to pause your account.</p>

    <div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
        <p style="margin: 0; color: #991b1b;">
            <strong>What you''ll lose:</strong>
            <ul style="margin: 10px 0 0 0; padding-left: 20px;">
                <li>Access to your saved leads</li>
                <li>Call recordings and transcripts</li>
                <li>Validation insights</li>
            </ul>
        </p>
    </div>

    <p>We don''t want to see you go. Here''s our <strong>best offer ever</strong>:</p>
    <p style="text-align: center; font-size: 28px; font-weight: bold; color: #7c3aed; margin: 20px 0;">
        30% OFF with LASTCHANCE30
    </p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code=LASTCHANCE30" style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Save My Account - 30% Off</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">⏰ This offer expires in 48 hours</p>',
    'Hi {{firstName}}, Your account will be paused soon. Use code LASTCHANCE30 for 30% off - our best offer: {{upgradeUrl}}',
    false, 0, 'LASTCHANCE30', 30, 48
);

-- =============================================
-- ABANDONED UPGRADE TRIGGERS (Cart Abandonment)
-- =============================================

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES

-- Abandoned Upgrade - 1 Hour Follow-up
(
    'Abandoned Upgrade - 1 Hour',
    'Quick follow-up 1 hour after viewing pricing',
    'abandoned_upgrade_1h',
    'Still thinking about it, {{firstName}}?',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Need help deciding?</h2>
    <p>Hi {{firstName}},</p>
    <p>We noticed you were checking out our plans earlier. Have questions?</p>

    <p><strong>Here''s what most users ask:</strong></p>
    <ul>
        <li><strong>Can I cancel anytime?</strong> Yes, no contracts.</li>
        <li><strong>Is there a setup fee?</strong> Nope, just the plan price.</li>
        <li><strong>What if I need help?</strong> Our support team responds in under 2 hours.</li>
    </ul>

    <p>Still not sure? Reply to this email and I''ll personally help you decide.</p>

    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Plans Again</a>
    </p>',
    'Hi {{firstName}}, Still thinking about upgrading? Reply to this email if you have questions - happy to help!',
    false, 60, NULL, NULL, NULL
),

-- Abandoned Upgrade - 24 Hour with Discount
(
    'Abandoned Upgrade - 24 Hours',
    'Discount offer 24 hours after viewing pricing',
    'abandoned_upgrade_24h',
    '{{firstName}}, here''s 15% off to help you decide',
    '<h2 style="color: #1a1a2e; margin-top: 0;">We want to help you succeed</h2>
    <p>Hi {{firstName}},</p>
    <p>You were looking at our plans yesterday. We know choosing the right tool is a big decision.</p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>Here''s a little push:</strong><br>
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
        <a href="{{upgradeUrl}}?code=READY15" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Get 15% Off Now</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">Code expires in 24 hours</p>',
    'Hi {{firstName}}, Use code READY15 for 15% off your first month. Validate your idea before spending thousands: {{upgradeUrl}}',
    false, 1440, 'READY15', 15, 24
);

-- =============================================
-- WELCOME SEQUENCE (Onboarding + Engagement)
-- =============================================

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES

-- Welcome Day 2 - Tips
(
    'Welcome Sequence - Day 2',
    'Day 2: Tips for getting the most out of ValidateCall',
    'welcome_day_2',
    '3 tips to validate your idea faster, {{firstName}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Get the most out of ValidateCall</h2>
    <p>Hi {{firstName}},</p>
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
        <a href="https://validatecall.com/leads" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Find Your First Leads</a>
    </p>',
    'Hi {{firstName}}, Day 2 tips: 1) Be specific with searches, 2) Call during business hours (9-11 AM), 3) Read full transcripts. Start now: https://validatecall.com/leads',
    false, 2880, NULL, NULL, NULL
),

-- Welcome Day 5 - Check-in
(
    'Welcome Sequence - Day 5',
    'Day 5: Check-in and offer help',
    'welcome_day_5',
    'How''s it going, {{firstName}}?',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Quick check-in</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve been with us for 5 days now. How''s the validation going?</p>

    <p><strong>Quick self-assessment:</strong></p>
    <ul>
        <li>✓ Found promising leads?</li>
        <li>✓ Made your first calls?</li>
        <li>✓ Got actionable feedback?</li>
    </ul>

    <p>If you checked all three, amazing! You''re on track.</p>
    <p>If not, reply to this email and tell me where you''re stuck. I read every response.</p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>Pro tip:</strong> Users who make at least 5 calls in their first week are 4x more likely to find product-market fit.
        </p>
    </div>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Continue Validating</a>
    </p>',
    'Hi {{firstName}}, Day 5 check-in: Made calls? Got feedback? Reply if you need help - I read every email. Keep validating: https://validatecall.com/dashboard',
    false, 7200, NULL, NULL, NULL
);

-- =============================================
-- SOCIAL PROOF EMAIL (FOMO + Authority)
-- =============================================

INSERT INTO automated_triggers (
    name, description, trigger_type, subject, body_html, body_text,
    is_active, delay_minutes, discount_code, discount_percent, discount_expires_hours
) VALUES
(
    'Social Proof Weekly',
    'Weekly social proof email with stats and success stories',
    'social_proof_weekly',
    'This week on ValidateCall: 847 ideas validated',
    '<h2 style="color: #1a1a2e; margin-top: 0;">What happened this week</h2>
    <p>Hi {{firstName}},</p>
    <p>Here''s what the ValidateCall community accomplished this week:</p>

    <div style="display: flex; gap: 15px; margin: 25px 0;">
        <div style="flex: 1; background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="font-size: 32px; font-weight: bold; color: #7c3aed; margin: 0;">847</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Ideas Validated</p>
        </div>
        <div style="flex: 1; background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="font-size: 32px; font-weight: bold; color: #22c55e; margin: 0;">2,341</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Calls Made</p>
        </div>
        <div style="flex: 1; background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center;">
            <p style="font-size: 32px; font-weight: bold; color: #f59e0b; margin: 0;">156</p>
            <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Products Launched</p>
        </div>
    </div>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>"ValidateCall saved me from building the wrong product."</strong><br>
            <span style="font-size: 14px;">- Sarah K., Founder @ TechStartup</span>
        </p>
    </div>

    <p>Your turn. What will you validate this week?</p>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Start Validating</a>
    </p>',
    'This week: 847 ideas validated, 2,341 calls made. What will you validate? https://validatecall.com/dashboard',
    false, 0, NULL, NULL, NULL
);

-- =============================================
-- EMAIL TEMPLATES (Reusable)
-- =============================================

-- Clear existing templates
DELETE FROM email_templates WHERE name IN (
    'Discount Offer',
    'Feature Announcement',
    'Survey Request',
    'Milestone Celebration',
    'Referral Request'
);

INSERT INTO email_templates (
    name, description, subject, body_html, body_text, template_type, variables
) VALUES

-- Discount Offer Template
(
    'Discount Offer',
    'Generic discount offer template',
    '{{discountPercent}}% off ValidateCall - Limited Time',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Special Offer for You</h2>
    <p>Hi {{firstName}},</p>
    <p>{{customMessage}}</p>
    <p style="text-align: center; font-size: 32px; font-weight: bold; color: #7c3aed; margin: 30px 0;">
        {{discountPercent}}% OFF
    </p>
    <p style="text-align: center;">Use code: <strong>{{discountCode}}</strong></p>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{{upgradeUrl}}?code={{discountCode}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Claim Your Discount</a>
    </p>
    <p style="color: #666; font-size: 14px; text-align: center;">Expires: {{expiresIn}}</p>',
    'Hi {{firstName}}, {{customMessage}} Use code {{discountCode}} for {{discountPercent}}% off: {{upgradeUrl}}',
    'marketing',
    ARRAY['firstName', 'discountPercent', 'discountCode', 'customMessage', 'expiresIn', 'upgradeUrl']
),

-- Feature Announcement Template
(
    'Feature Announcement',
    'Announce new features',
    'New in ValidateCall: {{featureName}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Introducing {{featureName}}</h2>
    <p>Hi {{firstName}},</p>
    <p>We''ve been working hard and we''re excited to announce: <strong>{{featureName}}</strong></p>

    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0;">{{featureDescription}}</p>
    </div>

    <p><strong>How to use it:</strong></p>
    <p>{{howToUse}}</p>

    <p style="text-align: center; margin: 30px 0;">
        <a href="{{ctaUrl}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Try It Now</a>
    </p>',
    'Hi {{firstName}}, Introducing {{featureName}}: {{featureDescription}}. Try it now: {{ctaUrl}}',
    'marketing',
    ARRAY['firstName', 'featureName', 'featureDescription', 'howToUse', 'ctaUrl']
),

-- Milestone Celebration
(
    'Milestone Celebration',
    'Celebrate user achievements',
    'Congrats {{firstName}}! You hit {{milestone}}',
    '<h2 style="color: #1a1a2e; margin-top: 0;">You did it!</h2>
    <p>Hi {{firstName}},</p>

    <div style="text-align: center; margin: 30px 0;">
        <div style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 30px 50px; border-radius: 12px;">
            <p style="font-size: 48px; margin: 0;">🎉</p>
            <p style="font-size: 24px; font-weight: bold; margin: 10px 0 0 0;">{{milestone}}</p>
        </div>
    </div>

    <p>{{celebrationMessage}}</p>

    <p style="text-align: center; margin: 30px 0;">
        <a href="https://validatecall.com/dashboard" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Keep Going</a>
    </p>',
    'Hi {{firstName}}, Congrats on hitting {{milestone}}! {{celebrationMessage}}',
    'marketing',
    ARRAY['firstName', 'milestone', 'celebrationMessage']
),

-- Referral Request
(
    'Referral Request',
    'Ask for referrals',
    '{{firstName}}, know someone who needs ValidateCall?',
    '<h2 style="color: #1a1a2e; margin-top: 0;">Spread the word</h2>
    <p>Hi {{firstName}},</p>
    <p>You''ve been using ValidateCall for a while now. If it''s been helpful, would you mind sharing it with a friend?</p>

    <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <p style="margin: 0; color: #166534;">
            <strong>You both win:</strong><br>
            They get 20% off their first month, and you get a $20 credit.
        </p>
    </div>

    <p style="text-align: center; margin: 30px 0;">
        <a href="{{referralUrl}}" style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600;">Get Your Referral Link</a>
    </p>
    <p style="color: #666; font-size: 14px;">Thanks for being part of the ValidateCall community!</p>',
    'Hi {{firstName}}, Share ValidateCall with a friend - they get 20% off, you get $20 credit: {{referralUrl}}',
    'marketing',
    ARRAY['firstName', 'referralUrl']
);

-- =============================================
-- SUMMARY OF ALL TRIGGERS
-- =============================================
--
-- USAGE-BASED (4 triggers):
--   - usage_50: Gentle nudge at 50%
--   - usage_80: Urgency + 15% discount
--   - usage_90: High urgency + 20% discount
--   - usage_100: Maxed out + 25% discount
--
-- INACTIVITY (3 triggers):
--   - inactive_3d: Gentle reminder
--   - inactive_7d: Win-back + 20% discount
--   - inactive_14d: Last chance + 30% discount
--
-- ABANDONED UPGRADE (2 triggers):
--   - abandoned_upgrade_1h: Quick follow-up
--   - abandoned_upgrade_24h: 15% discount
--
-- WELCOME SEQUENCE (2 triggers):
--   - welcome_day_2: Tips for success
--   - welcome_day_5: Check-in
--
-- SOCIAL PROOF (1 trigger):
--   - social_proof_weekly: Stats + testimonial
--
-- TEMPLATES (4 templates):
--   - Discount Offer
--   - Feature Announcement
--   - Milestone Celebration
--   - Referral Request
