---
title: GHCR Deployment Migration Guide
date: 2026-05-10
author: Cascade AI Assistant
status: Implemented & Validated
---

## Overview

This guide documents the migration from local Podman image builds to GitHub Container Registry (GHCR)-based builds and deployments. It is designed to be reusable across multiple repositories with similar Podman-based deployment architectures.

## Goals

- Move image builds off the production host and into GitHub Actions CI.
- Publish container images to GitHub Container Registry (GHCR) with immutable, versioned tags.
- Prevent runtime secrets from crossing the network during deployments by storing them on the server.
- Preserve the existing Podman-based runtime on the target host while minimizing changes to the host filesystem layout.
- Enable reproducible, auditable deployments with full version history.

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
- Runtime secrets stored on the host in `/opt/<service>/secrets/` and injected via env-file.
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
  1. Checkout code.
  2. Install SSH key.
  3. Create required directories on host (`certs`, `logs`, `data`, `nginx`).
  4. Log into GHCR on the host using `GHCR_PULL_TOKEN` secret.
  5. Pull images from GHCR by SHA tag.
  6. Clean up old pod/containers.
  7. Recreate pod and run containers with pulled images.
  8. Verify containers are running.

**Key differences from old workflow:**
- No rsync of repo files.
- No `podman build` on the host.
- Images pulled by specific SHA tag (immutable).
- Secrets passed via env-file, not as `-e KEY=value` arguments.

### 2. Prepare GitHub Actions Secrets

**One PAT, many repositories:** Create a **single** classic personal access token (PAT) with `read:packages` scope, then **reuse that same token value** everywhere you need pull access. You do **not** need a new PAT per repository. For each repo that deploys with this pattern, add an Actions secret named `GHCR_PULL_TOKEN` and paste the **same** token (or define **one** organization-level secret and grant each repository access). Each repo still has its own secret *reference*; the underlying credential is the one shared PAT.

Create the PAT once:

1. Go to <https://github.com/settings/tokens/new?scopes=read:packages>.
2. Name it generically (e.g., `org-ghcr-pull-readonly`) so it is obvious it is shared.
3. Set expiration (recommend 90 days, rotate regularly).
4. Copy the token **once** after creation (GitHub will not show it again).

Wire it into each repository:

5. In **each** repo: **Settings → Secrets and variables → Actions**.
6. Create a repository secret named `GHCR_PULL_TOKEN` and paste the **same** PAT value (or attach an org secret named `GHCR_PULL_TOKEN` to each repo).

**Note:** The workflow uses `${{ secrets.GITHUB_TOKEN }}` (built-in) for pushing images in CI. The `GHCR_PULL_TOKEN` is only used on the production host for pulling.

### 3. Server Preparation

On the production host, create the secrets directory and env-file in the application directory:

```bash
# Create directory structure (alongside certs, logs, data)
sudo mkdir -p ~/<app-dir>/secrets
sudo chmod 750 ~/<app-dir>/secrets

# Create api.env with all runtime secrets
sudo tee ~/<app-dir>/secrets/api.env > /dev/null <<'EOF'
NODE_ENV=production
LOKI_BASIC_AUTH=<value>
LOKI_URL=<value>
NEAR_CREDENTIALS_JSON_B64=<value>
NEAR_RPC_URL=<value>
SECURITY_OPTIONS_WEBHOOK_TLS_SKIP_VERIFY=<value>
SECURITY_OPTIONS_BYPASS_WEBHOOK_VERIFICATION=<value>
# Add any other runtime env vars here
EOF

# Secure the file
sudo chmod 640 ~/<app-dir>/secrets/api.env
sudo chown root:root ~/<app-dir>/secrets/api.env

# Verify
sudo cat ~/<app-dir>/secrets/api.env
```

**Important:** Replace `<app-dir>` with your application directory name (e.g., `idclawserver-app`, `mintserverapi-app`). Replace `<value>` placeholders with actual values from your GitHub Actions secrets/vars.

