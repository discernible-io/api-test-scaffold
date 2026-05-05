# Failed Tests Analysis - HOLA Verification Coverage

**Test Suite**: `sdk_holaVerificationCoverage`  
**Status**: ❌ NOT-PASSED (0/4 tests)  
**Test Run**: 2026-05-05 13:58:22 - 13:58:32 UTC  
**Duration**: 10.1 seconds  
**Run ID**: 554273e2-c619-4274-ad16-3ac2e4dd7a48

---

## Summary

The HOLA verification coverage test suite failed because:

1. **testIdentityVerifyComprehensive**: Failed with signature validation errors
2. **testTestholaComprehensive**: Failed with signature validation errors  
3. **testCoverageGate**: Failed - only 1 of 10 required error reason codes covered

**Root Cause**: The test module uses placeholder signatures instead of real Ed25519 signatures, causing the API to reject all HOLA messages with "Error during signature validation: bad signature size".

---

## Failed Test Details

### Test 1: testIdentityVerifyComprehensive

**Status**: ❌ NOT-PASSED  
**Error**: "Error during signature validation: bad signature size"  
**Endpoint**: `POST /api/identity/verify`

#### What Happened

The test attempted to send HOLA messages to `/api/identity/verify` but all requests failed with signature validation errors because the test uses a placeholder signature instead of a real Ed25519 signature.

#### Test Code

@/home/icarus40/clienttestapi-rodit/src/test-modules/hola-verification-coverage.js:113-383

**Key Issue** (lines 87-103):
```javascript
// Build HOLA message (simplified - actual implementation would sign properly)
// Format: HOLA/<recipient>/<tokenId>/<timestamp>/<noncets>/API.IDENTYCLAW.COM/<signature>/<checksum>
const prefix = `HOLA/${recipient}/${tokenId}/${timestamp}/${noncetsHex}/API.IDENTYCLAW.COM/`;

// For testing, we'll use a placeholder signature
// In production, this would be properly signed with Ed25519
const signature = 'MEQW4YLTORUW63THMV2GC3DBNVRWQ'; // Base32 placeholder

// Compute checksum (sum of UTF-8 bytes mod 16)
const checksumInput = prefix + signature + '/';
let sum = 0;
for (let i = 0; i < checksumInput.length; i++) {
  sum += checksumInput.charCodeAt(i);
}
const checksum = (sum % 16).toString(16).toUpperCase();

return prefix + signature + '/' + checksum;
```

#### Logs

```json
{
  "component": "TestRunner",
  "duration": 0,
  "error": "Error during signature validation: bad signature size",
  "failureData": {
    "details": {},
    "failureClassification": {
      "category": "unknown",
      "reason": "Unhandled error: Error during signature validation: bad signature size",
      "type": "unknown"
    },
    "testData": {
      "duration": 2294,
      "endpoint": "https://api.identyclaw.com",
      "results": [
        {
          "error": "Error during signature validation: bad signature size",
          "name": "Valid HOLA - should return 200",
          "passed": false,
          "reasonCode": null
        }
      ],
      "testId": "cdfce02b-53c4-4125-b905-7ebb3deb4371"
    },
    "testInfo": {
      "apiEndpoint": "https://api.identyclaw.com",
      "correlationId": "01KQW6XV3AKWDQ1DNKA0E2G35C",
      "moduleName": "sdk_holaVerificationCoverage",
      "testName": "testTestholaComprehensive",
      "timestamp": "2026-05-05T13:58:32.297Z"
    }
  },
  "level": "error",
  "message": "Test error details: testIdentityVerifyComprehensive",
  "moduleName": "sdk_holaVerificationCoverage",
  "result": "not-passed",
  "testId": "01KQW6XV3AKWDQ1DNKA0E2G35C",
  "testName": "testIdentityVerifyComprehensive"
}
```

#### What Should Happen

The test should generate valid HOLA messages with real Ed25519 signatures so that:
1. Valid HOLA messages are accepted by the API (HTTP 200)
2. Invalid HOLA messages are rejected with proper error codes
3. Coverage tracking captures the error reason codes

#### What Needs to Change

**API Side**: None - the API is correctly rejecting invalid signatures

**Test Side**: The test module needs to generate real Ed25519 signatures instead of placeholders:

