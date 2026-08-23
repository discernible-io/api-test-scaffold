# api-test-scaffold

Client test API service: webhook handling, deployment-time test orchestration, and RODiT SDK integration

## Branches and what they test

The three branches run the **same test harness** with a different `NODE_ENV`, config file (`config/${NODE_ENV}.json`), and nginx profile. Each run hits live API endpoints and checks behavior against a pinned OpenAPI contract and [`test-rodit-constitution.md`](test-rodit-constitution.md) gates

In one line:

- **main** — thin production gate: home auth + schema, plus federated login
- **development** — full home + federated matrix (everything main skips)
- **slc** — Synthetics' Last Cradle **game** API, not IdentyClaw home

Keep this section identical on **main**, **development**, and **slc** so the branch map does not drift.

### Purpose of each branch

**main** is the always-on production smoke check. A push deploys to `webhook.discernible.io` and targets IdentyClaw **home** (`https://api.identyclaw.com` when `API_ENDPOINT` is unset) using `api-docs/target-swagger.json` and the production NEAR contract. Only `authenticationComprehensive` and `schemaDocumentation` run; every other suite is named in `EXCLUDED_TESTS` so load tests, rate limits, game flows, and deep home coverage cannot block a production deploy.

**development** is the wide pre-production suite against the **same home API**, not a different product. A push deploys to `webhook.dihola.io`. `API_ENDPOINT` is still unset (home default), but the NEAR contract is the development contract, logging is debug, and webhook TLS verify is relaxed. Every home suite is enabled and `EXCLUDED_TESTS` is empty, including stress, security, sessions, SLOs, webhooks, HOLA, and MCP.

**slc** is a **different product target**: `https://slcapi.discernible.io:9443` against `api-docs/slc-swagger.json`. It does not auto-deploy on push, because that would overwrite the main host (`webhook.discernible.io`); deploy with `TARGET=slc` locally or `workflow_dispatch` from this branch. Enabled suites are game flow (`slcApi`: lobby join/start/play, contests, CRUDA/home probes), basic `authentication`, and `sdkInfrastructure`. IdentyClaw-home-only suites (HOLA, policy docs, home rate-limit/security/webhook/SLO, federated dual-login) stay off. `EXCLUDED_TESTS` also names `testMeIdentityEndpoint` and `testAutomaticTokenRenewal`, which do not apply to this API.

**main** and **development** also hit a **federated peer** via `API_DEFAULT_OPTIONS.FEDERATED_LOGIN_API_ENDPOINT` (`https://slc.discernible.io:8443` by default). `authenticationComprehensive` logs into home first, then `login_server({ apiEndpoint })` against that peer and probes `GET /api/token/claims` per `api-docs/federated-swagger.json`. Peer JWTs are not interchangeable with home JWTs. **slc** does not configure that peer; it tests `slcapi` directly.

### Deploy targets and APIs

| Branch | Deploy target | Auto-deploy on push | Primary API under test | OpenAPI contract |
| --- | --- | --- | --- | --- |
| **main** | `webhook.discernible.io` | Yes | IdentyClaw **home** — `https://api.identyclaw.com` (default when `API_ENDPOINT` is unset) | `api-docs/target-swagger.json` |
| **development** | `webhook.dihola.io` | Yes | Same home default as **main** | `api-docs/target-swagger.json` |
| **slc** | `webhook.discernible.io` (manual / `workflow_dispatch` only) | No | SLC game API — `https://slcapi.discernible.io:9443` | `api-docs/slc-swagger.json` |

### Enabled test suites by branch

Suite names map to modules under `src/test-modules/` (see `src/test-system.js`). Checkmarks match `ENABLED_TEST_SUITES` in each branch config, not an aspirational full matrix.

