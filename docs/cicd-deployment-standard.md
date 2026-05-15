---
title: CI/CD Deployment Standard
date: 2026-05-14
author: Cascade AI Assistant
status: Implemented & Validated
---

## Current Deployment Topology

Deployments use one workflow (`.github/workflows/deploy.yml`) with branch-selected SSH targets:

| Environment | Branch trigger | Workflow | Host path | Pod name | External port | NODE_ENV |
| --- | --- | --- | --- | --- | --- | --- |
| Development | `development` | `.github/workflows/deploy.yml` | `~/<app-dir>` | `<service>-pod` | `<port>` | `development` |
| Production | `main` | `.github/workflows/deploy.yml` | `~/<app-dir>` | `<service>-pod` | `<port>` | `main` |

**This repo (clienttestapi):** `~/clienttestapi-app` · `clienttestapi-pod` · `7443` on each target host (dev and prod may be different machines; same `APP_DIR` name on both).

**Example (SignSanctum):** `~/signsanctum-app` · `signsanctum-pod` · `1443` — same pattern, different names and port.

**Before first deploy:** provision TLS and `secrets/secrets.env` on the host — see [Host runtime: secrets and TLS certificates](#host-runtime-secrets-and-tls-certificates). CI pulls images and normalizes cert ownership; it does not create secrets or issue certificates.

## Overview

This guide documents the migration from local Podman image builds to GitHub Container Registry (GHCR)-based builds and deployments. It is designed to be reusable across multiple repositories with similar Podman-based deployment architectures.

> **How to read this document:** Generic placeholders appear first (e.g., `<app-dir>`, `<service>`, `<port>`). **This repo (clienttestapi)** values match [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) in this repository. **Example (SignSanctum)** shows the same pattern as [`signsanctum-rodit`](../../signsanctum-rodit) — use it for comparison, not as clienttestapi settings.

## Goals

- Move image builds off the production host and into GitHub Actions CI.
- Publish container images to GitHub Container Registry (GHCR) with immutable, versioned tags.
- Prevent runtime secrets from crossing the network during deployments by storing them on the server.
- Preserve the existing Podman-based runtime on the target host while minimizing changes to the host filesystem layout.
- Enable reproducible, auditable deployments with full version history.

## Host runtime: secrets and TLS certificates

Operators provision **secrets** and **TLS material on the deployment host** before (or between) CI runs. GitHub Actions builds images and recreates the Podman pod; it does not copy PEM files or secret values over SSH.

### Git repository vs host application directory

| Layer | Generic | This repo (clienttestapi) | Example (SignSanctum) |
| --- | --- | --- | --- |
| Source (clone, PRs, CI build context) | `<service>-rodit` repository | `clienttestapi-rodit` | `signsanctum-rodit` |
| Runtime data on the SSH host | `~/<app-dir>/` | `~/clienttestapi-app/` | `~/signsanctum-app/` |

Keep `certs/`, `logs/`, `data/`, and `secrets/` under **`~/<app-dir>/` only**. Do not commit PEMs or `secrets.env` to the git repository (see [`.gitignore`](../.gitignore) patterns for `*.pem` and `secrets.env`).

### TLS certificates

**Generic**

1. Point DNS **A records** for the environment hostname at the deployment host.
2. Issue or renew a certificate (for example Let's Encrypt) for that hostname.
3. Install **`fullchain.pem`** and **`privkey.pem`** into `~/<app-dir>/certs/`.
4. Align three names: nginx `server_name`, workflow `DOMAIN` (health check), and the certificate **CN/SAN**.
5. On each deploy (or before starting nginx), apply rootless ownership: `podman unshare chown 101:101` on PEMs, **600** on private keys, **644** on public material, **711** on `certs/` — see [Rootless Podman, TLS sidecar, and env-file learnings](#rootless-podman-tls-sidecar-and-env-file-learnings).

**This repo (shared host tooling)**

On servers that use the sibling [`infra`](../../infra) repository:

```bash
cd /path/to/infra
sudo ./generate_letsencrypt_cert.sh <hostname> <contact-email>
sudo ./install-certs-to-apps.sh
./verify-certs-in-apps.sh
```

`install-certs-to-apps.sh` copies from `/etc/letsencrypt/live/<hostname>/` into each app's `certs/` directory.

| Host directory | Certificate hostname (`CN`) | Repo |
| --- | --- | --- |
| `~/clienttestapi-app` | `webhook.dihola.io` (dev) / `webhook.discernible.io` (prod) | **This repo (clienttestapi)** |
| `~/signsanctum-app` | `signsanctum.dihola.io` (dev) / `signsanctum.discernible.io` (prod) | **Example (SignSanctum)** |

Issue and install for the hostname that matches the branch you deploy (`development` vs `main`).

After installing PEMs, restart or redeploy so nginx loads them (`sudo ./restart.sh` from `infra`, or push to trigger `.github/workflows/deploy.yml`).

**Domain alignment**

| Environment | Branch | Nginx `server_name` | Workflow `DOMAIN` |
| --- | --- | --- | --- |
| Development | `development` | `webhook.dihola.io` | `webhook.dihola.io` |
| Production | `main` | `webhook.discernible.io` | `webhook.discernible.io` |

**Example (SignSanctum):** `signsanctum.dihola.io` / `signsanctum.discernible.io` with the same branch mapping.

Change nginx configs, `DOMAIN` in `deploy.yml`, and DNS/cert issuance together when renaming a host.

Further detail: [`infra/CERTIFICATE-MANAGEMENT.md`](../../infra/CERTIFICATE-MANAGEMENT.md).

### Runtime secrets (`secrets.env`)

**Generic**

1. Create `~/<app-dir>/secrets/secrets.env` on the **target host** for that environment (development host vs production host).
2. Put **runtime secrets only** in the file (tokens, credentials, base64 key blobs). Non-secret settings belong in committed `config/{NODE_ENV}.json` — see [`configuration-standard.md`](configuration-standard.md).
3. Map keys through `config/custom-environment-variables.json` so the API reads them via `@rodit/rodit-auth-be` `config.get`.
4. Wire the deploy workflow: `podman run --env-file ~/<app-dir>/secrets/secrets.env`.
5. Keep each `KEY=value` on **one line** (especially `*_JSON_B64` values).

**Permissions (rootless Podman deploy user)**

| Path | Mode | Notes |
| --- | --- | --- |
| `~/<app-dir>/secrets/` | `750` | Created by deploy workflow (`chmod 750`) |
| `~/<app-dir>/secrets/secrets.env` | `644` | Must be readable by the API container user when using `--env-file` |
| PEM private key | `600` after `podman unshare chown 101:101` | Applied in deploy workflow before nginx starts |
| PEM certificate chain | `644` after `podman unshare chown 101:101` | Same |

If the API logs `permission denied` on `secrets.env`, set directory **755** and file **644** as in [Permission Denied on secrets.env](#permission-denied-on-secretsenv). Avoid `chmod 640` with `root:root` unless you confirm the deploy user's containers can still read the file.

**This repo (clienttestapi) — keys in `secrets.env`**

See [`config/custom-environment-variables.json`](../config/custom-environment-variables.json) and [`configuration-standard.md`](configuration-standard.md). Common entries include `LOKI_BASIC_AUTH`, `NEAR_CREDENTIALS_JSON_B64` (single-line; `base64 -w0` on GNU systems), `NEAR_RPC_URL`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`.

```bash
nano ~/clienttestapi-app/secrets/secrets.env
chmod 644 ~/clienttestapi-app/secrets/secrets.env
```

**Example (SignSanctum):** same layout under `~/signsanctum-app/secrets/secrets.env` with that service's mapped keys.

Use **development** credentials on the development server's file and **production** credentials on the production server. The workflow never copies this file from GitHub.

### What CI provisions vs what operators provision

| Item | Provisioned by CI / workflow | Provisioned on host by operator |
| --- | --- | --- |
| Container images | Yes (GHCR pull) | — |
| `certs/fullchain.pem`, `certs/privkey.pem` | — | Yes (TLS issuance + install) |
| `secrets/secrets.env` | — | Yes |
| `config/{NODE_ENV}.json` | Baked into API image at build time | — |
| `podman unshare` ownership on PEMs | Yes (each deploy) | Initial PEMs must exist first |

## Architecture

### Before (Local Build)
- Entire repo rsynced to production host on every deploy.
- Both API and nginx images built locally via `podman build` on the host.
- Images tagged locally only (`idclawserver-image:latest`, `localhost/idclawserver-nginx:latest`).
- Runtime secrets transmitted from GitHub to host via SSH on every deploy.
- No version history; images lost on cleanup.

### After (GHCR Pull)
- Images built in GitHub Actions CI using `docker/build-push-action@v6`.
- Images pushed to GHCR with immutable SHA tags (`ghcr.io/<org>/<repo>/<image>:${{ github.sha }}`).
- Deploy job pulls pre-built images from GHCR and recreates the pod.
- Runtime secrets stored on the host in `~/<app-dir>/secrets/secrets.env` and injected via `--env-file` (never rsynced from CI).
- GitHub only holds the GHCR pull token; other secrets remain on the host.
- Full version history and audit trail in GHCR.

## Implementation Steps

### 1. Refactor GitHub Actions Workflow

**File:** `.github/workflows/deploy.yml`

Split the workflow into two jobs:

#### Job 1: `build-images`
- **Permissions:** `contents: read`, `packages: write`
- **Steps:**
  1. Checkout code.
  2. Set up build environment (Node, Docker Buildx, etc.).
  3. Run tests/validation (e.g., permission map generation).
  4. Authenticate to GHCR using `${{ secrets.GITHUB_TOKEN }}`.
  5. Build and push API image: `docker/build-push-action@v6` with tags `${{ github.sha }}` and `latest` (on main).
  6. Build and push nginx image: same as above.
  7. Output image tags for downstream job.

#### Job 2: `test-and-deploy`
- **Depends on:** `build-images`
- **Permissions:** `contents: read` (SSH key for host access)
- **Steps:**
  1. Install SSH key (`shimataro/ssh-key-action@v2`).
  2. Create required directories on host (`certs`, `logs`, `data`, `nginx`, `secrets`).
  3. Log into GHCR on the host using `GHCR_PULL_TOKEN` secret.
  4. Pull images from GHCR by SHA tag.
  5. Clean up old pod/containers.
  6. Recreate pod and run containers with pulled images.
  7. Verify containers are running and run HTTPS health check.

**Key differences from old workflow:**
- No rsync of repo files.
- No `podman build` on the host.
- Images pulled by specific SHA tag (immutable).
- Secrets passed via env-file, not as `-e KEY=value` arguments.

### 2. Prepare GitHub Actions Secrets

Create a classic personal access token (PAT) with `read:packages` scope:

1. Go to <https://github.com/settings/tokens/new?scopes=read:packages>.
2. Name it (e.g., `idclawserver-ghcr-pull`).
3. Set expiration (recommend 90 days, rotate regularly).
4. Copy the token.
5. In your repo, go to **Settings → Secrets and variables → Actions**.
6. Create a new secret named `GHCR_PULL_TOKEN` and paste the token.

**Note:** The workflow uses `${{ secrets.GITHUB_TOKEN }}` (built-in) for pushing images in CI. The `GHCR_PULL_TOKEN` is only used on the deployment host for pulling.

#### SSH secrets (GitHub repository settings)

Create these in **Settings → Secrets and variables → Actions** (each RODiT service repo has its **own** copy of the values):

| GitHub secret name | Used when |
| --- | --- |
| `SSH_HOST_MAIN` | `main` branch deploy |
| `SSH_USER_MAIN` | `main` branch deploy |
| `SSH_PRIVATE_KEY_MAIN` | `main` branch deploy |
| `SSH_KNOWN_HOSTS_MAIN` | `main` branch deploy |
| `SSH_HOST_DEVELOPMENT` | `development` branch deploy |
| `SSH_USER_DEVELOPMENT` | `development` branch deploy |
| `SSH_PRIVATE_KEY_DEVELOPMENT` | `development` branch deploy |
| `SSH_KNOWN_HOSTS_DEVELOPMENT` | `development` branch deploy |
| `GHCR_PULL_TOKEN` | Both branches (host `podman login`) |

**Do not** create a secret named `SSH_KNOWN_HOSTS`. In `deploy.yml`, `SSH_KNOWN_HOSTS` is a **workflow `env` alias** only:

```yaml
SSH_KNOWN_HOSTS: ${{ github.ref == 'refs/heads/main' && secrets.SSH_KNOWN_HOSTS_MAIN || secrets.SSH_KNOWN_HOSTS_DEVELOPMENT }}
```

The Install SSH key step passes `known_hosts: ${{ env.SSH_KNOWN_HOSTS }}`, which resolves to `SSH_KNOWN_HOSTS_DEVELOPMENT` or `SSH_KNOWN_HOSTS_MAIN` depending on the branch.

**Populate `SSH_KNOWN_HOSTS_*`:** on a machine that can reach the target host, run `ssh-keyscan -H <same-host-as-SSH_HOST_*>` and paste the full output into the matching GitHub secret (no quotes). The host string must match `SSH_HOST_DEVELOPMENT` or `SSH_HOST_MAIN` exactly (IP vs hostname).

### 3. Server Preparation

On **each** deployment host (development and production), complete [Host runtime: secrets and TLS certificates](#host-runtime-secrets-and-tls-certificates) before the first workflow run.

**Quick bootstrap (generic):**

```bash
mkdir -p ~/<app-dir>/{certs,logs,data,nginx,secrets}
chmod 750 ~/<app-dir>/secrets
chmod 711 ~/<app-dir>/certs

# secrets.env — see configuration-standard.md for key list
nano ~/<app-dir>/secrets/secrets.env
chmod 644 ~/<app-dir>/secrets/secrets.env

# TLS — issue for the environment hostname, then install fullchain.pem + privkey.pem under certs/
```

**This repo (clienttestapi):** `~/clienttestapi-app`, development cert `webhook.dihola.io`, production `webhook.discernible.io`, secrets keys in [`configuration-standard.md`](configuration-standard.md).

**Directory structure:**

```
~/<app-dir>/
├── certs/              # fullchain.pem, privkey.pem (operator-provisioned)
├── logs/
├── data/
├── nginx/              # reference only; live config is in the image
└── secrets/
    └── secrets.env     # operator-provisioned; --env-file at runtime
```

### 4. Operational Safeguards (Optional)

Add GitHub environment protection rules for production deployments:

1. Go to **Settings → Environments**.
2. Create a new environment named `production`.
3. Add **Selected branches** filter: `main`.
4. Enable **Required reviewers** and add yourself or a team.
5. (Optional) Update the workflow to use the environment:
   ```yaml
   test-and-deploy:
     needs: build-images
     environment: production
     runs-on: ubuntu-latest
   ```

This ensures deployments require manual approval before running.

### 5. Dry-Run Validation

Trigger the workflow and verify:

1. **In GitHub Actions UI:**
   - `build-images` job completes successfully.
   - Images appear in GHCR with commit SHA tag.
   - `test-and-deploy` job completes without errors.

2. **On the production host:**
   ```bash
   # Check images were pulled
   podman images | grep ghcr.io

   # Check pod and containers
   podman pod ls
   podman ps -a

   # Check container logs
   podman logs <container-name> | tail -20

   # Test the service (adjust endpoint as needed)
   curl -k https://<domain>:<port>/health
   ```

3. **Verify secrets are not exposed:**
   - Check GitHub Actions logs—secrets should not appear in plain text.
   - Confirm `~/<app-dir>/secrets/secrets.env` exists on host with correct permissions.

## Verification Checklist

- [ ] `.github/workflows/deploy.yml` split into `build-images` and `test-and-deploy` jobs.
- [ ] `build-images` job uses `docker/build-push-action@v6` to push to GHCR.
- [ ] `test-and-deploy` job pulls images from GHCR by SHA tag.
- [ ] `GHCR_PULL_TOKEN` secret created and stored in GitHub Actions.
- [ ] `~/<app-dir>/secrets/secrets.env` created on each target host with correct permissions (directory `750`, file `644` for rootless deploy).
- [ ] TLS PEMs in `~/<app-dir>/certs/` for the environment hostname; `verify-certs-in-apps.sh` (or equivalent) passes.
- [ ] Workflow triggered and completed successfully.
- [ ] Images appear in GHCR with commit SHA tag.
- [ ] Containers running on production host.
- [ ] Service responding to health checks.
- [ ] No secrets exposed in GitHub Actions logs.

## Troubleshooting

### Build Job Fails
- Check Docker Buildx setup and authentication to GHCR.
- Verify `docker/build-push-action@v6` syntax and Dockerfile paths.
- Check GitHub Actions logs for build errors.

### Deploy Job Fails
- Verify `GHCR_PULL_TOKEN` is set correctly in GitHub Actions secrets.
- Check SSH key and host connectivity.
- Verify `~/<app-dir>/secrets/secrets.env` exists on host.
- Check `podman login` output for auth errors.
- Verify image exists in GHCR with the expected SHA tag.

### Permission Denied on secrets.env
- **Error:** `permission denied` when reading `/home/.../secrets/secrets.env`
- **Cause:** File or directory permissions are too restrictive.
- **Fix:**
  ```bash
  sudo chmod 755 ~/<app-dir>/secrets
  sudo chmod 644 ~/<app-dir>/secrets/secrets.env
  ```
- **Why:** Containers run as non-root users (e.g., uid 1000) and need to read the env-file. The file must be world-readable (644) and the directory must be executable (755).

### Containers Won't Start
- Check `podman logs <container-name>` for startup errors.
- Verify volume mounts (certs, logs, data) exist on host.
- Verify env-file is readable by the container user.
- Check Podman resource limits and disk space.

### Health Checks Failing
- Verify the service is listening on the expected port.
- Check firewall rules and port mappings.
- Verify environment variables are correctly injected from the env-file.
- Check service logs for configuration or startup errors.
- **Generic:** Treat the health endpoint as healthy only when the **response body** matches what you expect (e.g. contains `healthy`), not merely when `curl` returns any non-empty body—nginx can return a **502** HTML page while the API is still starting. **This repo (clienttestapi):** The workflow health step uses `grep -q healthy` on the `/health` JSON body.

### Rootless Podman, TLS sidecar, and env-file learnings

These patterns apply when the **deploy SSH user runs rootless Podman**, the **nginx image runs as a non-root user** (uid **101** in the official `nginx` Alpine image), TLS is **terminated in the nginx sidecar**, and PEM files are **bind-mounted** from `~/<app-dir>/certs/`.

#### A. `NEAR_CREDENTIALS_JSON_B64` (and similar) in `secrets.env`

| | |
| --- | --- |
| **Generic** | Any large `KEY=value` used with `podman run --env-file` must be **one logical line**. Multi-line “pretty” wrapping breaks parsing; only the first line becomes the variable value. |
| **This repo** | `NEAR_CREDENTIALS_JSON_B64` must be a **single-line** base64 string. If it wraps, the API may log `Unterminated string in JSON at position …` during credential init. Encode with `base64 -w0 < credentials.json` (GNU) to avoid line wraps. |

#### B. TLS private key: host `nginx` group vs `podman unshare`

| | |
| --- | --- |
| **Generic** | Do not assume the Linux host has a UNIX group named `nginx`. The `nginx` user exists **inside the image**; bind mounts are checked using **host inode permissions** and **user-namespace uid/gid mapping**. |
| **This repo** | `sudo chgrp nginx …` fails on RHEL-style hosts with `chgrp: invalid group 'nginx'`. Use **`podman unshare chown 101:101`** on PEM files so ownership matches **container uid 101** in the rootless namespace (host `ls` may show numeric owners such as `524388`—expected). **No** host group named `nginx` is required. |

#### C. TLS directory and file modes (after namespace ownership)

| | |
| --- | --- |
| **Generic** | After `podman unshare chown 101:101` on mounted PEMs, set **private keys** to mode **600** and **public certificate material** to **644**. Use directory mode **711** (`drwx--x--x`) on `certs/` if you want non-owners to **traverse** without **listing** the directory; **755** is also common. The deployment workflow should apply these modes **before** starting the nginx container so every deploy is consistent. |
| **This repo (clienttestapi)** | `.github/workflows/deploy.yml` runs `chmod 711 ~/clienttestapi-app/certs`, then `podman unshare chown`/`chmod` on PEMs before `podman run` **clienttestapi-nginx**. Same logic in [`scripts/deploy-local-podman.sh`](../scripts/deploy-local-podman.sh). |
| **Example (SignSanctum)** | Same steps under `~/signsanctum-app` / **signsanctum-nginx**. |

#### D. “Permission denied” on `privkey.pem` in nginx logs

| | |
| --- | --- |
| **Generic** | `nginx: [emerg] cannot load certificate key "…/privkey.pem": … Permission denied` means the **effective uid** of nginx cannot read the key file or cannot traverse a path component. |
| **This repo** | Fix with the **`podman unshare chown 101:101`** + **600** pattern in (B) and (C), not by creating a host `nginx` group. |

#### E. Brief HTTP 502 right after container start

| | |
| --- | --- |
| **Generic** | If nginx proxies to an API that performs slow startup (external RPC, SDK init), the first requests may return **502** until the upstream listens. |
| **This repo** | NEAR / RODiT initialization can take a few seconds. Wait and retry `/health`, or rely on the workflow’s **120s** health loop with **5s** interval. Immediate `curl` after `podman run` is not a reliable signal. |

#### F. Local fast loop (same layout as CI, no registry)

| | |
| --- | --- |
| **Generic** | For “build host == deploy host” troubleshooting, build images with `podman build` and run the **same** pod/volume flags as CI instead of pushing/pulling GHCR. |
| **This repo** | Run `./scripts/deploy-local-podman.sh` from the repo (optional `--skip-build`, `TARGET=main` for production-style nginx config). |

#### G. `chmod: Operation not permitted` on `logs/` or `logs/nginx`

| | |
| --- | --- |
| **Generic** | Earlier `podman unshare chown` on log trees can leave directories owned by subordinate uids; later `chmod` from the login user may fail. |
| **This repo** | Usually **noise** if the pod still reaches **Running** and `/health` succeeds. Fix once with coordinated `chown`/`chmod` as the deploy user if you want clean deploy logs. |

## Maintenance

### Rotating the GHCR Pull Token
1. Create a new PAT with `read:packages` scope.
2. Update `GHCR_PULL_TOKEN` secret in GitHub Actions.
3. Revoke the old token.
4. Test the next deployment to confirm the new token works.

### Cleaning Up Old Images
On the production host, periodically prune old images:
```bash
podman image prune -a --filter "until=720h"  # Remove images older than 30 days
```

Or configure GHCR retention policies in the GitHub UI.

### Updating the Workflow
If you need to change the workflow (e.g., add new build steps, change image names):
1. Update `.github/workflows/deploy.yml` in the repo.
2. Commit and push to `main`.
3. The workflow will automatically trigger on the next push.

## Reuse for Other Repositories

This pattern is designed to be reusable across multiple repositories with similar Podman-based deployment architectures. Follow these steps to apply it to another repository:

### Step 1: Prepare the Repository

1. **Copy the workflow file:**
   - Copy `.github/workflows/deploy.yml` from this repo to the target repo.
   - Update the following in the `env` section and GitHub settings to match your service:
     - `APP_PORT` — external port (hardcoded constant; must match `nginx.conf` `listen` and `nginx.Dockerfile` `EXPOSE`)
     - `APP_DIR` — host deployment directory (hardcoded constant, e.g., `~/myservice-app`)
     - `POD_NAME`, `APP_CONTAINER_NAME`, `NGINX_CONTAINER_NAME` — pod and container names (hardcoded constants)
     - `APP_IMAGE_NAME`, `NGINX_IMAGE_NAME` — image names in GHCR (hardcoded constants)
     - `SSH_HOST_MAIN` / `SSH_HOST_DEVELOPMENT` — server IPs (GitHub Secrets)
     - `DOMAIN` — health-check hostname per branch (hardcoded in workflow; must match `nginx/nginx.*.conf` `server_name`)
   
   **Note:** These variables are defined once in the `env` section and reused throughout the workflow via `${{ env.VARIABLE_NAME }}`. Changing them in one place automatically updates all deployment commands.

2. **Verify all build-required files exist in the repo:**
   - Ensure `api.Dockerfile` and `nginx.Dockerfile` are in the repo root.
   - Ensure `nginx/nginx.main.conf` and `nginx/nginx.development.conf` exist (required by `nginx.Dockerfile`: `COPY nginx/nginx.${NODE_ENV}.conf`).
   - Ensure `package.json` and `package-lock.json` are present (required by workflow).
   - *Example (SignPortal)* may also ship optional `nginx/docker-entrypoint.d/` scripts; **this repo (SignSanctum)** does not require them.
   - Keep `.dockerignore` and `.gitignore` for reference.
   - **All files referenced in Dockerfiles must be in the repo** — they are copied into the image during the CI build.

3. **Clean up unnecessary files:**
   - Delete build artifacts (`.deb` files, etc.).
   - Delete startup scripts (e.g., `start-service.sh`) — containers run from images.
   - Delete old deployment scripts — use GitHub Actions instead.
   - Keep Dockerfiles, nginx config, package files, and documentation.

4. **Ensure runtime directories are gitignored:**
   - Add to `.gitignore`:
     ```
     /certs/
     /logs/
     /data/
     /secrets/
     ```
   - These directories are created on the host at runtime, not in the repo.
   - The host directory `~/<app-dir>/nginx/` is for reference only; the actual nginx config is baked into the image from the repo.

### Step 2: Configure GitHub Actions Secrets

1. **Create `GHCR_PULL_TOKEN` secret:**
   - Go to **Settings → Secrets and variables → Actions**.
   - Create a new secret named `GHCR_PULL_TOKEN`.
   - Use a classic PAT with `read:packages` scope (can be shared across repos).

2. **Create SSH secrets** per branch — see [SSH secrets (GitHub repository settings)](#ssh-secrets-github-repository-settings). Use `SSH_*_MAIN` and `SSH_*_DEVELOPMENT` suffixes (not `_DEV`, not a bare `SSH_KNOWN_HOSTS` secret).

### Step 3: Prepare the Production Host

1. **Create application directory:**
   ```bash
   mkdir -p ~/<app-dir>/{certs,logs,data,nginx,secrets}
   chmod 750 ~/<app-dir>/secrets
   ```

2. **Create `secrets.env`:** Follow [Runtime secrets (`secrets.env`)](#runtime-secrets-secretsenv) in [Host runtime: secrets and TLS certificates](#host-runtime-secrets-and-tls-certificates). See also [`configuration-standard.md`](configuration-standard.md).

3. **Provision SSL certificates:** Follow [Host runtime: secrets and TLS certificates](#host-runtime-secrets-and-tls-certificates) (TLS subsection). The deploy workflow normalizes PEM ownership for rootless nginx on every run; operators must install the files first.

4. **Install logrotate config (optional):**
   ```bash
   sudo cp nginx/idclaw-nginx-logs.logrotate /etc/logrotate.d/<service>-nginx-logs
   sudo chmod 644 /etc/logrotate.d/<service>-nginx-logs
   ```

### Step 4: Trigger the First Deployment

1. Commit all changes and push to `main`.
2. The workflow will automatically trigger.
3. Monitor **Actions** tab in GitHub for build and deploy progress.
4. Verify on the production host:
   ```bash
   podman images | grep ghcr.io
   podman ps -a
   podman logs <container-name> | tail -20
   curl -k https://<domain>:<port>/health
   ```

### Step 5: Customize for Your Service

Depending on your service, you may need to adjust:

- **Environment variables** in `secrets.env` — add/remove as needed.
- **Dockerfile build steps** — if your service has different dependencies.
- **Nginx configuration** — if your service uses different ports or routing.
- **Health check endpoint** — adjust the curl command in verification.
- **Volume mounts** — if your service needs additional persistent storage.

### Changing Deployment Destination

To deploy to a **different server**, you only need to change **2 variables** in the workflow's `env` section:

1. **`SSH_HOST`** — Change the IP address of the target server
2. **`APP_DIR`** — Change the application directory (if different on the new server)

**Example:** To deploy to server `192.168.1.100` with app directory `~/myapp`:

```yaml
# Generic
env:
  SSH_HOST_MAIN: <prod-server-ip>     # ← stored as GitHub Secret
  SSH_HOST_DEVELOPMENT: <dev-server-ip>  # ← stored as GitHub Secret
  APP_PORT: <port>                    # ← hardcoded constant
  APP_DIR: ~/<app-dir>                # ← hardcoded constant
  POD_NAME: <service>-pod             # ← hardcoded constant
  APP_CONTAINER_NAME: <service>-container
  NGINX_CONTAINER_NAME: <service>-nginx

# This repo (clienttestapi)
env:
  # SSH_*_MAIN / SSH_*_DEVELOPMENT stored as GitHub Secrets
  APP_PORT: 7443
  APP_DIR: ~/clienttestapi-app
  POD_NAME: clienttestapi-pod
  APP_CONTAINER_NAME: clienttestapi-container
  NGINX_CONTAINER_NAME: clienttestapi-nginx

# Example (SignPortal)
env:
  APP_PORT: 8443
  APP_DIR: ~/signportal-app
  POD_NAME: signportal-pod
  APP_CONTAINER_NAME: signportal-container
  NGINX_CONTAINER_NAME: signportal-nginx
```

All SSH commands and directory paths throughout the workflow automatically use these variables, so changing them in one place updates the entire deployment pipeline.

### Checklist for New Repositories

- [ ] `.github/workflows/deploy.yml` copied and customized.
- [ ] `GHCR_PULL_TOKEN` and all `SSH_*_MAIN` / `SSH_*_DEVELOPMENT` secrets created (see [SSH secrets](#ssh-secrets-github-repository-settings)).
- [ ] Production host directory structure created (`certs`, `logs`, `data`, `secrets`, `nginx`).
- [ ] `secrets.env` file created on host with all runtime secrets.
- [ ] SSL certificates provisioned in `certs/` directory.
- [ ] Logrotate config installed (optional).
- [ ] First deployment triggered and verified.
- [ ] Service responding to health checks.
- [ ] Containers running and logs clean.

## Configuration Management: Secrets vs Non-Secrets

**Critical concept:** Separate secrets from non-secret configuration to maintain security and clarity.

For complete configuration architecture, see [`docs/configuration-standard.md`](configuration-standard.md).

### Configuration Sources

| Source | Format | Location | Committed | Purpose |
|--------|--------|----------|-----------|---------|
| `config/{NODE_ENV}.json` | JSON | Repository | ✅ Yes | Non-secret configuration (URLs, ports, feature flags, etc.). Use `config/development.json` on development branch, `config/main.json` on main branch. |
| `secrets/secrets.env` | KEY=VALUE | Host only | ❌ No | Runtime secrets (API keys, credentials, tokens) |
| `config/custom-environment-variables.json` | JSON | Repository | ✅ Yes | Maps secrets from `secrets/secrets.env` to config keys |

### What Goes Where

**In `config/{NODE_ENV}.json` (committed to repo):**
- Service URLs and endpoints
- Port numbers
- Feature flags and toggles
- Log levels
- Service names and versions
- Non-sensitive configuration values
- NODE_ENV setting (development or production)

**In `secrets/secrets.env` (host only, never committed):**
- API keys and tokens
- Database credentials
- Authentication credentials
- Encryption keys
- Private tokens and secrets

### Branch-Specific Configuration

- **`development` branch:** uses `config/development.json` with NODE_ENV: "development"
- **`main` branch:** uses `config/main.json` with NODE_ENV: "production"
- **Benefit:** Merging development → main never overwrites production configuration

### Benefits

1. **Security:** Secrets are never committed to version control
2. **Clarity:** Clear separation between configuration and secrets
3. **Auditability:** Configuration changes are tracked in git; secret changes are not
4. **Consistency:** All applications use the same JSON format for configuration
5. **Simplicity:** Single env-file on host contains only what needs to be secret
6. **Branch safety:** Environment-specific config files prevent accidental overwrites during branch merges

## Build vs Runtime: Single Source of Truth

**Critical concept:** The repo is the single source of truth for all build artifacts.

### Build Time (GitHub Actions CI)
- Workflow checks out the repo.
- Dockerfile reads files from the repo:
  - `nginx/nginx.main.conf` or `nginx/nginx.development.conf` → copied into image as `/etc/nginx/nginx.conf` via `nginx.${NODE_ENV}.conf`
  - `src/` → copied into API image
  - `package.json`, `package-lock.json` → dependencies installed
- Images are built and pushed to GHCR.

### Runtime (Production Host)
- Workflow pulls pre-built images from GHCR.
- **No files are copied from the repo to the host.**
- All configuration and scripts are **already inside the image** (baked in during build).
- Host directories (`certs/`, `logs/`, `data/`, `secrets/`) are for runtime data only.
- The host directory `~/<app-dir>/nginx/` is for **reference only** — the actual nginx config is inside the container image.

### Key Takeaway
- **Repo files** → Docker build (CI) → Image → GHCR → Deploy pulls image
- **Host directories** → Runtime data only (logs, certs, persistent data)
- **Single source:** The repo. Everything else is derived from it.

## Host Directory Structure

After deployment, the production host has the following directory structure under `~/<app-dir>/`:

```
~/<app-dir>/
├── certs/              # SSL/TLS certificates (mounted read-only into nginx)
│   ├── fullchain.pem   # Full certificate chain
│   └── privkey.pem     # Private key (deploy applies rootless ownership + 600 via workflow)
├── logs/               # Container logs (mounted from containers)
│   ├── nginxaccess.log # Nginx access logs
│   ├── nginxerror.log  # Nginx error logs
│   └── nginx/          # Nginx-specific logs
├── data/               # Persistent application data (mounted read-write)
│   └── (application-specific files)
├── nginx/              # Nginx configuration reference
│   └── (optional reference files; live config is in the image as /etc/nginx/nginx.conf)
└── secrets/            # Runtime environment variables
    └── secrets.env     # Operator-provisioned; typically chmod 644 for --env-file
```

### Directory Purposes

| Directory | Purpose | Mounted | Writable | Notes |
|-----------|---------|---------|----------|-------|
| `certs/` | SSL/TLS certificates | Yes (read-only) | No | Operator-provisioned; see [Host runtime: secrets and TLS certificates](#host-runtime-secrets-and-tls-certificates) |
| `logs/` | Container logs | Yes | Yes | Logs from running containers; can be pruned periodically |
| `data/` | Persistent data | Yes | Yes | Application-specific data; backed up separately |
| `nginx/` | Nginx config reference | No | No | For reference only; actual config is in the image |
| `secrets/` | Runtime secrets | No | No | `secrets.env` loaded via `--env-file`; never mounted as a volume |

### Deleted Directories

The following directories were removed as they are no longer needed:

- `config/` — Application config (baked into Docker image at build time)
- `src/` — Source code (baked into Docker image at build time)
- `scripts/` — Build scripts (no longer used; builds happen in CI)
- `docs/` — Documentation (available in main repo)
- `api-docs/` — API documentation (available in main repo)
- *Other repos may list `references/` or vendored `sdk/`; **this repo** uses `@rodit/rodit-auth-be` from npm, not a local `sdk/` tree.*
- `public/` — Static files (baked into Docker image if needed)
- `.git/`, `.github/`, `.windsurf/` — Version control and editor config (not needed on host)
- `*.Dockerfile` — Dockerfile files (images are in GHCR)
- `package.json`, `package-lock.json` — Dependencies (installed in image)
- Build artifacts (`.deb` files, etc.)

## Multi-Environment Deployment (Development & Production)

This section documents the setup for deploying different branches to isolated environments (development and production servers).

### Overview

The workflow supports two deployment branches:
- **`development` branch** → deploys to development server
- **`main` branch** → deploys to production server

Each environment has completely isolated SSH credentials, hosts, and configuration.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Repository                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  development branch          main branch                     │
│       ↓                            ↓                         │
│  [GitHub Actions CI]         [GitHub Actions CI]            │
│       ↓                            ↓                         │
│  Build & Push Images         Build & Push Images            │
│  (GHCR)                      (GHCR)                          │
│       ↓                            ↓                         │
│  Pull SSH_*_DEVELOPMENT      Pull SSH_*_MAIN                │
│  (SSH_KNOWN_HOSTS_DEVELOPMENT) (SSH_KNOWN_HOSTS_MAIN)       │
│       ↓                            ↓                         │
│  Deploy to Dev Server        Deploy to Prod Server          │
│  (SSH_HOST_DEVELOPMENT)      (SSH_HOST_MAIN)                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### GitHub Secrets Configuration

Create the following secrets in **Settings → Secrets and variables → Actions**:

#### Production Secrets (main branch)
- `SSH_HOST_MAIN` — Production server IP address
- `SSH_USER_MAIN` — SSH username for production server
- `SSH_PRIVATE_KEY_MAIN` — SSH private key for production server
- `SSH_KNOWN_HOSTS_MAIN` — Host key fingerprint for production server

#### Development Secrets (development branch)

See [SSH secrets (GitHub repository settings)](#ssh-secrets-github-repository-settings): `SSH_HOST_DEVELOPMENT`, `SSH_USER_DEVELOPMENT`, `SSH_PRIVATE_KEY_DEVELOPMENT`, `SSH_KNOWN_HOSTS_DEVELOPMENT`.

#### Hardcoded Workflow Constants
Defined directly in the workflow `env` section — not stored in GitHub Secrets or Variables:
- `APP_PORT: <port>` — Fixed by the container/nginx architecture; same for both environments.
- `APP_DIR: ~/<app-dir>` — Fixed host deployment convention; same for both environments.
- `DOMAIN` — Hostname for the post-deploy HTTPS health check (`https://${DOMAIN}:${APP_PORT}/health`). Chosen by branch in `deploy.yml`; must match `server_name` in the nginx config baked into the image for that branch.

**Where domains actually live**

| Environment | Branch | Nginx `server_name` | Workflow `DOMAIN` | This repo (clienttestapi) |
| --- | --- | --- | --- | --- |
| Development | `development` | in `nginx/nginx.development.conf` | same as `server_name` | `webhook.dihola.io` |
| Production | `main` | in `nginx/nginx.main.conf` | same as `server_name` | `webhook.discernible.io` |

**Example (SignPortal):** `signportal.dihola.io` / `signportal.discernible.io`, port `8443`.

Do not add `DOMAIN_MAIN` / `DOMAIN_DEV` GitHub Variables—they duplicate values already in `deploy.yml` and nginx configs. Change nginx configs, `DOMAIN` in `deploy.yml`, and DNS/certs together when renaming a host.

#### Shared Secrets
- `GHCR_PULL_TOKEN` — GitHub Container Registry pull token (shared across both environments)

### Workflow Configuration

The workflow uses conditional expressions to select the correct secrets based on the branch:

```yaml
# Generic pattern
on:
  push:
    branches: [ main, development ]

env:
  SSH_HOST: ${{ github.ref == 'refs/heads/main' && secrets.SSH_HOST_MAIN || secrets.SSH_HOST_DEVELOPMENT }}
  SSH_USER: ${{ github.ref == 'refs/heads/main' && secrets.SSH_USER_MAIN || secrets.SSH_USER_DEVELOPMENT }}
  SSH_PRIVATE_KEY: ${{ github.ref == 'refs/heads/main' && secrets.SSH_PRIVATE_KEY_MAIN || secrets.SSH_PRIVATE_KEY_DEVELOPMENT }}
  # SSH_KNOWN_HOSTS is workflow env only — sources SSH_KNOWN_HOSTS_MAIN or SSH_KNOWN_HOSTS_DEVELOPMENT secrets
  SSH_KNOWN_HOSTS: ${{ github.ref == 'refs/heads/main' && secrets.SSH_KNOWN_HOSTS_MAIN || secrets.SSH_KNOWN_HOSTS_DEVELOPMENT }}
  DOMAIN: ${{ github.ref == 'refs/heads/main' && '<prod-host>' || '<dev-host>' }}
  APP_PORT: <port>             # hardcoded constant
  APP_DIR: ~/<app-dir>         # hardcoded constant
```

```yaml
# This repo (clienttestapi)
env:
  SSH_HOST: ${{ github.ref == 'refs/heads/main' && secrets.SSH_HOST_MAIN || secrets.SSH_HOST_DEVELOPMENT }}
  SSH_KNOWN_HOSTS: ${{ github.ref == 'refs/heads/main' && secrets.SSH_KNOWN_HOSTS_MAIN || secrets.SSH_KNOWN_HOSTS_DEVELOPMENT }}
  DOMAIN: ${{ github.ref == 'refs/heads/main' && 'webhook.discernible.io' || 'webhook.dihola.io' }}
  APP_PORT: 7443
  APP_DIR: ~/clienttestapi-app
```

**How it works:**
- Pushing to `main` → uses `*_MAIN` secrets for SSH; `DOMAIN=webhook.discernible.io` for the health check
- Pushing to `development` → uses `*_DEVELOPMENT` secrets for SSH; `DOMAIN=webhook.dihola.io` for the health check
- **Example (SignPortal):** `*_DEVELOPMENT`, `signportal.dihola.io`, port `8443`, `~/signportal-app`
- `APP_PORT` and `APP_DIR` are hardcoded constants — identical for both environments (no branch-conditional needed)
- All downstream steps automatically use the correct environment variables
- Merging `development` into `main` never overwrites production infrastructure settings

### Workflow Constants Reference

#### Hardcoded constants (workflow `env` section)

| Constant | Generic form | This repo (clienttestapi) | Example (SignSanctum) | Defined in |
|----------|-------------|---------------------------|------------------------|------------|
| `APP_PORT` | `<port>` | `7443` | `1443` | `nginx.Dockerfile` `EXPOSE`, nginx `listen` |
| `APP_DIR` | `~/<app-dir>` | `~/clienttestapi-app` | `~/signsanctum-app` | Host convention |
| `POD_NAME` | `<service>-pod` | `clienttestapi-pod` | `signsanctum-pod` | Podman pod name |
| `APP_CONTAINER_NAME` | `<service>-container` | `clienttestapi-container` | `signsanctum-container` | Must match nginx `proxy_pass` hostname |
| `NGINX_CONTAINER_NAME` | `<service>-nginx` | `clienttestapi-nginx` | `signsanctum-nginx` | Podman container name |
| `REGISTRY` | `ghcr.io` | `ghcr.io` | GitHub Container Registry |
| `HEALTH_CHECK_TIMEOUT` | `<seconds>` | `120` | Seconds before health check fails |
| `HEALTH_CHECK_INTERVAL` | `<seconds>` | `5` | Seconds between health check attempts |

These are **not secrets** and have **no environment-specific variants** (`_MAIN` / `_DEVELOPMENT`). They are fixed by the container and network architecture and apply equally to both `main` and `development` branch deployments.

#### Port architecture

The sidecar pod has two containers sharing a network namespace:

```
External client
      |
   <APP_PORT> (pod external port, e.g. podman pod create -p 1443:1443)
      |
 [nginx container]  — listens on <APP_PORT> ssl (nginx.*.conf + nginx.Dockerfile EXPOSE)
      |
   8080 (internal, pod-local, never exposed externally)
      |
 [api container]    — SERVERPORT in config (typically 8080)
```

- `APP_PORT` is the **external** pod port. It must match nginx `listen` and `nginx.Dockerfile` `EXPOSE`.
- **This repo (clienttestapi):** `7443`, `proxy_pass http://clienttestapi-container:8080`.
- **Example (SignPortal):** `8443`, `proxy_pass http://signportal-container:8080`.
- `APP_CONTAINER_NAME` must match the hostname in nginx `proxy_pass` (Podman pod DNS uses container names).

Changing any of these values requires coordinated updates across `nginx/nginx.*.conf`, `nginx.Dockerfile`, `api.Dockerfile`, config files, and `deploy.yml`.

#### APP_DIR layout

`~/<app-dir>` is the host directory where runtime data is stored. It is created by the workflow on first deploy and is never committed to the repository.

```
# Generic
~/<app-dir>/
├── certs/      # TLS PEMs (operator-provisioned; see Host runtime section)
├── logs/       # Container logs
├── data/       # Persistent application data
├── nginx/      # Reference only
└── secrets/    # secrets.env (never committed)

# This repo (clienttestapi)
~/clienttestapi-app/

# Example (SignPortal)
~/signportal-app/
```

### Configuration files per branch

**Generic:** Non-secret settings live in `config/{NODE_ENV}.json` on the branch being built. Secrets (for example `LOKI_BASIC_AUTH`) stay in host `secrets/secrets.env` per environment — not in committed JSON.

**This repo (clienttestapi):** `config/development.json` on the `development` branch and `config/main.json` on `main`. The workflow sets `NODE_ENV` to `development` or `main` so the API loads the matching file from the image. See [`configuration-standard.md`](configuration-standard.md).

### Setting Up SSH Credentials

For each environment, generate or obtain SSH credentials:

#### 1. Generate SSH Key Pair (if needed)
```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_rsa_dev -N ""
ssh-keygen -t ed25519 -f ~/.ssh/id_rsa_main -N ""
```

#### 2. Add Public Key to Server
```bash
# On development server
cat ~/.ssh/id_rsa_dev.pub | ssh deploy@dev-server "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# On production server
cat ~/.ssh/id_rsa_main.pub | ssh deploy@prod-server "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

#### 3. Get SSH Known Hosts
```bash
# For development server
ssh-keyscan -H dev-server-ip >> ~/.ssh/known_hosts
ssh-keyscan -H dev-server-ip

# For production server
ssh-keyscan -H prod-server-ip >> ~/.ssh/known_hosts
ssh-keyscan -H prod-server-ip
```

Copy the output and store in GitHub Secrets as `SSH_KNOWN_HOSTS_DEVELOPMENT` and `SSH_KNOWN_HOSTS_MAIN` (not `SSH_KNOWN_HOSTS` — that name is only the workflow `env` alias).

#### 4. Store Private Keys in GitHub Secrets
```bash
# Copy the private key content
cat ~/.ssh/id_rsa_dev
cat ~/.ssh/id_rsa_main
```

Paste into GitHub Secrets as `SSH_PRIVATE_KEY_DEVELOPMENT` and `SSH_PRIVATE_KEY_MAIN`.

### Development Workflow

1. **Create feature branches** from `development`:
   ```bash
   git checkout development
   git pull origin development
   git checkout -b feature/my-feature
   ```

2. **Commit and push to feature branch:**
   ```bash
   git add .
   git commit -m "Add my feature"
   git push origin feature/my-feature
   ```

3. **Create a pull request** to `development` for code review.

4. **Merge to development** after approval:
   ```bash
   # GitHub UI or CLI
   gh pr merge feature/my-feature --squash
   ```
   - This triggers the workflow to deploy to the **development server**.
   - Test the feature on the development server.

5. **Merge to main** when ready for production:
   ```bash
   git checkout main
   git pull origin main
   git merge development
   git push origin main
   ```
   - This triggers the workflow to deploy to the **production server**.

### Verification Checklist

- [ ] All `SSH_*_MAIN` and `SSH_*_DEVELOPMENT` secrets created in GitHub.
- [ ] `GHCR_PULL_TOKEN` secret created.
- [ ] Development server SSH key added to `~/.ssh/authorized_keys`.
- [ ] Production server SSH key added to `~/.ssh/authorized_keys`.
- [ ] `config/development.json` and `config/main.json` contain environment-appropriate non-secret values on their branches.
- [ ] Each target host has its own `secrets/secrets.env` and TLS PEMs under `certs/`.
- [ ] Push to `development` branch and verify deployment to dev server.
- [ ] Push to `main` branch and verify deployment to prod server.
- [ ] Verify containers are running on correct servers.
- [ ] Verify configuration is correct for each environment.

### Troubleshooting Multi-Environment Deployments

#### Workflow deploys to wrong server
- **Cause:** Secrets are named incorrectly or branch name doesn't match.
- **Fix:** Verify secret names match exactly (`SSH_HOST_MAIN`, `SSH_HOST_DEVELOPMENT`, etc.) and branch names are `main` and `development`.

#### SSH authentication fails
- **Cause:** Private key doesn't match public key on server, or `SSH_KNOWN_HOSTS_DEVELOPMENT` / `SSH_KNOWN_HOSTS_MAIN` does not match `SSH_HOST_*`.
- **Fix:**
  1. Verify public key is in server's `~/.ssh/authorized_keys`.
  2. Re-run `ssh-keyscan -H <same-as-SSH_HOST_*>` and update the matching `SSH_KNOWN_HOSTS_*` GitHub secret (not a secret named `SSH_KNOWN_HOSTS`).
  3. Test SSH locally: `ssh -i ~/.ssh/id_rsa_dev deploy@dev-server`

#### Configuration not applied
- **Cause:** Wrong `NODE_ENV`, missing `config/{NODE_ENV}.json` on the built branch, or secrets not in host `secrets.env`.
- **Fix:**
  1. Verify the workflow sets `NODE_ENV` for the branch (`development` vs `production`).
  2. Verify `config/development.json` or `config/main.json` exists on the branch that was built.
  3. Verify `~/<app-dir>/secrets/secrets.env` on that host and check container logs for config loading errors.

## Success Criteria

✅ **Deployment is successful when:**
- Images build and push to GHCR without errors.
- Images pull on the correct server (dev or prod) without auth errors.
- Containers start and remain running on the correct server.
- Service responds to health checks on the correct server.
- No secrets appear in GitHub Actions logs.
- Deployment completes in under 10 minutes.
- Host directory structure matches the documented layout above.
- Development branch deployments only affect the development server.
- Main branch deployments only affect the production server.

## Future: Meaningful Dev/Prod Split

Using separate names/paths on the same host helps avoid collisions, but both environments still share one failure domain. For a meaningful split, use separate hosts:

- **Production host** (current)
- **Development host** (new)

Then map each environment to its own workflow, host credentials, and DNS endpoint. The multi-environment deployment section above documents the workflow configuration needed to support this separation.

---

## Setup Checklist

### Phase 1: GitHub Configuration (5 min)

**GitHub repo → Settings → Secrets and variables → Actions**

**Production Secrets (main branch):**
- [ ] `SSH_HOST_MAIN` — Production server IP (generic: `<prod-ip>`)
- [ ] `SSH_USER_MAIN` — SSH username
- [ ] `SSH_PRIVATE_KEY_MAIN` — SSH private key content
- [ ] `SSH_KNOWN_HOSTS_MAIN` — Output of `ssh-keyscan -H <same-as-SSH_HOST_MAIN>`

**Development Secrets (development branch):**
- [ ] `SSH_HOST_DEVELOPMENT` — Development server IP (generic: `<dev-ip>`)
- [ ] `SSH_USER_DEVELOPMENT` — SSH username
- [ ] `SSH_PRIVATE_KEY_DEVELOPMENT` — SSH private key content
- [ ] `SSH_KNOWN_HOSTS_DEVELOPMENT` — Output of `ssh-keyscan -H <same-as-SSH_HOST_DEVELOPMENT>`

**Shared Secrets (both branches):**
- [ ] `GHCR_PULL_TOKEN` — GitHub Container Registry pull token (PAT with `read:packages` scope)

**Note:** `APP_PORT`, `APP_DIR`, and `DOMAIN` are hardcoded in the workflow (and `DOMAIN` must match nginx `server_name` per branch) — no GitHub Variables needed for hostnames.

### Phase 2: Production Server (10 min)

**Server:** `<prod-ip>` (use your production host; **Example (SignPortal)** used `178.105.131.69`)

**Base Directory:** `~/<app-dir>/` — **This repo (SignSanctum):** `~/signsanctum-app/` · **Example (SignPortal):** `~/signportal-app/`

**Tasks:**
- [ ] Directory structure exists: `certs/`, `logs/`, `data/`, `nginx/`, `secrets/`
- [ ] TLS: `certs/fullchain.pem`, `certs/privkey.pem` for the production hostname
- [ ] `secrets/secrets.env` with production runtime secrets
- [ ] Permissions: `chmod 750 secrets/`, `chmod 644 secrets/secrets.env`

### Phase 3: Development Server (15 min)

**Base directory:** `~/<app-dir>/` on the **development** SSH host (**This repo (SignSanctum):** `~/signsanctum-app/` · **Example (SignPortal):** `~/signportal-app/` — same directory name on each host is fine).

**Tasks:**
- [ ] Complete [Host runtime: secrets and TLS certificates](#host-runtime-secrets-and-tls-certificates) for the development hostname
- [ ] `secrets/secrets.env` with **development** credentials (not production values)
- [ ] TLS PEMs for the development hostname (**SignSanctum:** `signsanctum.dihola.io` · **Example (SignPortal):** `signportal.dihola.io`)

### Phase 4: Git Configuration (5 min)

**Local Repository:**
- [ ] Create development branch: `git checkout -b development`
- [ ] Push to origin: `git push -u origin development`
- [ ] Verify workflow triggers on push to `main` (production)
- [ ] Verify workflow triggers on push to `development` (development)

### Phase 5: Verification (5 min)

**GitHub Actions:**
- [ ] All `SSH_*_MAIN` secrets created and verified
- [ ] All `SSH_*_DEVELOPMENT` secrets created and verified
- [ ] `GHCR_PULL_TOKEN` verified
- [ ] Workflow runs without auth errors

**Servers (one checklist per SSH host):**
- [ ] `~/signsanctum-app/secrets/secrets.env` populated (dev host: dev secrets; prod host: prod secrets)
- [ ] `~/signsanctum-app/certs/` valid for that host's hostname
- [ ] Directory permissions: `secrets/` 750, `secrets.env` 644, PEMs normalized by deploy or `install-certs-to-apps.sh`

**Deployment:**
- [ ] Push to `main` → production server deployment succeeds
- [ ] Push to `development` → development server deployment succeeds
- [ ] Services respond to health checks on correct servers
- [ ] No secrets appear in GitHub Actions logs

---

## Quick Reference

### Update Production Secrets

```bash
# Generic
sudo nano ~/<app-dir>/secrets/secrets.env

# This repo (SignSanctum)
sudo nano ~/signsanctum-app/secrets/secrets.env
```

### Update Development Secrets

```bash
# Generic — on the development SSH host
nano ~/<app-dir>/secrets/secrets.env

# This repo (SignSanctum)
nano ~/signsanctum-app/secrets/secrets.env
```

### Trigger Deployments

```bash
git push origin main          # Deploy to production
git push origin development   # Deploy to development
```

### Check Deployment Status

Go to GitHub repo → **Actions** tab → view workflow run

### View Container Logs

**Production:**
```bash
# Generic
ssh <user>@<prod-ip> "podman logs <service>-container"

# This repo (SignSanctum)
ssh <user>@<host> "podman logs signsanctum-container"
```

**Development:**
```bash
# Generic
ssh <user>@<dev-ip> "podman logs <service>-container"

# This repo (SignSanctum)
ssh <user>@<dev-ip> "podman logs signsanctum-container"
```

### Restart Containers

**Production:**
```bash
# Generic
ssh <user>@<prod-ip> "podman pod restart <service>-pod"

# This repo (SignSanctum)
ssh <user>@<host> "podman pod restart signsanctum-pod"
```

**Development:**
```bash
# Generic
ssh <user>@<dev-ip> "podman pod restart <service>-pod"

# This repo (SignSanctum)
ssh <user>@<dev-ip> "podman pod restart signsanctum-pod"
```

## Environment-Specific Nginx Configuration

### Overview

Nginx configuration differs between development and production environments, particularly for CORS origins and server names. This is managed through environment-specific config files and Docker build arguments.

### Architecture

```
nginx/
├── nginx.main.conf          # Main branch (production) nginx config
└── nginx.development.conf   # Development branch nginx config

nginx.Dockerfile
├── ARG NODE_ENV=main
└── COPY nginx/nginx.${NODE_ENV}.conf /etc/nginx/nginx.conf
```

### Configuration Files

#### Generic Pattern

```
nginx/
├── nginx.main.conf          # Main branch: CORS origins, server_name for prod domain
└── nginx.development.conf   # Development branch: CORS origins, server_name for dev domain
```

#### Example (SignPortal)

Illustrates the same `nginx/nginx.${NODE_ENV}.conf` pattern; **this repo (SignSanctum)** uses `listen 1443`, `signsanctum.*` hostnames, and different CORS origins — see `nginx/nginx.main.conf` and `nginx/nginx.development.conf` in this repository.

**`nginx/nginx.main.conf`** (main branch / production):
```nginx
# CORS origin mapping (production)
map $http_origin $cors_origin {
    default "";
    "https://root.discernible.io:6443" "$http_origin";
    "https://purchase.identyclaw.com:4443" "$http_origin";
    "https://signportal.discernible.io:8443" "$http_origin";
}

server {
    listen 8443 ssl;
    http2 on;
    server_name signportal.discernible.io;
    ...
}
```

**`nginx/nginx.development.conf`** (development branch):
```nginx
# CORS origin mapping (development)
map $http_origin $cors_origin {
    default "";
    "https://root-dev.discernible.io:6443" "$http_origin";
    "https://purchase-dev.identyclaw.com:4443" "$http_origin";
    "https://signportal.dihola.io:8443" "$http_origin";
}

server {
    listen 8443 ssl;
    http2 on;
    server_name signportal.dihola.io;
    ...
}
```

### Build Process

The `nginx.Dockerfile` uses a build argument to select the correct config:

```dockerfile
ARG NODE_ENV=main

COPY nginx/nginx.${NODE_ENV}.conf /etc/nginx/nginx.conf
```

The GitHub Actions workflow passes the `NODE_ENV` build argument based on the branch:

```yaml
- name: Build and push Nginx image
  uses: docker/build-push-action@v6
  with:
    context: .
    file: ./nginx.Dockerfile
    build-args: |
      NODE_ENV=${{ github.ref == 'refs/heads/main' && 'main' || 'development' }}
    tags: |
      ${{ env.REGISTRY }}/${{ env.NGINX_IMAGE_NAME }}:${{ github.sha }}
      ${{ env.REGISTRY }}/${{ env.NGINX_IMAGE_NAME }}:latest
```

**How it works:**
- Pushing to `main` → `NODE_ENV=main` → copies `nginx.main.conf` into image
- Pushing to `development` → `NODE_ENV=development` → copies `nginx.development.conf` into image

### What to Customize for Your Service

When adapting this pattern to another service:

1. **Create two nginx config files:**
   - `nginx/nginx.main.conf` — production origins and server names
   - `nginx/nginx.development.conf` — development origins and server names

2. **Update CORS origins** in each file:
   - Production: use production domain names and origins
   - Development: use development domain names and origins (e.g., add `-dev` suffix)

3. **Update server_name** in each file:
   - Production: `server_name <your-service>.example.com;`
   - Development: `server_name <your-service>-dev.example.com;`

4. **Ensure the Dockerfile has the build argument:**
   ```dockerfile
   ARG NODE_ENV=main
   COPY nginx/nginx.${NODE_ENV}.conf /etc/nginx/nginx.conf
   ```

5. **Ensure the workflow passes the build argument** (same pattern as above).

### Verification

After deployment, verify the correct config was used:

```bash
# SSH into the host and check the running nginx config
ssh <user>@<host> "podman exec <service>-nginx cat /etc/nginx/nginx.conf | grep server_name"

# This repo (SignSanctum)
ssh <user>@<host> "podman exec signsanctum-nginx cat /etc/nginx/nginx.conf | grep server_name"
# main: server_name signsanctum.discernible.io;
# development: server_name signsanctum.dihola.io;

# Example (SignPortal)
ssh <user>@<host> "podman exec signportal-nginx cat /etc/nginx/nginx.conf | grep server_name"
```

### Benefits

1. **Isolation:** Development and production CORS origins are completely separate
2. **Safety:** Merging `development` → `main` never overwrites production nginx config
3. **Clarity:** Each environment's nginx config is explicit and version-controlled
4. **Auditability:** All nginx changes are tracked in git with environment context
