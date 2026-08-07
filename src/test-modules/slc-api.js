/**
 * SLC (Synthetics' Last Cradle) API tests — paths documented in api-docs/slc-swagger.json
 * that are not covered by shared identyclaw suites (game, CRUDA, home, token claims).
 */

"use strict";

const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const {
  captureTestData,
  getRoditClientForTest,
  fetchDirect,
  bearerAuthorizationHeader,
  extractApiErrorInfo,
} = require("./test-utils");

const MODULE_NAME = "slc-api";

async function loginJwt() {
  const client = await getRoditClientForTest();
  const loginResult = await client.login_server();
  if (!loginResult?.success || !loginResult.jwt_token) {
    throw new Error(loginResult?.error || "Login not-passed");
  }
  return loginResult.jwt_token;
}

const slcApiTests = {
  /**
   * GET /api/home — public homepage string (slc-swagger)
   */
  testApiHome: async (apiEndpoint) => {
    const testName = "testApiHome";
    const testData = { apiEndpoint, endpoint: `${apiEndpoint}/api/home` };
    try {
      const response = await fetchDirect(apiEndpoint, "/api/home", { method: "GET" });
      testData.status = response.status;
      const text = await response.text();
      testData.bodyPreview = text.slice(0, 120);
      const passed = response.status === 200 && text.length > 0;
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed,
          message: passed ? "GET /api/home returned content" : "GET /api/home not-passed",
          error: passed ? undefined : `status ${response.status}`,
        },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * GET /api/token/claims — requires Bearer; returns claims when authenticated
   */
  testTokenClaims: async (apiEndpoint) => {
    const testName = "testTokenClaims";
    const correlationId = ulid();
    const testData = { apiEndpoint, endpoint: `${apiEndpoint}/api/token/claims` };
    try {
      const unauth = await fetchDirect(apiEndpoint, "/api/token/claims", {
        method: "GET",
        headers: { "X-Request-ID": correlationId },
      });
      testData.unauthStatus = unauth.status;
      if (unauth.status === 200) {
        return captureTestData(
          testName,
          MODULE_NAME,
          { passed: false, error: "Unauthenticated GET /api/token/claims must not return 200" },
          testData
        );
      }

      const jwt = await loginJwt();
      const auth = await fetchDirect(apiEndpoint, "/api/token/claims", {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt),
          "X-Request-ID": correlationId,
        },
      });
      testData.authStatus = auth.status;
      const body = await auth.json().catch(() => null);
      testData.bodyKeys = body && typeof body === "object" ? Object.keys(body) : [];
      const passed = auth.status === 200 && body && typeof body === "object";
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed,
          message: passed ? "GET /api/token/claims returns claims with Bearer" : undefined,
          error: passed ? undefined : `status ${auth.status}`,
        },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Public spectator game routes from slc-swagger (no JWT)
   */
  testGamePublicSpectatorEndpoints: async (apiEndpoint) => {
    const testName = "testGamePublicSpectatorEndpoints";
    const testData = { apiEndpoint, probes: [] };
    const paths = [
      "/api/game/games",
      "/api/game/hall-of-fame",
      "/api/game/skill.md",
      "/api/game/peer-auth.md",
      "/api/game/action-schema.md",
      "/api/game/narrative",
      "/api/game/defaults",
      "/api/game/defaults/contest",
      "/api/game/contests",
    ];
    try {
      for (const path of paths) {
        const response = await fetchDirect(apiEndpoint, path, {
          method: "GET",
          headers: { Accept: path.endsWith(".md") ? "text/markdown,text/plain,*/*" : "application/json" },
        });
        const probe = { path, status: response.status, ok: response.ok };
        testData.probes.push(probe);
        if (!response.ok) {
          return captureTestData(
            testName,
            MODULE_NAME,
            {
              passed: false,
              error: `Public game path ${path} returned HTTP ${response.status}`,
              details: testData.probes,
            },
            testData
          );
        }
      }
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed: true,
          message: `Public spectator game routes OK (${paths.length})`,
          details: testData.probes,
        },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Authenticated game list/mine/tasks (slc-swagger jwt-passport)
   */
  testGameAuthenticatedReadEndpoints: async (apiEndpoint) => {
    const testName = "testGameAuthenticatedReadEndpoints";
    const correlationId = ulid();
    const testData = { apiEndpoint, probes: [] };
    try {
      const jwt = await loginJwt();
      const paths = ["/api/game/games/mine", "/api/game/tasks"];
      for (const path of paths) {
        const response = await fetchDirect(apiEndpoint, path, {
          method: "GET",
          headers: {
            Authorization: bearerAuthorizationHeader(jwt),
            Accept: "application/json",
            "X-Request-ID": correlationId,
          },
        });
        const body = await response.json().catch(() => null);
        testData.probes.push({ path, status: response.status, keys: body && Object.keys(body) });
        if (!response.ok) {
          return captureTestData(
            testName,
            MODULE_NAME,
            {
              passed: false,
              error: `${path} returned HTTP ${response.status}`,
              details: testData.probes,
            },
            testData
          );
        }
      }
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: true, message: "Authenticated game read routes OK", details: testData.probes },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * CRUDA routes require authentication (slc-swagger)
   */
  testCrudaRequiresAuth: async (apiEndpoint) => {
    const testName = "testCrudaRequiresAuth";
    const testData = { apiEndpoint, probes: [] };
    const cases = [
      { method: "GET", path: "/api/cruda/list" },
      { method: "POST", path: "/api/cruda/list", body: {} },
      { method: "POST", path: "/api/cruda/create", body: { text: "clienttest-idc probe" } },
      { method: "POST", path: "/api/cruda/read", body: { id: "nonexistent" } },
    ];
    try {
      for (const c of cases) {
        const response = await fetchDirect(apiEndpoint, c.path, {
          method: c.method,
          headers: { "Content-Type": "application/json", "X-Request-ID": ulid() },
          body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
        });
        const rejected = response.status === 401 || response.status === 403;
        testData.probes.push({ ...c, status: response.status, rejected });
        if (!rejected) {
          return captureTestData(
            testName,
            MODULE_NAME,
            {
              passed: false,
              error: `${c.method} ${c.path} expected 401/403 without auth, got ${response.status}`,
              details: testData.probes,
            },
            testData
          );
        }
      }
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: true, message: "CRUDA rejects unauthenticated access", details: testData.probes },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Authenticated CRUDA create → read → list → update → destroy round-trip
   */
  testCrudaAuthenticatedRoundTrip: async (apiEndpoint) => {
    const testName = "testCrudaAuthenticatedRoundTrip";
    const correlationId = ulid();
    const testData = { apiEndpoint, steps: [] };
    try {
      const jwt = await loginJwt();
      const headers = {
        Authorization: bearerAuthorizationHeader(jwt),
        "Content-Type": "application/json",
        "X-Request-ID": correlationId,
      };
      const marker = `clienttest-slc-${correlationId}`;

      const createResp = await fetchDirect(apiEndpoint, "/api/cruda/create", {
        method: "POST",
        headers,
        body: JSON.stringify({ text: marker }),
      });
      const createBody = await createResp.json().catch(() => null);
      testData.steps.push({ step: "create", status: createResp.status, body: createBody });
      if (!createResp.ok) {
        return captureTestData(
          testName,
          MODULE_NAME,
          { passed: false, error: `create HTTP ${createResp.status}`, details: testData.steps },
          testData
        );
      }
      const id = createBody?.id || createBody?.comment?.id || createBody?.data?.id;
      if (!id) {
        return captureTestData(
          testName,
          MODULE_NAME,
          { passed: false, error: "create response missing id", details: testData.steps },
          testData
        );
      }
      testData.id = id;

      const readResp = await fetchDirect(apiEndpoint, `/api/cruda/read/${encodeURIComponent(id)}`, {
        method: "GET",
        headers,
      });
      testData.steps.push({ step: "read", status: readResp.status });
      if (!readResp.ok) {
        return captureTestData(
          testName,
          MODULE_NAME,
          { passed: false, error: `read HTTP ${readResp.status}`, details: testData.steps },
          testData
        );
      }

      const listResp = await fetchDirect(apiEndpoint, "/api/cruda/list", {
        method: "GET",
        headers,
      });
      testData.steps.push({ step: "list", status: listResp.status });
      if (!listResp.ok) {
        return captureTestData(
          testName,
          MODULE_NAME,
          { passed: false, error: `list HTTP ${listResp.status}`, details: testData.steps },
          testData
        );
      }

      const updateResp = await fetchDirect(apiEndpoint, "/api/cruda/update", {
        method: "PUT",
        headers,
        body: JSON.stringify({ id, text: `${marker}-updated` }),
      });
      testData.steps.push({ step: "update", status: updateResp.status });
      if (!updateResp.ok) {
        return captureTestData(
          testName,
          MODULE_NAME,
          { passed: false, error: `update HTTP ${updateResp.status}`, details: testData.steps },
          testData
        );
      }

      const destroyResp = await fetchDirect(apiEndpoint, "/api/cruda/destroy", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ id }),
      });
      testData.steps.push({ step: "destroy", status: destroyResp.status });
      if (!destroyResp.ok) {
        return captureTestData(
          testName,
          MODULE_NAME,
          { passed: false, error: `destroy HTTP ${destroyResp.status}`, details: testData.steps },
          testData
        );
      }

      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: true, message: "CRUDA create/read/list/update/destroy OK", details: testData.steps },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * POST /api/signclient exists (validation shape covered elsewhere); unauthenticated probe
   */
  testSignclientEndpointPresent: async (apiEndpoint) => {
    const testName = "testSignclientEndpointPresent";
    const testData = { apiEndpoint };
    try {
      const response = await fetchDirect(apiEndpoint, "/api/signclient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      testData.status = response.status;
      // Must not be 404 — endpoint is documented; 4xx validation/auth is OK
      const passed = response.status !== 404;
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed,
          message: passed ? "POST /api/signclient is mounted" : undefined,
          error: passed ? undefined : "POST /api/signclient returned 404",
        },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },
};

module.exports = slcApiTests;
