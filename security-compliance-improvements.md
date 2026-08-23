# Security and Compliance Improvement Backlog

This backlog lists the **next** security and compliance improvements for this repository, ranked from **lowest effort / lowest rollout risk** to **highest effort / highest risk**. It is derived from a static review against the standards in [`../docs/`](../docs/) (markdown files under [`../docs/docs/`](../docs/docs/)).

Items already implemented in prior passes (README index, `_DEVELOPMENT` SSH secrets, main `LOG_LEVEL`, bootstrap logging via shared logger, `validateConfig`, expanded env mappings, main `SESSION_SECRET` enforcement, `sendError()` in `src/app.js`, CI gates, dependency audit cleanup, `npm ci` in `api.Dockerfile`, `.dockerignore`) are omitted here.

## Reference standards

| Standard | Path (from this repo) |
| --- | --- |
| Configuration | [`../docs/docs/configuration-standard.md`](../docs/docs/configuration-standard.md) |
| Logging | [`../docs/docs/logging-standard.md`](../docs/docs/logging-standard.md) |
| Error handling | [`../docs/docs/error-handling-standard.md`](../docs/docs/error-handling-standard.md) |
| CI/CD deployment | [`../docs/docs/cicd-deployment-standard.md`](../docs/docs/cicd-deployment-standard.md) |
| Allowed fallbacks | [`../docs/docs/allowed-fallback-standard.md`](../docs/docs/allowed-fallback-standard.md) |
| Test constitution (shared) | [`../docs/docs/test-constitution.md`](../docs/docs/test-constitution.md) |
| Test RODiT constitution (local) | [`test-rodit-constitution.md`](test-rodit-constitution.md) |
| Vocabulary | [`../docs/docs/vocabulary-standard.md`](../docs/docs/vocabulary-standard.md) |
| Documentation | [`../docs/docs/documentation-standard.md`](../docs/docs/documentation-standard.md) |

## Prioritized improvements

| Order | Improvement | Evidence in repo | Standards alignment | Effort / risk |
| --- | --- | --- | --- | --- |
| 5 | Remove `config.get(..., process.env[...])` stacking in test credential loading. | `src/test-utils/near-test-credentials.js` uses `config.get(PRIMARY_ENV_VAR, process.env[PRIMARY_ENV_VAR] \|\| null)` for primary credentials. | Configuration standard: application code should use `config.get` only, not ad-hoc `process.env` precedence. | Low effort, low-to-medium risk if any deploy relied on the extra fallback. |
| 6 | Set `LOKI_TLS_SKIP_VERIFY` to `"false"` in `config/main.json` once the main Loki endpoint has a trusted certificate. | Both `config/main.json` and `config/development.json` set `"LOKI_TLS_SKIP_VERIFY": "true"`. | Configuration and logging standards: avoid routine TLS verification bypass on main. | Low effort, low-to-medium risk if Loki TLS is not yet valid on main. |
| 7 | Pin the Node base image by digest in `api.Dockerfile` (and nginx Dockerfile if applicable). | `FROM node:20-alpine` uses a floating tag. | CI/CD supply-chain and reproducible image goals. | Low-to-medium effort, low risk. |
| 8 | Stop returning raw exception strings from webhook validation paths. | `handleIncomingWebhook` 500 responses use `sendError()` with a fixed message, but `processWebhookEvent` still returns `{ error: error.message }` and `resolveWebhookEventError` can expose unmapped strings as `WEBHOOK_PAYLOAD_ERROR` message text. | Error-handling standard: controlled `error.code` / `error.message`; details belong in logs. | Medium effort, medium risk for webhook tests expecting legacy strings. |
| 9 | Add an explicit maximum raw-body size in `createRawBodyParser()`. | `sdk/lib/middleware/webhookhandlermw.js` concatenates chunks without an upper bound before `JSON.parse`. | API hardening; supports test-constitution negative cases for oversized payloads. | Medium effort, low-to-medium risk if limits are documented and generous. |
| 10 | Gate or remove `/api/test/logging` on main. | `src/app.js` registers a public diagnostic route that emits all log levels and a synthetic `Error`; 500 responses still return `message: error.message` in a legacy shape. | Logging minimization and reduced main attack surface; vocabulary tier **main** vs **development**. | Medium effort, medium risk if operators use the endpoint for Loki verification. |
| 11 | Mount SDK rate-limit middleware on routes that swagger marks as rate-limited. | `sdk/lib/middleware/ratelimitmw.js` exists; `src/app.js` does not mount it. Tests in `rate-limiting` and `security` suites probe behavior that may be absent at runtime. | Security controls and alignment with `target-swagger.json` `rateLimitKey` metadata. | Medium effort, medium risk (tuning for webhook burst traffic). |
| 12 | Pin and verify the `tini` binary downloaded in `api.Dockerfile`. | `ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-static` has no checksum verification. | CI/CD supply-chain integrity for container entrypoints. | Medium effort, low-to-medium risk. |
| 13 | Exclude test-only and bulky paths from the API image via `.dockerignore`. | `.dockerignore` already excludes `node_modules` and secrets; the image still `COPY . .` includes `src/test-modules/`, `api-docs/`, and other non-runtime trees. | CI/CD “repo as build source” without shipping test harness code in production images. | Medium effort, low-to-medium risk if any runtime path assumed those files exist in-container. |
| 14 | Align deployment directory naming in docs and workflow comments with `clienttest-idc`. | `.github/workflows/deploy.yml` uses `APP_DIR: /home/dedalo43/clienttest-app`; upstream CI/CD examples still say `clienttestapi-app`. | Vocabulary and CI/CD standards; reduces operator mistakes during host bootstrap. | Medium effort, low operational risk (docs/comments only unless renaming host dirs). |
| 15 | Emit findings-first test outcome logs per the test constitution. | Runner logs still use mixed vocabulary (`passed` tallies are correct, but some modules/logs use `success`, `failure`, or `expect*` phrasing in published sub-results). | Test constitution (2026-05-21): logs must report what happened vs what the spec requires, not expectation jargon. | Medium-to-high effort, medium risk (log consumers and dashboards may need updates). |
| 16 | Replace hardcoded `https://api.identyclaw.com` API endpoint fallbacks with a single config-driven default and **info**-level allowed-fallback logs. | `src/test-system.js` `resolveApiEndpointFromApp` and `TestRunner.getApiEndpoint` stack metadata → stateManager → hardcoded mainnet URL; overlap is only partially logged at `warn`/`debug`. | Allowed-fallback standard: bounded, logged, mutually exclusive execution paths. | High effort, medium risk (wrong endpoint breaks large parts of the suite). |
| 17 | Move main NEAR credentials to Vault-backed storage (`RODIT_NEAR_CREDENTIALS_SOURCE: "vault"`). | `config/main.json` uses `"env"`; SDK supports Vault via `VAULT_*` keys and middleware. | Configuration and CI/CD standards: secrets on host/env for dev; vault for main where available. | High effort, medium-to-high risk (Vault rollout, token renewal, deploy validation). |
| 18 | Decide vendored `sdk/` vs package `@rodit/rodit-auth-be` and align imports, Docker context, and standards references. | `src/app.js` requires `../sdk`; standards and examples reference `@rodit/rodit-auth-be`. | Consistent configuration, logging, and error-handling patterns across services. | High effort, medium risk (import paths, image layout, version pinning). |
| 19 | Publish a route visibility and authentication matrix, then enforce it in code. | Public routes include `/health`, `/api/test/logging`, `/webhook`, `/hooks/wake`, `/hooks/agent`; policy is not centralized. | Logging standard aspirations for `routeVisibility`; error-handling reviewability. | High effort, medium-to-high risk (may require behavior changes). |
| 20 | Harden Podman deployments with least-privilege container flags. | API container runs as non-root `nodeuser`; deploy does not set read-only rootfs, dropped capabilities, `no-new-privileges`, or resource limits. | CI/CD container safeguards section. | High effort, high risk (writable paths under rootless Podman must be validated). |