**Directory structure:**
```
~/<app-dir>/
├── certs/              # SSL certificates (mounted read-only)
├── logs/               # Container logs
├── data/               # Persistent data
├── nginx/              # Nginx config
└── secrets/            # Runtime secrets (NEW)
    └── api.env         # Environment variables for containers
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
   - Confirm `~/<app-dir>/secrets/api.env` exists on host with correct permissions.

## Verification Checklist

- [ ] `.github/workflows/deploy.yml` split into `build-images` and `test-and-deploy` jobs.
- [ ] `build-images` job uses `docker/build-push-action@v6` to push to GHCR.
- [ ] `test-and-deploy` job pulls images from GHCR by SHA tag.
- [ ] `GHCR_PULL_TOKEN` secret created and stored in GitHub Actions.
- [ ] `~/<app-dir>/secrets/api.env` created on production host with correct permissions (640).
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
- Verify `~/<app-dir>/secrets/api.env` exists on host.
- Check `podman login` output for auth errors.
- Verify image exists in GHCR with the expected SHA tag.

### Permission Denied on api.env
- **Error:** `permission denied` when reading `/home/.../secrets/api.env`
- **Cause:** File or directory permissions are too restrictive.
- **Fix:**
  ```bash
  sudo chmod 755 ~/<app-dir>/secrets
  sudo chmod 644 ~/<app-dir>/secrets/api.env
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

## Maintenance

### Rotating the GHCR Pull Token
Because the same PAT is reused across repos, rotation is a **one-time credential change** followed by **updating every place** that still stores the old value.

1. Create a **new** PAT with `read:packages` scope.
2. Update the `GHCR_PULL_TOKEN` secret **in every repository** (and any organization secret copies) that uses this shared pull token.
3. Revoke the old PAT after all secrets are updated and at least one deploy per repo has succeeded.
4. Optionally re-run a deploy on each service to confirm pulls still work.

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
   - Update the following variables in the `env` section to match your service:
     - `SSH_HOST` — production host IP address (e.g., `178.62.195.21`)
     - `SSH_USER` — SSH username (stored as `${{ secrets.SSH_USER }}`)
     - `API_DOMAIN` — your service domain
     - `API_PORT` — your service port
     - `APP_DIR` — application directory on host (e.g., `~/myservice-app`)
     - `POD_NAME`, `API_CONTAINER_NAME`, `NGINX_CONTAINER_NAME` — pod and container names
     - `API_IMAGE_NAME`, `NGINX_IMAGE_NAME` — image names in GHCR
   
   **Note:** These variables are defined once in the `env` section and reused throughout the workflow via `${{ env.VARIABLE_NAME }}`. Changing them in one place automatically updates all deployment commands.

2. **Verify all build-required files exist in the repo:**
   - Ensure `api.Dockerfile` and `nginx.Dockerfile` are in the repo root.
   - Ensure `nginx/nginx.conf` exists (required by nginx.Dockerfile).
   - Ensure `nginx/docker-entrypoint.d/50-log-rotation.sh` exists (required by nginx.Dockerfile).
   - Ensure `package.json` and `package-lock.json` are present (required by workflow).
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
   - Paste the **same** classic PAT with `read:packages` scope that you already use for other repos in this org (create the PAT only once; reuse the value here).

2. **Create `SSH_PRIVATE_KEY` secret:**
   - Generate or use existing SSH key for the production host.
   - Store as `SSH_PRIVATE_KEY` secret.

3. **Create `SSH_KNOWN_HOSTS` secret:**
   - Run: `ssh-keyscan <production-host-ip>` and store the output.

4. **Create `SSH_USER` secret:**
   - Store the SSH username for the production host.

### Step 3: Prepare the Production Host

1. **Create application directory:**
   ```bash
   mkdir -p ~/<app-dir>/{certs,logs,data,nginx,secrets}
   chmod 750 ~/<app-dir>/secrets
   ```

