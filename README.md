# api-test-scaffold

Client test API service: webhook handling, deployment-time test orchestration, and RODiT SDK integration

## Branches and what they test

Each branch deploys (or is intended to deploy) the **same test harness** with a different `NODE_ENV`, config file (`config/${NODE_ENV}.json`), and nginx profile. The harness hits live API endpoints and validates behavior against pinned OpenAPI contracts and [`test-constitution.md`](test-constitution.md) gates.

| Branch | Deploy target | Auto-deploy on push | Primary API under test | OpenAPI contract |
| --- | --- | --- | --- | --- |
| **main** | `webhook.discernible.io` | Yes | IdentyClaw **home** — `https://api.identyclaw.com` (default when `API_ENDPOINT` is unset) | `api-docs/target-swagger.json` |
| **development** | `webhook.dihola.io` | Yes | Same home default as **main** | `api-docs/target-swagger.json` |
| **slc** | `webhook.discernible.io` (manual / `workflow_dispatch` only) | No | SLC game API — `https://slcapi.discernible.io:9443` | `api-docs/slc-swagger.json` |

**main** and **development** also exercise a **federated peer** login surface via `API_DEFAULT_OPTIONS.FEDERATED_LOGIN_API_ENDPOINT` (`https://slc.discernible.io:8443` by default). The `authenticationComprehensive` suite performs dual-target login: home first, then `login_server({ apiEndpoint })` against that peer and probes `GET /api/token/claims` per `api-docs/federated-swagger.json`. Peer JWTs are not interchangeable with home JWTs.

### Enabled test suites by branch

Suite names map to modules under `src/test-modules/` (see `src/test-system.js`).

| Suite | **main** | **development** | **slc** |
| --- | :---: | :---: | :---: |
| `authenticationComprehensive` | ✓ | ✓ | ✓ |
| `schemaDocumentation` | ✓ | ✓ | — |
| `authentication` | — | ✓ | ✓ |
| `contentType` | — | ✓ | — |
| `errorHandling` | — | ✓ | ✓ |
| `holaVerificationCoverage` | — | ✓ | — |
| `identyclawApi` | — | ✓ | ✓ |
| `integration` | — | ✓ | — |
| `mcp` | — | ✓ | ✓ |
| `metrics` | — | ✓ | ✓ |
| `policyDocuments` | — | ✓ | — |
| `rateLimiting` | — | ✓ | — |
| `sdkInfrastructure` | — | ✓ | ✓ |
| `security` | — | ✓ | — |
| `sessionManagement` | — | ✓ | ✓ |
| `sessionLifetime` | — | ✓ | — |
| `performanceSlo` | — | ✓ | — |
| `subagentAuthorization` | — | ✓ | — |
| `webhooks` | — | ✓ | — |
| `stressTests` | — | ✓ | — |
| `slcApi` | — | — | ✓ |

On **main**, every suite not listed above is named in `EXCLUDED_TESTS` so the production gate stays narrow. **development** runs the full home + federated matrix with no exclusions. **slc** enables game-flow coverage (`slcApi`: lobby join/start/play, contests, CRUDA/home probes against the SLC swagger) and excludes IdentyClaw-home-only cases that do not apply to `slcapi.discernible.io`.

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
| [`test-constitution.md`](test-constitution.md) | Rules for the deployment-time API test suite (includes `SPEC_PERF_*` gates) |
| [`../docs/test-constitution.md`](../docs/test-constitution.md) | Sibling docs index entry for the test constitution |
