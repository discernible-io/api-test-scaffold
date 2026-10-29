/**
 * OpenAPI 1.1.9+ surface coverage for api-docs/target-swagger.json.
 * Positive paths: discovery, docs, demo, funnel, concierge, public identity.
 * Negative paths: auth gates, removed endpoints, unsupported methods, bad params.
 * Access model: public / authenticated / privileged (BearerAuth + RoditPermissionedRoutes).
 */

"use strict";

const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const targetSwagger = require("../../api-docs/target-swagger.json");
const {
  captureTestData,
  getRoditClientForTest,
  fetchDirect,
  extractApiErrorInfo,
} = require("./test-utils");
const {
  readResponseBodySafe,
  hasStructuredErrorPayload,
  probeHttpRejection,
  validateOpenApiAccessModel,
  listPrivilegedPathsFromOpenApi,
  listAuthenticatedPathsFromOpenApi,
} = require("./openapi-contract-helpers");

const MODULE = "openapiSurface";

const CONCIERGE_REQUIRED = [
  "displayName",
  "host",
  "verifyHost",
  "supportEmail",
  "a2aRegistryId",
  "a2aRegistryUrl",
  "agentCardUrl",
  "a2aEndpoint",
  "contactUris",
  "verifyCli",
  "requestId",
];

async function resolveOwnTokenId() {
  const client = await getRoditClientForTest();
  const cfg = await client.getConfigOwnRodit();
  return (
    cfg?.own_rodit?.token_id ||
    cfg?.own_rodit?.tokenId ||
    cfg?.own_rodit?.metadata?.token_id ||
    null
  );
}

/**
 * Positive: GET /.well-known/did-method-rodit (markdown / html negotiation).
 */
async function testDidMethodRoditDocument(apiEndpoint) {
  const testName = "testDidMethodRoditDocument";
  const correlationId = ulid();
  const testData = { apiEndpoint, probes: [] };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    for (const accept of ["text/markdown", "text/html"]) {
      const response = await fetch(`${apiEndpoint}/.well-known/did-method-rodit`, {
        method: "GET",
        headers: { Accept: accept, "X-Request-ID": ulid() },
      });
      const body = await response.text();
      const contentType = response.headers.get("content-type") || "";
      const typeOk =
        accept === "text/markdown"
          ? contentType.includes("markdown") || contentType.includes("text/plain")
          : contentType.includes("text/html");
      const passed = response.status === 200 && body.length > 0 && typeOk;
      testData.probes.push({
        accept,
        status: response.status,
        contentType,
        bodyLength: body.length,
        passed,
      });
      if (!passed) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: `GET /.well-known/did-method-rodit Accept=${accept}: status=${response.status}, content-type=${contentType}`,
            details: testData.probes,
          },
          testData,
        );
      }
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message: "did:rodit method document negotiates markdown and HTML",
        details: testData.probes,
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive: GET /.well-known/mcp.json alias matches MCP discovery shape.
 */
