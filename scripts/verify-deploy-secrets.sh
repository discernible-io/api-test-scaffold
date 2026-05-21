#!/usr/bin/env bash
# Verify deploy-time credential env for clienttest-idc (host secrets.env and/or running container).
# Used by deploy-local-podman.sh and .github/workflows/deploy.yml (piped over SSH).
#
# Usage:
#   ./scripts/verify-deploy-secrets.sh --host-secrets /path/to/secrets.env
#   ./scripts/verify-deploy-secrets.sh --container clienttest-idc-container

set -euo pipefail

HOST_SECRETS=""
CONTAINER=""
TESTING_ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host-secrets)
      HOST_SECRETS="${2:?}"
      shift 2
      ;;
    --container)
      CONTAINER="${2:?}"
      shift 2
      ;;
    --testing-env)
      TESTING_ENV="${2:?}"
      shift 2
      ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$HOST_SECRETS" && -z "$CONTAINER" ]]; then
  echo "Specify --host-secrets PATH and/or --container NAME" >&2
  exit 2
fi

# Read KEY=value from env file or container inspect (supports optional 'export ' prefix).
env_get() {
  local key="$1"
  local file="${2:-}"
  if [[ -n "$file" ]]; then
    grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null \
      | tail -1 \
      | sed -E "s/^[[:space:]]*(export[[:space:]]+)?${key}=//"
  else
    # Runtime value (what Node/SDK actually see). More reliable than Config.Env alone.
    podman exec "$CONTAINER" printenv "$key" 2>/dev/null || true
  fi
}

# Fallback: podman inspect Config.Env (matches legacy deploy.yml grep).
container_config_env_get() {
  local key="$1"
  podman inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -E "^${key}=" \
    | tail -1 \
    | sed "s/^${key}=//"
}

warn_testing_env_override() {
  local secrets_file="$1"
  local testing_file="$2"
  [[ -n "$testing_file" && -f "$testing_file" ]] || return 0
  if grep -qE '^[[:space:]]*(export[[:space:]]+)?NEAR_CREDENTIALS_JSON_B64=' "$testing_file" 2>/dev/null; then
    echo "::warning::${testing_file} defines NEAR_CREDENTIALS_JSON_B64 and is passed after secrets.env — it overrides the primary credential in the container" >&2
  fi
}

credential_source() {
  local file="${1:-}"
  local src
  src="$(env_get RODIT_NEAR_CREDENTIALS_SOURCE "$file")"
  if [[ -z "$src" ]]; then
    printf '%s' env
  else
    printf '%s' "$src"
  fi
}

require_non_empty() {
  local label="$1"
  local value="$2"
  if [[ -z "${value// }" ]]; then
    echo "::error::${label} is missing or empty" >&2
    return 1
  fi
  return 0
}

verify_for_source() {
  local source="$1"
  local file="${2:-}"
  local label="${file:-container ${CONTAINER}}"
  local err=0

  case "$source" in
    env)
      require_non_empty "NEAR_CREDENTIALS_JSON_B64 in ${label}" \
        "$(env_get NEAR_CREDENTIALS_JSON_B64 "$file")" || err=1
      ;;
    vault)
      require_non_empty "VAULT_ENDPOINT in ${label}" "$(env_get VAULT_ENDPOINT "$file")" || err=1
      require_non_empty "VAULT_ROLE_ID in ${label}" "$(env_get VAULT_ROLE_ID "$file")" || err=1
      require_non_empty "VAULT_SECRET_ID in ${label}" "$(env_get VAULT_SECRET_ID "$file")" || err=1
      ;;
    file)
      require_non_empty "NEAR_CREDENTIALS_FILE_PATH in ${label}" \
        "$(env_get NEAR_CREDENTIALS_FILE_PATH "$file")" || err=1
      ;;
    *)
      echo "::error::Unsupported RODIT_NEAR_CREDENTIALS_SOURCE=${source} in ${label} (expected env, vault, or file)" >&2
      err=1
      ;;
  esac
  return "$err"
}