| Suite | What it covers | **main** | **development** | **slc** |
| --- | --- | :---: | :---: | :---: |
| `authenticationComprehensive` | All login methods and dual-target federated login | ✓ | ✓ | — |
| `schemaDocumentation` | Live API vs pinned OpenAPI/schema docs | ✓ | ✓ | — |
| `authentication` | Basic login and token probe | — | ✓ | ✓ |
| `contentType` | Content-Type / media-type handling | — | ✓ | — |
| `errorHandling` | Error response shape | — | ✓ | — |
| `holaVerificationCoverage` | HOLA nonce and verification | — | ✓ | — |
| `identyclawApi` | Core IdentyClaw home API | — | ✓ | — |
| `integration` | DID-web resolution | — | ✓ | — |
| `mcp` | MCP endpoints | — | ✓ | — |
| `metrics` | Metrics endpoints | — | ✓ | — |
| `policyDocuments` | Policy documents | — | ✓ | — |
| `rateLimiting` | Rate-limit behavior | — | ✓ | — |
| `sdkInfrastructure` | SDK internals used by the harness | — | ✓ | ✓ |
| `security` | Security / negative protocol cases | — | ✓ | — |
| `sessionManagement` | Session handling | — | ✓ | — |
| `sessionLifetime` | Session expiry and renewal | — | ✓ | — |
| `performanceSlo` | Performance SLO gates | — | ✓ | — |
| `subagentAuthorization` | Subagent authorization | — | ✓ | — |
| `webhooks` | Webhook delivery and signatures | — | ✓ | — |
| `stressTests` | Autocannon load (SDK phase only) | — | ✓ | — |
| `slcApi` | SLC game flow (join/start/play, contests, CRUDA) | — | — | ✓ |

### Branch-specific configuration

| Setting | **main** | **development** | **slc** |
| --- | --- | --- | --- |
| Config file | `config/main.json` | `config/development.json` | `config/slc.json` |
| NEAR contract | `genaaaa-identyclaw-com.near` | `2026v2-identyclaw-com.near` | `genaaaa-identyclaw-com.near` |
| `API_ENDPOINT` | unset → home default | unset → home default | `https://slcapi.discernible.io:9443` |
| Federated peer | `https://slc.discernible.io:8443` | `https://slc.discernible.io:8443` | — |

Deploy wiring lives in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). **slc** is omitted from push deploy so it does not overwrite the main host; use `TARGET=slc` locally or `workflow_dispatch` from the **slc** branch.

## Documentation in this repository.

| Document | Summary |
| --- | --- |
| [`security-compliance-improvements.md`](security-compliance-improvements.md) | Prioritized security and compliance backlog from static review against external standards |
| [`sdk/README.md`](sdk/README.md) | RODiT Authentication SDK: setup, configuration, API reference, and troubleshooting |
| [`sdk/CHANGELOG.md`](sdk/CHANGELOG.md) | SDK version history and breaking changes |
| [`api-docs/testhola-past-run-teaching-snapshot.md`](api-docs/testhola-past-run-teaching-snapshot.md) | Teaching snapshot from a past Hola test run |

## External standards

Operational standards live in the sibling [`docs`](../docs/) tree (paths relative to this repository root).

| Document | Summary |
| --- | --- |
| [`../docs/README.md`](../docs/README.md) | Index of all standards and guides |
| [`../docs/documentation-standard.md`](../docs/documentation-standard.md) | How documentation is written, indexed, and cross-referenced |
| [`../docs/vocabulary-standard.md`](../docs/vocabulary-standard.md) | Deployment tier terms (**development** / **main**) and naming conventions |
| [`../docs/configuration-standard.md`](../docs/configuration-standard.md) | Config sources, priority order, secrets, and safe logging of settings |
| [`../docs/logging-standard.md`](../docs/logging-standard.md) | Winston/SDK logging patterns, `LOG_LEVEL`, structured context, and Loki |
| [`../docs/error-handling-standard.md`](../docs/error-handling-standard.md) | API error response shape and migration toward SDK `sendError` |
| [`../docs/allowed-fallback-standard.md`](../docs/allowed-fallback-standard.md) | Permitted config and RPC fallbacks; logging and mutual-exclusivity rules |
| [`../docs/cicd-deployment-standard.md`](../docs/cicd-deployment-standard.md) | GHCR builds, Podman deploy, host secrets/TLS, and multi-environment CI/CD |
| [`test-rodit-constitution.md`](test-rodit-constitution.md) | Local RODiT rules for the deployment-time API test suite (includes `SPEC_PERF_*` gates) |
| [`../docs/test-constitution.md`](../docs/test-constitution.md) | Sibling docs index entry for the shared test constitution |
