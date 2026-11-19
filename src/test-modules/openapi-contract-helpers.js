/**
 * Shared helpers for OpenAPI / target-swagger.json contract probes (direct HTTP).
 * Used by discovery, authentication-comprehensive, session-management, and DID integration tests.
 */

"use strict";

const crypto = require("crypto");
const { ulid } = require("ulid");
const {
  captureTestData,
  getRoditClientForTest,
  extractApiErrorInfo,
} = require("./test-utils");

async function readResponseBodySafe(response) {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw;
    }
  }
  return raw;
}

function hasStructuredErrorPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.error && typeof payload.error === "object" && payload.error.message) return true;
  if (typeof payload.message === "string") return true;
  if (typeof payload.code === "string") return true;
  return false;
}

/** Unified ErrorResponse ({ error: { code } }) or SDK login_client flat shape ({ error: "CODE", message }) */
function extractLoginOrApiErrorCode(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.error === "string") return payload.error;
  if (payload.error && typeof payload.error === "object" && typeof payload.error.code === "string") {
    return payload.error.code;
  }
  return null;
}

async function buildLikelyValidLoginBody(apiEndpoint) {
  let tokenId = "bjbvcjzqbdsj";
  try {
    const client = await getRoditClientForTest();
    const cfg = await client.getConfigOwnRodit();
    tokenId = cfg?.own_rodit?.token_id || cfg?.own_rodit?.tokenId || tokenId;
  } catch (_) {
    // Keep deterministic fallback token id.
  }

  const tsResp = await fetch(`${apiEndpoint}/api/login/timestamp`, { method: "GET" });
  const tsBody = await readResponseBodySafe(tsResp);
  const timestamp = Number(tsBody?.timestamp) || Math.floor(Date.now() / 1000);

  return {
    roditid: tokenId,
    timestamp,
    roditid_base64url_signature: crypto.randomBytes(64).toString("base64url"),
  };
}

/**
 * Direct HTTP probe: API should reject invalid method, query, or payload (HTTP >= minStatus).
 */
async function probeHttpRejection(apiEndpoint, path, options = {}) {
  const {
    method = "POST",
    headers = {},
    body,
    minStatus = 400,
  } = options;

  const response = await fetch(`${apiEndpoint}${path}`, {
    method,
    headers: {
      "X-Request-ID": ulid(),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  });

  const payload = await readResponseBodySafe(response);
  return {
    status: response.status,
    rejected: response.status >= minStatus,
    hasStructuredError: hasStructuredErrorPayload(payload),
    bodySnippet:
      typeof payload === "string"
        ? payload.slice(0, 220)
        : JSON.stringify(payload).slice(0, 220),
  };
}

async function runOpenapiContractCase(
  moduleName,
  testName,
  apiEndpoint,
  endpointPathSuffix,
  contract,
  execute,
) {
  const correlationId = ulid();
  const testData = {
    endpoint: `${apiEndpoint}${endpointPathSuffix}`,
    contract,
    correlationId,
  };

  try {
    const details = await execute(correlationId);
    const result = { passed: true, details };
    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    const errorInfo = extractApiErrorInfo(error);
    const result = {
      passed: false,
      error: error.message,
      errorInfo,
      stack: error.stack,
    };
    return captureTestData(testName, moduleName, result, testData);
  }
}

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

/**
 * Classify one OpenAPI operation's security requirement into the documented access model.
 * Public: empty security. Authenticated: BearerAuth only. Privileged: BearerAuth + RoditPermissionedRoutes.
 */
function classifyOpenApiOperationSecurity(operation, documentSecurity = []) {
  const security =
    operation && Object.prototype.hasOwnProperty.call(operation, "security")
      ? operation.security
      : documentSecurity;

  if (!Array.isArray(security) || security.length === 0) {
    return { kind: "public", scopes: [], allowsAnonymous: true };
  }

  // Optional-auth ops (e.g. identity/verify): [{}, { BearerAuth: [] }]
  const hasAnonymousAlternative = security.some(
    (req) => req && typeof req === "object" && Object.keys(req).length === 0,
  );
  const nonEmpty = security.filter(
    (req) => req && typeof req === "object" && Object.keys(req).length > 0,
  );

  let hasBearer = false;
  let hasPermissionedRoutes = false;
  const scopes = [];

  for (const req of nonEmpty) {
    if (Object.prototype.hasOwnProperty.call(req, "BearerAuth")) {
      hasBearer = true;
    }
    if (Object.prototype.hasOwnProperty.call(req, "RoditPermissionedRoutes")) {
      hasPermissionedRoutes = true;
      const routeScopes = req.RoditPermissionedRoutes;
      if (Array.isArray(routeScopes)) {
        scopes.push(...routeScopes);
      }
    }
  }

  if (hasAnonymousAlternative && hasBearer && !hasPermissionedRoutes) {
    return { kind: "public-or-authenticated", scopes, allowsAnonymous: true };
  }
  if (hasBearer && hasPermissionedRoutes) {
    return { kind: "privileged", scopes, allowsAnonymous: false };
  }
  if (hasBearer) {
    return { kind: "authenticated", scopes, allowsAnonymous: false };
  }
  return { kind: "other", scopes, allowsAnonymous: hasAnonymousAlternative };
}

/**
 * Walk paths and return classified operations for access-model contract checks.
 */
function listOpenApiOperations(doc) {
  const operations = [];
  const paths = doc?.paths && typeof doc.paths === "object" ? doc.paths : {};
  const documentSecurity = Array.isArray(doc?.security) ? doc.security : [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== "object") {
        continue;
      }
      const classification = classifyOpenApiOperationSecurity(operation, documentSecurity);
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId || null,
        accessLevel: operation["x-access-level"] || null,
        classification,
        security: operation.security,
      });
    }
  }
  return operations;
}