1. Use the SDK's cryptographic facilities to sign HOLA messages
2. Extract the client's private key from credentials
3. Sign the message payload with Ed25519
4. Encode signature properly (base32url or base64url as per spec)

---

### Test 2: testTestholaComprehensive

**Status**: ❌ NOT-PASSED  
**Error**: "Error during signature validation: bad signature size"  
**Endpoint**: `POST /api/testhola`

#### What Happened

Same issue as testIdentityVerifyComprehensive - the test uses placeholder signatures that fail validation.

#### Test Code

@/home/icarus40/clienttestapi-rodit/src/test-modules/hola-verification-coverage.js:388-562

#### Logs

```json
{
  "component": "TestRunner",
  "duration": 0,
  "error": "Error during signature validation: bad signature size",
  "failureData": {
    "details": {},
    "failureClassification": {
      "category": "unknown",
      "reason": "Unhandled error: Error during signature validation: bad signature size",
      "type": "unknown"
    },
    "testData": {
      "duration": 2294,
      "endpoint": "https://api.identyclaw.com",
      "results": [
        {
          "error": "Error during signature validation: bad signature size",
          "name": "Valid HOLA - should return 200",
          "passed": false,
          "reasonCode": null
        },
        {
          "actual": {
            "code": "HOLA_VALIDATION_FAILED",
            "reasonCode": "protocol_invalid",
            "stage": "format_checksum_and_payload_validation",
            "status": 400
          },
          "expected": {
            "reasonCode": "invalid_format",
            "stage": "format_checksum_and_payload_validation",
            "status": 400
          },
          "name": "Invalid format - should return 400",
          "passed": true,
          "reasonCode": "protocol_invalid"
        },
        {
          "error": "Error during signature validation: bad signature size",
          "name": "Nonce replay test",
          "passed": false,
          "reasonCode": null
        },
        {
          "manual": true,
          "name": "Sender token mismatch - manual test required",
          "note": "Requires authenticating as token A and signing HOLA with token B",
          "passed": true,
          "reasonCode": "sender_token_mismatch"
        }
      ],
      "testId": "cdfce02b-53c4-4125-b905-7ebb3deb4371"
    },
    "testInfo": {
      "apiEndpoint": "https://api.identyclaw.com",
      "correlationId": "01KQW6XV3AKWDQ1DNKA0E2G35C",
      "moduleName": "sdk_holaVerificationCoverage",
      "testName": "testTestholaComprehensive",
      "timestamp": "2026-05-05T13:58:32.297Z"
    }
  },
  "level": "error",
  "message": "Test error details: testTestholaComprehensive",
  "moduleName": "sdk_holaVerificationCoverage",
  "result": "not-passed",
  "testId": "01KQW6XV3AKWDQ1DNKA0E2G35C",
  "testName": "testTestholaComprehensive"
}
```

#### What Needs to Change

Same as testIdentityVerifyComprehensive - generate real Ed25519 signatures.

---

### Test 3: testCoverageGate

**Status**: ❌ NOT-PASSED  
**Coverage**: 1/10 (10%)  
**Covered Reason Codes**: `protocol_invalid`  
**Missing Reason Codes** (9):
- `checksum_invalid`
- `invalid_format`
- `timestamp_stale_or_future`
- `nonce_replay`
- `token_missing`
- `token_expired`
- `public_key_unavailable`
- `blockchain_unavailable_or_validation_error`
- `signature_mismatch`
- `sender_token_mismatch`

#### What Happened

The coverage gate test analyzed all test cases and found that only 1 of 10 required HOLA error reason codes was covered by the test suite. The other 9 reason codes were never triggered because the tests failed before reaching the validation stages that would produce those error codes.

#### Test Code

@/home/icarus40/clienttestapi-rodit/src/test-modules/hola-verification-coverage.js:686-734

#### Logs