async function testMcpJsonDiscoveryAlias(apiEndpoint) {
  const testName = "testMcpJsonDiscoveryAlias";
  const correlationId = ulid();
  const testData = { apiEndpoint };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const response = await fetch(`${apiEndpoint}/.well-known/mcp.json`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Request-ID": ulid() },
    });
    const body = await readResponseBodySafe(response);
    testData.status = response.status;
    testData.body = typeof body === "object" ? body : String(body).slice(0, 200);

    if (response.status !== 200 || !body || typeof body !== "object") {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Expected 200 JSON from /.well-known/mcp.json, got ${response.status}`,
        },
        testData,
      );
    }

    const transportEndpoint = body.transport?.endpoint || body.endpoint;
    if (transportEndpoint && transportEndpoint !== "/mcp") {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `transport.endpoint must be /mcp, got ${transportEndpoint}`,
        },
        testData,
      );
    }

    return captureTestData(
      testName,
      MODULE,
      { passed: true, message: "MCP JSON discovery alias returned metadata" },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive: GET /docs and GET /docs/openapi return HTML.
 */
async function testDocsAndOpenApiUi(apiEndpoint) {
  const testName = "testDocsAndOpenApiUi";
  const correlationId = ulid();
  const testData = { apiEndpoint, probes: [] };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    for (const path of ["/docs", "/docs/openapi"]) {
      const response = await fetch(`${apiEndpoint}${path}`, { method: "GET" });
      const html = await response.text();
      const contentType = response.headers.get("content-type") || "";
      const passed =
        response.status === 200 &&
        contentType.includes("text/html") &&
        html.length > 0;
      testData.probes.push({
        path,
        status: response.status,
        contentType,
        bodyLength: html.length,
        passed,
      });
      if (!passed) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: `${path}: expected 200 text/html, got ${response.status} ${contentType}`,
            details: testData.probes,
          },
          testData,
        );
      }
    }

    return captureTestData(
      testName,
      MODULE,
      { passed: true, message: "/docs and /docs/openapi return HTML portals", details: testData.probes },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive: GET /llms.txt returns plain-text agent site map.
 */
async function testLlmsTxt(apiEndpoint) {
  const testName = "testLlmsTxt";
  const correlationId = ulid();
  const testData = { apiEndpoint };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const response = await fetch(`${apiEndpoint}/llms.txt`, { method: "GET" });
    const body = await response.text();
    const contentType = response.headers.get("content-type") || "";
    testData.status = response.status;
    testData.contentType = contentType;
    testData.bodyLength = body.length;

    const passed =
      response.status === 200 &&
      body.length > 0 &&
      (contentType.includes("text/plain") || contentType.includes("text/markdown"));

    return captureTestData(
      testName,
      MODULE,
      passed
        ? { passed: true, message: "llms.txt returned agent site map" }
        : {
            passed: false,
            error: `Expected 200 text/plain from /llms.txt, got ${response.status} ${contentType}`,
          },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive: GET /swagger.json permanently redirects to /openapi.json.
 */
async function testSwaggerJsonRedirect(apiEndpoint) {
  const testName = "testSwaggerJsonRedirect";
  const correlationId = ulid();
  const testData = { apiEndpoint };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const response = await fetch(`${apiEndpoint}/swagger.json`, {
      method: "GET",
      redirect: "manual",
    });
    const location = response.headers.get("location") || "";
    testData.status = response.status;
    testData.location = location;

    const passed =
      response.status === 301 &&
      (location.includes("/openapi.json") || location.endsWith("openapi.json"));

    return captureTestData(
      testName,
      MODULE,
      passed
        ? { passed: true, message: "/swagger.json redirects 301 to /openapi.json" }
        : {
            passed: false,
            error: `Expected 301 Location…/openapi.json, got ${response.status} Location=${location}`,
          },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Negative: removed /api-docs and /api-docs/{subpath} return 410 ErrorResponse.
 */
async function testApiDocsRemoved(apiEndpoint) {
  const testName = "testApiDocsRemoved";
  const correlationId = ulid();
  const testData = { apiEndpoint, probes: [] };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    for (const path of ["/api-docs", "/api-docs/index.html"]) {
      const response = await fetch(`${apiEndpoint}${path}`, {
        method: "GET",
        headers: { "X-Request-ID": ulid() },
      });
      const body = await readResponseBodySafe(response);
      const code =
        body && typeof body === "object" ? body?.error?.code : null;
      const passed =
        response.status === 410 &&
        hasStructuredErrorPayload(body) &&
        (code === "ENDPOINT_REMOVED" || code == null || typeof code === "string");
      testData.probes.push({
        path,
        status: response.status,
        code,
        passed,
        structured: hasStructuredErrorPayload(body),
      });
      if (!passed) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: `${path}: expected 410 ErrorResponse, got ${response.status} code=${code}`,
            details: testData.probes,
          },
          testData,
        );
      }
    }

    return captureTestData(
      testName,
      MODULE,
      { passed: true, message: "Removed /api-docs paths return 410", details: testData.probes },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive: GET /api/concierge/trust-anchor returns ConciergeTrustAnchor fields.
 */
async function testConciergeTrustAnchor(apiEndpoint) {
  const testName = "testConciergeTrustAnchor";
  const correlationId = ulid();
  const testData = { apiEndpoint };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const response = await fetch(`${apiEndpoint}/api/concierge/trust-anchor`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Request-ID": ulid() },
    });
    const body = await readResponseBodySafe(response);
    testData.status = response.status;
    testData.body = body;

    if (response.status !== 200 || !body || typeof body !== "object") {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Expected 200 ConciergeTrustAnchor, got ${response.status}`,
        },
        testData,
      );
    }

    const missing = CONCIERGE_REQUIRED.filter(
      (field) => body[field] === undefined || body[field] === null || body[field] === "",
    );
    // lobbyTokenId is nullable until configured
    if (missing.length > 0) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Missing required ConciergeTrustAnchor fields: ${missing.join(", ")}`,
        },
        testData,
      );
    }

    if (typeof body.contactUris !== "object") {
      return captureTestData(
        testName,
        MODULE,
        { passed: false, error: "contactUris must be an object" },
        testData,
      );
    }

    return captureTestData(
      testName,
      MODULE,
      { passed: true, message: "Concierge trust anchor matches required schema fields" },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive: GET /api/demo/heads and GET /api/demo/proofs.
 */
async function testDemoHeadsAndProofs(apiEndpoint) {
  const testName = "testDemoHeadsAndProofs";
  const correlationId = ulid();
  const testData = { apiEndpoint };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const headsResp = await fetch(`${apiEndpoint}/api/demo/heads`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Request-ID": ulid() },
    });
    const headsBody = await readResponseBodySafe(headsResp);
    testData.headsStatus = headsResp.status;
    testData.headsBody = headsBody;

    if (![200, 429, 503].includes(headsResp.status)) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `GET /api/demo/heads: unexpected status ${headsResp.status}`,
        },
        testData,
      );
    }

    if (headsResp.status === 200) {
      if (!Array.isArray(headsBody?.heads) || typeof headsBody.requestId !== "string") {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: "DemoHeadsResponse requires heads[] and requestId",
          },
          testData,
        );
      }
      for (const head of headsBody.heads) {
        if (!head?.tokenId || !head?.displayName) {
          return captureTestData(
            testName,
            MODULE,
            {
              passed: false,
              error: "Each DemoHead requires tokenId and displayName",
            },
            testData,
          );
        }
      }
    }

    const proofsResp = await fetch(
      `${apiEndpoint}/api/demo/proofs?destinatary=VERIFYIDENTY`,
      {
        method: "GET",
        headers: { Accept: "application/json", "X-Request-ID": ulid() },
      },
    );
    const proofsBody = await readResponseBodySafe(proofsResp);
    testData.proofsStatus = proofsResp.status;
    testData.proofsBody = proofsBody;

    if (![200, 400, 429, 503].includes(proofsResp.status)) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `GET /api/demo/proofs: unexpected status ${proofsResp.status}`,
        },
        testData,
      );
    }

    if (proofsResp.status === 200) {
      if (
        typeof proofsBody?.pollIntervalMs !== "number" ||
        !Array.isArray(proofsBody?.proofs) ||
        typeof proofsBody.requestId !== "string"
      ) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: "DemoProofsResponse requires pollIntervalMs, proofs[], requestId",
          },
          testData,
        );
      }
      for (const proof of proofsBody.proofs) {
        const required = ["tokenId", "hola", "destinatary", "issuedAt", "expiresAt"];
        const missing = required.filter((f) => !proof?.[f]);
        if (missing.length) {
          return captureTestData(
            testName,
            MODULE,
            {
              passed: false,
              error: `DemoProof missing ${missing.join(", ")}`,
            },
            testData,
          );
        }
      }
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message: "Demo heads/proofs returned allowed contract statuses and shapes",
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Negative: GET /api/demo/proofs rejects invalid destinatary.
 */
async function testDemoProofsInvalidDestinatary(apiEndpoint) {
  const testName = "testDemoProofsInvalidDestinatary";
  const correlationId = ulid();
  const testData = { apiEndpoint, probes: [] };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const invalid = ["mundo", "MUNDO", "bad-dest!", "TOOLONGDESTIN", "123"];
    for (const destinatary of invalid) {
      const probe = await probeHttpRejection(
        apiEndpoint,
        `/api/demo/proofs?destinatary=${encodeURIComponent(destinatary)}`,
        { method: "GET", minStatus: 400 },
      );
      testData.probes.push({ destinatary, ...probe });
      // Spec allows 400; 429/503 under load are also documented.
      if (probe.status === 429 || probe.status === 503) {
        continue;
      }
      if (!probe.rejected) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: `Invalid destinatary "${destinatary}" was accepted with HTTP ${probe.status}`,
            details: testData.probes,
          },
          testData,
        );
      }
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message: "Demo proofs reject invalid destinatary values",
        details: testData.probes,
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive: GET/POST /api/funnel/land return 204.
 */
async function testFunnelLandBeacon(apiEndpoint) {
  const testName = "testFunnelLandBeacon";
  const correlationId = ulid();
  const testData = { apiEndpoint };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const getResp = await fetch(
      `${apiEndpoint}/api/funnel/land?domain=api.identyclaw.com&utm_source=openapi-surface`,
      {
        method: "GET",
        headers: {
          "X-Request-ID": ulid(),
          "X-Funnel-Id": ulid(),
        },
      },
    );
    testData.getStatus = getResp.status;
    if (getResp.status !== 204) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `GET /api/funnel/land expected 204, got ${getResp.status}`,
        },
        testData,
      );
    }

    const postResp = await fetchDirect(apiEndpoint, "/api/funnel/land", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
      },
      body: JSON.stringify({
        domain: "verify.identyclaw.com",
        utm_campaign: "openapi-surface",
        funnel_id: ulid(),
      }),
    });
    testData.postStatus = postResp.status;
    if (postResp.status !== 204) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `POST /api/funnel/land expected 204, got ${postResp.status}`,
        },
        testData,
      );
    }

    return captureTestData(
      testName,
      MODULE,
      { passed: true, message: "Funnel land GET/POST return 204" },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive: GET /api/identity/token/{tokenId}/public (no auth).
 * Negative: unknown token → 404 ErrorResponse.
 */
async function testPublicIdentityProfile(apiEndpoint) {
  const testName = "testPublicIdentityProfile";
  const correlationId = ulid();
  const testData = { apiEndpoint };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const tokenId = await resolveOwnTokenId();
    if (!tokenId) {
      return captureTestData(
        testName,
        MODULE,
        { passed: false, error: "Could not resolve own tokenId for public profile probe" },
        testData,
      );
    }
    testData.tokenId = tokenId;

    const response = await fetch(
      `${apiEndpoint}/api/identity/token/${encodeURIComponent(tokenId)}/public`,
      {
        method: "GET",
        headers: { Accept: "application/json", "X-Request-ID": ulid() },
        // Intentionally no Authorization — public endpoint.
      },
    );
    const body = await readResponseBodySafe(response);
    testData.status = response.status;
    testData.body = body;

    if (response.status !== 200) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Public profile expected 200, got ${response.status}`,
        },
        testData,
      );
    }

    if (!body?.tokenId) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: "PublicPassportProfile requires tokenId",
        },
        testData,
      );
    }

    // Must not leak full DN / tax-style fields that belong on /full
    const forbiddenKeys = ["taxId", "tax_id", "streetAddress", "fullDN", "full_dn"];
    const leaked = forbiddenKeys.filter((k) => body[k] != null);
    if (leaked.length) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Public profile leaked non-public fields: ${leaked.join(", ")}`,
        },
        testData,
      );
    }

    const missingResp = await fetch(
      `${apiEndpoint}/api/identity/token/zzzzzzzzzzzz/public`,
      {
        method: "GET",
        headers: { Accept: "application/json", "X-Request-ID": ulid() },
      },
    );
    const missingBody = await readResponseBodySafe(missingResp);
    testData.missingStatus = missingResp.status;
    if (missingResp.status !== 404 || !hasStructuredErrorPayload(missingBody)) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Unknown tokenId expected 404 ErrorResponse, got ${missingResp.status}`,
        },
        testData,
      );
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message: "Public identity profile returns redacted profile; unknown token 404",
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Negative security: HOLA drop/take require Bearer; unauthenticated → 401.
 * Empty take with auth → 404 HOLA_DROP_EMPTY (or structured empty).
 */
