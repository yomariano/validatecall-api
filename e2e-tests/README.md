# ValidateCall E2E Test Suite

Comprehensive end-to-end testing for the ValidateCall AI market research platform.

## Overview

This test suite contains **71 test scenarios** across 11 feature areas, organized in XML format for framework-agnostic execution. All tests are designed to validate critical user flows, revenue-protecting features, and integration points.

### Test Coverage

| Feature Area | Test Count | Priority | Tags |
|-------------|------------|----------|------|
| Authentication & Authorization | 8 tests | Critical | `smoke`, `auth`, `security` |
| Lead Management | 12 tests | Critical | `smoke`, `leads`, `core-functionality` |
| Campaign Management | 10 tests | Critical | `smoke`, `campaigns` |
| Voice Agent Configuration | 7 tests | High | `agents`, `voice` |
| Call Execution & Scheduling | 6 tests | Critical | `smoke`, `calls`, `vapi` |
| Billing & Subscriptions | 7 tests | Critical | `smoke`, `billing`, `stripe`, `revenue` |
| Dashboard & Analytics | 3 tests | High | `dashboard`, `analytics` |
| Call History & Analytics | 3 tests | High | `history`, `reporting` |
| Integration Testing | 4 tests | Critical | `smoke`, `integration`, `api` |
| Error Handling & Edge Cases | 4 tests | High | `errors`, `resilience` |
| **Security** | **7 tests** | **Critical** | `smoke`, `security`, `auth` |

### Priority Distribution

- **Critical Tests (Revenue/Data):** 22 tests - Auth, payments, calls, data persistence, security
- **High Tests (Core Features):** 22 tests - Lead gen, campaigns, agents, integrations
- **Medium Tests (UX/Polish):** 27 tests - Filters, UI features, analytics

## Directory Structure

```
e2e-tests/
├── validatecall-e2e-tests.xml          # Root test suite configuration
├── tests/                              # Individual test group files
│   ├── auth-tests.xml                  # 8 authentication tests
│   ├── lead-tests.xml                  # 12 lead management tests
│   ├── campaign-tests.xml              # 10 campaign tests
│   ├── agent-tests.xml                 # 7 voice agent tests
│   ├── call-tests.xml                  # 6 call execution tests
│   ├── billing-tests.xml               # 7 billing tests
│   ├── dashboard-tests.xml             # 3 dashboard tests
│   ├── history-tests.xml               # 3 history tests
│   ├── integration-tests.xml           # 4 integration tests
│   ├── error-tests.xml                 # 4 error handling tests
│   └── security-tests.xml              # 7 security tests (NEW)
├── test-data/                          # Sample data files
│   ├── sample-leads-50.csv             # 50 sample leads (CSV)
│   ├── sample-leads.json               # 20 sample leads (JSON)
│   └── sample-leads-invalid.csv        # Invalid CSV for error testing
└── README.md                           # This file
```

## Test Execution Strategies

### 1. Smoke Tests (22 tests - ~18 minutes)

Run critical happy path tests before deployment:

```bash
# Execute tests tagged with "smoke"
npm run test:e2e -- --grep="@smoke"
```

**Includes:**
- AUTH-001, AUTH-002 (Authentication)
- LEAD-001, LEAD-002, LEAD-012 (Lead generation + limits)
- CAMP-001, CAMP-004, CAMP-010 (Campaign creation + limits)
- AGENT-001, AGENT-006 (Agent creation + testing)
- CALL-001 (Call initiation)
- BILL-001, BILL-002, BILL-003, BILL-004 (Paywalls + payments)
- INTEG-002, INTEG-004 (Vapi + Stripe integrations)
- SEC-001, SEC-002, SEC-005, SEC-006 (Security controls + access validation)

### 2. Regression Tests (71 tests - ~75 minutes)

Full test suite for comprehensive validation:

```bash
# Execute all tests
npm run test:e2e
```