```json
{
  "apiEndpoint": "https://api.identyclaw.com",
  "correlationId": "01KQW6XV4AEQ4MSQDY7P2BGTSG",
  "level": "info",
  "message": "[testCoverageGate] Checking coverage gate",
  "moduleName": "sdk_holaVerificationCoverage",
  "runId": "554273e2-c619-4274-ad16-3ac2e4dd7a48",
  "startTime": "2026-05-05T13:58:32.322Z",
  "testId": "b159bc31-2c4c-48a9-8965-3d4464a95dae",
  "testName": "testCoverageGate"
}

{
  "correlationId": "01KQW6XV4AEQ4MSQDY7P2BGTSG",
  "covered": ["protocol_invalid"],
  "level": "info",
  "message": "[testCoverageGate] Coverage gate FAILED: 1/10 reason codes covered (10%). Missing: checksum_invalid, invalid_format, timestamp_stale_or_future, nonce_replay, token_missing, token_expired, public_key_unavailable, blockchain_unavailable_or_validation_error, signature_mismatch, sender_token_mismatch",
  "missing": [
    "checksum_invalid",
    "invalid_format",
    "timestamp_stale_or_future",
    "nonce_replay",
    "token_missing",
    "token_expired",
    "public_key_unavailable",
    "blockchain_unavailable_or_validation_error",
    "signature_mismatch",
    "sender_token_mismatch"
  ],
  "passed": false
}

{
  "context": {
    "component": "TestRunner",
    "moduleName": "sdk_holaVerificationCoverage",
    "result": "not-passed",
    "resultPassed": false,
    "testName": "testCoverageGate"
  },
  "level": "warn",
  "message": "Test not-passed: testCoverageGate"
}

{
  "component": "TestRunner",
  "duration": 0,
  "error": "Unknown error",
  "failureData": {
    "details": {
      "coveragePercent": 10,
      "coveredReasonCodes": ["protocol_invalid"],
      "missingReasonCodes": [
        "checksum_invalid",
        "invalid_format",
        "timestamp_stale_or_future",
        "nonce_replay",
        "token_missing",
        "token_expired",
        "public_key_unavailable",
        "blockchain_unavailable_or_validation_error",
        "signature_mismatch",
        "sender_token_mismatch"
      ],
      "requiredReasonCodes": [
        "checksum_invalid",
        "invalid_format",
        "timestamp_stale_or_future",
        "nonce_replay",
        "token_missing",
        "token_expired",
        "public_key_unavailable",
        "blockchain_unavailable_or_validation_error",
        "signature_mismatch",
        "sender_token_mismatch"
      ],
      "stages": ["format_checksum_and_payload_validation"]
    },
    "failureClassification": {
      "category": "unknown",
      "reason": "Unhandled error: Unknown error",
      "type": "unknown"
    },
    "testData": {
      "duration": 16,
      "endpoint": "https://api.identyclaw.com",
      "testId": "b159bc31-2c4c-48a9-8965-3d4464a95dae"
    },
    "testInfo": {
      "apiEndpoint": "https://api.identyclaw.com",
      "correlationId": "01KQW6XV4P6SR4X7QJZA3VT1QY",
      "moduleName": "sdk_holaVerificationCoverage",
      "testName": "testCoverageGate",
      "timestamp": "2026-05-05T13:58:32.342Z"
    }
  },
  "level": "info",
  "message": "Test not-passed: testCoverageGate",
  "moduleName": "sdk_holaVerificationCoverage",
  "result": "not-passed",
  "testId": "01KQW6XV4P6SR4X7QJZA3VT1QY",
  "testName": "testCoverageGate"
}
```

#### What Should Happen

The coverage gate should pass when all 10 required reason codes have been exercised by test cases:
- ✅ `protocol_invalid` - Already covered (1/10)
- ❌ `checksum_invalid` - Need test case
- ❌ `invalid_format` - Need test case
- ❌ `timestamp_stale_or_future` - Need test case
- ❌ `nonce_replay` - Need test case
- ❌ `token_missing` - Need test case
- ❌ `token_expired` - Need test case
- ❌ `public_key_unavailable` - Need test case
- ❌ `blockchain_unavailable_or_validation_error` - Need test case
- ❌ `signature_mismatch` - Need test case
- ❌ `sender_token_mismatch` - Need test case

#### What Needs to Change

**Test Side**: Once real signatures are implemented, add test cases to cover the 9 missing reason codes.

---

## Root Cause Analysis

### Primary Issue: Placeholder Signatures

The test module uses a hardcoded placeholder signature instead of generating real Ed25519 signatures:

```javascript
const signature = 'MEQW4YLTORUW63THMV2GC3DBNVRWQ'; // Base32 placeholder
```

This causes the API to reject all HOLA messages with:
```
Error during signature validation: bad signature size
```

### Why This Matters