async function testHolaDropAuthAndEmptyTake(apiEndpoint) {
  const testName = "testHolaDropAuthAndEmptyTake";
  const correlationId = ulid();
  const testData = { apiEndpoint, probes: [] };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const unauthCases = [
      { method: "PUT", path: "/api/hola/drop", body: { hola: "INVALID" } },
      { method: "POST", path: "/api/hola/drop", body: { hola: "INVALID" } },
      { method: "POST", path: "/api/hola/drop/take", body: {} },
    ];

    for (const c of unauthCases) {
      const response = await fetchDirect(apiEndpoint, c.path, {
        method: c.method,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
          // No Authorization
        },
        body: JSON.stringify(c.body),
      });
      const body = await readResponseBodySafe(response);
      const passed = response.status === 401 && hasStructuredErrorPayload(body);
      testData.probes.push({
        name: `unauth ${c.method} ${c.path}`,
        status: response.status,
        passed,
      });
      if (!passed) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: `Unauth ${c.method} ${c.path}: expected 401 ErrorResponse, got ${response.status}`,
            details: testData.probes,
          },
          testData,
        );
      }
    }

    // Authenticated take with empty drop box
    const client = await getRoditClientForTest();
    try {
      await client.request("POST", "/api/hola/drop/take", {});
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: "Authenticated empty take succeeded; expected 404 HOLA_DROP_EMPTY",
          details: testData.probes,
        },
        testData,
      );
    } catch (error) {
      const info = extractApiErrorInfo(error);
      testData.probes.push({
        name: "auth empty take",
        status: info.statusCode,
        code: info.code,
      });
      const ok =
        info.statusCode === 404 &&
        (info.code === "HOLA_DROP_EMPTY" || info.code == null || typeof info.code === "string");
      if (!ok) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: `Empty take expected 404 HOLA_DROP_EMPTY, got ${info.statusCode} ${info.code}`,
            details: testData.probes,
          },
          testData,
        );
      }
    }

    // Bad content-type on PUT drop (415)
    const badCt = await fetchDirect(apiEndpoint, "/api/hola/drop", {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain",
        "X-Request-ID": ulid(),
      },
      body: "hola=nope",
    });
    // Without auth may be 401 first; either 401 or 415 is a correct rejection.
    testData.probes.push({
      name: "PUT drop text/plain",
      status: badCt.status,
      passed: badCt.status === 401 || badCt.status === 415,
    });
    if (!(badCt.status === 401 || badCt.status === 415)) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `PUT /api/hola/drop text/plain expected 401/415, got ${badCt.status}`,
          details: testData.probes,
        },
        testData,
      );
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message: "HOLA drop/take enforce Bearer auth; empty take returns 404",
        details: testData.probes,
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Negative: new public discovery routes reject unsupported methods.
 */
