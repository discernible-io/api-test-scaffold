# Token Renewal Tests

## Overview

The token renewal test module (`src/test-modules/token-renewal.js`) provides comprehensive testing for automatic JWT token renewal functionality. Unlike other tests that create new client instances for each test (for isolation), these tests maintain long-lived client instances to trigger token renewal.

## Problem Solved

Previously, tests were not triggering token renewals because:
1. Each test created a new `RoditClient` instance for isolation
2. Tests completed quickly (< 10 seconds typically)
3. Tokens need to be held for **72+ seconds** to reach the renewal threshold (15% of token lifetime)
4. The renewal threshold is configured as `LAPSED_LIFETIME_PROPORTION_4RENEWAL_ELIGIBILITY = 0.15` (15%)

## Test Architecture

### Test 1: Automatic Token Renewal (`testAutomaticTokenRenewal`)

This test verifies that tokens are automatically renewed when they reach the renewal threshold:

1. **Creates a single long-lived client** - Maintains one `RoditClient` instance throughout the test
2. **Authenticates and captures initial token** - Gets JWT token with `jti`, `iat`, `exp`
3. **Calculates renewal threshold** - Determines when renewal should occur (15% of token lifetime)
4. **Makes periodic requests** - Sends requests every 10 seconds to keep session active
5. **Monitors for token changes** - Checks if `jti` changes (indicating renewal)
6. **Verifies renewal occurred** - Confirms token was renewed within expected timeframe

**Key Features:**
- Reuses single client instance (no test isolation needed)
- Waits for renewal threshold + 5 second buffer
- Makes periodic requests to maintain session activity
- Tracks all requests and token changes
- Provides detailed logging of renewal events

### Test 2: Manual Token Refresh (`testManualTokenRefresh`)

This test verifies that calling `refreshToken()` explicitly works correctly:

1. **Creates client and authenticates** - Gets initial token
2. **Calls `refreshToken()` explicitly** - Forces token renewal
3. **Verifies token changed** - Confirms new `jti` and newer `iat`
4. **Measures refresh duration** - Tracks performance

**Key Features:**
- Tests explicit refresh API
- Verifies token properties change correctly
- Measures refresh performance
- Simpler and faster than automatic renewal test

## Configuration

### Enable/Disable Token Renewal Tests

Edit `config/default.json`:

```json
{
  "API_DEFAULT_OPTIONS": {
    "ENABLED_TEST_SUITES": [
      "tokenRenewal",  // Add or remove this line
      // ... other test suites
    ]
  }
}
```

### Exclude Token Renewal Tests

If you want to exclude these tests (e.g., in CI/CD where they take too long):

```json
{
  "API_DEFAULT_OPTIONS": {
    "EXCLUDED_TESTS": [
      "tokenRenewal"
    ]
  }
}
```

## Running the Tests

### Run All Tests (Including Token Renewal)

```bash
npm test
```

### Run Only Token Renewal Tests

```bash
# Using the test runner
node src/test-runner.js tokenRenewal
```

### Run via API Endpoint

```bash
curl -X POST http://localhost:3000/api/test/run/tokenRenewal
```

## Expected Behavior

### Automatic Token Renewal Test

**Duration:** 72+ seconds (depends on token lifetime)

**Expected Flow:**
1. Initial authentication: ~1-2 seconds
2. Wait period: 72+ seconds (15% of token lifetime)
3. Periodic requests: Every 10 seconds
4. Token renewal detection: When `jti` changes
5. Test completion: After renewal or timeout

**Success Criteria:**
- Token `jti` changes during test period
- New token has later `iat` timestamp
- All periodic requests succeed
- No authentication errors

**Warning (Not Failure):**
- If token doesn't renew within test period, logs warning but doesn't fail
- This can happen if token lifetime is very long or threshold not reached

### Manual Token Refresh Test

**Duration:** ~2-5 seconds

**Expected Flow:**
1. Initial authentication: ~1-2 seconds
2. Explicit `refreshToken()` call: ~1-2 seconds
3. Verification: < 1 second

**Success Criteria:**
- Token `jti` changes after refresh
- New token has later `iat` timestamp
- Refresh completes without errors

