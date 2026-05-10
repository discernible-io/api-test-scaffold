# Unified Error Handling Standard

**Status:** Aspirational + Incremental Adoption  
**Reference:** `sdk/services/error-response.js`, `src/routes`, `src/middleware`, `src/services`, and `docs/LOGGING_STANDARDS.md`  
**Last Updated:** May 2026

**Maintenance note:** Exhaustive inventories of every `message`, `status`, or log string are intentionally not duplicated in markdown. Operators and contributors should rely on codebase search (`src/` as listed above). The sections below are **representative examples** taken from current runtime wording to illustrate how API responses and logs align with the messaging standard.

**Test outcome vocabulary (deployment test harness):** For automated API tests run at deploy time, each test is reported with exactly one of two outcomes: **`passed`** or **`not-passed`**. Do not label test results as “failed”, “skipped”, or “succeed” in summaries, metrics, or runner logs—use **`not-passed`** for any outcome that is not a clear pass (including missing/invalid result objects from a test function). Harness counters use parallel names where applicable (for example metrics `test_passed` / `test_not_passed`). Semantics, triage rules, and what counts as a pass for positive vs negative cases are defined authoritatively in [`docs/TEST CONSTITUTION.md`](TEST%20CONSTITUTION.md). Operational API fields (for example health `status`, rate-limit “skipped”, generic `logger.event` `result` tokens) are unrelated to this harness vocabulary and are not restricted by this rule.

---

## Standard Error Response Structure

All API errors follow this compact, consistent format:

```json
{
  "error": {
    "code": "HELLO_TOKEN_ID_INVALID",
    "message": "invalid request; tokenId format rejected | reason: tokenId is not exactly 12 lowercase letters | action: provide a valid tokenId and retry",
    "details": { "tokenId": "INVALID123" }
  },
  "requestId": "01HX9X0T9CS1EM0WQ7R6F5B2VY",
  "timestamp": "2026-04-15T08:21:45.000Z"
}
```

**Key points:**
- `error.code` - Machine-readable code (SCREAMING_SNAKE_CASE)
- `error.message` - Human-readable, structured narrative
- `error.details` - Optional context (only when helpful)
- `requestId` - ULID for tracing (always included)
- `timestamp` - ISO 8601 when error occurred (always included)

---

## Message Composition Standard (Aspirational Target)

As a step toward unified messaging, every API-facing message should be authored in three parts:

1. `condition / status / error / issue; what happened`
2. `reason: <why it happened>`
3. `action: <what to do next or expected consequence>`

Canonical string form:

`<condition/status/error/issue; what happened> | reason: <reason> | action: <what to do or consequence>`

### Authoring Rules

- Start with the condition/outcome first, then the direct event description.
- Keep `reason` factual and specific.
- Keep `action` imperative for caller fixes, or declarative for consequences.
- Avoid vague fallback text unless cause is genuinely unknown.
- Keep terms consistent across endpoints (`tokenId`, `signature`, `permissions`, etc.).

### Illustrative snippets (representative strings from runtime)

Below are **real-style** excerpts from HTTP error bodies (`sendError` → `error.message`). They show validation, upstream failure, geographic policy, identity resolution, permissions, session handling, content type, etc.

- `condition; Content-Type must be application/json | reason: request payload or parameter validation failed | action: fix the input format/required fields and retry`
- `issue; Request body is missing or malformed | reason: request payload or parameter validation failed | action: fix the input format/required fields and retry`
- `issue; JWT payload is missing required sub field for identity derivation | reason: authentication preconditions were not met | action: authenticate with a valid token and retry`
- `issue; Unable to parse caller tokenId from JWT sub field | reason: authentication preconditions were not met | action: authenticate with a valid token and retry`
- `issue; Authentication service unavailable | reason: authentication preconditions were not met | action: authenticate with a valid token and retry`
- `issue; Authentication service unavailable | reason: request validation, authorization, or dependency checks failed | action: correct inputs/credentials or restore dependency health, then retry`
- `issue; Authorization service unavailable | reason: request validation, authorization, or dependency checks failed | action: correct inputs/credentials or restore dependency health, then retry`
- `condition; nonce must be a hexadecimal string | reason: HOLA integrity or freshness validation failed | action: regenerate values, re-sign, and retry with a fresh request`
- `issue; Unsupported protocol; expected HOLA | reason: HOLA integrity or freshness validation failed | action: regenerate values, re-sign, and retry with a fresh request`
- `issue; Invalid HOLA format. Expected standard format (8 fields with recipient) or subagent format (11 fields) | reason: HOLA integrity or freshness validation failed | action: regenerate values, re-sign, and retry with a fresh request`
- `issue; RODiT identity not found | reason: requested entity was not found in current data sources | action: verify identifiers or create the resource before retrying`
- `issue; RODiT token not found on blockchain | reason: requested entity was not found in current data sources | action: verify identifiers or create the resource before retrying`
- `condition; Authentication service not configured | reason: authentication preconditions were not met | action: authenticate with a valid token and retry`

