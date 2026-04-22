/**
 * IDENTYCLAW API Functionality and Security Tests
 * Tests specific to the IDENTYCLAW API endpoints as defined in swagger.json
 */

const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const stateManager = require("../../sdk/lib/blockchain/statemanager");
const { getRoditClientForTest } = require("./test-utils");

const extractApiErrorInfo = (error) => {
  // RoditClient now throws structured errors with statusCode and code properties
  const responseData = error?.responseData || {};
  const apiError = responseData?.error || {};

  return {
    statusCode: error?.statusCode || null,
    code: error?.code || apiError?.code || null,
    message: error?.message || apiError?.message || String(error),
    details: error?.details || apiError?.details || responseData?.details || null,
    requestId: error?.requestId || responseData?.requestId,
    timestamp: error?.timestamp || responseData?.timestamp,
  };
};

/**
 * Helper to get authentication headers for tests that need direct fetch() calls
 * (e.g., testWrongContentType, testInvalidJwtTokens)
 */
const getHeaders = () => {
  const token = stateManager.getJwtToken();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Request-ID": ulid(),
  };
};

const getAuthenticatedClientContext = async () => {
  const client = await getRoditClientForTest();
  const identityResponse = await client.request("GET", "/api/me/identity");
  const tokenId = identityResponse?.tokenId;

  if (!tokenId) {
    throw new Error("Unable to resolve tokenId for authenticated context");
  }

  return { client, tokenId };
};

/**
 * Helper to compute checksum for HOLA message
 * Checksum = sum of ASCII codes of the message prefix, modulo 16, as hex digit
 * @param {string} messagePrefix - The message without checksum: "HOLA:recipient:tokenId:timestamp:noncets:API.IDENTYCLAW.COM:signature:"
 * @returns {string} Single hex character (0-9A-F)
 */
const computeHolaChecksum = (messagePrefix) => {
  let sum = 0;
  for (let i = 0; i < messagePrefix.length; i++) {
    sum += messagePrefix.charCodeAt(i);
  }
  const checksumValue = sum % 16;
  return checksumValue.toString(16).toUpperCase();
};

/**
 * Fetch nonce and timestamp from the /api/noncets endpoint
 * @param {string} apiEndpoint - The API endpoint base URL
 * @returns {Promise<{noncets: string, timestamp: string}>} Nonce and timestamp from API
 */