2. **Create `api.env` file:**
   ```bash
   sudo tee ~/<app-dir>/secrets/api.env > /dev/null <<'EOF'
   NODE_ENV=production
   # Add all runtime environment variables here
   EOF
   
   # Permissions: directory must be readable by containers, file must be world-readable
   sudo chmod 755 ~/<app-dir>/secrets
   sudo chmod 644 ~/<app-dir>/secrets/api.env
   sudo chown root:root ~/<app-dir>/secrets/api.env
   ```
   
   **Important:** The env-file must be world-readable (644) so that containers running as non-root users can access it. The directory must be readable and executable (755).

3. **Provision SSL certificates:**
   - Place `fullchain.pem` and `privkey.pem` in `~/<app-dir>/certs/`.
   - Ensure correct permissions: `chmod 644 fullchain.pem`, `chmod 640 privkey.pem`.

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

- **Environment variables** in `api.env` — add/remove as needed.
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
env:
  SSH_HOST: 192.168.1.100        # ← Change this
  SSH_USER: ${{ secrets.SSH_USER }}
  API_DOMAIN: api.example.com
  API_PORT: 8443
  APP_DIR: ~/myapp               # ← Change this (if different)
  # ... rest stays the same
```

All SSH commands and directory paths throughout the workflow automatically use these variables, so changing them in one place updates the entire deployment pipeline.

### Checklist for New Repositories

- [ ] `.github/workflows/deploy.yml` copied and customized.
- [ ] `GHCR_PULL_TOKEN`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `SSH_USER` secrets created.
- [ ] Production host directory structure created (`certs`, `logs`, `data`, `secrets`, `nginx`).
- [ ] `api.env` file created on host with all runtime secrets.
- [ ] SSL certificates provisioned in `certs/` directory.
- [ ] Logrotate config installed (optional).
- [ ] First deployment triggered and verified.
- [ ] Service responding to health checks.
- [ ] Containers running and logs clean.

## Build vs Runtime: Single Source of Truth

**Critical concept:** The repo is the single source of truth for all build artifacts.

### Build Time (GitHub Actions CI)
- Workflow checks out the repo.
- Dockerfile reads files from the repo:
  - `nginx/nginx.conf` → copied into image
  - `nginx/docker-entrypoint.d/50-log-rotation.sh` → copied into image
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
│   └── privkey.pem     # Private key (chmod 640)
├── logs/               # Container logs (mounted from containers)
│   ├── nginxaccess.log # Nginx access logs
│   ├── nginxerror.log  # Nginx error logs
│   └── nginx/          # Nginx-specific logs
├── data/               # Persistent application data (mounted read-write)
│   └── (application-specific files)
├── nginx/              # Nginx configuration reference
│   └── nginx.conf      # Main nginx config (reference only; baked into image)
└── secrets/            # Runtime environment variables
    └── api.env         # Environment file with all secrets (chmod 640)
```

### Directory Purposes

| Directory | Purpose | Mounted | Writable | Notes |
|-----------|---------|---------|----------|-------|
| `certs/` | SSL/TLS certificates | Yes (read-only) | No | Required for HTTPS; must be provisioned manually |
| `logs/` | Container logs | Yes | Yes | Logs from running containers; can be pruned periodically |
| `data/` | Persistent data | Yes | Yes | Application-specific data; backed up separately |
| `nginx/` | Nginx config reference | No | No | For reference only; actual config is in the image |
| `secrets/` | Runtime secrets | No | No | Loaded via `--env-file`; never mounted into containers |

### Deleted Directories

The following directories were removed as they are no longer needed:

