IMPORTANT: The tests run once every time this repo is deployed, you can't run them interactively.
Tests dont succeed or fail, they passed or not-passed
Your mission is to diagnose and help fix all the bugs in the implementation of the API described in @target-swagger.json.
Use /sdk facilities whenever possible, particularly for anything related to jwt tokens.
Real cryptographic signatures (Ed25519, etc.) can be generated via the SDK using the credentials in .near-credentials/mainnet/. Do not use fake or placeholder signatures - tests must use real signatures to properly validate API behavior.
For each test run you need to find for not-passed tests: What happened, what should have happened, and what needs to change in the test suite or the API for the test to pass.
If you can't explain what should have happened, then the test module needs to be fixed until you can explain it in a following test run. This needs to match with the @target-swagger.json.
If you can't explain what happened, then you need to add logs to the test module until you can find and explain what happened in a following test run.
There are positive tests, where for an test input we expect an output, and negative tests, where for an test input we expect an error. Both cases are "passed" tests. 
When for a test input we expect an output, and the output does not match, or when for a test input we expect an error, and we get a different error or some unexpected output, the test does not pass and is at "not-passed" test.
Errors must never be hidden, mocked or fallback in a way that hides the error, as hidding an error will prevent improving a test or fixing bugs in the API.
ALWAYS START BY CHECKING LOGS: Use 'podman logs clienttestapi-container' and grep to find the results of the latest test run. Do not ask questions - directly analyze the logs to find not-passed tests and diagnose the issues.
Tests that pass can be disabled in @config/default.json by removing them from the ENABLED_TEST_SUITES list to focus on not-passed tests during debugging. When disabling a test, move it from ENABLED_TEST_SUITES to EXCLUDED_TESTS rather than deleting it entirely - this preserves the test for future use.
The older a test module is, which you can see in git, the more you can trust that is properly implemented. Use this knowledge to compare test modules between them when one fails, which often will be because is not following proper integration patterns with the SDK and how the test suite is engineered.
If you can think of ways to improve this constitution please let me know.

## Cryptographic Credentials

The test suite uses real NEAR credentials for cryptographic operations. These credentials are stored in `.near-credentials/mainnet/`:

### Agent Credentials
- **File**: `.near-credentials/mainnet/0192a65a46f1e34b8ff430b419f6f8bbe4544a573e1b28e6fe9ae8b065406287.json`
- **Purpose**: Used for signing delegated signer authorizations (the parent agent authorizes subagents)
- **Used in**: `testDelegatedSignerAuthorization`, `testMultipleDelegatedSigners`

### Subagent Credentials
- **File**: `.near-credentials/mainnet/4cf2c723baf45999af4ff573f0ab063937c934eb992241757e973f26eba1113c.json`
- **Purpose**: Used as the subagent's Ed25519 key pair for signing HOLA messages
- **Used in**: `testSubagentHolaVerification`

Both credentials files contain Ed25519 key pairs in NEAR format. The test suite loads these credentials and converts them to tweetnacl format for cryptographic signing operations. This ensures all signature-based tests use real, valid cryptographic signatures as required by line 5 of this constitution.