async function testOpenapiSurfaceUnsupportedMethods(apiEndpoint) {
  const testName = "testOpenapiSurfaceUnsupportedMethods";
  const correlationId = ulid();
  const testData = { apiEndpoint, probes: [] };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const getOnly = [
      "/.well-known/did-method-rodit",
      "/.well-known/mcp.json",
      "/llms.txt",
      "/api/concierge/trust-anchor",
      "/api/demo/heads",
      "/docs",
      "/docs/openapi",
    ];

    for (const path of getOnly) {
      const probe = await probeHttpRejection(apiEndpoint, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probe: true }),
      });
      testData.probes.push({ path, ...probe });
      if (!probe.rejected) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: `POST ${path} accepted with HTTP ${probe.status}`,
            details: testData.probes,
          },
          testData,
        );
      }
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message: "OpenAPI surface GET-only routes reject POST",
        details: testData.probes,
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Offline contract: api-docs/target-swagger.json access model (1.1.9+).
 * Public / authenticated / privileged security schemes and x-access-level consistency.
 */
async function testOpenApiAccessModelContract(apiEndpoint) {
  const testName = "testOpenApiAccessModelContract";
  const correlationId = ulid();
  const testData = { apiEndpoint, source: "api-docs/target-swagger.json" };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const validation = validateOpenApiAccessModel(targetSwagger);
    testData.summary = validation.summary;
    testData.errors = validation.errors;

    if (!validation.passed) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `OpenAPI access-model contract not-passed: ${validation.errors.slice(0, 5).join("; ")}`,
          details: validation,
        },
        testData,
      );
    }

    const privileged = listPrivilegedPathsFromOpenApi(targetSwagger);
    const authenticated = listAuthenticatedPathsFromOpenApi(targetSwagger);
    testData.privilegedCount = privileged.length;
    testData.authenticatedCount = authenticated.length;

    const requiredPrivileged = [
      "GET /api/metrics",
      "GET /api/metrics/system",
      "POST /api/metrics/reset",
      "GET /api/metrics/debug",
      "GET /api/sessions/list_all",
      "POST /api/sessions/cleanup",
      "POST /api/sessions/revoke",
    ];
    const privilegedKeys = new Set(privileged.map((op) => `${op.method} ${op.path}`));
    const missingPrivileged = requiredPrivileged.filter((key) => !privilegedKeys.has(key));
    if (missingPrivileged.length > 0) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Missing privileged operations: ${missingPrivileged.join(", ")}`,
          details: { privileged },
        },
        testData,
      );
    }

    const requiredAuthenticated = ["GET /api/holanonce16ts", "GET /api/me/identity", "POST /api/logout"];
    const authenticatedKeys = new Set(authenticated.map((op) => `${op.method} ${op.path}`));
    const missingAuthenticated = requiredAuthenticated.filter((key) => !authenticatedKeys.has(key));
    if (missingAuthenticated.length > 0) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Missing authenticated-only operations: ${missingAuthenticated.join(", ")}`,
          details: { authenticated },
        },
        testData,
      );
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message:
          "target-swagger.json documents public / authenticated / privileged access with RoditPermissionedRoutes scopes",
        details: validation.summary,
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Runtime: unauthenticated → 401 on authenticated and privileged routes;
 * valid JWT succeeds on authenticated-only; privileged may be 200 or 403 (authorize).
 */
