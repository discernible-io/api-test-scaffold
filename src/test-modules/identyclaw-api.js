/**
 * IDENTYCLAW API Functionality and Security Tests
 * Tests specific to the IDENTYCLAW API endpoints as defined in swagger.json
 */

const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const stateManager = require("../../sdk/lib/blockchain/statemanager");

/**
 * Helper to get authentication headers
 */
const getHeaders = () => {
  const token = stateManager.getJwtToken();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Request-ID": ulid(),
  };
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
      const response = await fetch(`${apiEndpoint}/api/noncets`, {
        method: "GET",
        headers: getHeaders(),
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Noncets endpoint failed with status ${response.status}: ${errorText}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate response structure
      const requiredFields = ["noncets", "noncets_hex", "timestamp", "requestId"];
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

      // Validate hex format (uppercase hex)
      const hexPattern = /^[0-9A-F]+$/;
      if (!hexPattern.test(data.noncets_hex)) {
        return {
          success: false,
          error: `Invalid noncets_hex format: ${data.noncets_hex}`,
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
      const response = await fetch(`${apiEndpoint}/api/me/identity`, {
        method: "GET",
        headers: getHeaders(),
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Me/identity endpoint failed with status ${response.status}: ${errorText}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate response structure
      const requiredFields = ["tokenId", "identity", "requestId"];
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
   * Test /api/me/face endpoint (protected)
   * Validates facial token_id encoding
   */
  testMeFace: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testMeFace";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const response = await fetch(`${apiEndpoint}/api/me/face`, {
        method: "GET",
        headers: getHeaders(),
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Me/face endpoint failed with status ${response.status}: ${errorText}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate response structure
      const requiredFields = ["tokenId", "faceDescription", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
          testData,
        };
      }

      // Validate faceDescription structure
      if (!data.faceDescription.checksumValid === undefined || !data.faceDescription.categories) {
        return {
          success: false,
          error: "Invalid faceDescription structure",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        checksumValid: data.faceDescription.checksumValid,
      });

      return {
        success: true,
        message: "Me/face endpoint working correctly",
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
   * Test /api/identity/token/{tokenId} endpoint (protected)
   * Validates peer identity lookup
   */
  testIdentityTokenLookup: async (apiEndpoint, tokenId) => {
    const moduleName = "identyclaw-api";
    const testName = "testIdentityTokenLookup";
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
      // First get own tokenId if not provided
      if (!tokenId) {
        const meResponse = await fetch(`${apiEndpoint}/api/me/identity`, {
          method: "GET",
          headers: getHeaders(),
        });

        if (meResponse.ok) {
          const meData = await meResponse.json();
          tokenId = meData.tokenId;
          testData.tokenId = tokenId;
        }
      }

      if (!tokenId) {
        return {
          success: false,
          error: "No tokenId available for testing",
          testData,
        };
      }

      const response = await fetch(`${apiEndpoint}/api/identity/token/${tokenId}`, {
        method: "GET",
        headers: getHeaders(),
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Identity token lookup failed with status ${response.status}: ${errorText}`,
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
        message: "Identity token lookup working correctly",
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
   * Test /api/identity/face/{tokenId} endpoint (protected)
   * Validates peer facial description lookup
   */
  testIdentityFaceLookup: async (apiEndpoint, tokenId) => {
    const moduleName = "identyclaw-api";
    const testName = "testIdentityFaceLookup";
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
      // First get own tokenId if not provided
      if (!tokenId) {
        const meResponse = await fetch(`${apiEndpoint}/api/me/identity`, {
          method: "GET",
          headers: getHeaders(),
        });

        if (meResponse.ok) {
          const meData = await meResponse.json();
          tokenId = meData.tokenId;
          testData.tokenId = tokenId;
        }
      }

      if (!tokenId) {
        return {
          success: false,
          error: "No tokenId available for testing",
          testData,
        };
      }

      const response = await fetch(`${apiEndpoint}/api/identity/face/${tokenId}`, {
        method: "GET",
        headers: getHeaders(),
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Identity face lookup failed with status ${response.status}: ${errorText}`,
          testData,
        };
      }

      const data = await response.json();
      testData.response = data;

      // Validate response structure
      const requiredFields = ["tokenId", "faceDescription", "requestId"];
      const missingFields = requiredFields.filter((field) => !data[field]);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `Missing required fields: ${missingFields.join(", ")}`,
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
        message: "Identity face lookup working correctly",
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
      // Test with invalid hello to verify error handling
      const invalidHello = "INVALID:HELLO:FORMAT";
      
      const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          hello: invalidHello,
          constraints: {
            maxAgeMs: 300000,
          },
        }),
      });

      testData.status = response.status;

      // Should return 400 for invalid hello
      if (response.status !== 400) {
        return {
          success: false,
          error: `Expected 400 for invalid hello, got ${response.status}`,
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
        "/api/me/face",
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
   * NEGATIVE TEST: Invalid tokenId formats for /api/identity/face/{tokenId}
   * Tests various invalid tokenId formats to ensure proper validation
   */
  testInvalidTokenIdFormats: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testInvalidTokenIdFormats";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const invalidTokenIds = [
        { id: "INVALIDTOKEN", desc: "uppercase letters" },
        { id: "invalid123", desc: "contains numbers" },
        { id: "short", desc: "too short" },
        { id: "toolongtoken123", desc: "too long" },
        { id: "invalid-dash", desc: "contains dash" },
        { id: "invalid_under", desc: "contains underscore" },
      ];

      const results = [];

      for (const { id, desc } of invalidTokenIds) {
        const response = await fetch(`${apiEndpoint}/api/identity/face/${id}`, {
          method: "GET",
          headers: getHeaders(),
        });

        results.push({
          tokenId: id,
          description: desc,
          status: response.status,
          rejected: response.status === 400 || response.status === 404,
        });
      }

      testData.results = results;

      const allRejected = results.every((r) => r.rejected);

      if (!allRejected) {
        const failedCases = results.filter((r) => !r.rejected);
        return {
          success: false,
          error: `Some invalid tokenIds were not rejected: ${failedCases.map((c) => c.description).join(", ")}`,
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
        message: "All invalid tokenId formats properly rejected",
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
      const testCases = [
        { body: {}, desc: "empty body" },
        { body: { hello: "test" }, desc: "missing constraints" },
        { body: { constraints: {} }, desc: "missing hello" },
      ];

      const results = [];

      for (const { body, desc } of testCases) {
        const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify(body),
        });

        results.push({
          description: desc,
          status: response.status,
          rejected: response.status === 400,
        });
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
      const token = stateManager.getJwtToken();
      
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
   * NEGATIVE TEST: Non-existent resources (404)
   * Tests that endpoints return 404 for non-existent resources
   */
  testNonExistentResources: async (apiEndpoint) => {
    const moduleName = "identyclaw-api";
    const testName = "testNonExistentResources";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
        correlationId,
    });

    try {
      // Test with a valid format but non-existent tokenId
      const nonExistentTokenId = "zzzzzzzzzzza"; // Valid format, but doesn't exist
      
      const response = await fetch(`${apiEndpoint}/api/identity/face/${nonExistentTokenId}`, {
        method: "GET",
        headers: getHeaders(),
      });

      testData.status = response.status;

      // Should return 404 for non-existent resource
      if (response.status !== 404) {
        return {
          success: false,
          error: `Expected 404 for non-existent tokenId, got ${response.status}`,
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
        message: "Non-existent resources properly return 404",
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
};

module.exports = identyclawApiTests;
