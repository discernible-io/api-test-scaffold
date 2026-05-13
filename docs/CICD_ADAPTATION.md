---
title: mintclientapi CICD Pipeline Adaptation
date: 2026-05-11
status: Completed
---

## Overview

The CICD pipeline for `mintclientapi-rodit` has been successfully adapted to follow the GHCR-based deployment pattern documented in `CICD_DEPLOYMENT_STANDARD.md`, using `mintrootapi-rodit` as the working example.

## Changes Made

### Workflow Structure: `.github/workflows/deploy.yml`

**Before:** Single monolithic `deploy` job that:
- Checked out code
- Installed Node.js dependencies
- Rsynced entire repo to production host
- Built images locally on the host with `podman build`
- Ran containers with locally-built images

**After:** Two-job pipeline:

#### Job 1: `build-images`
- Runs in GitHub Actions CI environment
- Checks out code at specified commit SHA (supports manual override)
- Sets up Docker Buildx for efficient multi-platform builds
- Authenticates to GHCR using `${{ secrets.GITHUB_TOKEN }}`
- Builds and pushes both images with immutable SHA tags and `latest` tag:
  - `react.Dockerfile` → `ghcr.io/<org>/mintclientapi-rodit/mintclientapi-app:${{ github.sha }}`
  - `nginx.Dockerfile` → `ghcr.io/<org>/mintclientapi-rodit/mintclientapi-nginx:${{ github.sha }}`
- Uses GitHub Actions cache for faster builds

#### Job 2: `test-and-deploy`
- Depends on `build-images` completing successfully
- Installs SSH key for host access
- Creates required directories on host: `certs/`, `logs/`, `nginx/`, `secrets/`
- Authenticates to GHCR on the host using `GHCR_PULL_TOKEN` secret
- Pulls pre-built images from GHCR by SHA tag (immutable)
- Removes old pod/containers
- Creates new pod and runs containers with pulled images
- Verifies containers are running
- Performs health check against the service endpoint

### Environment Variables

All deployment parameters are centralized in the `env` section:

| Variable | Value | Purpose |
|----------|-------|---------|
| `SSH_HOST` | `174.138.10.2` | Production host IP |
| `SSH_USER` | `${{ secrets.SSH_USER }}` | SSH username (secret) |
| `DOMAIN` | `purchase.identyclaw.com` | Service domain for health checks |
| `APP_PORT` | `4443` | HTTPS port |
| `APP_DIR` | `~/mintclientapi-app` | Application directory on host |
| `POD_NAME` | `mintclientapi-pod` | Podman pod name |
| `APP_CONTAINER_NAME` | `mintclientapi-container` | React app container name |
| `NGINX_CONTAINER_NAME` | `mintclientapi-nginx` | Nginx sidecar container name |
| `REGISTRY` | `ghcr.io` | Container registry |
| `APP_IMAGE_NAME` | `${{ github.repository }}/mintclientapi-app` | App image in GHCR |
| `NGINX_IMAGE_NAME` | `${{ github.repository }}/mintclientapi-nginx` | Nginx image in GHCR |
| `HEALTH_CHECK_TIMEOUT` | `120` | Health check timeout (seconds) |
| `HEALTH_CHECK_INTERVAL` | `5` | Health check interval (seconds) |

## Key Benefits

✅ **Immutable Deployments:** Images tagged with commit SHA ensure exact reproducibility  
✅ **No Secrets on Network:** Runtime secrets stored on host, not transmitted via GitHub  
✅ **Faster Deployments:** Pre-built images pulled from GHCR instead of building on host  
✅ **Version History:** Full audit trail in GHCR with all deployed versions  
✅ **Scalability:** Pattern reusable across multiple services  
✅ **Health Checks:** Automated verification that service is responding  

## Required Setup

### 1. GitHub Actions Secrets

Create the following secrets in **Settings → Secrets and variables → Actions**:

- **`GHCR_PULL_TOKEN`** — Classic PAT with `read:packages` scope (shared across repos)
- **`SSH_PRIVATE_KEY`** — SSH private key for production host
- **`SSH_KNOWN_HOSTS`** — Output of `ssh-keyscan 174.138.10.2`
- **`SSH_USER`** — SSH username for production host

### 2. Production Host Setup

On the production host (`174.138.10.2`), create the directory structure:

```bash
mkdir -p ~/mintclientapi-app/{certs,logs,nginx,secrets}
chmod 750 ~/mintclientapi-app/secrets
```

Create `~/mintclientapi-app/secrets/api.env` with runtime environment variables (if needed):

```bash
sudo tee ~/mintclientapi-app/secrets/api.env > /dev/null <<'EOF'
NODE_ENV=production
# Add any runtime env vars here
EOF

sudo chmod 644 ~/mintclientapi-app/secrets/api.env
```

### 3. SSL Certificates

Place SSL certificates in `~/mintclientapi-app/certs/`:

```bash
# fullchain.pem (chmod 644)
# privkey.pem (chmod 640)
```

## Deployment Trigger

The workflow triggers automatically on:
- Push to `idclaw` branch
- Manual trigger via **Actions → Deploy mintclientapi → Run workflow**

For manual deployment of a specific commit:
1. Go to **Actions → Deploy mintclientapi**
2. Click **Run workflow**
3. Enter the commit SHA (optional; defaults to latest)

## Verification

After deployment, verify on the production host:

```bash
# Check images were pulled
podman images | grep ghcr.io

# Check pod and containers
podman pod ls
podman ps -a

# Check container logs
podman logs mintclientapi-container | tail -20
podman logs mintclientapi-nginx | tail -20

# Test the service
curl -k https://purchase.identyclaw.com:4443/health
```

## Differences from mintrootapi-rodit

| Aspect | mintrootapi-rodit | mintclientapi-rodit |
|--------|-------------------|---------------------|
| Branch | `main` | `idclaw` |
| Domain | `root.roditcorp.com` | `purchase.identyclaw.com` |
| Port | `6443` | `4443` |
| App Dockerfile | `react.Dockerfile` | `react.Dockerfile` |
| Nginx Dockerfile | `nginx.Dockerfile` | `nginx.Dockerfile` |
| Container names | `mintrootapi-*` | `mintclientapi-*` |
| Image names | `mintrootapi-app/nginx` | `mintclientapi-app/nginx` |

All other aspects (build process, deployment strategy, health checks) are identical.

## Troubleshooting

### Build Job Fails
- Check Docker Buildx setup in GitHub Actions logs
- Verify `react.Dockerfile` and `nginx.Dockerfile` exist in repo root
- Check for syntax errors in Dockerfiles

### Deploy Job Fails
- Verify `GHCR_PULL_TOKEN` is set and valid
- Check SSH connectivity: `ssh -i <key> $SSH_USER@174.138.10.2`
- Verify host directory structure exists: `ls -la ~/mintclientapi-app/`
- Check `podman login` output for auth errors

### Health Check Fails
- Verify service is listening: `curl -k https://purchase.identyclaw.com:4443/health`
- Check container logs: `podman logs mintclientapi-container`
- Verify SSL certificates are in place: `ls -la ~/mintclientapi-app/certs/`
- Check firewall rules on production host

### Permission Denied on Logs
- Ensure nginx logs directory has correct ownership:
  ```bash
  podman unshare chown -R 101:101 ~/mintclientapi-app/logs/nginx
  chmod 0775 ~/mintclientapi-app/logs/nginx
  ```

## Next Steps

1. ✅ Workflow updated in `.github/workflows/deploy.yml`
2. ⏳ Create GitHub Actions secrets (if not already present)
3. ⏳ Verify production host directory structure
4. ⏳ Provision SSL certificates in `~/mintclientapi-app/certs/`
5. ⏳ Trigger first deployment and verify health checks pass

## References

- `docs/CICD_DEPLOYMENT_STANDARD.md` — Full deployment standard
- `..mintrootapi-rodit/.github/workflows/deploy.yml` — Working example