## Suggested first pass

Start with **1–5** (documentation links, test constitution sync, README index, testing.env operator docs, credential loader precedence). These align the repo with the latest `../docs` guidance without changing API semantics.

Next track (**6–13**): TLS trust on main, supply-chain pins, webhook error and body limits, diagnostic endpoint policy, rate limits, slimmer images.

Defer **16–20** until endpoint fallback behavior, Vault credentials, SDK packaging, route policy, and container flags can be tested on both **development** and **main** hosts.

## Item 36 — Performance test classification (gate vs metric)

Phase B complete. Performance tests use two tags on the same runs:

| Tag | Blocks deploy? | Purpose |
| --- | --- | --- |
| `@perf-gate` | **Yes** | Correctness + architectural invariants |
| `@perf-metric` | **No** | Latency reporting vs `SPEC_PERF_*` targets |

**`@perf-gate` must pass:** steady poll all-200 + renewal; holanonce burst all-200 / no 429/5xx / 0 NEAR RPC; chain read ratio ≤ 0.10; login error budget; session lifetime poll.

**`@perf-metric` report only:** p50/p95/max vs targets (`pass` / `warn` / `fail`). Steady poll emits `s2_non_renewal_p95`, `s2_renewal_p95`, `s2_all_polls_p95`. `fetch failed` / HTTP 502 → **infra abort**, not perf regression.

Implementation: `src/test-modules/performance-slo.js`, `src/test-modules/perf-slo-utils.js`, `test-rodit-constitution.md` § Performance SLOs. Suite summary logs `gateFailures` (block deploy) vs `metricWarnings` (log only).

## Review notes

- Static review only (no runtime penetration test or host permission audit).
- `npm audit --omit=dev` currently reports **0 vulnerabilities** (2026-05-21).
- `.near-credentials/` is gitignored and not present in the workspace; keep verifying no credential JSON is committed.
- Health checks in deploy remain **non-blocking** per CI/CD standard; test suite outcomes must not fail the workflow.