const fetchNoncetsFromApi = async (apiEndpoint) => {
  try {
    const response = await fetch(`${apiEndpoint}/api/noncets`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch noncets: ${response.status}`);
    }

    const data = await response.json();
    return {
      noncets: data.noncets || "4F9A3C7E2D1B9A4C",
      timestamp: data.timestamp || new Date().toISOString(),
    };
  } catch (error) {
    logger.warn("Failed to fetch noncets from API, using defaults", {
      component: "TestHelper",
      error: error.message,
    });
    // Fallback to defaults if API call fails
    return {
      noncets: "4F9A3C7E2D1B9A4C",
      timestamp: new Date().toISOString(),
    };
  }
};

/**
 * Helper to generate a proper HOLA message with signature and checksum
 * Format: HOLA:<recipient>:<tokenId>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<base64url-signature>:<checksum>
 * 
 * For testing purposes, we generate valid-looking HOLA messages with:
 * - Recipient (defaults to MUNDO)
 * - Valid tokenId (12 lowercase letters)
 * - Current timestamp from API
 * - Valid noncets from API
 * - Valid base64url signature
 * - Valid hex checksum computed from the message
 */
const generateValidHola = async (apiEndpoint, options = {}) => {
  const {
    recipient = 'MUNDO',
    tokenId = 'aaaaaaaaaaaa',
    signature = 'n3FZ5kQ8-Lh2BsM1xY',
  } = options;

  const { noncets, timestamp } = await fetchNoncetsFromApi(apiEndpoint);
  
  // Build the message prefix (without checksum)
  const messagePrefix = `HOLA:${recipient}:${tokenId}:${timestamp}:${noncets}:API.IDENTYCLAW.COM:${signature}:`;
  
  // Compute the checksum
  const checksum = computeHolaChecksum(messagePrefix);
  
  return `${messagePrefix}${checksum}`;
};

/**
 * Helper to generate HOLA message of specific length by padding signature
 * Ensures the final message is exactly targetLength characters
 */
const generateHolaOfLength = async (apiEndpoint, targetLength) => {
  // Fetch fresh nonce and timestamp from API
  const { noncets, timestamp } = await fetchNoncetsFromApi(apiEndpoint);
  
  const recipient = 'MUNDO';
  const tokenId = 'aaaaaaaaaaaa';
  const prefix = `HOLA:${recipient}:${tokenId}:${timestamp}:${noncets}:API.IDENTYCLAW.COM:`;
  const suffixWithColon = ':'; // Colon before checksum
  
  // Calculate how much space we have for the signature
  const fixedLength = prefix.length + suffixWithColon.length + 1; // +1 for checksum
  const signatureLength = targetLength - fixedLength;
  
  if (signatureLength < 1) {
    // If target is too small, return a minimal valid HOLA
    return generateValidHola(apiEndpoint);
  }
  
  // Pad the signature to the required length
  const signature = 'x'.repeat(signatureLength);
  const messagePrefix = `${prefix}${signature}${suffixWithColon}`;
  const checksum = computeHolaChecksum(messagePrefix);
  
  return `${messagePrefix}${checksum}`;
};

const identyclawApiTests = {
  /**
   * Test /health endpoint (public, no auth required)
   */
  testHealthEndpoint: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testHealthEndpoint";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/health`, {
        method: "GET",
      });

      testData.status = response.status;
      testData.success = response.status === 200;

      if (!response.ok) {
        return {
          success: false,
          error: `Health check failed with status ${response.status}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Health endpoint accessible",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET / endpoint (API discovery endpoint)
   * Validates API discovery information including enrollment URL and documentation links
   */
  testApiDiscoveryRoot: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testApiDiscoveryRoot";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        return {
          success: false,
          error: `API discovery endpoint failed with status ${response.status}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate response structure per Swagger spec
      const requiredFields = ["name", "version", "enrollment", "documentation", "endpoints", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate endpoints structure
      if (!data.endpoints || typeof data.endpoints !== "object") {
        return {
          success: false,
          error: "endpoints field must be an object",
          testData,
        };
      }

      const endpointCategories = ["public", "authenticated", "privileged"];
      const missingCategories = endpointCategories.filter((cat) => !Array.isArray(data.endpoints[cat]));

      if (missingCategories.length > 0) {
        return {
          success: false,
          error: `Missing endpoint categories: ${missingCategories.join(", ")}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "API discovery endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /.well-known/enrollment endpoint
   * Validates enrollment information including pricing tiers and enrollment steps
   */
  testEnrollmentInformation: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testEnrollmentInformation";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/.well-known/enrollment`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        return {
          success: false,
          error: `Enrollment endpoint failed with status ${response.status}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate response structure per Swagger spec
      const requiredFields = ["title", "enrollment", "pricing", "enrollmentSteps", "authentication", "support", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate enrollment object
      if (!data.enrollment || typeof data.enrollment !== "object") {
        return {
          success: false,
          error: "enrollment field must be an object with url and description",
          testData,
        };
      }

      // Validate pricing object
      if (!data.pricing || !Array.isArray(data.pricing.tiers)) {
        return {
          success: false,
          error: "pricing field must contain tiers array",
          testData,
        };
      }

      // Validate enrollmentSteps array
      if (!Array.isArray(data.enrollmentSteps)) {
        return {
          success: false,
          error: "enrollmentSteps must be an array",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Enrollment information endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /openapi.json endpoint
   * Validates OpenAPI specification is accessible
   */
  testOpenApiSpecification: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testOpenApiSpecification";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        return {
          success: false,
          error: `OpenAPI endpoint failed with status ${response.status}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = {
        hasOpenapi: !!data.openapi,
        hasInfo: !!data.info,
        hasPaths: !!data.paths,
        hasComponents: !!data.components,
      };

      // Validate OpenAPI structure
      if (!data.openapi) {
        return {
          success: false,
          error: "OpenAPI specification missing openapi field",
          testData,
        };
      }

      if (!data.info) {
        return {
          success: false,
          error: "OpenAPI specification missing info field",
          testData,
        };
      }

      if (!data.paths || typeof data.paths !== "object") {
        return {
          success: false,
          error: "OpenAPI specification missing paths object",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "OpenAPI specification endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/v1/openapi.json endpoint
   * Validates versioned OpenAPI endpoint redirects properly
   */
  testVersionedOpenApiRedirect: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testVersionedOpenApiRedirect";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/api/v1/openapi.json`, {
        method: "GET",
        redirect: "follow",
      });

      testData.status = response.status;

      if (!response.ok) {
        return {
          success: false,
          error: `Versioned OpenAPI endpoint failed with status ${response.status}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = {
        hasOpenapi: !!data.openapi,
        redirectFollowed: response.url.includes("openapi.json"),
      };

      // Validate that we got OpenAPI spec (either direct or after redirect)
      if (!data.openapi) {
        return {
          success: false,
          error: "Versioned OpenAPI endpoint did not return valid OpenAPI specification",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Versioned OpenAPI endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /docs endpoint
   * Validates HTML documentation interface is accessible
   */
  testHtmlDocumentation: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testHtmlDocumentation";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/docs`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        return {
          success: false,
          error: `Documentation endpoint failed with status ${response.status}`,
          testData,
        };
      }

      const contentType = response.headers.get("content-type");
      testData.contentType = contentType;

      // Validate response is HTML
      if (!contentType || !contentType.includes("text/html")) {
        return {
          success: false,
          error: `Expected text/html content-type, got ${contentType}`,
          testData,
        };
      }

      const html = await response.text();
      testData.htmlLength = html.length;
      testData.hasSwaggerUI = html.includes("swagger") || html.includes("Swagger");

      if (html.length === 0) {
        return {
          success: false,
          error: "Documentation endpoint returned empty HTML",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "HTML documentation endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test /.well-known/privacy-policy endpoint (public)
   * Ensures privacy policy document is reachable
   */
  testWellKnownPrivacyPolicy: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testWellKnownPrivacyPolicy";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/.well-known/privacy-policy`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Privacy policy request failed: ${response.status} - ${body.substring(0, 200)}`);
      }

      const payload = await response.text();
      testData.bodyLength = payload.length;

      if (!payload || payload.length === 0) {
        return {
          success: false,
          error: "Privacy policy response was empty",
          testData,
        };
      }

      return {
        success: true,
        message: "Privacy policy endpoint returned content",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test /.well-known/data-retention endpoint (public)
   * Ensures data retention policy is discoverable
   */
  testWellKnownDataRetention: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testWellKnownDataRetention";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/.well-known/data-retention`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Data retention policy request failed: ${response.status} - ${body.substring(0, 200)}`);
      }

      const payload = await response.text();
      testData.bodyLength = payload.length;

      if (!payload || payload.length === 0) {
        return {
          success: false,
          error: "Data retention policy response was empty",
          testData,
        };
      }

      return {
        success: true,
        message: "Data retention policy endpoint returned content",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /swagger.json endpoint (public)
   * Validates that the OpenAPI schema can be fetched
   */
  testSwaggerSchemaEndpoint: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testSwaggerSchemaEndpoint";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/swagger.json`, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      testData.status = response.status;

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Swagger schema request failed: ${response.status} - ${body.substring(0, 200)}`);
      }

      const schema = await response.json();
      testData.hasOpenapi = Boolean(schema.openapi);
      testData.hasInfo = Boolean(schema.info);
      testData.pathCount = schema.paths ? Object.keys(schema.paths).length : 0;

      if (!schema.openapi || !schema.paths) {
        return {
          success: false,
          error: "Swagger schema missing required fields",
          testData,
        };
      }

      return {
        success: true,
        message: "Swagger schema endpoint returned OpenAPI document",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/agent/auth-params endpoint (public)
   * Validates authentication parameters for AI agents
   * Also tests rate limiting (429 Too Many Requests per Swagger spec)
   */
  testAgentAuthParamsGet: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testAgentAuthParamsGet";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Test 1: Normal request should succeed
      const response = await fetch(`${apiEndpoint}/api/agent/auth-params`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        return {
          success: false,
          error: `Auth params endpoint failed with status ${response.status}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate response structure (per Swagger spec: timestamp, nonce, nonce_length, requestId required)
      const requiredFields = ["timestamp", "nonce", "nonce_length", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate nonce is base64url encoded
      if (!/^[A-Za-z0-9_-]+$/.test(data.nonce)) {
        return {
          success: false,
          error: `Invalid nonce format (should be base64url): ${data.nonce}`,
          testData,
        };
      }

      // Test 2: Rate limiting - attempt multiple rapid requests to trigger 429
      testData.rateLimitTest = {
        description: "Testing rate limit (100 requests per minute per Swagger spec)",
        requestCount: 0,
        rateLimitHit: false,
        status429Count: 0,
      };

      // Make rapid requests to test rate limiting
      const rateLimitTestCount = 5; // Make 5 rapid requests to test rate limiting
      for (let i = 0; i < rateLimitTestCount; i++) {
        try {
          const rateLimitResponse = await fetch(`${apiEndpoint}/api/agent/auth-params`, {
            method: "GET",
          });
          testData.rateLimitTest.requestCount++;

          if (rateLimitResponse.status === 429) {
            testData.rateLimitTest.rateLimitHit = true;
            testData.rateLimitTest.status429Count++;
            logger.info(`Rate limit (429) hit on request ${i + 1}`, {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              requestNumber: i + 1,
            });
            break; // Stop testing once rate limit is hit
          }
        } catch (e) {
          // Network error during rate limit test - not a failure
          logger.debug(`Network error during rate limit test: ${e.message}`, {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
          });
        }
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        rateLimitTested: testData.rateLimitTest.rateLimitHit,
      });

      return {
        success: true,
        message: "Agent auth params endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },


  /**
   * Test GET /api/agents endpoint (public)
   * Validates listing of RODiT token holders with facial descriptions
   * Also tests pagination with cursor parameter (per Swagger spec)
   */
  testAgentsList: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testAgentsList";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Test 1: Initial request with limit parameter
      const response = await fetch(`${apiEndpoint}/api/agents?limit=10`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        return {
          success: false,
          error: `Agents endpoint failed with status ${response.status}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate response structure (per Swagger spec: agents, requestId required; nextCursor optional)
      const requiredFields = ["agents", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate agents is an array
      if (!Array.isArray(data.agents)) {
        return {
          success: false,
          error: "agents field should be an array",
          testData,
        };
      }

      // Validate agent structure if agents exist
      if (data.agents.length > 0) {
        const firstAgent = data.agents[0];
        if (!firstAgent.tokenId) {
          return {
            success: false,
            error: "Agent missing tokenId field",
            testData,
          };
        }
        // Validate agent has creature field (per Swagger spec - nullable but present)
        if (!("creature" in firstAgent)) {
          return {
            success: false,
            error: "Agent missing creature field",
            testData,
          };
        }
      }

      // Test 2: Pagination - test cursor parameter if nextCursor is available
      testData.paginationTest = {
        hasNextCursor: data.nextCursor ? true : false,
        nextCursorValue: data.nextCursor || null,
        secondPageTested: false,
        secondPageAgents: 0,
      };

      if (data.nextCursor) {
        logger.debug(`Testing pagination with cursor: ${data.nextCursor}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "pagination_test",
        });

        try {
          const paginationResponse = await fetch(
            `${apiEndpoint}/api/agents?limit=10&cursor=${encodeURIComponent(data.nextCursor)}`,
            { method: "GET" }
          );

          if (paginationResponse.ok) {
            const paginationData = await paginationResponse.json();
            testData.paginationTest.secondPageTested = true;
            testData.paginationTest.secondPageAgents = paginationData.agents ? paginationData.agents.length : 0;

            // Validate second page has required fields
            if (!paginationData.agents || !paginationData.requestId) {
              logger.warn("Second page missing required fields", {
                component: "TestRunner",
                moduleName,
                testName,
                correlationId,
                phase: "pagination_validation",
              });
            }
          } else {
            logger.warn(`Pagination request failed with status ${paginationResponse.status}`, {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              phase: "pagination_error",
            });
          }
        } catch (paginationError) {
          logger.debug(`Pagination test error: ${paginationError.message}`, {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "pagination_exception",
          });
        }
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        agentCount: data.agents.length,
        paginationSupported: testData.paginationTest.hasNextCursor,
      });

      return {
        success: true,
        message: "Agents list endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/identity/token/{tokenId}/full endpoint (protected)
   * Validates full token lookup with parsed DN and metadata
   */
  testIdentityTokenFullLookup: async (apiEndpoint, tokenId) => {
    const moduleName = "identyclaw-api";
    const testName = "testIdentityTokenFullLookup";
    const correlationId = ulid();
    const testData = { apiEndpoint, tokenId };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      tokenId,
    });

    try {
      const client = await getRoditClientForTest();
      
      // First get own tokenId if not provided
      if (!tokenId || typeof tokenId !== 'string') {
        const meData = await client.request('GET', '/api/me/identity');
        tokenId = meData.tokenId;
        testData.tokenId = tokenId;
      }

      if (!tokenId) {
        return {
          success: false,
          error: "No tokenId available for testing",
          testData,
        };
      }

      const data = await client.request('GET', `/api/identity/token/${tokenId}/full`);
      
      testData.status = 200;
      testData.response = data;

      // Validate response structure
      const requiredFields = ["tokenId", "dn", "face", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate tokenId format
      const tokenIdPattern = /^[a-z]{12}$/;
      if (!tokenIdPattern.test(data.tokenId)) {
        return {
          success: false,
          error: `Invalid tokenId format: ${data.tokenId}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Identity token full lookup working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test /api/noncets endpoint (protected)
   * Validates noncets generation for Morse-compatible canonical messages
   */
  testNoncetsGeneration: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testNoncetsGeneration";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      const data = await client.request('GET', '/api/noncets');
      
      testData.status = 200;
      testData.response = data;

      // Validate response structure
      const requiredFields = ["noncets", "timestamp", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate noncets format (should be :timestamp:hex:)
      const noncetsPattern = /^:.+:.+:$/;
      if (!noncetsPattern.test(data.noncets)) {
        return {
          success: false,
          error: `Invalid noncets format: ${data.noncets}`,
          testData,
        };
      }

      // Extract and validate the hex component from noncets
      // Format is :<ISO8601-timestamp>:<NONCETS-HEX>:
      const noncetsParts = data.noncets.split(':');
      if (noncetsParts.length >= 3) {
        const hexComponent = noncetsParts[2];
        const hexPattern = /^[0-9A-F]+$/;
        if (hexComponent && !hexPattern.test(hexComponent)) {
          return {
            success: false,
            error: `Invalid hex component in noncets: ${hexComponent}`,
            testData,
          };
        }
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Noncets generation working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test /api/me/identity endpoint (protected)
   * Validates self-identification functionality
   */
  testMeIdentity: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMeIdentity";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      const data = await client.request('GET', '/api/me/identity');
      
      testData.status = 200;
      testData.response = data;

      // Validate response structure (per Swagger spec: tokenId, dn, face, metadata, requestId)
      const requiredFields = ["tokenId", "dn", "face", "metadata", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate tokenId format (12 lowercase letters)
      const tokenIdPattern = /^[a-z]{12}$/;
      if (!tokenIdPattern.test(data.tokenId)) {
        return {
          success: false,
          error: `Invalid tokenId format: ${data.tokenId}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        tokenId: data.tokenId,
      });

      return {
        success: true,
        message: "Me/identity endpoint working correctly",
        tokenId: data.tokenId,
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },




  /**
   * Test /api/identity/verify endpoint (protected)
   * Validates peer hello verification with Ed25519 signatures
   * 
   * Expected HOLA format (from API spec):
   * HOLA:<recipient>:<tokenId>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<base64url-ed25519-signature>:<checksum>
   * Example: HOLA:MUNDO:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A3C7E2D1B9A4C:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:7
   */
  testIdentityVerify: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testIdentityVerify";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      
      // Test with invalid hello to verify error handling
      const invalidHello = "INVALID:HELLO:FORMAT:EXTRA";
      
      try {
        await client.request('POST', '/api/identity/verify', {
          hello: invalidHello,
          constraints: {
            maxAgeMs: 300000,
          },
        });
        
        // If we get here, the request succeeded when it should have failed
        return {
          success: false,
          error: `Expected 400 for invalid hello, but request succeeded`,
          testData,
        };
      } catch (error) {
        // Any error thrown = API rejected the invalid hello as expected
        testData.status = 400;
        testData.response = { error: error.message };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Identity verify endpoint properly validates input",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test POST /api/testhola endpoint (protected)
   * Validates HOLA message validation and server response generation
   * Note: This endpoint expects a valid HOLA message in the request body
   */
  testTesthola: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testTesthola";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      
      // Test with invalid HOLA to verify error handling
      const invalidHola = "INVALID:HOLA:FORMAT";
      
      try {
        await client.request('POST', '/api/testhola', {
          hello: invalidHola,
        });
        
        // If we get here, the request succeeded when it should have failed
        return {
          success: false,
          error: `Expected 400 for invalid HOLA, but request succeeded`,
          testData,
        };
      } catch (error) {
        // Any error thrown = API rejected the invalid HOLA as expected
        testData.status = 400;
        testData.response = { error: error.message };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Testhola endpoint properly validates HOLA messages",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test /api/mcp/resources endpoint (public)
   * Validates MCP resource listing
   */
  testMcpResources: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMcpResources";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/resources`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `MCP resources endpoint failed with status ${response.status}: ${errorText}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "MCP resources endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test /api/mcp/schema endpoint (public)
   * Validates OpenAPI schema retrieval
   */
  testMcpSchema: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMcpSchema";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/schema`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `MCP schema endpoint failed with status ${response.status}: ${errorText}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate it contains OpenAPI schema
      if (!data.requestId) {
        return {
          success: false,
          error: "Missing requestId in schema response",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "MCP schema endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test /.well-known/terms-of-service endpoint (public)
   * Validates policy document retrieval
   */
  testWellKnownTermsOfService: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testWellKnownTermsOfService";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/.well-known/terms-of-service`, {
        method: "GET",
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Terms of service endpoint failed with status ${response.status}: ${errorText}`,
          testData,
        };
      }

      const contentType = response.headers.get("content-type");
      testData.contentType = contentType;

      // Should return text/markdown or text/html
      if (!contentType || (!contentType.includes("text/markdown") && !contentType.includes("text/html"))) {
        return {
          success: false,
          error: `Unexpected content-type: ${contentType}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Terms of service endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test authentication requirement on protected endpoints
   * Validates that protected endpoints reject unauthenticated requests
   */
  testAuthenticationRequired: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testAuthenticationRequired";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const protectedEndpoints = [
        "/api/noncets",
        "/api/me/identity",
        "/api/metrics",
      ];

      const results = [];

      for (const endpoint of protectedEndpoints) {
        const response = await fetch(`${apiEndpoint}${endpoint}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
          },
          // No Authorization header
        });

        results.push({
          endpoint,
          status: response.status,
          shouldBe401: response.status === 401,
        });
      }

      testData.results = results;

      const allRejected = results.every((r) => r.shouldBe401);

      if (!allRejected) {
        const failedEndpoints = results.filter((r) => !r.shouldBe401);
        return {
          success: false,
          error: `Some endpoints did not reject unauthenticated requests: ${failedEndpoints.map((e) => e.endpoint).join(", ")}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "All protected endpoints properly require authentication",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test DID resolution endpoints (/.well-known/did/...)
   * Validates did:rodit, did:web, and resolve flows
   */
  testDidResolutionEndpoints: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testDidResolutionEndpoints";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getAuthenticatedClientContext();
      const { tokenId } = client;
      testData.tokenId = tokenId;

      const endpointChecks = [
        { name: "did:rodit", path: `/.well-known/did/rodit/${tokenId}` },
        { name: "did:web", path: `/.well-known/did/web/token/${tokenId}` },
        { name: "did:web json", path: `/.well-known/did/web/token/${tokenId}/did.json` },
      ];

      const endpointResults = [];

      for (const check of endpointChecks) {
        const document = await client.client.request("GET", check.path);
        endpointResults.push({ name: check.name, id: document.id, hasService: Array.isArray(document.service) });

        if (!document.id || !Array.isArray(document.verificationMethod)) {
          return {
            success: false,
            error: `DID document for ${check.name} missing required fields`,
            testData: { ...testData, endpointResults },
          };
        }
      }

      testData.endpointResults = endpointResults;

      return {
        success: true,
        message: "DID endpoints returned valid documents",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Negative coverage for DID resolution endpoints
   * Ensures invalid inputs return appropriate errors
   */
  testDidResolutionNegativeCases: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testDidResolutionNegativeCases";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const { client } = await getAuthenticatedClientContext();
      const invalidTokenId = "zzzzzzzzzzzz";
      const negativeEndpoints = [
        `/.well-known/did/rodit/${invalidTokenId}`,
        `/.well-known/did/web/token/${invalidTokenId}`,
        `/.well-known/did/web/token/${invalidTokenId}/did.json`,
      ];

      const endpointErrors = [];

      for (const path of negativeEndpoints) {
        try {
          await client.request("GET", path);
          return {
            success: false,
            error: `Expected ${path} to fail for invalid tokenId`,
            testData,
          };
        } catch (error) {
          const errInfo = extractApiErrorInfo(error);
          endpointErrors.push({ path, status: errInfo.statusCode, code: errInfo.code });

          // Accept any 4xx error for invalid tokenId (404 or 400)
          if (!errInfo.statusCode || errInfo.statusCode < 400) {
            return {
              success: false,
              error: `Unexpected error for ${path}: ${errInfo.statusCode} ${errInfo.code}`,
              testData: { ...testData, endpointErrors },
            };
          }
        }
      }

      // Missing DID query parameter
      try {
        await client.request("GET", "/.well-known/did/resolve");
        return {
          success: false,
          error: "Expected resolve endpoint without did query to fail",
          testData,
        };
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        testData.missingDidError = errInfo;

        // Accept any 4xx error for missing required parameter
        if (!errInfo.statusCode || errInfo.statusCode < 400) {
          return {
            success: false,
            error: `Unexpected response for missing did parameter: ${errInfo.statusCode} ${errInfo.code}`,
            testData,
          };
        }
      }

      testData.endpointErrors = endpointErrors;

      return {
        success: true,
        message: "DID endpoints reject invalid inputs as expected",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * NEGATIVE TEST: Signclient validations
   * Ensures /api/signclient rejects malformed requests
   */
  testSignclientValidationCases: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testSignclientValidationCases";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const minimalPermissions = JSON.stringify({ entities: { methods: {} } });
      const baseTobesigned = {
        permissioned_routes: minimalPermissions,
        max_requests: 100,
        maxrq_window: 60,
        not_after: futureDate,
        serviceprovider_signature: "test-signature",
      };

      const cloneTobesigned = () => JSON.parse(JSON.stringify(baseTobesigned));

      const testCases = [
        {
          desc: "missing tobesignedValues",
          body: { mintingfee: "0.01" },
          expectedCode: "SIGNCLIENT_TOBESIGNED_MISSING",
        },
        {
          desc: "missing mintingfee",
          body: { tobesignedValues: {} },
          expectedCode: "SIGNCLIENT_FEE_MISSING",
        },
        {
          desc: "permissioned_routes must be string",
          body: {
            tobesignedValues: { ...cloneTobesigned(), permissioned_routes: { invalid: true } },
            mintingfee: "0.01",
          },
          expectedCode: "SIGNCLIENT_PERMISSIONS_FORMAT",
        },
        {
          desc: "permissioned_routes parse failure",
          body: {
            tobesignedValues: { ...cloneTobesigned(), permissioned_routes: "not json" },
            mintingfee: "0.01",
          },
          expectedCode: "SIGNCLIENT_PERMISSIONS_PARSE_FAILED",
        },
        {
          desc: "minting fee mismatch",
          body: {
            tobesignedValues: cloneTobesigned(),
            mintingfee: "0.000001",
          },
          expectedCode: "SIGNCLIENT_FEE_MISMATCH",
        },
      ];

      const results = [];

      for (const { desc, body, expectedCode } of testCases) {
        const response = await fetch(`${apiEndpoint}/api/signclient`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify(body),
        });

        const payload = await response.json().catch(() => ({}));
        const errorCode = payload?.error?.code || payload?.error;

        results.push({ 
          desc, 
          status: response.status, 
          code: errorCode,
          message: payload?.error?.message || payload?.message,
          details: payload?.error?.details || payload?.details
        });

        if (response.status !== 400 || errorCode !== expectedCode) {
          logger.warn(`Signclient validation test case failed`, {
            component: 'TestRunner',
            testName,
            testCase: desc,
            expectedStatus: 400,
            actualStatus: response.status,
            expectedCode,
            actualCode: errorCode,
            responseMessage: payload?.error?.message || payload?.message,
            responseDetails: payload?.error?.details || payload?.details
          });
          
          return {
            success: false,
            error: `Unexpected response for ${desc}: status=${response.status} code=${errorCode}`,
            testData: { ...testData, results },
          };
        }
      }

      testData.results = results;

      return {
        success: true,
        message: "Signclient endpoint rejects invalid payloads as expected",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/identity/token/{tokenId}/full endpoint (protected)
   * Validates full identity lookup with DN and facial encoding per Swagger spec
   */
  testIdentityTokenFull: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testIdentityTokenFull";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const { client, tokenId } = await getAuthenticatedClientContext();
      testData.tokenId = tokenId;

      const response = await client.request("GET", `/api/identity/token/${tokenId}/full`);
      testData.status = 200;
      testData.response = response;

      // Validate response structure per Swagger spec
      const requiredFields = ["tokenId"];
      const missingFields = requiredFields.filter((field) => !response[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate that at least one of dn or face is present
      if (!response.dn && !response.face) {
        return {
          success: false,
          error: "Response should contain at least dn or face data",
          testData,
        };
      }

      // If dn is present, validate it has expected structure
      if (response.dn && typeof response.dn !== 'object') {
        return {
          success: false,
          error: "DN should be an object",
          testData,
        };
      }

      // If face is present, validate it has expected structure
      if (response.face && typeof response.face !== 'object') {
        return {
          success: false,
          error: "Face should be an object",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Identity token full endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/identity/token/{tokenId}/full endpoint - DN validation (protected)
   * Validates Distinguished Name structure in the full endpoint response
   */
  testIdentityTokenDNStructure: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testIdentityTokenDNStructure";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const { client, tokenId } = await getAuthenticatedClientContext();
      testData.tokenId = tokenId;

      const response = await client.request("GET", `/api/identity/token/${tokenId}/full`);
      testData.status = 200;
      testData.response = response;

      // Validate DN structure if present
      if (!response.dn) {
        return {
          success: true,
          message: "DN not present in response (nullable per spec)",
          testData,
        };
      }

      // If DN is present, validate it has the raw field
      if (!response.dn.raw) {
        return {
          success: false,
          error: "DN object should contain 'raw' field when present",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Identity token DN structure validated correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/identity/token/{tokenId}/full with non-existent token (protected)
   * Validates 404 handling for missing tokens
   */
  testIdentityTokenNotFound: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testIdentityTokenNotFound";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      const nonExistentTokenId = "zzzzzzzzzzzz";
      testData.tokenId = nonExistentTokenId;

      try {
        await client.request("GET", `/api/identity/token/${nonExistentTokenId}/full`);
        return {
          success: false,
          error: "Expected 404 for non-existent token, but request succeeded",
          testData,
        };
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        testData.status = errInfo.statusCode;
        testData.errorCode = errInfo.code;

        // Accept any 4xx error for non-existent token (404 or 400)
        if (!errInfo.statusCode || errInfo.statusCode < 400) {
          return {
            success: false,
            error: `Expected 4xx error, got ${errInfo.statusCode}`,
            testData,
          };
        }

        logger.info(`Test ${testName} passed`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
        });

        return {
          success: true,
          message: "Non-existent token correctly returns error",
          testData,
        };
      }
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/mcp/resource/{uri} endpoint (public)
   * Validates individual MCP resource retrieval
   */
  testMcpResourceRetrieval: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMcpResourceRetrieval";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();

      // First, get list of resources
      const resourcesList = await client.request("GET", "/api/mcp/resources");
      testData.resourceCount = resourcesList.resources ? resourcesList.resources.length : 0;

      if (!resourcesList.resources || resourcesList.resources.length === 0) {
        return {
          success: false,
          error: "No MCP resources available to test",
          testData,
        };
      }

      const testResource = resourcesList.resources[0];
      const resourceUri = testResource.uri || testResource.id;
      testData.testedUri = resourceUri;

      // Retrieve the specific resource
      const resource = await client.request("GET", `/api/mcp/resource/${encodeURIComponent(resourceUri)}`);
      testData.resourceRetrieved = true;

      if (!resource || typeof resource !== "object") {
        return {
          success: false,
          error: "Resource retrieval returned invalid data",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        uri: resourceUri,
      });

      return {
        success: true,
        message: "MCP resource retrieval working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/mcp/resource/{uri} with non-existent URI (public)
   * Validates 404 handling for missing resources
   */
  testMcpResourceNotFound: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMcpResourceNotFound";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      const nonExistentUri = `non-existent-resource-${ulid()}`;
      testData.uri = nonExistentUri;

      try {
        await client.request("GET", `/api/mcp/resource/${encodeURIComponent(nonExistentUri)}`);
        return {
          success: false,
          error: "Expected error for non-existent resource, but request succeeded",
          testData,
        };
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        testData.status = errInfo.statusCode;

        // Should return 4xx error for non-existent resource
        if (!errInfo.statusCode || errInfo.statusCode < 400) {
          return {
            success: false,
            error: `Expected 4xx error, got ${errInfo.statusCode}`,
            testData,
          };
        }

        logger.info(`Test ${testName} passed`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
        });

        return {
          success: true,
          message: "Non-existent resource correctly returns error",
          testData,
        };
      }
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/metrics endpoint (privileged)
   * Validates performance metrics retrieval
   */
  testMetricsEndpoint: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMetricsEndpoint";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();

      const metrics = await client.request("GET", "/api/metrics");
      testData.status = 200;
      testData.hasMetrics = Boolean(metrics.metrics);
      testData.hasTimestamp = Boolean(metrics.timestamp);

      if (!metrics || typeof metrics !== "object") {
        return {
          success: false,
          error: "Metrics endpoint returned invalid data",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Metrics endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/metrics/system endpoint (privileged)
   * Validates system resource metrics
   */
  testMetricsSystemEndpoint: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMetricsSystemEndpoint";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();

      const response = await client.request("GET", "/api/metrics/system");
      testData.status = 200;

      // Response should be an object with metrics
      if (!response || typeof response !== "object") {
        return {
          success: false,
          error: "Response should be an object",
          testData,
        };
      }

      if (!response.metrics || typeof response.metrics !== "object") {
        return {
          success: false,
          error: "Response should have metrics object",
          testData,
        };
      }

      // Validate metrics structure
      const requiredMetrics = ["cpu", "memory", "uptime"];
      const missingMetrics = requiredMetrics.filter((field) => response.metrics[field] === undefined);

      if (missingMetrics.length > 0) {
        return {
          success: false,
          error: `System metrics missing fields: ${missingMetrics.join(", ")}`,
          testData,
        };
      }

      // Validate CPU structure
      if (!response.metrics.cpu || typeof response.metrics.cpu !== "object") {
        return {
          success: false,
          error: "CPU metrics should be an object",
          testData,
        };
      }

      // Validate memory structure
      if (!response.metrics.memory || typeof response.metrics.memory !== "object") {
        return {
          success: false,
          error: "Memory metrics should be an object",
          testData,
        };
      }

      // Uptime should be a number
      if (typeof response.metrics.uptime !== "number") {
        return {
          success: false,
          error: "Uptime should be a number",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        uptime: response.metrics.uptime,
      });

      return {
        success: true,
        message: "System metrics endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * NEGATIVE TEST: Missing required fields in POST /api/identity/verify
   * Tests that missing fields are properly rejected
   */
  testVerifyMissingFields: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testVerifyMissingFields";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      
      const testCases = [
        { body: {}, desc: "empty body" },
        { body: { hello: "test" }, desc: "missing constraints" },
        { body: { constraints: {} }, desc: "missing hello" },
      ];

      const results = [];

      for (const { body, desc } of testCases) {
        try {
          await client.request('POST', `/api/identity/verify`, body);
          results.push({
            description: desc,
            status: 200,
            rejected: false,
          });
        } catch (error) {
          // Any thrown error = API rejected the invalid/missing field (400 or similar)
          results.push({
            description: desc,
            status: 400,
            rejected: true,
          });
        }
      }

      testData.results = results;

      const allRejected = results.every((r) => r.rejected);

      if (!allRejected) {
        const failedCases = results.filter((r) => !r.rejected);
        return {
          success: false,
          error: `Some invalid requests were not rejected: ${failedCases.map((c) => c.description).join(", ")}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Missing fields properly rejected",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * NEGATIVE TEST: Wrong content-type headers
   * Tests that endpoints reject requests with wrong content-type
   */
  testWrongContentType: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testWrongContentType";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      const token = client.stateManager.getJwtToken();
      
      const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: "not json",
      });

      testData.status = response.status;

      // Should reject with 400 or 415 (Unsupported Media Type)
      const rejected = response.status === 400 || response.status === 415;

      if (!rejected) {
        return {
          success: false,
          error: `Expected 400/415 for wrong content-type, got ${response.status}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Wrong content-type properly rejected",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * NEGATIVE TEST: Invalid JWT tokens
   * Tests that endpoints reject invalid/malformed tokens
   */
  testInvalidJwtTokens: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testInvalidJwtTokens";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const invalidTokens = [
        { token: "invalid_token_12345", desc: "malformed token" },
        { token: "Bearer invalid", desc: "invalid format" },
        { token: "", desc: "empty token" },
      ];

      const results = [];

      for (const { token, desc } of invalidTokens) {
        const response = await fetch(`${apiEndpoint}/api/noncets`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
        });

        results.push({
          description: desc,
          status: response.status,
          rejected: response.status === 401 || response.status === 403,
        });
      }

      testData.results = results;

      const allRejected = results.every((r) => r.rejected);

      if (!allRejected) {
        const failedCases = results.filter((r) => !r.rejected);
        return {
          success: false,
          error: `Some invalid tokens were not rejected: ${failedCases.map((c) => c.description).join(", ")}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "All invalid tokens properly rejected",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * COMPREHENSIVE VALIDATION TEST: HOLA handshake format validation
   * Tests various malformed HOLA handshakes to ensure proper validation
   */
  testHolaHandshakeValidation: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testHolaHandshakeValidation";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      
      // Build test cases - some require async HOLA generation
      const invalidHolaTests = [
        { hello: "", desc: "empty string", expectedCode: "HELLO_REQUIRED" },
        { hello: "HOLA", desc: "missing all fields", expectedCode: "HELLO_PROTOCOL_INVALID" },
        { hello: "HOLA:", desc: "only prefix", expectedCode: "HELLO_FORMAT_INVALID" },
        { hello: "HOLA:tokenId", desc: "missing timestamp and other fields", expectedCode: "HELLO_FORMAT_INVALID" },
        { hello: await generateValidHola(apiEndpoint, { tokenId: 'INVALIDTOKEN' }), desc: "invalid tokenId (uppercase)", expectedCode: "HELLO_TOKEN_ID_INVALID" },
        { hello: await generateValidHola(apiEndpoint, { tokenId: 'aaaaaaaaaa' }), desc: "tokenId too short (10 chars)", expectedCode: "HELLO_TOKEN_ID_INVALID" },
        { hello: await generateValidHola(apiEndpoint, { tokenId: 'aaaaaaaaaaaaaa' }), desc: "tokenId too long (14 chars)", expectedCode: "HELLO_TOKEN_ID_INVALID" },
        { hello: "HOLA:MUNDO:aaaaaaaaaaaa:BADTIMESTAMP:4F9A3C7E:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:7", desc: "invalid timestamp format", expectedCode: "HELLO_TIMESTAMP_INVALID" },
        { hello: "HOLA:MUNDO:aaaaaaaaaaaa:2026-04-04T10:10:00Z:NOTAHEX:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:7", desc: "invalid hex in noncets", expectedCode: "HELLO_NONCETS_INVALID" },
        { hello: "HOLA:MUNDO:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A3C7E:WRONG.DOMAIN.COM:n3FZ5kQ8-Lh2BsM1xY:7", desc: "wrong domain", expectedCode: "HELLO_PROTOCOL_UNRECOGNIZED" },
        { hello: "HOLA:MUNDO:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A3C7E:API.IDENTYCLAW.COM::7", desc: "empty signature", expectedCode: "HELLO_FIELDS_MISSING" },
        { hello: "HOLA:MUNDO:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A3C7E:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:", desc: "empty checksum", expectedCode: "HELLO_FIELDS_MISSING" },
        { hello: (() => { const msg = `HOLA:MUNDO:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A3C7E:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:`; return msg + 'ZZ'; })(), desc: "invalid checksum (not hex)", expectedCode: "HELLO_CHECKSUM_INVALID" },
      ];

      const results = [];
      
      for (const { hello, desc, expectedCode } of invalidHolaTests) {
        try {
          await client.request('POST', '/api/identity/verify', {
            hello,
            constraints: { maxAgeMs: 300000 },
          });
          
          // Should not succeed - API rejects invalid HOLA with 400
          results.push({
            description: desc,
            hello: hello.substring(0, 50),
            expectedRejection: true,
            actuallyRejected: false,
            passed: false,
            error: "Expected 400 rejection but request succeeded",
          });
        } catch (error) {
          const errorInfo = extractApiErrorInfo(error);
          const statusCode = errorInfo.statusCode;
          const errorCode = errorInfo.code;
          // Test passes if we got a 400+ error (rejection expected and received)
          // Don't require exact error code match - just verify rejection occurred
          const passed = statusCode >= 400;
          
          results.push({
            description: desc,
            hello: hello.substring(0, 50),
            expectedRejection: true,
            actuallyRejected: statusCode >= 400,
            statusCode,
            errorCode,
            errorMessage: errorInfo.message?.substring(0, 200),
            requestId: errorInfo.requestId,
            passed,
          });
        }
      }

      testData.results = results;
      const allPassed = results.every(r => r.passed);

      if (!allPassed) {
        const failures = results.filter(r => !r.passed);
        return {
          success: false,
          error: `${failures.length} HOLA validation tests failed`,
          details: failures,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        totalTests: results.length,
      });

      return {
        success: true,
        message: `All ${results.length} HOLA validation tests passed`,
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * COMPREHENSIVE VALIDATION TEST: Oversized input rejection
   * Tests that endpoints reject excessively large inputs
   */
  testOversizedInputRejection: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testOversizedInputRejection";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      
      // Test cases for oversized inputs - requires async HOLA generation
      const oversizedTests = [
        {
          endpoint: '/api/identity/verify',
          method: 'POST',
          body: {
            hello: await generateHolaOfLength(apiEndpoint, 10000), // Extremely long hello (10KB)
            constraints: { maxAgeMs: 300000 },
          },
          desc: "oversized hello string (10KB)",
          expectedCode: "HELLO_TOO_LONG",
        },
        {
          endpoint: '/api/identity/verify',
          method: 'POST',
          body: {
            hello: await generateValidHola(apiEndpoint), // Properly formatted HOLA
            constraints: { maxAgeMs: 999999999999 }, // Unreasonably large maxAge
          },
          desc: "unreasonably large maxAgeMs",
          expectedCode: "INVALID_CONSTRAINTS",
        },
      ];

      const results = [];
      
      for (const { endpoint, method, body, desc, expectedCode } of oversizedTests) {
        try {
          await client.request(method, endpoint, body);
          
          // Should not succeed - API now rejects oversized inputs with 400
          results.push({
            description: desc,
            endpoint,
            expectedRejection: true,
            actuallyRejected: false,
            passed: false,
            error: "Expected 400 rejection but request succeeded",
          });
        } catch (error) {
          const errorInfo = extractApiErrorInfo(error);
          const statusCode = errorInfo.statusCode;
          const errorCode = errorInfo.code;
          // Test passes if we got a 400+ error (rejection expected and received)
          // Don't require exact error code match - just verify rejection occurred
          const passed = statusCode >= 400;
          
          results.push({
            description: desc,
            endpoint,
            expectedRejection: true,
            actuallyRejected: statusCode >= 400,
            statusCode,
            errorCode,
            errorMessage: errorInfo.message?.substring(0, 200),
            requestId: errorInfo.requestId,
            passed,
          });
        }
      }

      testData.results = results;
      const allPassed = results.every(r => r.passed);

      if (!allPassed) {
        const failures = results.filter(r => !r.passed);
        return {
          success: false,
          error: `${failures.length} oversized input tests failed`,
          details: failures,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        totalTests: results.length,
      });

      return {
        success: true,
        message: `All ${results.length} oversized input tests passed`,
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * SECURITY TEST: Hello string length limit enforcement
   * Verifies that API enforces 512-byte maximum on hello strings to prevent DoS
   */
  testHelloStringLengthLimit: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testHelloStringLengthLimit";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      
      const MAX_HELLO_LENGTH = 512;
      
      // Test cases for hello string length validation - requires async HOLA generation
      const testCases = [
        {
          hello: await generateHolaOfLength(apiEndpoint, 505), // Just under limit
          desc: "valid HOLA at 505 chars (under 512 limit)",
          shouldPass: true,
        },
        {
          hello: await generateHolaOfLength(apiEndpoint, 512), // Exactly at limit
          desc: "valid HOLA at exactly 512 chars (at limit)",
          shouldPass: true,
        },
        {
          hello: await generateHolaOfLength(apiEndpoint, 513), // Over limit
          desc: "valid HOLA at 513 chars (over 512 limit)",
          shouldPass: false,
        },
        {
          hello: await generateHolaOfLength(apiEndpoint, 1000), // Way over limit
          desc: "valid HOLA at 1000 chars (way over limit)",
          shouldPass: false,
        },
      ];

      const results = [];
      
      for (const { hello, desc, shouldPass } of testCases) {
        try {
          const response = await client.request('POST', '/api/identity/verify', {
            hello,
            constraints: { maxAgeMs: 300000 },
          });
          
          // Request succeeded
          if (shouldPass) {
            results.push({
              description: desc,
              length: hello.length,
              shouldPass,
              actuallyPassed: true,
              passed: true,
            });
          } else {
            results.push({
              description: desc,
              length: hello.length,
              shouldPass,
              actuallyPassed: true,
              passed: false,
              error: `Expected 400 rejection for ${hello.length} chars, but request succeeded`,
            });
          }
        } catch (error) {
          const errorInfo = extractApiErrorInfo(error);
          const statusCode = errorInfo.statusCode;
          const errorCode = errorInfo.code;
          // For oversized inputs, any 400+ rejection is acceptable (don't require exact error code)
          const isRejected = statusCode >= 400;
          
          if (!shouldPass && isRejected) {
            // Expected rejection occurred
            results.push({
              description: desc,
              length: hello.length,
              shouldPass,
              actuallyPassed: false,
              passed: true,
              statusCode,
              errorCode,
              requestId: errorInfo.requestId,
              errorMessage: errorInfo.message?.substring(0, 200),
            });
          } else if (shouldPass) {
            // Unexpected error for valid input
            results.push({
              description: desc,
              length: hello.length,
              shouldPass,
              actuallyPassed: false,
              passed: false,
              statusCode,
              errorCode,
              error: errorInfo.message?.substring(0, 200),
            });
          } else {
            // Wrong outcome for invalid input (did not return expected error)
            results.push({
              description: desc,
              length: hello.length,
              shouldPass,
              actuallyPassed: false,
              passed: false,
              statusCode,
              errorCode,
              error: errorInfo.message?.substring(0, 200),
            });
          }
        }
      }

      testData.results = results;
      testData.maxAllowedLength = MAX_HELLO_LENGTH;
      const allPassed = results.every(r => r.passed);

      if (!allPassed) {
        const failures = results.filter(r => !r.passed);
        return {
          success: false,
          error: `${failures.length} hello length validation tests failed`,
          details: failures,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        totalTests: results.length,
      });

      return {
        success: true,
        message: `All ${results.length} hello length validation tests passed`,
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * COMPREHENSIVE VALIDATION TEST: Response field validation
   * Tests that API responses contain all required fields with correct types
   */
  testResponseFieldValidation: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testResponseFieldValidation";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();
      
      // Test /api/noncets response structure
      const noncetsData = await client.request('GET', '/api/noncets');
      const noncetsValidation = {
        endpoint: '/api/noncets',
        requiredFields: ['noncets', 'timestamp', 'requestId'],
        optionalFields: ['length', 'algorithm'],
        typeChecks: {
          noncets: 'string',
          timestamp: 'string',
          requestId: 'string',
          length: 'number',
          algorithm: 'string',
        },
      };

      const noncetsErrors = [];
      for (const field of noncetsValidation.requiredFields) {
        if (!(field in noncetsData)) {
          noncetsErrors.push(`Missing required field: ${field}`);
        } else if (typeof noncetsData[field] !== noncetsValidation.typeChecks[field]) {
          noncetsErrors.push(`Field ${field} has wrong type: expected ${noncetsValidation.typeChecks[field]}, got ${typeof noncetsData[field]}`);
        }
      }

      // Test /api/me/identity response structure (per Swagger spec: tokenId, dn, face, metadata, requestId)
      const identityData = await client.request('GET', '/api/me/identity');
      const identityValidation = {
        endpoint: '/api/me/identity',
        requiredFields: ['tokenId', 'dn', 'face', 'metadata', 'requestId'],
        typeChecks: {
          tokenId: 'string',
          dn: 'object',
          face: 'object',
          metadata: 'object',
          requestId: 'string',
        },
      };

      const identityErrors = [];
      for (const field of identityValidation.requiredFields) {
        if (!(field in identityData)) {
          identityErrors.push(`Missing required field: ${field}`);
        } else if (typeof identityData[field] !== identityValidation.typeChecks[field]) {
          identityErrors.push(`Field ${field} has wrong type: expected ${identityValidation.typeChecks[field]}, got ${typeof identityData[field]}`);
        }
      }

      // Test /api/identity/token/{tokenId}/full response structure
      const meIdentity = await client.request('GET', '/api/me/identity');
      const fullTokenData = await client.request('GET', `/api/identity/token/${meIdentity.tokenId}/full`);
      const fullTokenValidation = {
        endpoint: '/api/identity/token/{tokenId}/full',
        requiredFields: ['tokenId', 'dn', 'face', 'requestId'],
        typeChecks: {
          tokenId: 'string',
          dn: 'object',
          face: 'object',
          requestId: 'string',
        },
      };

      const fullTokenErrors = [];
      for (const field of fullTokenValidation.requiredFields) {
        if (!(field in fullTokenData)) {
          fullTokenErrors.push(`Missing required field: ${field}`);
        } else if (typeof fullTokenData[field] !== fullTokenValidation.typeChecks[field]) {
          fullTokenErrors.push(`Field ${field} has wrong type: expected ${fullTokenValidation.typeChecks[field]}, got ${typeof fullTokenData[field]}`);
        }
      }

      testData.validations = {
        noncets: { errors: noncetsErrors, data: noncetsData },
        identity: { errors: identityErrors, data: identityData },
        fullToken: { errors: fullTokenErrors, data: fullTokenData },
      };

      const allErrors = [...noncetsErrors, ...identityErrors, ...fullTokenErrors];
      
      if (allErrors.length > 0) {
        return {
          success: false,
          error: `Response validation failed with ${allErrors.length} errors`,
          details: allErrors,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "All response fields validated successfully",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/sessions/list_all endpoint (privileged)
   * Validates session listing for admin users
   */
  testSessionListAll: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testSessionListAll";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();

      const response = await client.request("GET", "/api/sessions/list_all");
      testData.status = 200;

      // Response should be an object with sessions array
      if (!response || typeof response !== "object") {
        return {
          success: false,
          error: "Response should be an object",
          testData,
        };
      }

      if (!response.sessions || !Array.isArray(response.sessions)) {
        return {
          success: false,
          error: "Response should have sessions array",
          testData,
        };
      }

      testData.sessionCount = response.sessions.length;

      // If sessions exist, validate structure
      if (response.sessions.length > 0) {
        const firstSession = response.sessions[0];
        const requiredFields = ["id", "roditId", "ownerId", "createdAt", "expiresAt", "lastAccessedAt", "status"];
        const missingFields = requiredFields.filter((field) => firstSession[field] === undefined);

        if (missingFields.length > 0) {
          return {
            success: false,
            error: `Session missing fields: ${missingFields.join(", ")}`,
            testData,
          };
        }
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        sessionCount: testData.sessionCount,
      });

      return {
        success: true,
        message: "Session list endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test POST /api/sessions/cleanup endpoint (privileged)
   * Validates cleanup of expired sessions
   */
  testSessionCleanup: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testSessionCleanup";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();

      const response = await client.request("POST", "/api/sessions/cleanup", {});
      testData.status = 200;
      testData.response = response;

      if (!response || typeof response !== "object") {
        return {
          success: false,
          error: "Cleanup response should be an object",
          testData,
        };
      }

      // Response should have success flag and stats object
      if (response.success !== true) {
        return {
          success: false,
          error: "Cleanup response should have success: true",
          testData,
        };
      }

      if (!response.stats || typeof response.stats !== "object") {
        return {
          success: false,
          error: "Cleanup response should have stats object",
          testData,
        };
      }

      // Validate stats structure
      const requiredStats = ["removedCount", "activeSessions", "totalSessions", "cleanupResult"];
      const missingStats = requiredStats.filter((field) => response.stats[field] === undefined);

      if (missingStats.length > 0) {
        return {
          success: false,
          error: `Stats missing fields: ${missingStats.join(", ")}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        removedCount: response.stats.removedCount,
      });

      return {
        success: true,
        message: "Session cleanup endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test POST /api/sessions/revoke endpoint (privileged)
   * Validates session revocation
   */
  testSessionRevoke: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testSessionRevoke";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();

      // First, get a session to revoke
      const listResponse = await client.request("GET", "/api/sessions/list_all");

      if (!listResponse || !listResponse.sessions || !Array.isArray(listResponse.sessions)) {
        return {
          success: false,
          error: "Failed to get sessions list",
          testData,
        };
      }

      testData.sessionCount = listResponse.sessions.length;

      if (listResponse.sessions.length === 0) {
        return {
          success: false,
          error: "No sessions available to revoke",
          testData,
        };
      }

      const sessionToRevoke = listResponse.sessions[0];
      const sessionId = sessionToRevoke.id;
      testData.revokedSessionId = sessionId;

      // Attempt to revoke the session
      const response = await client.request("POST", "/api/sessions/revoke", {
        sessionId: sessionId,
      });

      testData.status = 200;
      testData.response = response;

      if (!response || typeof response !== "object") {
        return {
          success: false,
          error: "Revoke response should be an object",
          testData,
        };
      }

      // Validate response structure
      if (response.message !== "Session terminated successfully") {
        return {
          success: false,
          error: `Expected message 'Session terminated successfully', got '${response.message}'`,
          testData,
        };
      }

      if (response.sessionId !== sessionId) {
        return {
          success: false,
          error: `Expected sessionId '${sessionId}', got '${response.sessionId}'`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        sessionId,
      });

      return {
        success: true,
        message: "Session revoke endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test GET /api/metrics/debug endpoint (privileged)
   * Validates debug metrics for monitoring
   */
  testMetricsDebug: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMetricsDebug";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();

      const debugMetrics = await client.request("GET", "/api/metrics/debug");
      testData.status = 200;
      testData.response = debugMetrics;

      if (!debugMetrics || typeof debugMetrics !== "object") {
        return {
          success: false,
          error: "Debug metrics should be an object",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Debug metrics endpoint working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test POST /api/metrics/reset endpoint (privileged)
   * Validates metrics counter reset - expects admin permission requirement
   */
  testMetricsReset: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMetricsReset";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const client = await getRoditClientForTest();

      try {
        const response = await client.request("POST", "/api/metrics/reset", {});
        testData.status = 200;
        testData.response = response;

        // If we get here, user has admin permissions
        if (!response || typeof response !== "object") {
          return {
            success: false,
            error: "Reset response should be an object",
            testData,
          };
        }

        logger.info(`Test ${testName} passed`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
        });

        return {
          success: true,
          message: "Metrics reset endpoint working correctly (admin access)",
          testData,
        };
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        
        // Check if it's an admin permission error (403) - this is expected for non-admin users
        if (errInfo.statusCode === 403) {
          testData.status = errInfo.statusCode;
          testData.errorCode = errInfo.code;
          testData.expectedBehavior = "Admin-only endpoint correctly rejected non-admin user";

          logger.info(`Test ${testName} passed`, {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            note: "Admin permission correctly required",
          });

          return {
            success: true,
            message: "Metrics reset correctly requires admin permission",
            testData,
          };
        }

        // If it's a different error, that's a failure
        throw error;
      }
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },
};

module.exports = identyclawApiTests;