print_host_hint() {
  local source="$1"
  cat >&2 <<EOF
Host provisioning (${HOST_SECRETS}):
  - File must exist on the deploy host (never in git).
  - Format: KEY=value per line (no shell export required; export prefix is accepted).
  - For RODIT_NEAR_CREDENTIALS_SOURCE=env (default in config/development.json):
      NEAR_CREDENTIALS_JSON_B64=\$(base64 -w0 /path/to/near-credentials.json)
  - See docs/cicd-deployment-standard.md § Runtime secrets (secrets.env).
EOF
}

status=0

if [[ -n "$HOST_SECRETS" ]]; then
  if [[ ! -f "$HOST_SECRETS" ]]; then
    echo "::error::Missing secrets file on deploy host: ${HOST_SECRETS}" >&2
    exit 1
  fi
  if [[ ! -r "$HOST_SECRETS" ]]; then
    echo "::error::Cannot read secrets file (check permissions): ${HOST_SECRETS}" >&2
    exit 1
  fi
  if [[ -z "$TESTING_ENV" ]]; then
    sibling="$(dirname "$HOST_SECRETS")/testing.env"
    [[ -f "$sibling" ]] && TESTING_ENV="$sibling"
  fi
  warn_testing_env_override "$HOST_SECRETS" "$TESTING_ENV"

  src="$(credential_source "$HOST_SECRETS")"
  if ! verify_for_source "$src" "$HOST_SECRETS"; then
    print_host_hint "$src"
    status=1
  else
    echo "Verified host secrets (${HOST_SECRETS}): RODIT_NEAR_CREDENTIALS_SOURCE=${src}"
  fi
fi

if [[ -n "$CONTAINER" ]]; then
  if ! podman container exists "$CONTAINER" >/dev/null 2>&1; then
    echo "::error::Container not found: ${CONTAINER}" >&2
    exit 1
  fi
  src="$(credential_source "$HOST_SECRETS")"
  if ! verify_for_source "$src"; then
    echo "::error::API container missing required credential env for source=${src}; check --env-file order on podman run" >&2
    if [[ -n "$HOST_SECRETS" && -f "$HOST_SECRETS" ]] && [[ "$src" == env ]]; then
      if grep -qE '^[[:space:]]*(export[[:space:]]+)?NEAR_CREDENTIALS_JSON_B64=' "$HOST_SECRETS" 2>/dev/null; then
        host_val="$(env_get NEAR_CREDENTIALS_JSON_B64 "$HOST_SECRETS")"
        if [[ -n "${host_val// }" ]]; then
          echo "::error::${HOST_SECRETS} sets NEAR_CREDENTIALS_JSON_B64 but the running container does not — likely testing.env override, unreadable env-file for the deploy user, or podman inspect-only false negative (use printenv)" >&2
          warn_testing_env_override "$HOST_SECRETS" "$TESTING_ENV"
        else
          echo "::error::${HOST_SECRETS} has NEAR_CREDENTIALS_JSON_B64= but the value is empty" >&2
        fi
      else
        echo "::error::${HOST_SECRETS} has no NEAR_CREDENTIALS_JSON_B64= line — add credentials before redeploying" >&2
      fi
    fi
    # Legacy CI check used inspect Config.Env; report if printenv works but inspect does not.
    if [[ "$src" == env ]]; then
      runtime_val="$(env_get NEAR_CREDENTIALS_JSON_B64)"
      inspect_val="$(container_config_env_get NEAR_CREDENTIALS_JSON_B64)"
      if [[ -n "${runtime_val// }" && -z "${inspect_val// }" ]]; then
        echo "::warning::NEAR_CREDENTIALS_JSON_B64 is set in the container at runtime (printenv) but missing from podman inspect Config.Env — do not use inspect-only checks in CI" >&2
        echo "Verified container ${CONTAINER} via printenv: RODIT_NEAR_CREDENTIALS_SOURCE=${src}"
        status=0
      fi
    fi
    [[ "$status" -eq 0 ]] || status=1
  else
    echo "Verified container ${CONTAINER}: RODIT_NEAR_CREDENTIALS_SOURCE=${src}"
  fi
fi

exit "$status"
