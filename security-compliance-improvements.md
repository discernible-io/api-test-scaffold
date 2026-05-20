# Security and Compliance Improvement Backlog

This backlog lists security and compliance improvements identified from a static review of this repository against the standards in `../docs`. It is ordered from lowest implementation effort and rollout risk to highest. Some high-urgency issues appear later because the safe remediation includes credential rotation, deployment coordination, or behavior changes.

## Reference Standards

- `../docs/configuration-standard.md`
- `../docs/logging-standard.md`
- `../docs/error-handling-standard.md`
- `../docs/cicd-deployment-standard.md`
- `../docs/allowed-fallback-standard.md`
- `../docs/test-constitution.md`
- `../docs/documentation-standard.md`
- `../docs/vocabulary-standard.md`

## Prioritized Improvements

| Order | Improvement | Evidence in repo | Standards alignment | Effort / risk |
| --- | --- | --- | --- | --- |
| 6 | Fix and expand `config/custom-environment-variables.json` mappings for security-critical keys. | The mapping contains `PERFORMANCEx_LOAD_THRESHOLDS_CRITICAL` and does not map several SDK security options such as `SECURITY_OPTIONS.SESSION_SECRET`, `SECURITY_OPTIONS.WEBHOOK_TLS_SKIP_VERIFY`, `SECURITY_OPTIONS.BYPASS_WEBHOOK_VERIFICATION`, and `SECURITY_OPTIONS.RELAXED_SESSION_VALIDATION`. | Supports the configuration standard requirement that operator-facing secrets and runtime knobs have stable environment mappings. | Low-to-medium effort, medium risk due to deployment env updates. |
| 7 | Replace fallback `SESSION_SECRET` with a required runtime secret in main and validate against the placeholder. | SDK fallback defaults include `SECURITY_OPTIONS.SESSION_SECRET: "HMAC-session-secret-is-not-set"` and validation only rejects empty values. | Keeps secrets in host `secrets/secrets.env` and prevents insecure defaults from silently reaching runtime. | Medium effort, medium risk because deployments need a new secret. |
| 8 | Standardize `src/app.js` API errors through `sendError()` and the compact error envelope. | `src/app.js` still returns direct payloads such as `{ error: event.error }`, `{ error: error.message }`, and `{ error: 'Internal Server Error', requestId }`. | Aligns with the error-handling standard: `error.code`, `error.message`, `requestId`, and `timestamp`. | Medium effort, medium risk for clients or tests depending on legacy shapes. |
| 9 | Avoid returning raw exception messages from webhook handlers. | `handleIncomingWebhook` returns `res.status(500).json({ error: error.message })`. | Supports the error-handling and logging standards by keeping detailed causes in logs while returning controlled API error codes. | Medium effort, medium risk for test expectations. |
| 10 | Add explicit request body size limits for webhook raw-body parsing and general JSON parsing. | `createRawBodyParser()` concatenates chunks into memory without an upper bound before `JSON.parse`. | Improves API hardening and supports test-constitution negative cases for oversized or corrupt payloads. | Medium effort, low-to-medium risk if legitimate webhook payloads are small and a limit is documented. |
| 11 | Apply or document rate limiting at the API entry points that should be protected. | A rate-limit middleware exists in `sdk/lib/middleware/ratelimitmw.js`, but `src/app.js` does not mount it globally or on webhook/test endpoints. | Supports security controls and test coverage for rate-limit behavior. | Medium effort, medium risk because limits must be tuned to webhook/test traffic. |
| 12 | Disable or gate diagnostic endpoints in main. | `/api/test/logging` is publicly registered and intentionally emits logs, including an `Error` object. | Reduces unnecessary main surface area and log noise; aligns with logging minimization and route visibility goals. | Medium effort, medium risk if external health checks or tests use this endpoint. |
| 13 | Add CI gates for `npm ci`, tests, `npm audit --omit=dev`, and a secret scan before image build. | The workflow builds and pushes images without a dependency audit or explicit test gate. Local `npm audit --omit=dev` currently reports 8 vulnerabilities: 2 low, 1 moderate, and 5 high, mainly through the `sqlite3` dependency chain. | Aligns with the CI/CD standard's build validation goals and the test constitution's deployment-time test expectations. | Medium effort, medium risk because current builds may start failing. |
| 14 | Upgrade or replace vulnerable dependencies, especially the `sqlite3` chain that pulls vulnerable `tar`, `cacache`, `node-gyp`, and `@tootallnate/once`. | `npm audit --omit=dev` recommends a breaking upgrade to `sqlite3@6.0.1` for high-severity `tar` advisories. | Improves supply-chain posture and supports reproducible, auditable deployments. | Medium effort, medium-to-high risk because the suggested fix is breaking. |
| 15 | Use `npm ci --omit=dev` in Docker builds and avoid carrying local dependency trees into images. | `api.Dockerfile` uses `npm install --production` and then `COPY . .`; the workspace contains `sdk/node_modules`. There is no `.dockerignore` visible in the repo. | Supports reproducible builds and the CI/CD standard's repo-as-build-source model without accidental local artifacts. | Medium effort, medium risk due to image build behavior changes. |
| 16 | Add a `.dockerignore` that excludes `.git`, `node_modules`, `.near-credentials`, logs, local data, certs, and secrets from Docker build context. | `api.Dockerfile` copies the full repository into the API image. Sensitive and bulky paths exist in the workspace. | Reinforces the CI/CD standard's separation of repo files from host runtime secrets and TLS material. | Medium effort, low-to-medium risk. |
| 17 | Pin and verify downloaded build-time binaries. | `api.Dockerfile` uses `ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini-static /tini` without checksum verification. | Improves supply-chain integrity for container builds. | Medium effort, low-to-medium risk. |
| 18 | Remove committed `.near-credentials/` files, add `.near-credentials/` to `.gitignore`, and rotate the affected keys. | The repository contains `.near-credentials/mainnet/*.json` files. `../docs/test-constitution.md` says these are real Ed25519 key pairs. | Directly aligns with the configuration and CI/CD standards: private keys belong in host secrets or vault-backed stores, not git. | Medium effort, high operational risk because key rotation and test credential updates must be coordinated. |
| 19 | Move main credentials to vault-backed storage and reserve env/file credentials for development or test-only use. | `config/main.json` sets `"RODIT_NEAR_CREDENTIALS_SOURCE": "env"` while SDK supports `vault` and has Vault config keys. | Stronger compliance with secret-management guidance and reduces blast radius of env-file exposure. | High effort, medium-to-high risk due to Vault provisioning and rollout. |
| 20 | Decide whether the SDK is vendored or package-managed, then align code and documentation to one model. | `src/app.js` imports `../sdk`, while the standards mention importing `@rodit/rodit-auth-be`; the repo also contains `sdk/package.json` and `sdk/node_modules`. | Reduces compliance drift in configuration, logging, and error-handling standards that currently reference the package model. | High effort, medium risk because import paths, packaging, and deployment image contents may change. |
| 21 | Convert fallback behavior in test/runtime resolution to explicit, logged, non-overlapping paths. | `src/test-system.js` has multiple endpoint resolution fallbacks; SDK config has broad fallback defaults; some fallback logs are debug-level only. | Aligns with the allowed-fallback standard: allowed fallbacks must be bounded, observable, and non-overlapping. | High effort, medium risk because test execution and diagnostics may change. |
| 22 | Add route visibility and authentication policy documentation for each endpoint, then enforce it in code. | Public endpoints include `/health`, `/api/test/logging`, `/webhook`, `/hooks/wake`, and `/hooks/agent`; route visibility is not centrally documented. | Supports logging standard aspirations for `routeVisibility` and improves reviewability of authentication exceptions. | High effort, medium-to-high risk because it may require endpoint behavior changes. |
| 23 | Harden runtime containers with least-privilege flags in deployment. | Containers run as non-root users, but deployment does not add flags such as read-only root filesystem, dropped capabilities, `no-new-privileges`, or explicit resource limits. | Extends the CI/CD standard's container deployment safeguards. | High effort, high risk because writable paths and rootless Podman behavior must be tested carefully. |

## Suggested First Pass

Start with items 1 through 6 because they mostly align existing behavior with the standards without changing endpoint semantics. In parallel, treat item 18 as urgent triage: even though full remediation is higher risk, the credential exposure should be assessed immediately and rotated if those keys have ever been valid outside a disposable test context.

After that, group work into three tracks:

- Logging and error contract: items 3, 8, 9, and 22.
- Configuration and secret handling: items 4, 5, 6, 7, 18, and 19.
- CI/CD and supply chain: items 13, 14, 15, 16, 17, and 23.

## Review Notes

This review was static. It did not include runtime probing, penetration testing, or validation of deployed host permissions. Dependency findings came from `npm audit --omit=dev` in both the root package and `sdk/`, which currently report the same vulnerability set.
