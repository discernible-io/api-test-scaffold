const crypto = require("crypto");
const { ulid } = require("ulid");
const { captureTestData, getRoditClientForTest, extractApiErrorInfo } = require("./test-utils");

const moduleName = "swagger-spec-gap-stubs";

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
    tokenId =
      cfg?.own_rodit?.token_id ||
      cfg?.own_rodit?.tokenId ||
      tokenId;
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

async function runCase(testName, apiEndpoint, endpoint, contract, execute) {
  const correlationId = ulid();
  const testData = {
    endpoint: `${apiEndpoint}${endpoint}`,
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

const swaggerSpecGapStubs = {
  testApiDocsPublicPageReturns200: async (apiEndpoint) =>
    runCase(
      "testApiDocsPublicPageReturns200",
      apiEndpoint,
      "/api-docs",
      { method: "GET", expectedStatus: 200 },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api-docs`, {
          method: "GET",
          headers: { "X-Request-ID": requestId },
        });
        const body = await readResponseBodySafe(response);
        const contentType = response.headers.get("content-type") || "";

        if (response.status !== 200) {
          throw new Error(`Expected 200 from /api-docs, got ${response.status}`);
        }
        if (!contentType.includes("text/html")) {
          throw new Error(`Expected text/html from /api-docs, got ${contentType || "unknown"}`);
        }

        return {
          status: response.status,
          contentType,
          hasSwaggerUiMarkup: typeof body === "string" && body.toLowerCase().includes("swagger"),
        };
      }
    ),

  testDocsEnrollmentPageReturns200: async (apiEndpoint) =>
    runCase(
      "testDocsEnrollmentPageReturns200",
      apiEndpoint,
      "/docs/enrollment",
      { method: "GET", expectedStatus: 200 },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/docs/enrollment`, {
          method: "GET",
          headers: { "X-Request-ID": requestId },
        });
        const body = await readResponseBodySafe(response);
        const contentType = response.headers.get("content-type") || "";

        if (response.status !== 200) {
          throw new Error(`Expected 200 from /docs/enrollment, got ${response.status}`);
        }
        if (!contentType.includes("text/html")) {
          throw new Error(`Expected text/html from /docs/enrollment, got ${contentType || "unknown"}`);
        }
        if (typeof body !== "string" || !body.toLowerCase().includes("quick start")) {
          throw new Error("Expected enrollment guide HTML to contain quick-start content");
        }

        return { status: response.status, contentType, containsQuickStart: true };
      }
    ),

  testLoginMissingFieldsReturns400: async (apiEndpoint) =>
    runCase(
      "testLoginMissingFieldsReturns400",
      apiEndpoint,
      "/api/login",
      {
        method: "POST",
        expectedStatus: 400,
        note: "SDK login_client: roditid without signature → MISSING_BASE64URL_SIGNATURE",
      },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
          },
          body: JSON.stringify({ roditid: "bjbvcjzqbdsj" }),
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 400) {
          throw new Error(`Expected 400 for missing login fields, got ${response.status}`);
        }
        const code = extractLoginOrApiErrorCode(body);
        if (code !== "MISSING_BASE64URL_SIGNATURE") {
          throw new Error(
            `Expected error code MISSING_BASE64URL_SIGNATURE, got ${code ?? JSON.stringify(body).slice(0, 120)}`
          );
        }
        return { status: response.status, errorCode: code };
      }
    ),

  testLoginTimestampGetMatchesSwagger: async (apiEndpoint) =>
    runCase(
      "testLoginTimestampGetMatchesSwagger",
      apiEndpoint,
      "/api/login/timestamp",
      {
        method: "GET",
        expectedStatus: 200,
        ref: "target-swagger.json /api/login/timestamp",
      },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api/login/timestamp`, {
          method: "GET",
          headers: { "X-Request-ID": requestId },
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 200) {
          throw new Error(`Expected 200 from /api/login/timestamp, got ${response.status}`);
        }
        const required = ["timestamp", "timestamp_iso", "requestId"];
        const missing = required.filter((k) => body[k] === undefined || body[k] === null);
        if (missing.length) {
          throw new Error(`Missing required fields: ${missing.join(", ")}`);
        }
        if (!Number.isInteger(body.timestamp)) {
          throw new Error(`timestamp must be integer seconds, got ${body.timestamp}`);
        }
        return { hasIso: !!body.timestamp_iso, requestId: body.requestId };
      }
    ),

  testLoginMissingIdentifierReturns400: async (apiEndpoint) =>
    runCase(
      "testLoginMissingIdentifierReturns400",
      apiEndpoint,
      "/api/login",
      {
        method: "POST",
        expectedStatus: 400,
        note: "MISSING_LOGIN_IDENTIFIER when neither roditid nor accountid",
      },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
          },
          body: JSON.stringify({
            timestamp: Math.floor(Date.now() / 1000),
            base64url_signature: "dGVzdA",
          }),
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 400) {
          throw new Error(`Expected 400, got ${response.status}`);
        }
        const code = extractLoginOrApiErrorCode(body);
        if (code !== "MISSING_LOGIN_IDENTIFIER") {
          throw new Error(`Expected MISSING_LOGIN_IDENTIFIER, got ${code}`);
        }
        return { status: response.status, errorCode: code };
      }
    ),

  testLoginAmbiguousIdentifierReturns400: async (apiEndpoint) =>
    runCase(
      "testLoginAmbiguousIdentifierReturns400",
      apiEndpoint,
      "/api/login",
      {
        method: "POST",
        expectedStatus: 400,
        note: "LOGIN_IDENTIFIER_AMBIGUOUS when both roditid and accountid non-empty",
      },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
          },
          body: JSON.stringify({
            roditid: "bjbvcjzqbdsj",
            accountid: "a".repeat(64),
            timestamp: Math.floor(Date.now() / 1000),
            base64url_signature: "dGVzdA",
          }),
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 400) {
          throw new Error(`Expected 400, got ${response.status}`);
        }
        const code = extractLoginOrApiErrorCode(body);
        if (code !== "LOGIN_IDENTIFIER_AMBIGUOUS") {
          throw new Error(`Expected LOGIN_IDENTIFIER_AMBIGUOUS, got ${code}`);
        }
        return { status: response.status, errorCode: code };
      }
    ),

  testLoginDeprecatedSignatureFieldReturns400: async (apiEndpoint) =>
    runCase(
      "testLoginDeprecatedSignatureFieldReturns400",
      apiEndpoint,
      "/api/login",
      {
        method: "POST",
        expectedStatus: 400,
        note: "LOGIN_PAYLOAD_DEPRECATED for legacy signature key",
      },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
          },
          body: JSON.stringify({
            roditid: "bjbvcjzqbdsj",
            timestamp: 1,
            base64url_signature: "ab",
            signature: "deprecated",
          }),
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 400) {
          throw new Error(`Expected 400, got ${response.status}`);
        }
        const code = extractLoginOrApiErrorCode(body);
        if (code !== "LOGIN_PAYLOAD_DEPRECATED") {
          throw new Error(`Expected LOGIN_PAYLOAD_DEPRECATED, got ${code}`);
        }
        return { status: response.status, errorCode: code };
      }
    ),

  testLoginDuplicateSignatureFieldsReturns400: async (apiEndpoint) =>
    runCase(
      "testLoginDuplicateSignatureFieldsReturns400",
      apiEndpoint,
      "/api/login",
      {
        method: "POST",
        expectedStatus: 400,
        note: "LOGIN_PAYLOAD_DEPRECATED when both signature fields non-empty",
      },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
          },
          body: JSON.stringify({
            roditid: "bjbvcjzqbdsj",
            timestamp: 1,
            base64url_signature: "aaa",
            roditid_base64url_signature: "bbb",
          }),
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 400) {
          throw new Error(`Expected 400, got ${response.status}`);
        }
        const code = extractLoginOrApiErrorCode(body);
        if (code !== "LOGIN_PAYLOAD_DEPRECATED") {
          throw new Error(`Expected LOGIN_PAYLOAD_DEPRECATED, got ${code}`);
        }
        return { status: response.status, errorCode: code };
      }
    ),

  testLoginSuccessfulRoundTripMatchesSwagger: async (apiEndpoint) =>
    runCase(
      "testLoginSuccessfulRoundTripMatchesSwagger",
      apiEndpoint,
      "/api/login",
      {
        method: "POST",
        expectedStatus: 200,
        note: "Uses SDK login_server middleware — same wire shape as RoditClient#login_server",
      },
      async (requestId) => {
        const client = await getRoditClientForTest();
        const config_own_rodit = await client.getConfigOwnRodit();
        if (!config_own_rodit) {
          throw new Error("No getConfigOwnRodit — cannot run positive login contract test");
        }
        const { login_server: loginServerMw } = require("../../sdk/lib/middleware/authenticationmw");
        const result = await loginServerMw(config_own_rodit, { loginPath: "/api/login" });
        if (result.error) {
          throw new Error(`login_server failed: ${result.error}`);
        }
        if (!result.jwt_token || typeof result.jwt_token !== "string") {
          throw new Error("Expected jwt_token string on successful login_server");
        }
        return {
          requestId,
          hasJwt: true,
          jwtLength: result.jwt_token.length,
        };
      }
    ),

  testLoginInvalidSignatureReturns401: async (apiEndpoint) =>
    runCase(
      "testLoginInvalidSignatureReturns401",
      apiEndpoint,
      "/api/login",
      { method: "POST", expectedStatus: 401 },
      async (requestId) => {
        const loginBody = await buildLikelyValidLoginBody(apiEndpoint);
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
          },
          body: JSON.stringify(loginBody),
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 401) {
          throw new Error(`Expected 401 for invalid login signature, got ${response.status}`);
        }
        return { status: response.status, bodySnippet: JSON.stringify(body).slice(0, 220) };
      }
    ),

  /** Same as invalid signature but POST body uses accountid (no roditid), matching account-based login wire shape. */
  testLoginAccountIdInvalidSignatureReturns401: async (apiEndpoint) =>
    runCase(
      "testLoginAccountIdInvalidSignatureReturns401",
      apiEndpoint,
      "/api/login",
      { method: "POST", expectedStatus: 401 },
      async (requestId) => {
        let accountid = "a".repeat(64);
        try {
          const client = await getRoditClientForTest();
          const cfg = await client.getConfigOwnRodit();
          const fromCfg =
            cfg?.near_account_id ||
            cfg?.implicit_account_id ||
            cfg?.account_id ||
            cfg?.own_rodit?.owner_id;
          if (typeof fromCfg === "string" && /^[0-9a-fA-F]+$/.test(fromCfg)) {
            accountid = fromCfg;
          }
        } catch (_) {
          // fallback 64-char hex placeholder
        }
        const tsResp = await fetch(`${apiEndpoint}/api/login/timestamp`, { method: "GET" });
        const tsBody = await readResponseBodySafe(tsResp);
        const timestamp = Number(tsBody?.timestamp) || Math.floor(Date.now() / 1000);
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
          },
          body: JSON.stringify({
            accountid,
            timestamp,
            roditid_base64url_signature: crypto.randomBytes(64).toString("base64url"),
          }),
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 401) {
          throw new Error(
            `Expected 401 for invalid accountid login signature, got ${response.status}`
          );
        }
        return { status: response.status, bodySnippet: JSON.stringify(body).slice(0, 220) };
      }
    ),

  testLoginWrongContentTypeReturns415: async (apiEndpoint) =>
    runCase(
      "testLoginWrongContentTypeReturns415",
      apiEndpoint,
      "/api/login",
      { method: "POST", expectedStatus: 415 },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            "X-Request-ID": requestId,
          },
          body: "not-json",
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 415) {
          throw new Error(`Expected 415 for wrong content-type, got ${response.status}`);
        }
        return { status: response.status, bodySnippet: JSON.stringify(body).slice(0, 220) };
      }
    ),

  testLoginInternalErrorContract: async (apiEndpoint) =>
    runCase(
      "testLoginInternalErrorContract",
      apiEndpoint,
      "/api/login",
      { method: "POST", expectedStatus: 500 },
      async (requestId) => {
        const loginBody = await buildLikelyValidLoginBody(apiEndpoint);
        const response = await fetch(`${apiEndpoint}/api/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
            "X-Force-Error": "true",
          },
          body: JSON.stringify(loginBody),
        });
        const body = await readResponseBodySafe(response);

        if (response.status === 500 && !hasStructuredErrorPayload(body)) {
          throw new Error("Expected structured payload when /api/login returns 500");
        }

        if (![400, 401, 415, 500].includes(response.status)) {
          throw new Error(`Unexpected status for login contract probe: ${response.status}`);
        }

        return {
          status: response.status,
          observed500: response.status === 500,
          structuredErrorPayload: response.status === 500 ? hasStructuredErrorPayload(body) : null,
        };
      }
    ),

  testSessionsListAllUnauthenticatedReturns401: async (apiEndpoint) =>
    runCase(
      "testSessionsListAllUnauthenticatedReturns401",
      apiEndpoint,
      "/api/sessions/list_all",
      { method: "GET", expectedStatus: 401 },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/api/sessions/list_all`, {
          method: "GET",
          headers: { "X-Request-ID": requestId },
        });
        const body = await readResponseBodySafe(response);
        if (response.status !== 401) {
          throw new Error(`Expected 401 for unauthenticated /api/sessions/list_all, got ${response.status}`);
        }
        return { status: response.status, bodySnippet: JSON.stringify(body).slice(0, 220) };
      }
    ),

  testDidResolveInternalErrorContract: async (apiEndpoint) =>
    runCase(
      "testDidResolveInternalErrorContract",
      apiEndpoint,
      "/.well-known/did/resolve",
      { method: "GET", expectedStatus: 500 },
      async (requestId) => {
        const response = await fetch(
          `${apiEndpoint}/.well-known/did/resolve?did=did:unsupported:trigger500`,
          {
            method: "GET",
            headers: {
              Authorization: "Bearer test-token",
              "X-Request-ID": requestId,
              "X-Force-Error": "true",
            },
          }
        );
        const body = await readResponseBodySafe(response);
        if (response.status === 500 && !hasStructuredErrorPayload(body)) {
          throw new Error("Expected structured payload when DID resolve returns 500");
        }
        if (![400, 401, 404, 500].includes(response.status)) {
          throw new Error(`Unexpected status from DID resolve contract probe: ${response.status}`);
        }
        return { status: response.status, observed500: response.status === 500 };
      }
    ),

  testDidRoditInternalErrorContract: async (apiEndpoint) =>
    runCase(
      "testDidRoditInternalErrorContract",
      apiEndpoint,
      "/.well-known/did/rodit/{tokenId}",
      { method: "GET", expectedStatus: 500 },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/.well-known/did/rodit/zzzzzzzzzzzz`, {
          method: "GET",
          headers: {
            Authorization: "Bearer test-token",
            "X-Request-ID": requestId,
            "X-Force-Error": "true",
          },
        });
        const body = await readResponseBodySafe(response);
        if (response.status === 500 && !hasStructuredErrorPayload(body)) {
          throw new Error("Expected structured payload when did:rodit returns 500");
        }
        if (![400, 401, 404, 500].includes(response.status)) {
          throw new Error(`Unexpected status from did:rodit contract probe: ${response.status}`);
        }
        return { status: response.status, observed500: response.status === 500 };
      }
    ),

  testDidWebTokenInternalErrorContract: async (apiEndpoint) =>
    runCase(
      "testDidWebTokenInternalErrorContract",
      apiEndpoint,
      "/.well-known/did/web/token/{tokenId}",
      { method: "GET", expectedStatus: 500 },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/zzzzzzzzzzzz`, {
          method: "GET",
          headers: {
            Authorization: "Bearer test-token",
            "X-Request-ID": requestId,
            "X-Force-Error": "true",
          },
        });
        const body = await readResponseBodySafe(response);
        if (response.status === 500 && !hasStructuredErrorPayload(body)) {
          throw new Error("Expected structured payload when did:web token returns 500");
        }
        if (![400, 401, 404, 500].includes(response.status)) {
          throw new Error(`Unexpected status from did:web token contract probe: ${response.status}`);
        }
        return { status: response.status, observed500: response.status === 500 };
      }
    ),

  testDidWebJsonInternalErrorContract: async (apiEndpoint) =>
    runCase(
      "testDidWebJsonInternalErrorContract",
      apiEndpoint,
      "/.well-known/did/web/token/{tokenId}/did.json",
      { method: "GET", expectedStatus: 500 },
      async (requestId) => {
        const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/zzzzzzzzzzzz/did.json`, {
          method: "GET",
          headers: {
            Authorization: "Bearer test-token",
            "X-Request-ID": requestId,
            "X-Force-Error": "true",
          },
        });
        const body = await readResponseBodySafe(response);
        if (response.status === 500 && !hasStructuredErrorPayload(body)) {
          throw new Error("Expected structured payload when did:web did.json returns 500");
        }
        if (![400, 401, 404, 500].includes(response.status)) {
          throw new Error(`Unexpected status from did:web did.json contract probe: ${response.status}`);
        }
        return { status: response.status, observed500: response.status === 500 };
      }
    ),
};

module.exports = swaggerSpecGapStubs;