### 3. Critical Path (Revenue-Critical - ~30 minutes)

Revenue and data-integrity tests:

```bash
# Execute tests with priority="critical"
npm run test:e2e -- --grep="@critical"
```

### 4. Integration Tests (~10 minutes)

External API integration validation:

```bash
# Execute integration-tagged tests
npm run test:e2e -- --grep="@integration"
```

## Test Environment Setup

### Prerequisites

1. **Application Running:**
   - Frontend: `http://localhost:5173`
   - Backend: `http://localhost:3002`

2. **API Keys Configured:**
   - Supabase (database + auth)
   - Claude AI (lead generation + classification)
   - Vapi AI (voice calls)
   - Stripe (test mode for billing)

3. **Test Framework Installed:**
   ```bash
   npm install --save-dev @playwright/test
   # OR
   npm install --save-dev cypress
   ```

### Environment Variables

Create `.env.test` file:

```env
# Application URLs
VITE_APP_URL=http://localhost:5173
VITE_API_URL=http://localhost:3002

# API Keys (Test Mode)
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
CLAUDE_API_KEY=your-claude-key
VAPI_API_KEY=your-vapi-key
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...

# Test Data
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=Test123!
```

## Test Data

### Sample Leads (50 records)

Located in `test-data/sample-leads-50.csv`:
- 50 diverse businesses across Ireland (Dublin, Cork, Galway)
- Multiple industries: Healthcare, Food & Beverage, Technology, Professional Services
- Properly formatted with phone numbers (+353-X-XXX-XXXX)
- Pre-classified categories

### JSON Format

Located in `test-data/sample-leads.json`:
- 20 leads in JSON array format
- Same structure as CSV for import testing

### Invalid Data

Located in `test-data/sample-leads-invalid.csv`:
- Missing required columns (tests error handling)
- Used for LEAD-004 (CSV Import - Invalid Format)

## Test Execution Examples

### Using Playwright

```javascript
// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-tests',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
});

// auth.spec.ts
test('AUTH-001: Google OAuth Login Success', async ({ page }) => {
  await page.goto('/');
  await page.click('button:has-text("Sign in with Google")');
  // ... implement test steps from XML
});
```

### Using Cypress

```javascript
// cypress.config.js
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5173',
    specPattern: 'e2e-tests/**/*.cy.js',
  },
});

// auth.cy.js
describe('AUTH-001: Google OAuth Login Success', () => {
  it('should login successfully via Google OAuth', () => {
    cy.visit('/');
    cy.contains('Sign in with Google').click();
    // ... implement test steps from XML
  });
});
```

## XML Test Structure

### Test Case Format

Each test case in the XML files follows this structure:

```xml
<TestCase id="TEST-001" name="Test Name" priority="critical" tags="smoke,auth">
  <Description>What this test validates</Description>

  <Preconditions>
    <Precondition>Required state before test</Precondition>
  </Preconditions>

  <Steps>
    <Step id="1" action="navigate" target="/page">
      <Description>Step description</Description>
      <Expected>Expected outcome</Expected>
    </Step>
  </Steps>

  <ExpectedResults>
    <Result>What should happen</Result>
  </ExpectedResults>

  <Assertions>
    <Assert type="element-exists" selector="#element" />
  </Assertions>
</TestCase>
```

### Action Types

Common actions used in test steps:

- **navigate** - Navigate to URL
- **click** - Click element
- **input** - Enter text
- **select** - Select dropdown option
- **wait** - Wait for condition
- **assert** - Verify expectation
- **api-call** - Make API request
- **upload-file** - Upload file
- **oauth** - Complete OAuth flow

### Assertion Types

Common assertion types:

- `element-exists` - Element is present
- `element-not-exists` - Element is not present
- `element-contains-text` - Element contains text
- `text-match` - Text matches pattern
- `url-match` - URL matches pattern
- `api-response-status` - API status code
- `api-response-field` - API response field value
- `element-count` - Number of elements

