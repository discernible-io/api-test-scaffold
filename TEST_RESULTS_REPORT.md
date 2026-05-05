# Test Results Report

Source of truth: latest `podman logs clienttestapi-container` run.

## Run Snapshot

- Run ID: `fe461d02-2493-4226-8573-ba04efac994b`
- Suites completed: `14`
- Tests passed: `130`
- Tests not-passed: `3`
- Total executed tests: `133`
- Failing suite: `sdk_holaVerificationCoverage` (`passed: 1`, `not-passed: 3`, `total: 4`)
- Additional blocker: test module `stressTests` failed to load (`Cannot find module 'autocannon'`)

## Not-Passed Tests (Constitution Format)

### Bug Title
**Endpoint**: `/api/identity/verify`  
**Test**: `testIdentityVerifyComprehensive`  
**What Happened**: Multiple subtests did not pass. The positive subtest reported mismatch because actual payload had `verified: true` with checks, while expected object required `peerVerified: true`. The negative invalid-format subtest got HTTP 400 with code `HELLO_PROTOCOL_INVALID`, but test expected `reasonCode: invalid_format`. Additional subtests for stale timestamp, missing token, and signature mismatch expected HTTP 400 but got HTTP 200.  
**What Should Happen**: Per `target-swagger.json`, `/api/identity/verify` returns a 200 body keyed by `verified` (not `peerVerified`) for successful verification, and should return a structured 400 error for malformed/invalid hello cases. The test assertions should align with this response contract and error schema. If stale/missing/signature-negative payloads are validly constructed, API should reject them with 400.  
**Logs**:
- `Test not-passed: testIdentityVerifyComprehensive`
- `Failed subtest: Valid HOLA - should verify`
- `Invalid format test: reasonCode=undefined, stage=undefined`
- `Expected 400 error but got 200` for stale timestamp, token missing, and signature mismatch subtests
- Error code observed: `HELLO_PROTOCOL_INVALID`
**Required Fix**:
- Test-suite fix: update positive assertions to use `verified` for `/api/identity/verify` responses.
- Test-suite/API contract fix: normalize negative assertions to the documented error shape (`error.code`, `error.details.reasonCode` where present).
- API or test-vector fix: investigate why stale timestamp/token-missing/signature-mismatch payloads are accepted with 200; either harden endpoint validation or correct malformed negative fixtures so they truly violate validation rules.

### Bug Title
**Endpoint**: `/api/identity/verify` and `/api/testhola` coverage gate logic  
**Test**: `testHolaVerificationCoverage`  
**What Happened**: Coverage test finished with 60% reason-code coverage (`6/10`), then was marked not-passed. Missing reason codes: `checksum_invalid`, `timestamp_stale_or_future`, `token_missing`, `signature_mismatch`.  
**What Should Happen**: Coverage module expects all required reason codes to be exercisable and observed in test outcomes. Given the target swagger documents these error classifiers, coverage should reach expected threshold by producing and asserting those scenarios correctly.  
**Logs**:
- `Coverage test completed` with `passed:false`, `passedTests:9`, `totalTests:14`
- `Coverage Report` shows `coveragePercent:60`
- Missing: `checksum_invalid`, `timestamp_stale_or_future`, `token_missing`, `signature_mismatch`
**Required Fix**:
- Test-suite fix: strengthen scenario generation and error parsing so each required reason code is actually provoked and captured.
- API fix (if reproducible with valid negative vectors): ensure endpoint emits documented machine-readable reason codes for each failure path.

### Bug Title
**Endpoint**: Coverage gate on HOLA verification tests  
**Test**: `testCoverageGate`  
**What Happened**: Gate failed because only `6/10` required reason codes were covered (`60%`).  
**What Should Happen**: Gate should pass only when required failure taxonomy is covered. For this run, that means adding working tests for `checksum_invalid`, `timestamp_stale_or_future`, `token_missing`, and `signature_mismatch`.  
**Logs**:
- `[testCoverageGate] Coverage gate FAILED: 6/10 reason codes covered (60%). Missing: checksum_invalid, timestamp_stale_or_future, token_missing, signature_mismatch`
- `Test not-passed: testCoverageGate`
**Required Fix**:
- Test-suite fix: add/repair deterministic negative tests for missing reason codes and keep API assertions bound to documented contract.
- Keep gate strict after fixes to prevent regression.

## Additional Non-Execution Blocker

### Bug Title
**Endpoint**: N/A (test infrastructure dependency)  
**Test**: `stressTests` module load  
**What Happened**: Test module failed to load: `Cannot find module 'autocannon'`.  
**What Should Happen**: Stress test module should load cleanly when enabled, with declared dependencies installed in the runtime image.  
**Logs**:
- `Failed to load test module: stressTests`
- `Cannot find module 'autocannon'`
**Required Fix**:
- Add/install `autocannon` in the test runtime dependencies, or exclude `stressTests` from enabled suites when dependency is intentionally absent.

## Suggested Constitution Improvement

- Add a short mandatory field in each not-passed entry: `Classification: API bug | test bug | infra bug`, to reduce ambiguity and speed triage.
- Require one `spec reference` per not-passed diagnosis (path + key names from `target-swagger.json`) so expected behavior is always anchored to contract.
