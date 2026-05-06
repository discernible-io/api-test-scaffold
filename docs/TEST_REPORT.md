# TEST REPORT (CONSTITUTION-COMPLIANT)

Run source: `podman logs clienttestapi-container`  
Observed run id: `0ab9196f-63c8-446a-9915-5cb89fd6649c`  
Scope: full latest logged run (not first failure only)

## Core Workflow Record

1. Started with logs (`podman logs clienttestapi-container`).
2. Extracted all latest `not-passed` tests and `not-passed` suites.
3. For every `not-passed` test, answered:
   - What happened
   - What should have happened (per `api-docs/target-swagger.json`)
   - What must change for this test to pass

## Not-Passed Inventory (Full Run)

- `sdk_schemaDocumentation.testSwaggerJsonSchema`
- `sdk_webhooks.testWebhookWakeEndpoint`
- `sdk_webhooks.testWebhookAgentEndpoint`
- `sdk_webhooks.testWebhookReceptionAtMultipleEndpoints`
- `sdk_identyclawApi.testSwaggerSchemaEndpoint`

## Per-Test Diagnosis

### 1) `testSwaggerJsonSchema` (`sdk_schemaDocumentation`)

- What happened:
  - `GET /swagger.json` returned `404`.
  - Test subchecks (`schema`, `structure`, `components`, `content-type`) all became `not-passed`.
- What should have happened:
  - `target-swagger` defines `GET /swagger.json` (`operationId: get_swagger_json`) with `200` JSON response requiring `openapi`, `info`, `paths`.
- What must change:
  - API: restore/implement `GET /swagger.json` route to return the documented OpenAPI JSON contract.
  - Or alignment: if endpoint is intentionally removed, update `target-swagger` and this test together.

Logs:
```text
Test not-passed: testSwaggerJsonSchema
Failed subtest: Retrieve swagger.json schema (HTTP 404)
Endpoint not found (404) - Check API route configuration
```

### 2) `testWebhookWakeEndpoint` (`sdk_webhooks`)

- What happened:
  - The test triggered `/api/testhola` successfully, but observed no webhook receipt at `/hooks/wake` within wait window.
  - Evidence shows `receivedCount: 0` and empty receipt paths.
- What should have happened:
  - `target-swagger` for `/api/testhola` states development webhook behavior emits webhook events to `/hooks/wake` and `/hooks/agent`.
  - Test expects at least one matching event at `/hooks/wake` after `/api/testhola`.
- What must change:
  - API/runtime: ensure `/api/testhola` webhook emission is active for this environment and reaches the listener buffer for `/hooks/wake`.
  - If this deployment is not in development mode, test/spec alignment must gate or conditionally skip this assertion by runtime mode.

Logs:
```text
Test testWebhookWakeEndpoint not-passed at webhook side-effects tier
Expected /hooks/wake webhook was not observed after /api/testhola
receivedCount: 0, receivedPaths: []
```

### 3) `testWebhookAgentEndpoint` (`sdk_webhooks`)

- What happened:
  - No webhook receipt observed at `/hooks/agent` after `/api/testhola`.
  - Recorded `not-passed` with empty webhook evidence.
- What should have happened:
  - Per `/api/testhola` contract description, development webhook emission includes `/hooks/agent`.
- What must change:
  - API/runtime: deliver webhook events to `/hooks/agent` in this environment.
  - If environment intentionally disables development webhook emission, adjust test/spec alignment for mode-aware behavior.

Logs:
```text
Test testWebhookAgentEndpoint not-passed at webhook side-effects tier
Expected /hooks/agent webhook was not observed after /api/testhola
receivedCount: 0, receivedPaths: []
```

### 4) `testWebhookReceptionAtMultipleEndpoints` (`sdk_webhooks`)

- What happened:
  - Combined wake+agent webhook assertion failed: both missing.
  - Result message explicitly reports `wake=false, agent=false`.
- What should have happened:
  - `/api/testhola` development webhook behavior should emit receipts observable at both `/hooks/wake` and `/hooks/agent`.
- What must change:
  - API/runtime: fix dual-endpoint webhook dispatch and/or listener capture path so both endpoints receive expected events.
  - If mode is non-development, add explicit mode check in tests before asserting dual receipt delivery.

Logs:
```text
Test testWebhookReceptionAtMultipleEndpoints not-passed at webhook side-effects tier
Missing expected webhook receipts after /api/testhola: wake=false, agent=false
receivedCount: 0, receivedPaths: []
```

### 5) `testSwaggerSchemaEndpoint` (`sdk_identyclawApi`)

- What happened:
  - Direct request to `/swagger.json` failed with `404` and endpoint-not-found body.