## Token Renewal Configuration

Token renewal behavior is controlled by RODiT configuration in the credentials store:

```javascript
{
  "tokenrenewaloptions": {
    "LAPSED_LIFETIME_PROPORTION_4RENEWAL_ELIGIBILITY": 0.15,  // 15% threshold
    "THRESHOLD_VALIDATION_TYPE": 0.25,                        // 25% for full validation
    "DURATIONRAMP": 1.0                                       // Duration multiplier
  }
}
```

### Key Parameters

- **LAPSED_LIFETIME_PROPORTION_4RENEWAL_ELIGIBILITY (0.15)**: Token becomes eligible for renewal when 15% of its lifetime has elapsed
  - Example: 480-second token → eligible after 72 seconds
  
- **THRESHOLD_VALIDATION_TYPE (0.25)**: When 25% of lifetime has elapsed, perform full validation instead of brief validation
  
- **DURATIONRAMP (1.0)**: Multiplier for new token duration (1.0 = same duration)

## Troubleshooting

### Test Takes Too Long

**Problem:** Automatic renewal test runs for 72+ seconds

**Solutions:**
1. Exclude from CI/CD: Add `"tokenRenewal"` to `EXCLUDED_TESTS`
2. Run manually only when testing renewal functionality
3. Reduce token lifetime in test environment (not recommended for production testing)

### Token Not Renewing

**Problem:** Test completes but token doesn't renew

**Possible Causes:**
1. Token lifetime too long - renewal threshold not reached
2. Requests not frequent enough - session becoming inactive
3. Server-side renewal disabled or failing
4. RODiT configuration incorrect

**Debug Steps:**
1. Check token `exp` - `iat` to see token lifetime
2. Verify renewal threshold calculation (15% of lifetime)
3. Check server logs for renewal attempts
4. Verify RODiT configuration in credentials store

### Authentication Failures

**Problem:** Periodic requests fail with 401 errors

**Possible Causes:**
1. Token expired before renewal
2. Session invalidated server-side
3. RODiT expired or invalid

**Debug Steps:**
1. Check token expiration time
2. Verify session status on server
3. Check RODiT validity period
4. Review authentication logs

## Integration with Test Suite

The token renewal tests are integrated into the main test suite:

1. **Test Module:** `src/test-modules/token-renewal.js`
2. **Test Runner Integration:** `src/test-system.js`
3. **Configuration:** `config/default.json`
4. **SDK Test Suites:** Listed in `availableSdkSuites.tokenRenewal`

### Test Execution Order

Token renewal tests run as part of SDK-based tests:
1. Integration tests
2. MCP tests
3. Session management tests
4. SDK core tests
5. **Token renewal tests** ← Here
6. Other test suites

## Best Practices

### When to Run Token Renewal Tests

**Always Run:**
- Before deploying changes to token renewal logic
- After modifying authentication/session management
- When investigating token-related issues
- During comprehensive integration testing

**Consider Excluding:**
- In fast CI/CD pipelines (< 2 minutes)
- During rapid development iterations
- When testing unrelated features

### Test Environment Considerations

1. **Token Lifetime:** Ensure test environment has realistic token lifetimes (e.g., 480 seconds)
2. **RODiT Configuration:** Use test RODiT with appropriate renewal settings
3. **Time Allowance:** Allow 90+ seconds for automatic renewal test
4. **Logging:** Enable debug logging to track renewal events

## Metrics and Monitoring

The token renewal tests emit metrics for monitoring:

```javascript
logger.metric("test_success", 1, {
  module: "token-renewal",
  test: "testAutomaticTokenRenewal"
});

logger.metric("test_failure", 1, {
  module: "token-renewal",
  test: "testAutomaticTokenRenewal",
  failure_type: "external_server_issue"
});
```

Monitor these metrics to track:
- Token renewal test success rate
- Average renewal time
- Renewal failures and causes

## Related Documentation

- [Authentication Architecture](./AUTHENTICATION.md)
- [Session Management](./SESSION_MANAGEMENT.md)
- [Test System Overview](./TESTING.md)
- [SDK Documentation](../sdk/README.md)