/**
 * Validate OpenAPI 1.1.9+ access model: security schemes, x-access-level, privileged scopes.
 * @returns {{ passed: boolean, errors: string[], summary: object }}
 */
function validateOpenApiAccessModel(doc) {
  const errors = [];
  const schemes = doc?.components?.securitySchemes || {};

  if (!schemes.BearerAuth) {
    errors.push("components.securitySchemes.BearerAuth is required");
  }
  if (!schemes.RoditPermissionedRoutes) {
    errors.push("components.securitySchemes.RoditPermissionedRoutes is required");
  }

  const declaredScopes = Object.keys(
    schemes.RoditPermissionedRoutes?.flows?.clientCredentials?.scopes || {},
  );

  const avatarSchema = doc?.components?.schemas?.AvatarContentHash;
  if (!avatarSchema) {
    errors.push("components.schemas.AvatarContentHash is required");
  } else {
    const required = Array.isArray(avatarSchema.required) ? avatarSchema.required : [];
    for (const field of [
      "algorithm",
      "digestBytes",
      "encoding",
      "affectsVerified",
      "compared",
      "match",
      "reason",
    ]) {
      if (!required.includes(field)) {
        errors.push(`AvatarContentHash.required must include "${field}"`);
      }
      if (!avatarSchema.properties?.[field]) {
        errors.push(`AvatarContentHash.properties.${field} is required`);
      }
    }
    const reasonEnum = avatarSchema.properties?.reason?.enum;
    if (!Array.isArray(reasonEnum)) {
      errors.push("AvatarContentHash.properties.reason.enum is required");
    } else {
      for (const code of AVATAR_CONTENT_HASH_REASONS) {
        if (!reasonEnum.includes(code)) {
          errors.push(`AvatarContentHash.reason.enum missing "${code}"`);
        }
      }
    }
    if (avatarSchema.properties?.affectsVerified?.enum?.[0] !== false) {
      errors.push("AvatarContentHash.affectsVerified.enum must be [false]");
    }
  }

  const infoVersion = String(doc?.info?.version || "");
  {
    const parts = infoVersion.split(".").map((p) => Number.parseInt(p, 10));
    const [major = 0, minor = 0, patch = 0] = parts;
    const tooOld =
      !infoVersion ||
      Number.isNaN(major) ||
      Number.isNaN(minor) ||
      Number.isNaN(patch) ||
      major < 1 ||
      (major === 1 && minor < 1) ||
      (major === 1 && minor === 1 && patch < 9);
    if (tooOld) {
      errors.push(`info.version must be 1.1.9+ for access-model contract (got ${infoVersion || "missing"})`);
    }
  }

  const accessDescription = String(doc?.info?.description || "");
  for (const needle of ["Public:", "Authenticated:", "Privileged", "RoditPermissionedRoutes"]) {
    if (!accessDescription.includes(needle)) {
      errors.push(`info.description must document access model term "${needle}"`);
    }
  }

  const operations = listOpenApiOperations(doc);
  const privileged = [];
  const authenticated = [];
  const publicOps = [];
  const mixed = [];

  for (const op of operations) {
    const { kind, scopes } = op.classification;
    const level = op.accessLevel;

    if (kind === "privileged") {
      privileged.push(op);
      if (level && level !== "privileged") {
        errors.push(`${op.method} ${op.path}: security is privileged but x-access-level=${level}`);
      }
      if (!scopes.includes(op.path)) {
        errors.push(
          `${op.method} ${op.path}: RoditPermissionedRoutes scopes must include exact path (got ${JSON.stringify(scopes)})`,
        );
      }
      if (!declaredScopes.includes(op.path)) {
        errors.push(
          `${op.method} ${op.path}: path missing from RoditPermissionedRoutes.flows.clientCredentials.scopes`,
        );
      }
    } else if (kind === "authenticated") {
      authenticated.push(op);
      if (level && level !== "authenticated") {
        errors.push(`${op.method} ${op.path}: security is authenticated but x-access-level=${level}`);
      }
      if (scopes.length > 0) {
        errors.push(`${op.method} ${op.path}: authenticated ops must not declare permissioned route scopes`);
      }
    } else if (kind === "public-or-authenticated") {
      mixed.push(op);
      if (level && level !== "public-or-authenticated") {
        errors.push(
          `${op.method} ${op.path}: security is public-or-authenticated but x-access-level=${level}`,
        );
      }
    } else if (kind === "public") {
      publicOps.push(op);
      if (level && level !== "public") {
        errors.push(`${op.method} ${op.path}: security is public but x-access-level=${level}`);
      }
    } else {
      errors.push(`${op.method} ${op.path}: unrecognized security classification "${kind}"`);
    }

    if (!level) {
      errors.push(`${op.method} ${op.path}: missing x-access-level`);
    }
  }

  if (privileged.length === 0) {
    errors.push("expected at least one privileged operation");
  }
  if (authenticated.length === 0) {
    errors.push("expected at least one authenticated operation");
  }

  // Declared OAuth scopes should match privileged paths 1:1
  const privilegedPaths = new Set(privileged.map((op) => op.path));
  for (const scope of declaredScopes) {
    if (!privilegedPaths.has(scope)) {
      errors.push(`RoditPermissionedRoutes scope "${scope}" has no matching privileged path operation`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    summary: {
      version: infoVersion,
      schemeNames: Object.keys(schemes),
      declaredScopes,
      counts: {
        public: publicOps.length,
        authenticated: authenticated.length,
        "public-or-authenticated": mixed.length,
        privileged: privileged.length,
        total: operations.length,
      },
      privilegedPaths: [...privilegedPaths].sort(),
      authenticatedSample: authenticated.slice(0, 5).map((op) => `${op.method} ${op.path}`),
    },
  };
}

/** Privileged path list from OpenAPI (metrics/sessions admin surface). */
function listPrivilegedPathsFromOpenApi(doc) {
  return listOpenApiOperations(doc)
    .filter((op) => op.classification.kind === "privileged")
    .map((op) => ({ method: op.method, path: op.path, scopes: op.classification.scopes }));
}

/** Authenticated-only path list (BearerAuth, no RoditPermissionedRoutes). */
function listAuthenticatedPathsFromOpenApi(doc) {
  return listOpenApiOperations(doc)
    .filter((op) => op.classification.kind === "authenticated")
    .map((op) => ({ method: op.method, path: op.path }));
}

/** OpenAPI 1.1.9+ AvatarContentHash.reason enum. */
const AVATAR_CONTENT_HASH_REASONS = new Set([
  "match",
  "mismatch",
  "no_avatar_url",
  "token_missing",
  "invalid_url",
  "missing_filename",
  "unsupported_scheme",
  "blocked_target",
  "dns_failed",
  "redirect_unsupported",
  "http_error",
  "empty_body",
  "too_large",
  "timeout",
  "fetch_failed",
]);

/** SecurityAssurance.code enum from target-swagger.json. */
const SECURITY_ASSURANCE_CODES = new Set([
  "UNIQUE_PASSPORT",
  "CURRENT_CONTROLLER",
  "ACTIVE_LIFECYCLE",
  "FRESH_PROOF",
  "INTENDED_RECIPIENT",
  "ACCOUNT_PRIMARY",
]);

/** Machine-readable failureReasons on HTTP 200 verify responses. */
const VERIFY_FAILURE_REASONS = new Set([
  "timestamp_stale_or_future",
  "nonce_replay",
  "token_missing",
  "token_expired",
  "signature_invalid",
  "public_key_unavailable",
  "public_key_error",
  "subagent_public_key_invalid_length",
  "subagent_public_key_decode_failed",
  "destinatary_mismatch",
  "not_account_primary_passport",
]);

/** Required boolean flags on verify `checks` (OpenAPI 1.1.9+). */
const VERIFY_CHECK_FIELDS = [
  "tokenExists",
  "tokenActive",
  "timestampFresh",
  "nonceReplaySafe",
  "signatureValid",
  "checksumValid",
  "destinataryMatch",
  "accountPrimaryPassport",
];

/**
 * Validate SecurityAssurance[] per target-swagger.json.
 *
 * @param {unknown} value
 * @returns {{ passed: boolean, errors: string[], summary: object|null }}
 */
function validateSecurityAssurances(value) {
  const errors = [];
  if (!Array.isArray(value)) {
    return {
      passed: false,
      errors: ["assurances must be an array"],
      summary: null,
    };
  }
  if (value.length === 0) {
    errors.push("assurances must not be empty");
  }

  const seen = new Set();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`assurances[${i}] must be an object`);
      continue;
    }
    if (typeof entry.code !== "string" || !SECURITY_ASSURANCE_CODES.has(entry.code)) {
      errors.push(`assurances[${i}].code must be a documented enum value (got ${JSON.stringify(entry.code)})`);
    } else if (seen.has(entry.code)) {
      errors.push(`assurances[${i}].code duplicate ${entry.code}`);
    } else {
      seen.add(entry.code);
    }
    if (typeof entry.satisfied !== "boolean") {
      errors.push(`assurances[${i}].satisfied must be boolean`);
    }
    if (typeof entry.summary !== "string" || entry.summary.length === 0) {
      errors.push(`assurances[${i}].summary must be a non-empty string`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    summary: {
      count: value.length,
      codes: value.map((e) => e?.code).filter(Boolean),
      unsatisfied: value.filter((e) => e && e.satisfied === false).map((e) => e.code),
    },
  };
}

/**
 * Validate HTTP 200 verify-shaped body (identity/verify, hola/drop/take, hola/offer/take).
 * Required: verified, peerTokenId, checks (+ new flags), failureReasons, failureDetails,
 * assurances, signatureVerificationImplemented, notBefore, notAfter, avatarContentHash, requestId.
 *
 * @param {unknown} body
 * @param {{ requireHola?: boolean, omitHola?: boolean }} [options]
 * @returns {{ passed: boolean, errors: string[], summary: object }}
 */
function validateVerifyResponseShape(body, options = {}) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      passed: false,
      errors: ["verify response must be a non-null object"],
      summary: {},
    };
  }

  if (typeof body.verified !== "boolean") {
    errors.push("verified must be boolean");
  }
  if (typeof body.peerTokenId !== "string") {
    errors.push("peerTokenId must be a string");
  }
  if (typeof body.signatureVerificationImplemented !== "boolean") {
    errors.push("signatureVerificationImplemented must be boolean");
  }
  if (typeof body.requestId !== "string" || !body.requestId) {
    errors.push("requestId must be a non-empty string");
  }
  // Required nullable strings: key must be present; value may be null.
  for (const field of ["notBefore", "notAfter"]) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) {
      errors.push(`${field} is required (nullable string)`);
    } else if (!(body[field] === null || typeof body[field] === "string")) {
      errors.push(`${field} must be string or null`);
    }
  }
  if (!Array.isArray(body.failureReasons)) {
    errors.push("failureReasons must be an array");
  } else {
    for (const reason of body.failureReasons) {
      if (typeof reason !== "string" || !VERIFY_FAILURE_REASONS.has(reason)) {
        errors.push(`failureReasons contains undocumented code ${JSON.stringify(reason)}`);
      }
    }
    if (body.verified === true && body.failureReasons.length !== 0) {
      errors.push("verified=true requires empty failureReasons");
    }
  }
  if (!Array.isArray(body.failureDetails)) {
    errors.push("failureDetails must be an array");
  }

  if (!body.checks || typeof body.checks !== "object" || Array.isArray(body.checks)) {
    errors.push("checks must be an object");
  } else {
    for (const field of VERIFY_CHECK_FIELDS) {
      if (typeof body.checks[field] !== "boolean") {
        errors.push(`checks.${field} must be boolean`);
      }
    }
  }

  const assurances = validateSecurityAssurances(body.assurances);
  if (!assurances.passed) {
    errors.push(...assurances.errors);
  }

  const avatarHash = validateAvatarContentHash(body.avatarContentHash);
  if (!avatarHash.passed) {
    errors.push(...avatarHash.errors.map((e) => `avatarContentHash: ${e}`));
  }

  if (options.requireHola && typeof body.hola !== "string") {
    errors.push("hola must be a string on drop/take responses");
  }
  if (options.omitHola && Object.prototype.hasOwnProperty.call(body, "hola") && body.hola != null) {
    errors.push("hola must be omitted on offer/take responses");
  }

  if (Array.isArray(body.warnings)) {
    for (let i = 0; i < body.warnings.length; i++) {
      const w = body.warnings[i];
      if (!w || typeof w !== "object") {
        errors.push(`warnings[${i}] must be an object`);
        continue;
      }
      if (w.code !== "RECIPIENT_MISMATCH") {
        errors.push(`warnings[${i}].code must be RECIPIENT_MISMATCH (got ${JSON.stringify(w.code)})`);
      }
      if (typeof w.message !== "string") {
        errors.push(`warnings[${i}].message must be a string`);
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    summary: {
      verified: body.verified,
      peerTokenId: body.peerTokenId,
      failureReasons: body.failureReasons,
      assurances: assurances.summary,
      avatarContentHash: avatarHash.summary,
    },
  };
}

/**
 * Validate AvatarContentHash per target-swagger.json (required fields + enums).
 * Informational only: affectsVerified must always be false.
 *
 * @param {unknown} value
 * @returns {{ passed: boolean, errors: string[], summary: object|null }}
 */
function validateAvatarContentHash(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      passed: false,
      errors: ["avatarContentHash must be a non-null object"],
      summary: null,
    };
  }

  if (value.algorithm !== "BLAKE3") {
    errors.push(`algorithm must be BLAKE3 (got ${JSON.stringify(value.algorithm)})`);
  }
  if (value.digestBytes !== 16) {
    errors.push(`digestBytes must be 16 (got ${JSON.stringify(value.digestBytes)})`);
  }
  if (value.encoding !== "base64url") {
    errors.push(`encoding must be base64url (got ${JSON.stringify(value.encoding)})`);
  }
  if (value.affectsVerified !== false) {
    errors.push(`affectsVerified must be false (got ${JSON.stringify(value.affectsVerified)})`);
  }
  if (typeof value.compared !== "boolean") {
    errors.push(`compared must be boolean (got ${JSON.stringify(value.compared)})`);
  }
  if (!(value.match === null || typeof value.match === "boolean")) {
    errors.push(`match must be boolean or null (got ${JSON.stringify(value.match)})`);
  }
  if (typeof value.reason !== "string" || !AVATAR_CONTENT_HASH_REASONS.has(value.reason)) {
    errors.push(`reason must be a documented enum value (got ${JSON.stringify(value.reason)})`);
  }

  // Spec consistency: no comparison ⇒ match is null; comparison ⇒ match is boolean.
  if (value.compared === false && value.match !== null) {
    errors.push("when compared is false, match must be null");
  }
  if (value.compared === true && typeof value.match !== "boolean") {
    errors.push("when compared is true, match must be boolean");
  }
  if (value.reason === "match" && value.match !== true) {
    errors.push("reason=match requires match=true");
  }
  if (value.reason === "mismatch" && value.match !== false) {
    errors.push("reason=mismatch requires match=false");
  }

  // Optional nullable string fields, when present, must be strings (or null).
  for (const field of ["avatarUrl", "declaredFilename", "declaredHash", "contentHash"]) {
    if (
      Object.prototype.hasOwnProperty.call(value, field) &&
      !(value[field] === null || typeof value[field] === "string")
    ) {
      errors.push(`${field} must be string or null when present`);
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "httpStatus") &&
    !(value.httpStatus === null || Number.isInteger(value.httpStatus))
  ) {
    errors.push("httpStatus must be integer or null when present");
  }

  return {
    passed: errors.length === 0,
    errors,
    summary: {
      algorithm: value.algorithm,
      digestBytes: value.digestBytes,
      encoding: value.encoding,
      affectsVerified: value.affectsVerified,
      compared: value.compared,
      match: value.match,
      reason: value.reason,
    },
  };
}

module.exports = {
  readResponseBodySafe,
  hasStructuredErrorPayload,
  extractLoginOrApiErrorCode,
  buildLikelyValidLoginBody,
  probeHttpRejection,
  runOpenapiContractCase,
  classifyOpenApiOperationSecurity,
  listOpenApiOperations,
  validateOpenApiAccessModel,
  listPrivilegedPathsFromOpenApi,
  listAuthenticatedPathsFromOpenApi,
  AVATAR_CONTENT_HASH_REASONS,
  SECURITY_ASSURANCE_CODES,
  VERIFY_FAILURE_REASONS,
  VERIFY_CHECK_FIELDS,
  validateAvatarContentHash,
  validateSecurityAssurances,
  validateVerifyResponseShape,
};
