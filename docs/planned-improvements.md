# Planned Improvements

This document tracks code quality, security, and operational improvements for future implementation. Items are **ordered from lowest to highest combined risk and workload**: earlier entries are comparatively safer and quicker wins; later entries tend to need more design, testing, or deployment care (including breaking or security-sensitive changes).

---

### 4. Graceful fallback for `REJECTED_COUNTRIES_B64`

**Status:** Planned  
**Severity:** Low  
**Location:** `src/protected/signportal.js` (module load / `getRejectedCountries`)

**Issue:**  
Malformed or missing config can throw at import time and prevent the process from starting.

**Expected fix:**  
Catch parse failures, log a warning, and fall back to an empty reject list (or other explicitly documented safe default); document operational behavior.

**Impact:** Better resilience; deliberate tradeoff on strict vs. available service.

---

### 5. Fix token validation regex (`facialTokenId`)

**Status:** Planned  
**Severity:** Medium  
**Location:** `src/utils/facialTokenId.js`

**Issue:**  
Validation may be looser than the intended safe charset / length for facial token IDs.

**Expected fix:**  
Align regex and length checks with `CHARSET_EVEN` / `CHARSET_ODD` and documented wire format; add tests.

**Impact:** Stricter acceptance rules—verify no legitimate clients rely on previously accepted shapes.

---

### 6. Improve key handling in `getPublicKeyBytes`

**Status:** Planned  
**Severity:** Medium  
**Location:** `src/protected/signportal.js`

**Issue:**  
Assumptions about `signingBytesKey` shape can produce cryptic failures.

**Expected fix:**  
Validate type/length explicitly and throw clear errors before crypto calls.

**Impact:** Safer diagnostics; localized change.

---

### 7. Handle async logout correctly

**Status:** Planned  
**Severity:** Medium  
**Location:** `src/app.js` (`POST /api/logout`)

**Issue:**  
`roditClient.logoutClient(req, res)` is not awaited; async failures may become unhandled rejections depending on SDK implementation.

**Expected fix:**  
Confirm SDK contract; if async, use `async` handler, `await`, and consistent error delegation (`next(err)` or SDK pattern).

**Impact:** More predictable error surfaces.

---

### 8. Clarify login endpoint error handling

**Status:** Planned  
**Severity:** Medium  
**Location:** `src/app.js` (`POST /api/login`)

**Issue:**  
Outer `try/catch` may race with `login_client` if it already sends a response (“headers already sent”).

**Expected fix:**  
Document and align with SDK behavior; adjust wrapper or error flow; add integration tests for failure paths.

**Impact:** Fewer double-response bugs and clearer login failure semantics.

---

### 9. Reduce and redact debug logging in signing paths

**Status:** Planned  
**Severity:** Low–medium (security/ops)  
**Location:** `src/protected/signportal.js`, `src/protected/signroot.js`

**Issue:**  
Verbose `debug` / string-built logs may dump full structures (`JSON.stringify` of sign data, hash inputs, etc.), conflicting with [`docs/logging-standard.md`](logging-standard.md) redaction guidance and increasing leak surface in log aggregators.

**Expected fix:**  
Log shape/presence only; gate detailed dumps on `LOG_LEVEL`; remove `[DEBUG]` / “critical debug” patterns from default paths; prefer allowlisted fields.

**Impact:** Lower PII/sensitive-data exposure and log volume; may require operators to use `debug` tier for deep dives.

---

### 10. Standardize JSON error response shape

**Status:** Planned  
**Severity:** Medium (API contract)  
**Location:** `signportal.js`, `signroot.js`, `app.js`

**Issue:**  
Clients see inconsistent fields (`error` vs `message`, optional `timestamp` / `requestId`, etc.).

**Expected fix:**  
Define a single schema (aligned with [`docs/error-handling-standard.md`](error-handling-standard.md)); apply across routes; version or document breaking changes if needed.

**Impact:** Easier client handling; may require client updates if responses change.

---

### 11. Centralize HTTP errors: `next(err)` and correct status in global handler

**Status:** Planned  
**Severity:** Medium  
**Location:** `src/app.js` and route modules

**Issue:**  
Many paths call `res.status(...).json(...)` directly; global error middleware logs `err.statusCode` but still responds with a fixed `500` to clients. That diverges from [`docs/error-handling-standard.md`](error-handling-standard.md).

**Expected fix:**  
Prefer `next(err)` for unexpected failures; in the error middleware, use `err.statusCode` / `err.status` when set and safe; return stable generic bodies for unknown errors in production.

**Impact:** More accurate HTTP semantics and one consistent error path; requires regression testing.

---

### 12. Structured logging consistency (`*WithContext`, correlation, canonical error object)

**Status:** Planned  
**Severity:** Medium  
**Location:** `src/` (especially `protected/*.js`)

**Issue:**  
Mixed `logger.info(message, meta)`, string-only messages, and inconsistent `component` / `requestId` usage; some failures log `error` as a bare string instead of the canonical nested shape described in [`docs/logging-standard.md`](logging-standard.md).

**Expected fix:**  
Migrate opportunistically when touching files: prefer `*WithContext`, always include `component`, include `requestId` on request-scoped events, pass `Error` as the third argument to `errorWithContext` where applicable.

**Impact:** Better observability; broad churn—avoid big-bang refactors.

---

### 13. Fix race condition in signer initialization

**Status:** Planned  
**Severity:** High  
**Location:** `src/protected/signportal.js`, `src/protected/signroot.js`

**Issue:**  
Check-then-act on `req.app.locals.roditSignerClient` allows concurrent double initialization.

**Expected fix:**  
Promise-based single-flight initialization (or equivalent mutex) so only one initializer runs and all awaiters share the result.

**Impact:** Correctness under concurrency; subtle bugs if implemented wrong—test load scenarios.

