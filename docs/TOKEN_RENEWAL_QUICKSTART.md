# Token Renewal Testing - Quick Start Guide

## TL;DR

Token renewal tests now exist to verify automatic JWT token renewal. They maintain long-lived client instances to trigger renewal after 72+ seconds (15% of token lifetime).

## Quick Commands

```bash
# Run all tests including token renewal
npm test

# Run only token renewal tests
node src/test-runner.js tokenRenewal

# Run example demonstration
node examples/token-renewal-example.js

# Exclude token renewal from CI/CD (too slow)
# Edit config/default.json and add to EXCLUDED_TESTS:
"EXCLUDED_TESTS": ["tokenRenewal"]
```

## Why This Was Needed

**Problem:** Tests were creating new `RoditClient` instances for each test (for isolation), but tokens need to be held for 72+ seconds to trigger renewal. Tests completed in < 10 seconds, so renewal never happened.

**Solution:** Created dedicated token renewal tests that:
- Reuse a single client instance throughout the test
- Make periodic requests over 72+ seconds
- Monitor for token JTI changes (indicating renewal)

## Test Files Created

1. **`src/test-modules/token-renewal.js`** - Main test module
   - `testAutomaticTokenRenewal()` - Tests automatic renewal (72+ seconds)
   - `testManualTokenRefresh()` - Tests explicit refresh (2-5 seconds)

2. **`docs/TOKEN_RENEWAL_TESTS.md`** - Complete documentation

3. **`examples/token-renewal-example.js`** - Runnable examples

4. **`src/test-system.js`** - Updated with token renewal integration

5. **`config/default.json`** - Added `"tokenRenewal"` to enabled test suites

## How It Works

### Automatic Token Renewal Test

```javascript
// 1. Create long-lived client
const client = await RoditClient.createTestInstance({ testMode: true });

// 2. Authenticate
await client.login_server();
const initialToken = client.getSessionToken();
const initialJti = decodeJwt(initialToken).jti;

// 3. Calculate renewal threshold (15% of token lifetime)
const tokenDuration = 480; // seconds
const renewalThreshold = tokenDuration * 0.15; // 72 seconds

// 4. Make periodic requests and wait for renewal
for (let i = 0; i < numRequests; i++) {
  const currentToken = client.getSessionToken();
  const currentJti = decodeJwt(currentToken).jti;
  
  if (currentJti !== initialJti) {
    console.log('Token renewed!');
    break;
  }
  
  await sleep(10000); // Wait 10 seconds between requests
}
```

### Manual Token Refresh Test

```javascript
// 1. Create client and authenticate
const client = await RoditClient.createTestInstance({ testMode: true });
await client.login_server();
const initialJti = decodeJwt(client.getSessionToken()).jti;

// 2. Call refreshToken() explicitly
await client.refreshToken();

// 3. Verify token changed
const newJti = decodeJwt(client.getSessionToken()).jti;
assert(newJti !== initialJti, 'Token should have new JTI');
```

## Configuration

### Token Renewal Threshold

Configured in RODiT credentials store:

```javascript
{
  "tokenrenewaloptions": {
    "LAPSED_LIFETIME_PROPORTION_4RENEWAL_ELIGIBILITY": 0.15  // 15%
  }
}
```

**Calculation:**
- Token lifetime: 480 seconds
- Renewal threshold: 480 × 0.15 = 72 seconds
- Token eligible for renewal after 72 seconds

### Enable/Disable in Tests

**Enable (default):**
```json
{
  "API_DEFAULT_OPTIONS": {
    "ENABLED_TEST_SUITES": [
      "tokenRenewal",
      // ... other suites
    ]
  }
}
```

**Disable (for fast CI/CD):**
```json
{
  "API_DEFAULT_OPTIONS": {
    "EXCLUDED_TESTS": ["tokenRenewal"]
  }
}
```

## Expected Results

### Automatic Renewal Test
- **Duration:** 72+ seconds
- **Success:** Token JTI changes during test period
- **Warning (not failure):** Token doesn't renew if threshold not reached

### Manual Refresh Test
- **Duration:** 2-5 seconds
- **Success:** Token JTI changes after `refreshToken()` call

## When to Run

### ✅ Always Run
- Before deploying token/auth changes
- During comprehensive integration testing
- When investigating token issues

### ⚠️ Consider Excluding
- In fast CI/CD pipelines (< 2 minutes)
- During rapid development
- When testing unrelated features

## Troubleshooting

### Test Takes Too Long
**Solution:** Add to `EXCLUDED_TESTS` in config

### Token Not Renewing
**Check:**
1. Token lifetime (should be ~480 seconds)
2. Renewal threshold calculation (15% = 72 seconds)
3. Server-side renewal enabled
4. RODiT configuration correct

### Authentication Failures
**Check:**
1. Token expiration time
2. Session validity
3. RODiT validity period

## Key Differences from Other Tests

| Aspect | Regular Tests | Token Renewal Tests |
|--------|--------------|---------------------|
| Client Instance | New per test | Single long-lived |
| Duration | < 10 seconds | 72+ seconds |
| Purpose | Test isolation | Trigger renewal |
| Test Mode | `testMode: true` | `testMode: true` |
| Cleanup | Per test | After all requests |

## Integration Points

### Test System
- Integrated into `src/test-system.js`
- Part of SDK-based tests
- Runs after session management tests

### Test Runner
- Available via `runTokenRenewalTests(app)`
- Can run standalone or as part of full suite

### Configuration
- Controlled by `ENABLED_TEST_SUITES`
- Can be excluded via `EXCLUDED_TESTS`

## Metrics Emitted

```javascript
// Success
logger.metric("test_success", 1, {
  module: "token-renewal",
  test: "testAutomaticTokenRenewal"
});

// Failure
logger.metric("test_failure", 1, {
  module: "token-renewal",
  test: "testAutomaticTokenRenewal",
  failure_type: "external_server_issue"
});
```

## Related Files

- **Implementation:** `src/test-modules/token-renewal.js`
- **Documentation:** `docs/TOKEN_RENEWAL_TESTS.md`
- **Example:** `examples/token-renewal-example.js`
- **Integration:** `src/test-system.js`
- **Configuration:** `config/default.json`

## Next Steps

1. **Run the example:** `node examples/token-renewal-example.js`
2. **Review full docs:** `docs/TOKEN_RENEWAL_TESTS.md`
3. **Run tests:** `npm test` or `node src/test-runner.js tokenRenewal`
4. **Configure CI/CD:** Add to `EXCLUDED_TESTS` if needed

---

For complete documentation, see [TOKEN_RENEWAL_TESTS.md](./TOKEN_RENEWAL_TESTS.md)
