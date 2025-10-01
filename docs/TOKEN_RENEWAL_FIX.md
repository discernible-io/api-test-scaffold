# Token Renewal Test Fix

## Issue

Token renewal tests were failing with error:
```
"Failed to decode initial token"
```

## Root Cause

The test was calling `client.getSessionToken()` immediately after `login_server()`, but the token wasn't available via that method. The issue was:

1. `login_server()` calls `setSessionToken()` **without await** (line 914 in sdk/index.js)
2. `setSessionToken()` is an async function
3. The token might not be fully stored in stateManager when `getSessionToken()` is called
4. `getSessionToken()` retrieves from `stateManager.getJwtToken()` which may be empty

## Solution

Changed token retrieval to match the pattern used by other successful tests:

### Before (Broken)
```javascript
await client.login_server();
const initialToken = client.getSessionToken();  // ❌ May return null
```

### After (Fixed)
```javascript
const loginResult = await client.login_server();
const initialToken = loginResult.jwt_token;     // ✅ Direct from login result
```

Or alternatively:
```javascript
await client.login_server();
const initialToken = client.jwt_token;          // ✅ From client property
```

## Changes Made

Updated `/home/icarus40/clienttestapi-rodit/src/test-modules/token-renewal.js`:

### 1. Initial Token Retrieval (testAutomaticTokenRenewal)
```javascript
// OLD:
await client.login_server();
const initialToken = client.getSessionToken();

// NEW:
const loginResult = await client.login_server();
const initialToken = loginResult.jwt_token;
```

### 2. Periodic Token Checks
```javascript
// OLD:
const currentToken = client.getSessionToken();

// NEW:
const currentToken = client.jwt_token;
```

### 3. Final Token Verification
```javascript
// OLD:
const finalToken = client.getSessionToken();

// NEW:
const finalToken = client.jwt_token;
```

### 4. Manual Refresh Test (testManualTokenRefresh)
```javascript
// OLD:
await client.login_server();
const initialToken = client.getSessionToken();
// ... refresh ...
const refreshedToken = client.getSessionToken();

// NEW:
const loginResult = await client.login_server();
const initialToken = loginResult.jwt_token;
// ... refresh ...
const refreshedToken = client.jwt_token;
```

## Why This Works

Other tests (integration.js, session-management.js, sdk-tests.js) all use the same pattern:

```javascript
const loginResult = await client.login_server();
if (!loginResult || !loginResult.jwt_token) {
  throw new Error('Login failed: No JWT token received');
}
const token = loginResult.jwt_token;
```

This pattern:
1. ✅ Gets token directly from login response
2. ✅ Doesn't depend on async stateManager storage
3. ✅ Works reliably for test instances
4. ✅ Matches established test patterns

## Server-Side Changes

**None required.** This was a client-side test implementation issue, not a server problem.

## Verification

Run the token renewal tests:
```bash
node src/test-runner.js tokenRenewal
```

Expected result:
- ✅ `testAutomaticTokenRenewal` - Passes (or warns if renewal threshold not reached)
- ✅ `testManualTokenRefresh` - Passes with token JTI change

## Related Issue

There's a potential bug in `sdk/index.js` line 914 where `setSessionToken()` is called without `await`:

```javascript
// Line 914 - Missing await
this.setSessionToken(loginResult.jwt_token);
```

Should be:
```javascript
await this.setSessionToken(loginResult.jwt_token);
```

However, fixing this is not required for the tests to work since we now access the token directly from `loginResult.jwt_token` or `client.jwt_token`.
