// API verification suite targeting the IDClawserver endpoints under /api

const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger } = require("../../sdk");

const {
  captureTestData,
  getRoditClientForTest,
} = require("./test-utils");

const API_PATHS = {
  metrics: "/api/metrics",
  systemMetrics: "/api/metrics/system",
  nonce: "/api/noncets",
  meIdentity: "/api/me/identity",
  identityVerify: "/api/identity/verify",
};

/**
 * Consolidated API verification module that exercises the new /api server
 */
const crudaTests = {
  /**
   * Comprehensive API verification test that covers authentication, protected
   * resources, diagnostics, and failure handling on the IDClawserver API.
   */
  testCrudaFullOperations: async (apiBaseUrl, logContext) => {
    const moduleName = "cruda";
    const testName = "testCrudaFullOperations";
    const correlationId = ulid();
    const testData = { apiBaseUrl };
    testData.endpoint = `${apiBaseUrl}${API_PATHS.metrics}`;

    logger.info("Starting IDClawserver API verification suite", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const client = await getRoditClientForTest({ testMode: true });
      const loginResult = await client.login_server();

      if (!loginResult || !loginResult.jwt_token) {
        const result = {
          success: false,
          error: "Failed to obtain JWT token from login_server",
          details: loginResult || {},
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const jwtToken = loginResult.jwt_token;
      testData.hasToken = true;
      testData.apiendpoint = loginResult.apiendpoint;

      const baseHeaders = {
        "Content-Type": "application/json",
        "User-Agent": "clienttestapi-rodit/api-suite",
        "X-Request-ID": ulid(),
      };

      const authHeaders = {
        ...baseHeaders,
        Authorization: `Bearer ${jwtToken}`,
      };

      // 1. Verify that authenticated endpoints reject missing tokens
      const unauthIdentityResponse = await fetch(
        `${apiBaseUrl}${API_PATHS.meIdentity}`,
        {
          method: "GET",
          headers: baseHeaders,
        }
      );
      testData.unauthIdentityStatus = unauthIdentityResponse.status;

      // 2. Fetch authenticated identity information (200 or 404 are acceptable)
      const identityResponse = await fetch(
        `${apiBaseUrl}${API_PATHS.meIdentity}`,
        {
          method: "GET",
          headers: authHeaders,
        }
      );
      testData.identityStatus = identityResponse.status;
      try {
        testData.identityPayload = await identityResponse.clone().json();
      } catch (err) {
        testData.identityParseError = err.message;
      }

      // 3. Retrieve aggregated metrics
      const metricsResponse = await fetch(
        `${apiBaseUrl}${API_PATHS.metrics}`,
        {
          method: "GET",
          headers: authHeaders,
        }
      );
      testData.metricsStatus = metricsResponse.status;
      let metricsPayload = null;
      try {
        metricsPayload = await metricsResponse.clone().json();
        testData.metricsKeys = Object.keys(metricsPayload || {});
      } catch (err) {
        testData.metricsParseError = err.message;
      }

      // 4. Retrieve system metrics snapshot
      const systemMetricsResponse = await fetch(
        `${apiBaseUrl}${API_PATHS.systemMetrics}`,
        {
          method: "GET",
          headers: authHeaders,
        }
      );
      testData.systemMetricsStatus = systemMetricsResponse.status;
      let systemMetricsPayload = null;
      try {
        systemMetricsPayload = await systemMetricsResponse.clone().json();
        testData.systemMetricsKeys = Object.keys(
          systemMetricsPayload?.metrics || {}
        );
      } catch (err) {
        testData.systemMetricsParseError = err.message;
      }

      // 5. Generate noncets payload for hello verification flows
      const noncetsResponse = await fetch(
        `${apiBaseUrl}${API_PATHS.nonce}`,
        {
          method: "GET",
          headers: authHeaders,
        }
      );
      testData.noncetsStatus = noncetsResponse.status;
      try {
        testData.noncetsPayload = await noncetsResponse.clone().json();
      } catch (err) {
        testData.noncetsParseError = err.message;
      }

      // 6. Submit an intentionally invalid identity verification payload to
      // confirm defensive error handling
      const invalidVerifyPayload = {
        hello: "INVALID_HELLO_PAYLOAD",
      };

      const identityVerifyResponse = await fetch(
        `${apiBaseUrl}${API_PATHS.identityVerify}`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(invalidVerifyPayload),
        }
      );
      testData.identityVerifyStatus = identityVerifyResponse.status;
      try {
        testData.identityVerifyBody = await identityVerifyResponse
          .clone()
          .json();
      } catch (err) {
        testData.identityVerifyParseError = err.message;
      }

      const successCriteria = {
        unauthorizedIdentityRejected: [401, 403].includes(
          testData.unauthIdentityStatus
        ),
        metricsAccessible:
          metricsResponse.ok && metricsPayload && typeof metricsPayload === "object",
        systemMetricsAccessible:
          systemMetricsResponse.ok &&
          systemMetricsPayload &&
          typeof systemMetricsPayload === "object",
        noncetsAvailable: noncetsResponse.ok,
        verifyProperlyRejected: identityVerifyResponse.status >= 400,
      };

      const success = Object.values(successCriteria).every(Boolean);

      const result = {
        success,
        details: {
          correlationId,
          criteria: successCriteria,
          statuses: {
            unauthorizedIdentity: testData.unauthIdentityStatus,
            identity: testData.identityStatus,
            metrics: testData.metricsStatus,
            systemMetrics: testData.systemMetricsStatus,
            noncets: testData.noncetsStatus,
            identityVerify: testData.identityVerifyStatus,
          },
          metadata: {
            metricsKeys: testData.metricsKeys,
            systemMetricsKeys: testData.systemMetricsKeys,
          },
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("IDClawserver API verification suite encountered an error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },
};

module.exports = crudaTests;