# LOGGING STANDARDS

Internal logging conventions for IDClawserver and the embedded SDK integration.
This document is for contributors and operators, not public API consumers.

**Related:** [`docs/CONFIGURATION_STANDARD.md`](CONFIGURATION_STANDARD.md) — how `LOG_LEVEL`, `NODE_ENV`, and optional log shipping (`LOKI_URL`, etc.) are resolved and what appears in startup logs.

## Goals

- Keep logs machine-queryable and human-readable.
- Make incidents traceable across API, middleware, and SDK layers.
- Prevent accidental disclosure of secrets or sensitive payload data.

## Scope

Applies to runtime code in:

- `src/` (API server)
- `sdk/` (shared SDK code used by this server)

Does not apply to docs/examples where `console.*` snippets are instructional only.

**Deployment test harness:** Log lines and metrics emitted by the post-deploy test runner (`src/test-system.js`, `src/test-modules/*`) must describe each test outcome as **`passed`** or **`not-passed`** only (see [`docs/TEST CONSTITUTION.md`](TEST%20CONSTITUTION.md), summarized in [`docs/ERROR_HANDLING_STANDARD.md`](ERROR_HANDLING_STANDARD.md)). This does not forbid words like “failure” when describing upstream HTTP errors or subsystem state outside the test verdict field.

## Logger and Levels

- Use `logger.debug`, `logger.info`, `logger.warn`, `logger.error` from the shared logger.
- For new runtime code, prefer `logger.event(level, message, context, error)` as the canonical structured logging entrypoint.
- Use log levels consistently:
  - `debug`: development diagnostics and detailed state.
  - `info`: expected lifecycle events (startup, request completion, successful operations).
  - `warn`: recoverable problems or degraded behavior.
  - `error`: failed operation, exception, or unavailable dependency.
- Avoid emojis and decorative prefixes in production log messages.

## Effective log level and environment (`LOG_LEVEL`, `NODE_ENV`)

Logging volume and verbosity are **not** hardcoded per environment in application logic. They follow the **same configuration resolution order** as every other tunable setting (environment variable → layered `config/` files including `NODE_ENV` → SDK fallbacks). See [`CONFIGURATION_STANDARD.md`](CONFIGURATION_STANDARD.md) for priority details.

**`LOG_LEVEL`**

- **Source:** Resolved through `sdk-config.service.js` → `config.get("LOG_LEVEL")` (with documented fallbacks in `sdk/services/configsdk.js`).
- **Allowed values:** `error`, `warn`, `info`, `debug` (enforced during `validateConfig` at startup).
- **Effect:** The shared Winston logger uses this as its **maximum verbosity** threshold: messages below that level are not emitted on console (and on Loki, when configured). For example `info` hides `logger.debug(...)` calls; `debug` exposes them—including **per-key lines** emitted while `validateConfig` runs (`✓ KEY: value` style diagnostics referenced in [`CONFIGURATION_STANDARD.md`](CONFIGURATION_STANDARD.md)).
- **Operators:** Prefer `LOG_LEVEL=debug` (or equivalent in `config/{NODE_ENV}.json`) only for short-lived troubleshooting, then revert to `info` or `warn` in steady-state production.

**`NODE_ENV`**

- Selects **`config/{NODE_ENV}.json`** when that file exists (standard `node-config` behavior). It does not bypass `LOG_LEVEL`; it may supply a **different default** `LOG_LEVEL` than `config/default.json` for that environment tier.
- Do not add `process.env.NODE_ENV` checks in routing or middleware to gate logging; rely on **`LOG_LEVEL`** and structured messages instead.

**Log shipping (`LOKI_URL`, `LOKI_TLS_SKIP_VERIFY`, `LOKI_BASIC_AUTH`)**

- Optional Loki transport in `src/app.js` uses the **same resolved `LOG_LEVEL`** as stdout. These keys follow the configuration standard above; secrets in `LOKI_BASIC_AUTH` must never be logged (see startup snapshot redaction in [`CONFIGURATION_STANDARD.md`](CONFIGURATION_STANDARD.md)).

**Observability of the chosen settings**

- After successful startup validation, **`IDClawserver API server`** `info` logs include **`logLevel`** and **`SERVICE_NAME`** reflecting the resolved config.
- A **startup configuration snapshot** (redacted keys) is logged separately; correlate with configured `LOG_LEVEL` when auditing what an instance should have printed versus what collectors received.

## Canonical Event Shape

Every structured log entry should follow this payload contract:

- `component` (required): stable emitter identifier (for example `IDClawserverAPI`).
- `requestId` (required for request-bound logs): request correlation id.
- `operation` (recommended): logical action (for example `startup.validateConfig`, `auth.login`).
- `method`, `path`, `statusCode`, `duration` (request lifecycle logs).
- `error` (for failures): normalized error object (see Error Contract).

## Aspirational Unified Event Schema