- `config/` — Application config (baked into Docker image at build time)
- `src/` — Source code (baked into Docker image at build time)
- `scripts/` — Build scripts (no longer used; builds happen in CI)
- `docs/` — Documentation (available in main repo)
- `api-docs/` — API documentation (available in main repo)
- `references/` — Reference files (available in main repo)
- `sdk/` — SDK code (available in main repo)
- `public/` — Static files (baked into Docker image if needed)
- `.git/`, `.github/`, `.windsurf/` — Version control and editor config (not needed on host)
- `*.Dockerfile` — Dockerfile files (images are in GHCR)
- `package.json`, `package-lock.json` — Dependencies (installed in image)
- Build artifacts (`.deb` files, etc.)

## Common Issues and Solutions (Lessons Learned)

### Issue 1: SARIF Upload Fails with "Resource not accessible by integration"

**Problem:** Trivy vulnerability scan completes but uploading SARIF results to GitHub Security fails with permission error.

**Root Cause:** The `GITHUB_TOKEN` doesn't have `security-events: write` permission by default in private repositories or with certain organization settings.

**Solution:**
```yaml
# Option 1: Add continue-on-error to make scanning non-blocking
- name: Upload scan results
  uses: github/codeql-action/upload-sarif@v3
  if: always()
  continue-on-error: true  # Don't fail deployment if upload fails
  with:
    sarif_file: 'trivy-results.sarif'
    category: 'image-scan'

# Option 2: Enable security-events permission (may not work in all repos)
jobs:
  build-images:
    permissions:
      contents: read
      packages: write
      security-events: write  # May fail if org doesn't allow
```

**Best Practice:** Use `continue-on-error: true` on both scan and upload steps to prevent blocking deployments while still capturing scan results in workflow logs.

### Issue 2: Wildcard SARIF File Pattern Fails

**Problem:** Using `sarif_file: 'trivy-*-results.sarif'` results in "Path does not exist" error.

**Root Cause:** GitHub Actions `upload-sarif` action doesn't support glob patterns for file paths.

**Solution:** Upload each SARIF file separately with distinct categories:
```yaml
- name: Scan app image
  uses: aquasecurity/trivy-action@master
  with:
    output: 'trivy-app-results.sarif'

- name: Upload app scan
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-app-results.sarif'
    category: 'app-image'  # Unique category required

- name: Scan nginx image
  uses: aquasecurity/trivy-action@master
  with:
    output: 'trivy-nginx-results.sarif'

- name: Upload nginx scan
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-nginx-results.sarif'
    category: 'nginx-image'  # Different category
```

### Issue 3: Podman Login Fails with "inappropriate ioctl for device"

**Problem:** During deploy, `podman login ghcr.io ... --password-stdin` fails with `Error: getting username and password: reading password: inappropriate ioctl for device`, often with a stray `Password:` prompt in the log.

**Root causes (any can apply):**

- Stdin does not reach `podman` on the remote host (how the SSH command and pipeline are quoted).
- The `GHCR_PULL_TOKEN` repository secret is missing, empty, or not a valid PAT — Podman then tries to read from a TTY.
- Embedding the token in a remote `echo '...'` command breaks when the token contains shell-special characters (for example a single quote).

**Recommended approach (GitHub Actions):** Bind the secret to a step environment variable, validate it is non-empty, forward the token on stdin through SSH, and run only `podman login ... --password-stdin` on the remote side. This avoids inlining the token in the remote argv where possible and handles arbitrary token bytes better than a quoted `echo`.

```yaml
- name: Setup Directories and Login to GHCR
  env:
    GHCR_PULL_TOKEN: ${{ secrets.GHCR_PULL_TOKEN }}
  run: |
    if [ -z "${GHCR_PULL_TOKEN}" ]; then
      echo "::error::GHCR_PULL_TOKEN secret is missing or empty. Create a classic PAT with read:packages scope."
      exit 1
    fi
    printf '%s\n' "$GHCR_PULL_TOKEN" | ssh user@host \
      "podman login ghcr.io -u ${{ github.actor }} --password-stdin"
```