async function testAccessModelAuthVsAuthz(apiEndpoint) {
  const testName = "testAccessModelAuthVsAuthz";
  const correlationId = ulid();
  const testData = { apiEndpoint, probes: [] };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const authenticatedProbe = { method: "GET", path: "/api/holanonce16ts" };
    const privilegedProbe = { method: "GET", path: "/api/metrics" };

    for (const probe of [authenticatedProbe, privilegedProbe]) {
      const response = await fetchDirect(apiEndpoint, probe.path, {
        method: probe.method,
        headers: { "X-Request-ID": ulid() },
      });
      const body = await readResponseBodySafe(response);
      const passed = response.status === 401 && hasStructuredErrorPayload(body);
      testData.probes.push({
        name: `unauth ${probe.method} ${probe.path}`,
        status: response.status,
        passed,
      });
      if (!passed) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: `Unauth ${probe.method} ${probe.path}: expected 401 ErrorResponse (authenticate), got ${response.status}`,
            details: testData.probes,
          },
          testData,
        );
      }
    }

    const client = await getRoditClientForTest();
    const loginResult = await client.login_server();
    if (!loginResult?.success || !loginResult.jwt_token) {
      throw new Error(loginResult?.error || "Login not-passed for access-model probe");
    }
    const token = loginResult.jwt_token;

    const authOk = await fetchDirect(apiEndpoint, authenticatedProbe.path, {
      method: authenticatedProbe.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-ID": ulid(),
      },
    });
    testData.probes.push({
      name: `auth ${authenticatedProbe.method} ${authenticatedProbe.path}`,
      status: authOk.status,
      passed: authOk.status === 200,
    });
    if (authOk.status !== 200) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Authenticated-only ${authenticatedProbe.path}: valid JWT should not require permissioned_routes; got ${authOk.status}`,
          details: testData.probes,
        },
        testData,
      );
    }

    const priv = await fetchDirect(apiEndpoint, privilegedProbe.path, {
      method: privilegedProbe.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-ID": ulid(),
      },
    });
    // Privileged: authenticate passed; authorize may allow (200) or deny missing scope (403).
    const privOk = priv.status === 200 || priv.status === 403;
    testData.probes.push({
      name: `authz ${privilegedProbe.method} ${privilegedProbe.path}`,
      status: priv.status,
      passed: privOk,
    });
    if (!privOk) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Privileged ${privilegedProbe.path}: expected 200 (authorized) or 403 (missing permissioned_routes), got ${priv.status}`,
          details: testData.probes,
        },
        testData,
      );
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message:
          "Access model enforced: unauth→401; JWT auth-only→200; privileged→200/403 after authorize",
        details: testData.probes,
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

