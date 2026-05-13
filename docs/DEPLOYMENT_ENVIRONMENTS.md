# Deployment Environments

This project currently deploys through a single production workflow. This document clarifies the current state and how to evolve to a true dev/prod separation later.

## Current deployment topology

| Environment | Branch trigger | Workflow | Host path | Pod name | External port | NODE_ENV |
| --- | --- | --- | --- | --- | --- | --- |
| Production | `main` | `.github/workflows/deploy.yml` | `~/idclawserver-app` | `idclawserver-pod` | `8443` | `production` |

## How to use the current pipeline

### Normal release flow

- Merge approved changes to `main`.
- Deployment runs automatically via `.github/workflows/deploy.yml`.
- Validate service health and endpoint reachability after rollout.

### Manual deploys (specific commit)

The workflow supports manual execution (`workflow_dispatch`) with `commit_sha`.

- Use this to redeploy a known good commit.
- Use this for controlled roll-forward after a failed release.

## Required GitHub configuration

- Secrets: `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `NEAR_RPC_URL`, `SECURITY_OPTIONS_SESSION_SECRET`, `LOKI_BASIC_AUTH`, `NEAR_CREDENTIALS_JSON_B64`
- Variables: `LOKI_URL`, `NEAR_CREDENTIALS_FILE_PATH`, `SECURITY_OPTIONS_WEBHOOK_TLS_SKIP_VERIFY`, `SECURITY_OPTIONS_BYPASS_WEBHOOK_VERIFICATION`, `RATE_LIMIT_PUBLIC_ENABLED`, `RATE_LIMIT_PUBLIC_MAX`, `RATE_LIMIT_PUBLIC_WINDOW_MINUTES`

## CI/CD output policy

- Pipeline logs are intentionally lean and focused on deploy-critical checks.
- Stale debug and diagnostic probes were removed.
- Deep diagnostics should be added temporarily only during incident response, then removed again.

## Future: meaningful dev/prod split

Using separate names/paths on the same host helps avoid collisions, but both environments still share one failure domain. For a meaningful split, use separate hosts:

- production host (current)
- development host (new)

Then map each environment to its own workflow, host credentials, and DNS endpoint.