**Alternative (remote-only pipeline):** Run the entire `echo | podman login` pipeline **inside** one SSH command string so the pipe is evaluated on the server. This can work when the token is simple, but the token appears in the remote command line and tokens containing `'` will break unless you use a different quoting strategy.

```yaml
ssh user@host "echo '${{ secrets.GHCR_PULL_TOKEN }}' | podman login ghcr.io -u ${{ github.actor }} --password-stdin"
```

**Note:** Some workflows pipe from the runner (`echo ... | ssh ... "podman login"`). Whether that forwards stdin correctly depends on OpenSSH and shell quoting. If one pattern fails in your environment, use the other; the env + `printf` + SSH stdin pattern above is the most reliable default for Actions.

### Issue 4: `$GITHUB_OUTPUT` Ambiguous Redirect Over SSH

**Problem:** A step logs `bash: line N: $GITHUB_OUTPUT: ambiguous redirect`.

**Root cause:** `GITHUB_OUTPUT` is set only on GitHub-hosted (or self-hosted) **runner** machines. It is **not** set inside an SSH session on your production host. Appending to `$GITHUB_OUTPUT` there expands to an empty path, which triggers bash’s “ambiguous redirect” error.

**Wrong:**

```yaml
- id: state
  run: |
    ssh user@host "
      if podman pod exists my-pod; then
        echo 'pod_exists=true' >> \$GITHUB_OUTPUT
      fi
    "
```

**Correct:** Execute the remote check with SSH, then write step outputs **only** in the local `run:` script (where `GITHUB_OUTPUT` is defined):

```yaml
- id: state
  run: |
    if ssh user@host "podman pod exists my-pod"; then
      echo 'pod_exists=true' >> "$GITHUB_OUTPUT"
    else
      echo 'pod_exists=false' >> "$GITHUB_OUTPUT"
    fi
```

### Issue 5: GitHub Actions Expression Syntax in Shell Arithmetic

**Problem:** Using nested GitHub Actions expressions in shell arithmetic causes parsing errors.

**Wrong:**
```yaml
run: |
  ATTEMPTS=$((ELAPSED / ${{ env.INTERVAL }} + 1))  # Syntax error
```

**Correct:**
```yaml
env:
  INTERVAL: ${{ env.HEALTH_CHECK_INTERVAL }}
run: |
  ATTEMPTS=$((ELAPSED / INTERVAL + 1))  # Use shell variable
```

**Explanation:** GitHub Actions can't parse `${{ }}` expressions inside shell `$(( ))` arithmetic. Pass env vars to the step and use them as shell variables.

### Issue 6: Conditional Expressions Need Explicit Syntax

**Problem:** Using bare function calls in `if` conditions may fail in some contexts.

**Inconsistent (may work but not recommended):**
```yaml
if: always()
if: failure() && steps.state.outputs.exists == 'true'
```

**Explicit (always works):**
```yaml
if: ${{ always() }}
if: ${{ failure() && steps.state.outputs.exists == 'true' }}
```

**Best Practice:** Always wrap conditional expressions in `${{ }}` for consistency and clarity.

### Issue 7: YAML Indentation and Line Break Corruption

**Problem:** Mixed line breaks or incorrect indentation causes YAML parsing errors.

**Prevention:**
- Use consistent 2-space indentation
- Avoid tabs (use spaces only)
- Validate YAML syntax: `python3 -c "import yaml; yaml.safe_load(open('file.yml'))"`
- Use a YAML-aware editor with syntax highlighting

**Recovery:** If file becomes corrupted, delete and recreate with proper formatting rather than trying to fix in place.

## Success Criteria

✅ **Deployment is successful when:**
- Images build and push to GHCR without errors.
- Vulnerability scans complete (results in logs even if upload fails).
- Images pull on the production host without auth errors.
- Containers start and remain running.
- Service responds to health checks.
- No secrets appear in GitHub Actions logs.
- Deployment completes in under 10 minutes.
- Host directory structure matches the documented layout above.
