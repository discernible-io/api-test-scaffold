#!/usr/bin/env bash
# Local Podman deploy for clienttest-idc — mirrors .github/workflows/deploy.yml on this host.
# CI job build-images pushes to GHCR; locally we podman build (or pull with PULL_FROM_GHCR=1).
#
# Usage (repo root):
#   ./scripts/deploy-local-podman.sh
#   TARGET=main ./scripts/deploy-local-podman.sh
#   ./scripts/deploy-local-podman.sh --skip-build
#   ./scripts/deploy-local-podman.sh --skip-ci
#   ./scripts/deploy-local-podman.sh --skip-enforce
#
# Env (defaults mirror deploy.yml env: block):
#   APP_DIR                  App data root (default: /home/dedalo43/clienttest-app)
#   APP_PORT                 Host/pod port (default: 7443)
#   POD_NAME                 Pod name (default: clienttest-idc-pod)
#   APP_CONTAINER_NAME       API container (default: clienttest-idc-container)
#   NGINX_CONTAINER_NAME     Nginx container (default: clienttest-nginx)
#   TARGET                   development or main (default: current git branch)
#   LOCAL_TAG                Image tag (default: full git SHA, matching github.sha in deploy.yml)
#   HEALTH_CHECK_MAX_ATTEMPTS  Attempts (default: 5, deploy.yml HEALTH_CHECK_MAX_ATTEMPTS)
#   HEALTH_CHECK_INTERVAL    Seconds between attempts (default: 5)
#   USE_LOCAL_RESOLVE        When 1 (default), health check uses curl --resolve to 127.0.0.1
#   PULL_FROM_GHCR           When 1, skip build and podman pull from ghcr.io (needs podman login)
#   REGISTRY                 Default: ghcr.io (deploy.yml REGISTRY)
#   GHCR_IMAGE_PREFIX        owner/repo (default: from git remote origin, else discernible-io/clienttest-idc)
#   REPO_ROOT                Git repo root (default: parent of this script)
#   TRACE                    Set to 1 to enable shell trace (deploy.yml uses set -x on the host)

set -euo pipefail
[[ "${TRACE:-0}" == 1 ]] && set -x

SKIP_BUILD=0
SKIP_CI=0
SKIP_ENFORCE=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-ci) SKIP_CI=1 ;;
    --skip-enforce) SKIP_ENFORCE=1 ;;
    -h|--help)
      sed -n '1,32p' "$0"
      exit 0
      ;;
  esac
done

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_DIR="${APP_DIR:-/home/dedalo43/clienttest-app}"
APP_DIR="${APP_DIR/#\~/$HOME}"

# deploy.yml env: block
APP_PORT="${APP_PORT:-7443}"
POD_NAME="${POD_NAME:-clienttest-idc-pod}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-clienttest-idc-container}"
NGINX_CONTAINER_NAME="${NGINX_CONTAINER_NAME:-clienttest-nginx}"
HEALTH_CHECK_MAX_ATTEMPTS="${HEALTH_CHECK_MAX_ATTEMPTS:-5}"
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-5}"
REGISTRY="${REGISTRY:-ghcr.io}"
USE_LOCAL_RESOLVE="${USE_LOCAL_RESOLVE:-1}"
PULL_FROM_GHCR="${PULL_FROM_GHCR:-0}"

# deploy.yml DOMAIN mapping (must match nginx server_name per branch)
DOMAIN_MAIN="webhook.discernible.io"
DOMAIN_DEVELOPMENT="webhook.dihola.io"

resolve_target() {
  if [[ -n "${TARGET:-}" ]]; then
    printf '%s' "$TARGET"
    return
  fi
  local branch
  branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo development)"
  case "$branch" in
    main) printf '%s' main ;;
    development) printf '%s' development ;;
    *)
      echo "Note: git branch '${branch}' → TARGET=development (set TARGET=main for main config)" >&2
      printf '%s' development
      ;;
  esac
}
TARGET="$(resolve_target)"

if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse HEAD >/dev/null 2>&1; then
  DEFAULT_TAG="$(git -C "$REPO_ROOT" rev-parse HEAD)"
else
  DEFAULT_TAG="local"
fi
LOCAL_TAG="${LOCAL_TAG:-$DEFAULT_TAG}"

case "$TARGET" in
  development)
    NGINX_BUILD_ENV="development"
    API_NODE_ENV="development"
    DOMAIN="$DOMAIN_DEVELOPMENT"
    ;;
  main)
    NGINX_BUILD_ENV="main"
    API_NODE_ENV="main"
    DOMAIN="$DOMAIN_MAIN"
    ;;
  *)
    echo "TARGET must be 'development' or 'main' (got: $TARGET)" >&2
    exit 1
    ;;
esac