## Critical Test IDs

### Must-Pass Before Deployment

| Test ID | Description | Why Critical |
|---------|-------------|--------------|
| AUTH-001 | Google OAuth Login | Users can't access app |
| AUTH-002 | Protected Route Access | Security vulnerability |
| LEAD-001 | Lead Scraping | Core value proposition |
| LEAD-012 | Free Tier Limits | Revenue protection |
| CAMP-004 | Batch Call Execution | Core feature |
| CAMP-010 | Call Limit Enforcement | Revenue protection |
| AGENT-006 | Voice Agent Testing | Vapi integration |
| CALL-001 | Immediate Call Initiation | Core feature |
| BILL-001 | Soft Paywall | Revenue funnel |
| BILL-002 | Hard Paywall | Revenue protection |
| BILL-003 | Stripe Payment Lite | Revenue generation |
| BILL-004 | Stripe Payment Starter | Revenue generation |
| INTEG-002 | Vapi Integration | Call functionality |
| INTEG-004 | Stripe Webhooks | Subscription activation |
| SEC-001 | Stripe Webhook Signature | Prevents forged webhooks |
| SEC-002 | Multi-Tenant Access | Prevents cross-user data access |
| SEC-005 | RLS Policy Enforcement | Database-level isolation |
| SEC-006 | Auth Required Endpoints | API security |

## Test Maintenance

### Adding New Tests

1. **Choose appropriate test group file** (e.g., `lead-tests.xml`)
2. **Follow XML structure** with unique test ID
3. **Add to root test suite** if creating new group
4. **Update test count** in documentation

### Updating Tests

1. **Modify XML test definition** in appropriate file
2. **Update implementation** in test framework
3. **Verify assertions** match expected behavior
4. **Run full regression** to ensure no breakage

### Test Data Management

1. **Use sample CSV/JSON files** for import tests
2. **Create test users** per subscription tier
3. **Configure Stripe test cards** for payment tests
4. **Use mock phone numbers** for call tests

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build
      - run: npm run test:e2e:smoke  # Smoke tests first
      - run: npm run test:e2e         # Full regression if smoke passes
```

### Pre-Commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/bash
npm run test:e2e:smoke || exit 1
```

## Test Results

Test results are output in multiple formats:

- **XML:** `results/test-results.xml`
- **JSON:** `results/test-results.json`
- **HTML:** `results/test-report.html`
- **JUnit:** `results/junit.xml` (for CI tools)

### Screenshots & Videos

- **Screenshots:** `results/screenshots/` (on failure)
- **Videos:** `results/videos/` (on failure)

## Troubleshooting

### Common Issues

**Tests timing out:**
- Increase timeout in XML: `<Timeout>60000</Timeout>`
- Check if application is running
- Verify API keys are configured

**Authentication failures:**
- Ensure Supabase auth configured
- Check OAuth redirect URLs
- Verify test user exists

**Payment test failures:**
- Confirm Stripe test mode enabled
- Use correct test card numbers
- Check webhook configuration

**Call test failures:**
- Verify Vapi API key valid
- Check phone number format
- Ensure call limits not exceeded

## Support

- **Documentation:** See plan file at `C:\Users\35383\.claude\plans\witty-tickling-papert.md`
- **Issues:** Report test failures with screenshots and logs
- **Updates:** Keep test data and assertions in sync with application changes

## Summary

This comprehensive E2E test suite ensures:

✅ **Critical paths work** (auth, payments, calls)
✅ **Revenue is protected** (free tier limits, paywalls)
✅ **Integrations function** (Claude, Vapi, Stripe, Supabase)
✅ **Data integrity maintained** (leads, campaigns, calls)
✅ **Error handling graceful** (network issues, validation, rate limits)
✅ **Security controls enforced** (webhook signatures, multi-tenant isolation, RLS policies)

**Execute smoke tests before every deployment to ensure core functionality remains intact.**
