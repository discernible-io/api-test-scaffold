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

module.exports = {
  readResponseBodySafe,
  hasStructuredErrorPayload,
  extractLoginOrApiErrorCode,
  buildLikelyValidLoginBody,
  probeHttpRejection,
  runOpenapiContractCase,
};
