# Multi-Environment Deployment Setup

This document outlines operator setup for `clienttestapi-rodit` using the GHCR + Podman pipeline in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Full standard: [`docs/cicd-deployment-standard.md`](docs/cicd-deployment-standard.md).

## Overview

| Branch | Server secrets | Hostname (TLS + health) | `NODE_ENV` (config file) |
| --- | --- | --- | --- |
| `development` | `SSH_*_DEVELOPMENT` (legacy `SSH_*_DEV` also accepted) | `webhook.dihola.io` | `development` → `config/development.json` |
| `main` | `SSH_*_MAIN` | `webhook.discernible.io` | `main` → `config/main.json` |

**Host path:** `~/clienttestapi-app` · **Pod:** `clienttestapi-pod` · **Port:** `7443`

## Required GitHub Secrets

**Settings → Secrets and variables → Actions**

### Production (`main` branch)

- `SSH_HOST_MAIN`
- `SSH_USER_MAIN`
- `SSH_PRIVATE_KEY_MAIN`
- `SSH_KNOWN_HOSTS_MAIN` — output of `ssh-keyscan -H <same-as-SSH_HOST_MAIN>`

### Development (`development` branch)

- `SSH_HOST_DEVELOPMENT` (or legacy `SSH_HOST_DEV`)
- `SSH_USER_DEVELOPMENT` (or legacy `SSH_USER_DEV`)
- `SSH_PRIVATE_KEY_DEVELOPMENT` (or legacy `SSH_PRIVATE_KEY_DEV`)
- `SSH_KNOWN_HOSTS_DEVELOPMENT` (or legacy `SSH_KNOWN_HOSTS_DEV`)

### Shared

- `GHCR_PULL_TOKEN` — classic PAT with `read:packages` (host `podman login` only; CI push uses built-in `GITHUB_TOKEN`)

Non-secret settings belong in committed `config/development.json` and `config/main.json`. Runtime secrets belong in host `~/clienttestapi-app/secrets/secrets.env` only.

## Host preparation (each server)

```bash
mkdir -p ~/clienttestapi-app/{certs,logs,data,nginx,secrets}
chmod 750 ~/clienttestapi-app/secrets
chmod 711 ~/clienttestapi-app/certs

# secrets.env — see docs/configuration-standard.md
nano ~/clienttestapi-app/secrets/secrets.env
chmod 644 ~/clienttestapi-app/secrets/secrets.env
```

**TLS:** install `fullchain.pem` and `privkey.pem` under `~/clienttestapi-app/certs/` for the environment hostname (`webhook.dihola.io` on dev, `webhook.discernible.io` on prod). On shared infra hosts, use [`infra`](../../infra) `install-certs-to-apps.sh`.

**Typical `secrets.env` keys:** `LOKI_BASIC_AUTH`, `NEAR_RPC_URL`, `NEAR_CREDENTIALS_JSON_B64` (single line; `base64 -w0` on GNU), `VAULT_ROLE_ID`, `VAULT_SECRET_ID`.

## Workflow architecture

1. **`build-images`** — `docker/build-push-action@v6` pushes to GHCR:
   - `ghcr.io/<owner>/<repo>/clienttestapi-api:<sha>`
   - `ghcr.io/<owner>/<repo>/clienttestapi-nginx:<sha>` (nginx config selected by branch via `NODE_ENV` build-arg)
2. **`test-and-deploy`** — SSH to target host, `podman login` with `GHCR_PULL_TOKEN`, pull images by SHA, recreate pod, HTTPS health check on `/health`.

No rsync, no `podman build` on the host, no secrets passed from GitHub Actions (except GHCR pull token).

## Local deploy (same layout as CI)

```bash
chmod +x scripts/deploy-local-podman.sh
./scripts/deploy-local-podman.sh
TARGET=main ./scripts/deploy-local-podman.sh
```

Requires `~/clienttestapi-app/secrets/secrets.env` and TLS PEMs on the host.

## Verification checklist

- [ ] All `SSH_*_MAIN` and `SSH_*_DEVELOPMENT` (or `*_DEV`) secrets created
- [ ] `GHCR_PULL_TOKEN` created
- [ ] `~/clienttestapi-app/secrets/secrets.env` on each host (dev credentials on dev host only)
- [ ] TLS PEMs match branch hostname
- [ ] Push to `development` → dev server; push to `main` → prod server
- [ ] `curl -sk https://webhook.<env-domain>:7443/health` returns JSON with `"status":"healthy"`

## Troubleshooting

| Issue | Fix |
| --- | --- |
| `GHCR_PULL_TOKEN` missing | Add PAT with `read:packages` |
| Wrong server | Check secret names and branch (`main` vs `development`) |
| `permission denied` on `secrets.env` | `chmod 755 ~/clienttestapi-app/secrets` and `chmod 644 secrets.env` |
| nginx TLS permission denied | Deploy workflow runs `podman unshare chown 101:101` on PEMs; ensure PEMs exist first |
| Health check fails from runner | Containers may still be up; verify with local curl or `scripts/deploy-local-podman.sh` |
| Old image path | Images are now `ghcr.io/<owner>/<repo>/clienttestapi-api` (not `ghcr.io/<owner>/clienttestapi/api`) |

## References

- [`docs/cicd-deployment-standard.md`](docs/cicd-deployment-standard.md)
- [`docs/configuration-standard.md`](docs/configuration-standard.md)
- Sister repo reference: `../signsanctum-rodit/.github/workflows/deploy.yml`