According to TEST CONSTITUTION.md (line 16):
> "Real cryptographic signatures (Ed25519, etc.) can be generated via the SDK using the credentials in .near-credentials/mainnet/. Do not use fake or placeholder signatures - tests must use real signatures to properly validate API behaviour for legitimate signing scenarios."

The test violates this principle by using placeholder signatures.

---

## Required Fixes

### Fix 1: Implement Real Ed25519 Signatures

**File**: `/home/icarus40/clienttestapi-rodit/src/test-modules/hola-verification-coverage.js`

**Current Code** (lines 87-103):
```javascript
// For testing, we'll use a placeholder signature
// In production, this would be properly signed with Ed25519
const signature = 'MEQW4YLTORUW63THMV2GC3DBNVRWQ'; // Base32 placeholder
```

**Required Change**:
1. Load the client's private key from credentials
2. Create the message to sign: `tokenId:timestamp:noncets:API.IDENTYCLAW.COM`
3. Sign with Ed25519 using tweetnacl or libsodium
4. Encode signature in proper format (base32url or base64url)
5. Compute checksum correctly

**Reference Implementation**:
See `/home/icarus40/clienttestapi-rodit/src/test-modules/identyclaw-api.js` for examples of proper HOLA generation with real signatures.

### Fix 2: Add Missing Test Cases

Once real signatures work, add test cases for the 9 missing reason codes:

1. **checksum_invalid** - Mutate the checksum field
2. **invalid_format** - Send malformed HOLA structure
3. **timestamp_stale_or_future** - Use timestamp outside valid range
4. **nonce_replay** - Send same nonce twice
5. **token_missing** - Use non-existent tokenId
6. **token_expired** - Use expired token (if available)
7. **public_key_unavailable** - Use tokenId with no public key
8. **blockchain_unavailable_or_validation_error** - Simulate blockchain errors
9. **signature_mismatch** - Modify signed fields after signing
10. **sender_token_mismatch** - Sign with different token than authenticated

---

## API Behavior Observed

### Positive Test Case
- **Input**: Valid HOLA with placeholder signature
- **Output**: HTTP 400 `Error during signature validation: bad signature size`
- **Status**: ✅ Correct - API properly validates signatures

### Negative Test Case: Invalid Format
- **Input**: `INVALID_FORMAT` string
- **Output**: HTTP 400 `HOLA_VALIDATION_FAILED` with `reasonCode: protocol_invalid`
- **Status**: ✅ Correct - API detects invalid format

### Coverage Analysis
- **Covered**: 1 reason code (`protocol_invalid`)
- **Missing**: 9 reason codes (all others)
- **Status**: ⚠️ Test suite incomplete

---

## Recommendations

### Priority 1: Fix Signature Generation
Implement real Ed25519 signature generation in the test module. This is blocking all other tests.

### Priority 2: Add Missing Test Cases
Once signatures work, add test cases for the 9 missing reason codes to achieve 100% coverage.

### Priority 3: Validate Error Response Format
Ensure all error responses include:
- `error.code` (e.g., `HOLA_VALIDATION_FAILED`)
- `error.details.reasonCode` (e.g., `checksum_invalid`)
- `error.details.stage` (e.g., `format_checksum_and_payload_validation`)

---

## Test Execution Timeline

| Time | Event |
|------|-------|
| 13:58:22.217Z | Test suite started |
| 13:58:22.217Z | testIdentityVerifyComprehensive started |
| 13:58:24.511Z | testIdentityVerifyComprehensive failed (signature validation) |
| 13:58:24.512Z | testTestholaComprehensive started |
| 13:58:26.806Z | testTestholaComprehensive failed (signature validation) |
| 13:58:26.807Z | testCoverageGate started |
| 13:58:26.823Z | testCoverageGate failed (coverage gate) |
| 13:58:32.357Z | Test suite completed (4 tests, 0 passed, 4 failed) |

---

## Summary for API Team

The test suite is well-designed but cannot run successfully until the test module generates real Ed25519 signatures instead of placeholders. The API is correctly rejecting invalid signatures, which is the expected behavior.

**No API fixes are required.** The issue is entirely on the test side.

Once the test module is fixed to use real signatures, the coverage gate test will be able to track which error reason codes are being exercised and ensure comprehensive coverage of all HOLA validation scenarios.