# deploy.yml: APP_IMAGE_NAME=${{ github.repository }}/clienttest-idc
ghcr_repo_from_origin() {
  local url origin
  origin="$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null)" || return 1
  case "$origin" in
    git@github.com:*.git) url="${origin#git@github.com:}"; url="${url%.git}" ;;
    https://github.com/*.git) url="${origin#https://github.com/}"; url="${url%.git}" ;;
    *) return 1 ;;
  esac
  printf '%s' "$url"
}
GHCR_IMAGE_PREFIX="${GHCR_IMAGE_PREFIX:-$(ghcr_repo_from_origin || echo discernible-io/clienttest-idc)}"
APP_IMAGE_NAME="${GHCR_IMAGE_PREFIX}/clienttest-idc"
NGINX_IMAGE_NAME="${GHCR_IMAGE_PREFIX}/clienttest-nginx"
APP_IMAGE_LOCAL="localhost/clienttest-idc:${LOCAL_TAG}"
NGINX_IMAGE_LOCAL="localhost/clienttest-nginx:${LOCAL_TAG}"
APP_IMAGE_GHCR="${REGISTRY}/${APP_IMAGE_NAME}:${LOCAL_TAG}"
NGINX_IMAGE_GHCR="${REGISTRY}/${NGINX_IMAGE_NAME}:${LOCAL_TAG}"

SECRETS_FILE="${APP_DIR}/secrets/secrets.env"
TESTING_ENV_FILE="${APP_DIR}/secrets/testing.env"

cd "$REPO_ROOT"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "Missing secrets file: $SECRETS_FILE" >&2
  echo "deploy.yml uses: --env-file …/secrets/secrets.env" >&2
  exit 1
fi

# Build podman --env-file args (absolute paths; deploy.yml must use \$ENV_FILES on remote).
podman_env_file_args() {
  local -a args=(--env-file "$SECRETS_FILE")
  if [[ -f "$TESTING_ENV_FILE" ]]; then
    args+=(--env-file "$TESTING_ENV_FILE")
  fi
  printf '%s\n' "${args[@]}"
}

VERIFY_SECRETS_SCRIPT="${REPO_ROOT}/scripts/verify-deploy-secrets.sh"

verify_host_secrets_env() {
  bash "$VERIFY_SECRETS_SCRIPT" --host-secrets "$SECRETS_FILE"
}

verify_api_container_secrets_env() {
  if ! bash "$VERIFY_SECRETS_SCRIPT" \
    --host-secrets "$SECRETS_FILE" \
    --container "$APP_CONTAINER_NAME"; then
    podman logs "$APP_CONTAINER_NAME" 2>&1 | tail -30 >&2 || true
    return 1
  fi
}

if [[ ! -f "${APP_DIR}/certs/fullchain.pem" ]] || [[ ! -f "${APP_DIR}/certs/privkey.pem" ]]; then
  echo "Missing TLS in ${APP_DIR}/certs/ (fullchain.pem, privkey.pem)" >&2
  exit 1
fi

# Mirrors workflow job build-images: CI validation before image build
ci_validate() {
  echo "==> CI validation (deploy.yml: build-images pre-build steps)"
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "node and npm are required for CI validation" >&2
    exit 1
  fi

  echo "==> Install production dependencies (deploy.yml: Install production dependencies)"
  npm ci --omit=dev

  echo "==> Run CI tests (deploy.yml: Run CI tests)"
  npm test

  echo "==> Audit production dependencies (deploy.yml: Audit production dependencies)"
  npm run audit:production

  echo "==> Scan for secrets (deploy.yml: Scan for secrets)"
  if command -v gitleaks >/dev/null 2>&1; then
    gitleaks detect --source "$REPO_ROOT" --no-banner
  else
    local runtime=""
    if command -v podman >/dev/null 2>&1; then
      runtime=podman
    elif command -v docker >/dev/null 2>&1; then
      runtime=docker
    fi
    if [[ -n "$runtime" ]]; then
      $runtime run --rm -v "${REPO_ROOT}:/repo:ro" docker.io/gitleaks/gitleaks:latest \
        detect --source /repo --no-banner
    else
      echo "Install gitleaks or podman/docker to run secret scan (or use --skip-ci)" >&2
      exit 1
    fi
  fi
}

# Mirrors workflow step: Enforce minimum package age
enforce_minimum_package_age() {
  echo "==> Enforce minimum package age (deploy.yml: Enforce minimum package age)"
  node "${REPO_ROOT}/scripts/enforce-minimum-package-age.sh"
}