Some success-style responses reuse the same canonical triad on the `message` field (for symmetry with structured logging):

- `status; Session terminated successfully | reason: operation completed successfully | action: no action required`
- `status; Performance metrics reset successfully | reason: operation completed successfully | action: no action required`

### Structured `status` / `result` / `outcome` fields on JSON bodies

Health and handshake flows also attach short machine-oriented tokens beside human strings. Typical values include:

**Lifecycle / probes**

- `status; healthy | reason: operation completed successfully | action: no action required`
- `condition; degraded | reason: the event outcome depends on request context | action: inspect context and logs to determine next steps`
- `condition; fail | reason: the event outcome depends on request context | action: inspect context and logs to determine next steps`
- `condition; skipped | reason: the event outcome depends on request context | action: inspect context and logs to determine next steps`

**Operational results**

- `status; success | reason: operation completed successfully | action: no action required`
- `status; active | reason: operation completed successfully | action: no action required`

**HOLA-oriented outcomes (often under `result`/`outcome` style payloads)**

- `invalid_signature`
- `invalid_timestamp`
- `nonce_replay`
- `sender_token_mismatch`

Integrators should rely on **`error.code`** for programmatic branching; treat these string fields as explanatory and subject to iterative wording improvements.

---

## Logging alignment (`src/` runtime)

Operational visibility should mirror response semantics wherever practical. Prefer `logger.event(level, message, context, error)` per `docs/LOGGING_STANDARDS.md`. Structured log lines increasingly use the same **condition | reason | action** pattern as HTTP messages.

Representative **`logger.event`** messages (abbreviated):

- `status; Request completed | reason: operation completed successfully | action: no action required`
- `status; IDClawserver API server started | reason: operation completed successfully | action: no action required`
- `issue; Fatal error starting IDClawserver API | reason: the event outcome depends on request context | action: inspect context and logs to determine next steps`
- `issue; Geolocation check denied access | reason: request validation, authorization, or dependency checks failed | action: correct inputs/credentials or restore dependency health, then retry`
- `condition; MCP service not available; skipping streamable HTTP transport setup | reason: the event outcome depends on request context | action: inspect context and logs to determine next steps`

Representative legacy-style messages (migrate toward the triad over time):

- `Failed to calculate minting fee`
- `Error serving policy file`
- `HOLA signature validation failed`

---

## How API Endpoints Report Errors

All route files use `sendError()` from `@rodit/rodit-auth-be`:

```javascript
const { sendError } = require("@rodit/rodit-auth-be").errorResponse;

sendError(res, {
  statusCode: 400,
  requestId,
  code: "HELLO_TOKEN_ID_INVALID",
  message: "invalid request; tokenId format rejected | reason: tokenId is not exactly 12 lowercase letters | action: provide a valid tokenId and retry"
});
```

---

## Common Error Codes

### Authentication & Authorization
| Code | Status | Meaning |
|------|--------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid JWT token |
| `FORBIDDEN` | 403 | Authenticated but lacks required permissions |
| `AUTH_SERVICE_UNAVAILABLE` | 503 | Authentication service unavailable |

### Token Validation
| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_RODITID` | 400 | Token ID format invalid (not 12 lowercase letters) |
| `TOKEN_NOT_FOUND` | 401 | Token does not exist on blockchain |
| `IDENTITY_NOT_FOUND` | 404 | RODiT identity not found |

### HOLA Handshake
| Code | Status | Meaning |
|------|--------|---------|
| `HELLO_REQUIRED` | 400 | Hello message missing |
| `HELLO_TOKEN_ID_INVALID` | 400 | Token ID invalid format |
| `HELLO_TIMESTAMP_INVALID` | 400 | Timestamp outside acceptable window |
| `HELLO_SIGNATURE_INVALID` | 400 | Signature verification failed |
| `HELLO_CHECKSUM_INVALID` | 400 | Checksum verification failed |
| `HELLO_TOO_LONG` | 400 | Message exceeds 512 character limit |

### Request Validation
| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_REQUEST` | 400 | Missing required parameter |
| `INVALID_PARAMETERS` | 400 | Parameter value out of range |
| `INVALID_SIGNATURE` | 400 | Signature verification failed |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type not application/json |

### Service Errors
| Code | Status | Meaning |
|------|--------|---------|
| `SERVICE_UNAVAILABLE` | 503 | Upstream service unavailable |
| `AGENT_DISCOVERY_FAILED` | 500 | Failed to fetch agent list |
| `LOGIN_FAILED` | 500 | Authentication service error |

---

## Implementation Notes

- Existing endpoints can migrate message strings incrementally.
- New endpoints should adopt the 3-part structure by default.
- `error.code` remains the programmatic contract; message structure improves operator and integrator clarity.
- For a complete list of current strings at any point in time, search literals in `src/app.js`, `src/routes/`, `src/middleware/`, and `src/services/` (responses, statuses, logs); do not treat this document as a full catalog.