- What should have happened:
  - Same swagger contract expectation: `GET /swagger.json` returns OpenAPI schema payload.
- What must change:
  - Same required fix as failure #1: restore/implement `/swagger.json` contract in deployed API (or align spec+tests if intentionally removed).

Logs:
```text
Test not-passed: testSwaggerSchemaEndpoint
Swagger schema request not-passed: 404 - {"error":{"code":"ENDPOINT_NOT_FOUND","message":"Endpoint not found" ...}}
Endpoint not found (404) - Check API route configuration
```

## Code/Spec Samples

Test expectation sample (`src/test-modules/schema-documentation.js`):
```javascript
const response = await fetch(`${apiEndpoint}/swagger.json`, { method: 'GET' });
const data = await response.json();
const passed = response.status === 200 && data && (data.openapi || data.swagger) && data.info && data.paths;
```

Test expectation sample (`src/test-modules/webhooks.js`):
```javascript
const wakeReceipt = (deliveryCheck.evidence || []).find((entry) => entry.path === "/hooks/wake");
if (!wakeReceipt) {
  return { passed: false, error: "Expected /hooks/wake webhook was not observed after /api/testhola" };
}
```

Spec sample (`api-docs/target-swagger.json`):
```json
"/api/testhola": {
  "post": {
    "description": "... In development mode, the server emits webhook events ... at `/hooks/wake` and `/hooks/agent`."
  }
}
```

Spec sample (`api-docs/target-swagger.json`):
```json
"/swagger.json": {
  "get": {
    "operationId": "get_swagger_json"
  }
}
```

## Reporting API Bugs

### Bug Title
**Endpoint**: `/swagger.json`  
**Test**: `testSwaggerJsonSchema`  
**What Happened**: Endpoint returned `404`; test marked `not-passed`.  
**What Should Happen**: Return `200` JSON OpenAPI document per `get_swagger_json`.  
**Logs**: `Failed subtest: Retrieve swagger.json schema (HTTP 404)`  
**Required Fix**: Restore/implement `/swagger.json` route in deployed API or align spec+tests if intentionally removed.

### Bug Title
**Endpoint**: `/swagger.json`  
**Test**: `testSwaggerSchemaEndpoint`  
**What Happened**: Endpoint returned `404` with `ENDPOINT_NOT_FOUND`; test marked `not-passed`.  
**What Should Happen**: Same as above, valid schema response expected.  
**Logs**: `Swagger schema request not-passed: 404 ... ENDPOINT_NOT_FOUND`  
**Required Fix**: Same `/swagger.json` contract restoration/alignment as above.

### Bug Title
**Endpoint**: `/api/testhola` (webhook side effects: `/hooks/wake`)  
**Test**: `testWebhookWakeEndpoint`  
**What Happened**: No webhook receipt observed at `/hooks/wake` after `/api/testhola`.  
**What Should Happen**: Development-mode webhook emission should produce receipt at `/hooks/wake`.  
**Logs**: `Expected /hooks/wake webhook was not observed after /api/testhola`  
**Required Fix**: Ensure webhook dispatch/capture to `/hooks/wake` works in active environment, or make test mode-aware if non-development behavior is expected.

### Bug Title
**Endpoint**: `/api/testhola` (webhook side effects: `/hooks/agent`)  
**Test**: `testWebhookAgentEndpoint`  
**What Happened**: No webhook receipt observed at `/hooks/agent` after `/api/testhola`.  
**What Should Happen**: Development-mode webhook emission should produce receipt at `/hooks/agent`.  
**Logs**: `Expected /hooks/agent webhook was not observed after /api/testhola`  
**Required Fix**: Ensure webhook dispatch/capture to `/hooks/agent` works in active environment, or make test mode-aware if non-development behavior is expected.

### Bug Title
**Endpoint**: `/api/testhola` (webhook side effects: `/hooks/wake`, `/hooks/agent`)  
**Test**: `testWebhookReceptionAtMultipleEndpoints`  
**What Happened**: Combined check failed (`wake=false, agent=false`).  
**What Should Happen**: Both endpoint receipts should be present in development-mode webhook emission.  
**Logs**: `Missing expected webhook receipts after /api/testhola: wake=false, agent=false`  
**Required Fix**: Correct dual webhook delivery/capture behavior, or gate assertions by runtime mode if non-development deployment.

## Suite-Level Snapshot

- `sdk_schemaDocumentation`: `not-passed` 1, `passed` 3, total 4
- `sdk_webhooks`: `not-passed` 3, `passed` 6, total 9
- `sdk_identyclawApi`: `not-passed` 1, `passed` 50, total 51