# Mirrors workflow job: build-images (local podman build instead of GHCR push)
build_images() {
  echo "==> build-images (local podman build; deploy.yml: Build and push API/Nginx image)"
  podman build -f api.Dockerfile -t "$APP_IMAGE_LOCAL" "$REPO_ROOT"
  podman build -f nginx.Dockerfile \
    --build-arg "NODE_ENV=${NGINX_BUILD_ENV}" \
    -t "$NGINX_IMAGE_LOCAL" \
    "$REPO_ROOT"
}

# Mirrors workflow step: Setup directories and login to GHCR
setup_directories() {
  echo "==> Setup directories and login to GHCR (deploy.yml: Setup directories and login to GHCR)"
  mkdir -p "${APP_DIR}"/{certs,logs,data,nginx,secrets}
  mkdir -p "${APP_DIR}/logs/nginx"
  chmod 711 "${APP_DIR}/certs" || true
  chmod 750 "${APP_DIR}/secrets" || true
  chmod 0775 "${APP_DIR}/logs/nginx" || true
  podman unshare chown -R 101:101 "${APP_DIR}/logs/nginx" || true

  if [[ "$PULL_FROM_GHCR" == 1 ]]; then
    if ! podman login "$REGISTRY" --get-login >/dev/null 2>&1; then
      echo "PULL_FROM_GHCR=1 requires: podman login ${REGISTRY}" >&2
      exit 1
    fi
  fi
}

# Mirrors workflow step: Deploy containers
deploy_containers() {
  echo "==> Deploy containers (deploy.yml: Deploy containers)"
  set -euxo pipefail

  local app_image nginx_image
  if [[ "$PULL_FROM_GHCR" == 1 ]]; then
    app_image="$APP_IMAGE_GHCR"
    nginx_image="$NGINX_IMAGE_GHCR"
    podman pull "$app_image"
    podman pull "$nginx_image"
  else
    app_image="$APP_IMAGE_LOCAL"
    nginx_image="$NGINX_IMAGE_LOCAL"
    podman image exists "$app_image" || { echo "Missing image: $app_image" >&2; exit 1; }
    podman image exists "$nginx_image" || { echo "Missing image: $nginx_image" >&2; exit 1; }
  fi

  cd "$APP_DIR"

  for c in "$APP_CONTAINER_NAME" "$NGINX_CONTAINER_NAME"; do
    podman container exists "$c" && podman rm -f "$c" || true
  done
  podman pod exists "$POD_NAME" && podman pod rm -f "$POD_NAME" || true

  podman pod create --name "$POD_NAME" -p "${APP_PORT}:${APP_PORT}"

  mkdir -p "${APP_DIR}/logs" "${APP_DIR}/data"
  chmod 755 "${APP_DIR}/logs" || true
  podman unshare chown -R "$(id -u):$(id -g)" "${APP_DIR}/logs" "${APP_DIR}/data" || true
  podman unshare chmod g+w "${APP_DIR}/data" || true

  mapfile -t env_file_args < <(podman_env_file_args)
  echo "==> API container env files: ${env_file_args[*]}"
  verify_host_secrets_env

  podman run -d \
    --log-driver=k8s-file \
    --pod "$POD_NAME" \
    --name "$APP_CONTAINER_NAME" \
    --restart=unless-stopped \
    "${env_file_args[@]}" \
    -e "NODE_ENV=${API_NODE_ENV}" \
    -v "${APP_DIR}/logs:/app/logs:Z" \
    -v "${APP_DIR}/data:/app/data:Z" \
    -v "${APP_DIR}/certs:/app/certs:ro,Z" \
    "$app_image"

  podman container exists "$APP_CONTAINER_NAME"
  podman inspect "$APP_CONTAINER_NAME" --format '{{.State.Status}}' | grep -E 'running|created'
  verify_api_container_secrets_env

  mkdir -p "${APP_DIR}/logs/nginx"
  chmod 0775 "${APP_DIR}/logs/nginx" || true
  podman unshare chown -R 101:101 "${APP_DIR}/logs/nginx" || true

  chmod 711 "${APP_DIR}/certs" || true
  CERT_DIR="${APP_DIR}/certs"
  for f in privkey.pem tls.key; do
    if [[ -f "${CERT_DIR}/${f}" ]]; then
      podman unshare chown 101:101 "${CERT_DIR}/${f}" || true
      podman unshare chmod 600 "${CERT_DIR}/${f}" || true
    fi
  done
  for f in fullchain.pem chain.pem cert.pem tls.crt; do
    if [[ -f "${CERT_DIR}/${f}" ]]; then
      podman unshare chown 101:101 "${CERT_DIR}/${f}" || true
      podman unshare chmod 644 "${CERT_DIR}/${f}" || true
    fi
  done

  podman run -d \
    --log-driver=k8s-file \
    --pod "$POD_NAME" \
    --name "$NGINX_CONTAINER_NAME" \
    --restart=unless-stopped \
    -v "${APP_DIR}/certs:/app/certs:ro,Z" \
    -v "${APP_DIR}/logs/nginx:/var/log/nginx:Z" \
    "$nginx_image"

  podman ps -a
  podman logs "$APP_CONTAINER_NAME" || true
  podman logs "$NGINX_CONTAINER_NAME" || true
}

