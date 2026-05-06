# Configuration Standard

Internal conventions for how IDClawserver loads, prioritizes, validates, and **surfaces configuration in logs** safely. Audience: contributors and operators, not API consumers

**Reference implementations**

- Host app entrypoint: [`src/services/sdk-config.service.js`](../src/services/sdk-config.service.js) (preferred import surface)
- SDK resolution logic: `@rodit/rodit-auth-be` → `sdk/services/configsdk.js`
- Checked-in defaults and env mappings: [`config/default.json`](../config/default.json), [`config/custom-environment-variables.json`](../config/custom-environment-variables.json)
- Startup snapshot and redaction: [`src/app.js`](../src/app.js) (`buildStartupConfigSnapshot`, `shouldRedactConfigValue`)

**Related docs:** [`docs/LOGGING_STANDARDS.md`](LOGGING_STANDARDS.md) — effective `LOG_LEVEL` filtering, transports, and how environment ties to verbosity

---

## Configuration sources

| Source | Role |
| --- | --- |
| **Environment variables** | Primary override in deployments and CI. |
| **node-config (`config` package)** | Layered JSON under `config/`: `default.json` plus optional `config/{NODE_ENV}.json`. Maps env names via `custom-environment-variables.json`. |
| **SDK `FALLBACK_DEFAULTS`** | Baked-in defaults shipped with `@rodit/rodit-auth-be` when the host defines no value. |

Enrollment and product copy are **not** part of tunable deployment config—they live under [`src/config/`](../src/config/) (how-to MCP content), separate from [`config/`](../config/) at the repo root.

---

## Priority order (effective value per key)

Resolution is implemented in `configsdk.js` → `get(pathStr, defaultValue)`. For a given key path (for example `NEAR_RPC_URL` or `SECURITY_OPTIONS.LOGIN_MODE`):

1. **`process.env` under the SDK naming convention**  
   The key path is turned into an environment variable name: uppercase, dot segments become underscores (for example `SECURITY_OPTIONS.LOGIN_MODE` → `SECURITY_OPTIONS_LOGIN_MODE`). If that variable is set, its value wins. Boolean and integer-like strings are coerced.

2. **Host `node-config`**  
   Values from `config/default.json` (and any `config/{NODE_ENV}.json` you add) after the `config` package merge rules, including overrides driven by `config/custom-environment-variables.json`.

3. **SDK `FALLBACK_DEFAULTS`**  
   Used only when no value is available from (1) or (2).

4. **Optional `defaultValue` argument to `config.get`**  
   Used only if the key is still undefined. This application does not rely on that path for normal keys; repo defaults belong in `config/default.json`.

**Application rule:** Import configuration only through `require("./services/sdk-config.service")` (or the same re-export from `@rodit/rodit-auth-be`). Do not read `process.env` or `require("config")` directly in new API code so priority stays consistent.

---

## Managing configuration

- **Defaults and non-secret policy** live in [`config/default.json`](../config/default.json). Keep it safe to commit (no private keys, no production-only secrets).
- **Environment-specific layers** use the standard `NODE_ENV` pattern (for example `production`, `development`). Add `config/production.json` when you need values that differ from `default.json` without relying on long env lists.
- **Env → config mapping** is declared in [`config/custom-environment-variables.json`](../config/custom-environment-variables.json). When adding a new tunable key, update that file if operators should set it via a stable env name.
- **Secrets** (tokens, basic auth, private keys) must not appear in logs. They may be present in environment or vault-backed stores per your deployment; the runtime snapshot **redacts** sensitive key paths (see below).

---

## Validation

Before the HTTP server listens, startup calls **`validateConfig(logger)`** from the SDK (`config.validate`). It applies `VALIDATION_RULES` (required keys, types, sanity checks—for example `NEAR_RPC_URL` shape, `NEAR_CONTRACT_ID` non-empty, `LOG_LEVEL` allowed values). Failures abort startup and are logged as errors with structured context.

Operators should fix validation errors at the env or `config/` layer rather than patching code.

---

## Visualization via logs

Configuration is observable in four complementary ways:

### 1. Validation phase (`validateConfig`)

During validation the SDK emits:

- **`info`** when validation starts and when it succeeds.
- **`debug`** lines per validated rule (`key: value`), suitable for diagnosing “what did the server think this was?” without dumping the full tree at `info`.

Use **`LOG_LEVEL=debug`** temporarily when diagnosing misconfiguration; avoid permanent `debug` in high-volume production unless you accept the volume and downstream cost.

### 2. Resolved startup snapshot (`buildStartupConfigSnapshot`)

After startup checks succeed, [`src/app.js`](../src/app.js) logs a single **`info`** event:

- **Message:** structured startup narrative (see [`docs/LOGGING_STANDARDS.md`](LOGGING_STANDARDS.md)).
- **`context.component`:** `IDClawserverAPI`.
- **`context.config`:** flattened object of **effective** keys and values (`config.get(key)` after priority resolution).

Keys matching sensitive substrings (**password, secret, token, private key, basic auth, credential**) are replaced with **`[REDACTED]`** before logging. This is intentional: the snapshot proves *which* knobs were resolved, not secret material.

Filtering tips:

- Query logs for `Resolved configuration at startup` and the `config` payload.
- Correlate with the same boot cycle using `hostname` / `pid` fields from the logger (see [`sdk/services/logger.js`](../sdk/services/logger.js)).

### 3. Server listen confirmation

When the listener starts, **`IDClawserver API server logged at `info`** includes **`port`**, **`logLevel`**, and **`service`** (from resolved config). Quick sanity check that `SERVERPORT` and `LOG_LEVEL` match expectations.

### 4. Read-only exposure to tools (MCP)

The MCP resource **`config:default`** returns a **small, non-secret subset** of configuration (for example `METHOD_PERMISSION_MAP`, `SERVERPORT`, `SERVICE_NAME`, `LOG_LEVEL`). This complements logs: agents can introspect advertised surface area without scraping full startup payloads.

Operational state of dependencies—not full config—is reported on **`GET /health`** (NEAR RPC probe, Rodit client readiness). Use it for uptime and degraded behavior; use startup logs for “what configuration did this instance apply?”.

---

## Review checklist (changes to config behavior)

- New tunable behavior uses `sdk-config.service` / `config.get`, not ad-hoc `process.env`.
- New secrets or credentials are excluded from **`config/default.json`** and from MCP config resources.
- If a key appears in startup logs, sensitive values remain behind **`shouldRedactConfigValue`** logic or equivalent.
- **`custom-environment-variables.json`** is updated when operators need a documented env knob.
- **`VALIDATION_RULES`** (or upstream validation) covers any new mandatory production settings.