/**
 * Positive + negative: identity/verify includeProfile flag (public).
 */
async function testIdentityVerifyIncludeProfile(apiEndpoint) {
  const testName = "testIdentityVerifyIncludeProfile";
  const correlationId = ulid();
  const testData = { apiEndpoint };

  logger.info(`Starting test: ${testName}`, {
    component: "TestRunner",
    moduleName: MODULE,
    testName,
    correlationId,
  });

  try {
    const { generateValidHola } = require("./identyclaw-api");
    const client = await getRoditClientForTest();
    const validHola = await generateValidHola(client);

    const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
      },
      body: JSON.stringify({
        hola: validHola,
        includeProfile: true,
        constraints: { maxAgeMs: 300000 },
      }),
    });
    const body = await readResponseBodySafe(response);
    testData.status = response.status;
    testData.body = body;

    if (response.status === 401 || response.status === 403) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Public verify rejected unauthenticated includeProfile with ${response.status}`,
        },
        testData,
      );
    }

    if (![200, 400, 503].includes(response.status)) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Unexpected status ${response.status} for includeProfile verify`,
        },
        testData,
      );
    }

    if (response.status === 200) {
      // OpenAPI 1.1.9+: avatarContentHash is required on 200 (informational; affectsVerified=false).
      if (!body?.avatarContentHash || typeof body.avatarContentHash !== "object") {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: "identity/verify 200 response missing required avatarContentHash object",
          },
          testData,
        );
      }
      if (body.avatarContentHash.affectsVerified !== false) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: "avatarContentHash.affectsVerified must be false",
          },
          testData,
        );
      }
    }

    if (response.status === 200 && body?.verified === true) {
      // Spec: profile present when verified + includeProfile; tolerate alternate key names
      const hasProfileObject =
        (body.profile && typeof body.profile === "object") ||
        (body.publicProfile && typeof body.publicProfile === "object") ||
        (body.passportProfile && typeof body.passportProfile === "object");
      if (!hasProfileObject) {
        return captureTestData(
          testName,
          MODULE,
          {
            passed: false,
            error: "verified=true with includeProfile but no profile object in response",
          },
          testData,
        );
      }
    }

    // Negative: includeProfile with invalid hola still 400
    const bad = await fetchDirect(apiEndpoint, "/api/identity/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-ID": ulid() },
      body: JSON.stringify({ hola: "NOT-A-HOLA", includeProfile: true }),
    });
    const badBody = await readResponseBodySafe(bad);
    testData.badStatus = bad.status;
    if (bad.status !== 400 || !hasStructuredErrorPayload(badBody)) {
      return captureTestData(
        testName,
        MODULE,
        {
          passed: false,
          error: `Invalid hola + includeProfile expected 400 ErrorResponse, got ${bad.status}`,
        },
        testData,
      );
    }

    return captureTestData(
      testName,
      MODULE,
      {
        passed: true,
        message: "identity/verify includeProfile accepts public access and rejects bad HOLA",
      },
      testData,
    );
  } catch (error) {
    return captureTestData(
      testName,
      MODULE,
      { passed: false, error: error.message, stack: error.stack },
      testData,
    );
  }
}

module.exports = {
  testDidMethodRoditDocument,
  testMcpJsonDiscoveryAlias,
  testDocsAndOpenApiUi,
  testLlmsTxt,
  testSwaggerJsonRedirect,
  testApiDocsRemoved,
  testConciergeTrustAnchor,
  testDemoHeadsAndProofs,
  testDemoProofsInvalidDestinatary,
  testFunnelLandBeacon,
  testPublicIdentityProfile,
  testHolaDropAuthAndEmptyTake,
  testOpenapiSurfaceUnsupportedMethods,
  testOpenApiAccessModelContract,
  testAccessModelAuthVsAuthz,
  testIdentityVerifyIncludeProfile,
};