The long-term target is a single, normalized event envelope for all runtime logs.
This section is aspirational and describes the desired end state, not guaranteed current behavior.

Each log event should include:

- `eventId` (required): unique id for this emitted event.
- `eventType` (required): normalized type/category of event.
- `loggerId` (required): stable identifier of the logger/emitter instance.
- `ipAddressId` (required for multi-instance/server deployments): identifier for the server instance IP context.
- `credentialId` (optional): identifier of the credential used by the source to perform the request, when applicable.
- `sourceId` (required): origin identifier (for example originating client IP id or upstream system id).
- `resourceId` (required): identifier of the target resource (subject) of the event.
- `requestType` (required for request-driven events): normalized request/action type.
- `result` (required): one of `success`, `failure`, `error`, `source_error`.
- `resultText` (required when result is not self-evident): human-readable reason for the result.
- `dateTime` (required): event timestamp in ISO 8601 UTC format.

Recommended normalized envelope:

```json
{
  "eventId": "evt_01J...",
  "eventType": "authentication.attempt",
  "loggerId": "IDClawserverAPI",
  "ipAddressId": "ip_node_01",
  "credentialId": "cred_service_a",
  "sourceId": "src_203.0.113.10",
  "resourceId": "user_12345",
  "requestType": "POST /auth/login",
  "result": "failure",
  "resultText": "Invalid credentials",
  "dateTime": "2026-05-05T19:40:00Z"
}
```

Normalization notes:

- Prefer ids and controlled vocabularies over free-form strings for fields ending in `Id` or `Type`.
- `result` values should stay constrained to the canonical set above.
- `dateTime` should be generated by the server clock in UTC.
- If a legacy field (for example `requestId` or `operation`) is also present during migration, keep the aspirational fields authoritative.

## Message Style

- Message text should be short and action-oriented, for example:
  - `Configuration validation passed`
  - `RPC health check failed`
  - `Request completed`
- Do not encode metadata in message prefixes like `[MCP]` when the same value can be a field.

## Error Contract

Use one canonical error field:

```json
{
  "error": {
    "name": "ErrorName",
    "message": "Human readable message",
    "code": "OPTIONAL_MACHINE_CODE",
    "stack": "OPTIONAL_STACK_FOR_DEBUG"
  }
}
```

Rules:

- Always include `error.message`.
- Include `error.name` when available.
- Include `error.code` when available from upstream libraries.
- Include `error.stack` only where appropriate for the current **effective `LOG_LEVEL`** and security policy (avoid large stacks at `info` in high-volume paths unless justified).
- Do not split across ad-hoc fields like `errorMessage` and `errorCode`.
- Prefer `logger.formatError(error, fallbackName, extra)` from the shared SDK logger as the single formatter for runtime logs.

## Context Construction

- Prefer inline context objects passed directly to `logger.event(...)`.
- Treat `createLogContext` and `*WithContext` helpers as compatibility APIs for existing code.
- Compatibility aliases are retained for one release as a migration layer.
- Compatibility aliases are removed in the next major version.
- Do not introduce new helper layers for context construction unless there is a clear shared need.

## Request Lifecycle Pattern

For request-scoped operations:

- Emit one completion log at end of request with:
  - `component`, `requestId`, `method`, `path`, `statusCode`, `duration`.
- Emit error logs with the same correlation fields.
- Ensure middleware and route handlers preserve the same `requestId`.

## No `console.*` in Runtime Code

- Do not use `console.log`, `console.warn`, or `console.error` in runtime code under `src/` or `sdk/`.
- Use shared logger instead so all logs keep the same format and transport.
- Exception: early bootstrap fallback is permitted only when logger cannot initialize; keep this minimal.

## Redaction and Sensitive Data

Never log:

- Secrets, passwords, private keys, tokens, or credentials.
- Full auth headers or session bearer tokens.
- Raw biometric or facial encoding payloads.

When needed for diagnostics:

- Log presence/shape, not raw value (for example `[REDACTED]`, `tokenPresent: true`).
- Prefer explicit allowlists over broad object dumps.

## Current Consistency Gaps (Audit Snapshot)

- Mixed `createLogContext` call patterns across routes and SDK helper expectations.
- Direct `console.*` usage in API startup path.
- Inconsistent failure payload shape (`error` string vs nested object vs split fields).
- Uneven inclusion of `component` and `requestId` outside request handlers.

## Review Checklist (PR Gate)

- Uses shared logger (no runtime `console.*`).
- Does not hardcode verbosity; respects resolved **`LOG_LEVEL`** (see [`CONFIGURATION_STANDARD.md`](CONFIGURATION_STANDARD.md)).
- Includes `component` on all structured logs.
- Includes `requestId` on request-scoped logs.
- Uses canonical `error` object for failures.
- Avoids secrets/PII in log payload.
- Message text is concise and metadata lives in structured fields.