---

### 14. Enforce consistent fee validation across signing endpoints

**Status:** Planned  
**Severity:** High  
**Location:** `src/protected/signportal.js` vs `src/protected/signroot.js`

**Issue:**  
Portal path may accept fees differently from root path, enabling inconsistent or manipulable fee behavior.

**Expected fix:**  
Unify rules with `MINTING_FEE` (or document and enforce a deliberate, reviewed exception).

**Impact:** Billing integrity; **may break** clients that relied on relaxed portal behavior—coordinate rollout.

---

### 15. Add authentication to `/api/root` (signroot)

**Status:** Planned  
**Severity:** Critical (security)  
**Location:** `src/app.js` (route registration)

**Issue:**  
`/api/root` may be registered without `roditClient.authenticate`, unlike `/api/portal`, allowing unauthenticated signing if enabled.

**Expected fix:**  
`app.use("/api/root", roditClient.authenticate, signrootprotectedRoute)` (or equivalent), with tests and docs.

**Impact:** Closes a critical exposure; **breaking** for anyone depending on anonymous access—must be explicit in release notes.

---

### 16. Platform, dependency, and CI upgrades

**Status:** Planned  
**Severity:** Medium–high (supply chain, runtime drift)  
**Location:** `package.json`, `package-lock.json`, `api.Dockerfile`, `.github/workflows/deploy.yml`

**Context:**  
Review of `package.json`, `package-lock.json`, `api.Dockerfile`, and `.github/workflows/deploy.yml` for update opportunities beyond application code. The nginx service image was separately pinned to a concrete tag and manifest-list digest; the API image and Node/npm pipeline may still use floating tags and non-reproducible installs.

**Opportunities**

| Area | Current state | Suggested direction |
|------|----------------|---------------------|
| **`package.json` / npm** | Carets on many direct deps; `npm outdated` shows headroom on e.g. express, express-rate-limit, config, tldts, winston, nodemon within semver ranges; **node-vault** resolves to 0.10.x while **0.12.x** exists; **bs58** has a **6.x** major. | Routine minor/patch bumps with smoke tests (health, auth, Vault). Evaluate **bs58** 6.x only if needed (breaking risk). |
| **Dependency hygiene** | **`nodemon`** is under **`dependencies`** but production Docker runs **`node`** directly; **`base64-url`** and **`base64url`** both present. | Move **nodemon** to **`devDependencies`** once local workflow installs dev deps; consolidate base64 packages if code allows. |
| **`engines`** | Not set. | Add e.g. `"engines": { "node": ">=20 <23" }` (adjust when adopting Node 22) so CI, Docker, and laptops agree. |
| **`api.Dockerfile`** | **`FROM node:20-alpine`** (floating minor); **`COPY package.json`** only then **`npm install --production`** (lockfile excluded by design). | Pin base image to explicit **20.x** or **22.x** plus **digest** (same pattern as pinned nginx). Copy **`package-lock.json`** and use **`npm ci --omit=dev`** for reproducible transitive versions. |
| **Node 20 → 22** | Runtime is Node 20 line. | Evaluate **Node 22 LTS** when **`@rodit/rodit-auth-be`** and the rest of the stack support it; confirm against the [Node.js release schedule](https://github.com/nodejs/release#release-schedule). |
| **`deploy.yml`** | Official actions use major version tags (**`@v3`**, **`@v4`**, **`@v6`**); third-party **`shimataro/ssh-key-action@v2`**. | Optionally pin actions to **full semver or commit SHA**; pin third-party action to a **commit SHA** and bump deliberately. Optional **`concurrency`** group so concurrent deploys to the same environment do not overlap. |

**Benefits**

- **Security and bugs:** newer patch/minor releases often fix CVEs and defects without API changes.
- **Reproducible images:** `package-lock.json` + **`npm ci`** yields the same dependency graph on every build, improving incident response and reducing “works on my machine” drift.
- **Predictable runtime:** pinned Node image digest avoids silent base-image changes between deploys.
- **Node 22 (when adopted):** performance and V8 improvements; aligns with current LTS positioning as Node 20 ages (verify schedule at implementation time).
- **CI pinning:** less exposure to retagged or compromised action versions.

**Risks**

- **Any dependency or Node bump** can change runtime behavior; **express**, **rate-limit**, and **Vault** paths deserve a focused smoke test. Private **`@rodit/rodit-auth-be`** may constrain how aggressively other packages move.
- **`npm ci`** fails if lockfile and `package.json` disagree—operational discipline to update the lock when changing deps.
- **Node 22:** possible breakage in native addons or older patterns; validate in staging before production.
- **Major bumps (e.g. bs58 6):** API changes possible; treat as a small migration.
- **SHA-pinned actions:** more manual churn to pick up legitimate fixes from upstream actions.

**Implementation notes (phasing)**

1. Prefer **lockfile + `npm ci`** and **pinned Node digest** first (largest supply-chain win vs. effort).
2. Then **routine npm** updates within semver, then evaluate **Node 22** with `engines` and integration checks.
3. Finally **workflow hardening** (SHA pins, concurrency) as policy allows.

**Impact:** Broad effort and regression surface; schedule after higher-leverage product fixes unless driven by CVE or compliance deadlines.

---

## Implementation notes

- **Testing:** Each improvement should include unit and/or integration tests where applicable.
- **Documentation:** Update API docs, [`docs/configuration-standard.md`](configuration-standard.md), [`docs/logging-standard.md`](logging-standard.md), and [`docs/error-handling-standard.md`](error-handling-standard.md) when behavior changes.
- **Backwards compatibility:** Call out breaking changes (especially items **15**, **14**, **10**) in release notes.
- **Performance:** Review concurrency fixes and additional validation under expected load.
