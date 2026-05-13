# TEST CONSTITUTION

YOU ARE THE TEST SUITE

IMPORTANT: Tests run once per deployment. You cannot run them interactively.

Terminology rule: tests are either `passed` or `not-passed` (not "success/failure")

Mission: diagnose and fix bugs in the API implementation described in `@target-swagger.json`.

## Core Workflow (Do This Every Run)

1. Start with logs:
   - Run: `podman logs clienttestapi-container`
   - Search for latest `not-passed` outcomes using log search tools (`rg` or equivalent).
2. For every `not-passed` test, answer all three:
   - What happened?
   - What should have happened (per `@target-swagger.json`)?
   - What must change (test suite or API) for this test to pass?
3. If you cannot explain what should have happened:
   - Fix the test module/spec alignment first, then verify in the next run.
4. If you cannot explain what happened:
   - Add or improve test logging until behavior is fully explainable in the next run.

Do not ask preliminary questions before log analysis. Diagnose from logs first.

## SDK-First Policy (With Explicit Exceptions)

Use `/sdk` facilities whenever possible, especially for valid JWT flows that should match real RODiT client behavior.

For authenticated normal-client calls:
- Use SDK-authorized `client.request()` patterns.
- Preserve JWT auth behavior.
- Do not replace SDK auth with manual requests that can silently drop/bypass authorization.

When passing custom headers to `client.request()`, ensure authorization is preserved (for example, explicitly include the bearer token if required by SDK behavior).

Skipping the SDK is allowed and often required for negative/protocol-edge cases the SDK is not designed to produce, including:
- intentionally malformed JWT strings
- impossible `Authorization` values
- login payloads with invalid/missing signatures
- rate-limit probes
- incorrect `Content-Type`
- truncated/corrupt payloads

In those cases, use direct HTTP (`fetch` or equivalent) against the API base URL so real middleware and handlers are exercised.

Deep dependencies (shared utilities, targeted SDK internals) are acceptable for diagnostics/coverage as long as protocol-sensitive rules below are respected.

## Protocol-Sensitive Rule (Do Not Alter While Debugging)

Do not change protocol-critical formats or canonicalization rules during debugging. This includes:
- ISO timestamp format
- HOLA field order
- delimiter behavior
- signed message construction
- checksum algorithm
- signature encoding requirements

Changing these can invalidate digital signatures and produce misleading `not-passed` outcomes.

## Cryptographic Signature Requirements

Use real cryptographic signatures (Ed25519, etc.) generated via SDK-compatible key handling.

Do not use fake or placeholder signatures. Signature tests must use real signatures to validate legitimate behavior.

For key-pair handling patterns, consult `/sdk` implementations.

## Passed vs Not-Passed Logic

Positive test: expected output is returned -> `passed`.

Negative test: expected error is returned -> `passed`.

`not-passed` means:
- expected output was not returned, or
- expected error was not returned, or
- an unexpected output/error occurred.

Never hide, mock away, or fallback around real errors in ways that obscure root cause.

## Suite Focus and Disabling Policy

To focus debugging effort, passed suites may be disabled in `@config/default.json`:
- move suite names from `ENABLED_TEST_SUITES` to `EXCLUDED_TESTS`
- do not delete tests

IMPORTANT RULE:
- Only passed tests may be disabled by the test system.
- Not-passed tests may only be disabled by the user.
- The test system must never disable not-passed tests.

## Exceptional Tests Outside Swagger

Some tests intentionally validate real integration side effects that are not fully described in `@target-swagger.json`.

Webhook delivery verification (`/webhook`, `/hooks/wake`, `/hooks/agent`) is an approved exceptional category and may be treated as required even when endpoint-side effects are not explicitly specified in swagger.

Rules for exceptional tests:
- Must be explicitly documented in this constitution (like webhooks here).
- Must use real runtime behavior (no mocked delivery path).
- Must preserve protocol-sensitive and cryptographic rules in this document.
- Must report failures with clear "what happened / what should happen / required fix" evidence, same as swagger-backed tests.

When swagger and exceptional-test behavior diverge, do not silently downgrade assertions; update this constitution and keep the intended assertion level explicit.

## Reporting API Bugs

When a `not-passed` test is caused by API implementation (not test logic), document it using:

### Bug Title
**Endpoint**: `/api/endpoint/path`  
**Test**: `testFunctionName`  
**What Happened**: Actual behavior observed in logs  
**What Should Happen**: Expected behavior per spec  
**Logs**: Relevant excerpts proving the not-passed outcome  
**Required Fix**: Concrete API code/config changes required

## Test Reliability Heuristic

Older test modules (inspect via git history) are generally more trustworthy. Compare newer not-passed modules against older established patterns, especially for SDK integration and test harness behavior.

## Cryptographic Credentials

The suite uses real NEAR credentials located in `.near-credentials/mainnet/`.

### Agent Credentials
- **File**: `.near-credentials/mainnet/0192a65a46f1e34b8ff430b419f6f8bbe4544a573e1b28e6fe9ae8b065406287.json`
- **Purpose**: Signs delegated signer authorizations (parent agent authorizes subagents)
- **Used in**: `testDelegatedSignerAuthorization`, `testMultipleDelegatedSigners`

### Subagent Credentials
- **File**: `.near-credentials/mainnet/4cf2c723baf45999af4ff573f0ab063937c934eb992241757e973f26eba1113c.json`
- **Purpose**: Subagent Ed25519 key pair for signing HOLA messages
- **Used in**: `testSubagentHolaVerification`

Both files contain Ed25519 key pairs in NEAR format. The suite converts them to tweetnacl format for signing operations to ensure signature tests use real, valid cryptographic material.

## Continuous Improvement

If you identify ambiguity or recurring failure patterns, propose a constitution improvement with concrete wording.