# Mirrors workflow step: Health check
health_check() {
  echo "==> Health check (deploy.yml: Health check)"

  if [[ -z "${DOMAIN}" ]]; then
    echo "::error::DOMAIN is empty. Check deploy.yml DOMAIN mapping for this branch." >&2
    return 1
  fi

  HEALTH_URL="https://${DOMAIN}:${APP_PORT}/health"
  echo "Probing: ${HEALTH_URL}"
  if [[ "$USE_LOCAL_RESOLVE" == 1 ]]; then
    echo "Using curl --resolve ${DOMAIN}:${APP_PORT}:127.0.0.1 (USE_LOCAL_RESOLVE=1; deploy.yml probes public DNS from the runner)"
  fi

  curl_health() {
    if [[ "$USE_LOCAL_RESOLVE" == 1 ]]; then
      curl -sk -m 5 --resolve "${DOMAIN}:${APP_PORT}:127.0.0.1" "${HEALTH_URL}" "$@"
    else
      curl -sk -m 5 "${HEALTH_URL}" "$@"
    fi
  }

  local attempt=0
  while [[ $attempt -lt $HEALTH_CHECK_MAX_ATTEMPTS ]]; do
    if curl_health 2>/dev/null | grep -q healthy; then
      echo "Service is healthy"
      echo "health_status=success"
      return 0
    fi
    attempt=$((attempt + 1))
    echo "Health check attempt ${attempt}/${HEALTH_CHECK_MAX_ATTEMPTS}"
    if [[ $attempt -lt $HEALTH_CHECK_MAX_ATTEMPTS ]]; then
      sleep "$HEALTH_CHECK_INTERVAL"
    fi
  done

  echo "Service failed health check"
  local body code
  body=$(mktemp)
  if [[ "$USE_LOCAL_RESOLVE" == 1 ]]; then
    code=$(curl -sk -m 15 --resolve "${DOMAIN}:${APP_PORT}:127.0.0.1" -o "${body}" -w "%{http_code}" "${HEALTH_URL}") || true
  else
    code=$(curl -sk -m 15 -o "${body}" -w "%{http_code}" "${HEALTH_URL}") || true
  fi
  echo "HTTP status: ${code:-000} (000 usually means no TCP/TLS response from this runner)"
  head -c 800 "${body}" 2>/dev/null || true
  echo
  rm -f "${body}"
  echo "health_status=failed"
  echo "Health check failed - service may not be reachable from this host. Containers were deployed; verify manually."
  return 1
}

echo "==> Repo:       $REPO_ROOT"
echo "==> APP_DIR:    $APP_DIR"
echo "==> TARGET:     $TARGET (nginx NODE_ENV=$NGINX_BUILD_ENV, API NODE_ENV=$API_NODE_ENV)"
echo "==> DOMAIN:     $DOMAIN (deploy.yml health check hostname)"
echo "==> APP_PORT:   $APP_PORT"
echo "==> Image tag:  $LOCAL_TAG (deploy.yml: github.sha)"

if [[ "$PULL_FROM_GHCR" == 1 ]]; then
  echo "==> PULL_FROM_GHCR=1: using GHCR images (CI validation runs in build-images job)"
  setup_directories
elif [[ "$SKIP_BUILD" -eq 0 ]]; then
  if [[ "$SKIP_CI" -eq 0 ]]; then
    ci_validate
  else
    echo "==> Skipping CI validation (--skip-ci)"
  fi
  if [[ "$SKIP_ENFORCE" -eq 0 ]]; then
    enforce_minimum_package_age
  else
    echo "==> Skipping package-age enforcement (--skip-enforce)"
  fi
  build_images
  setup_directories
else
  echo "==> Skipping build (--skip-build)"
  if [[ "$SKIP_CI" -eq 0 ]] && [[ "$PULL_FROM_GHCR" -eq 0 ]]; then
    ci_validate
  fi
  setup_directories
fi

deploy_containers

if health_check; then
  echo "==> Local deploy finished successfully"
  exit 0
fi

if [[ "$USE_LOCAL_RESOLVE" == 1 ]]; then
  echo "Verify manually: curl -sk --resolve \"${DOMAIN}:${APP_PORT}:127.0.0.1\" \"https://${DOMAIN}:${APP_PORT}/health\"" >&2
else
  echo "Verify manually: curl -sk \"https://${DOMAIN}:${APP_PORT}/health\"" >&2
fi
exit 1
