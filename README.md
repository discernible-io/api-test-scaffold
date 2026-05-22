# clienttest-idc

Client test API service: webhook handling, deployment-time test orchestration, and RODiT SDK integration.

## Documentation in this repository

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
| [`../docs/test-constitution.md`](../docs/test-constitution.md) | Rules for the deployment-time API test suite |
