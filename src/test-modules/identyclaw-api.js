/**
 * IDENTYCLAW API Functionality and Security Tests
 * Tests specific to the IDENTYCLAW API endpoints as defined in swagger.json
 */

const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const stateManager = require("../../sdk/lib/blockchain/statemanager");
const { getRoditClientForTest } = require("./test-utils");

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
      const client = await getRoditClientForTest();
      const data = await client.request('GET', '/api/me/face');
      
      testData.status = 200;
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
      const client = await getRoditClientForTest();
      
      // First get own tokenId if not provided (second arg from runner is logContext, not tokenId)
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

      const data = await client.request('GET', `/api/identity/token/${tokenId}`);
      
      testData.status = 200;
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
      const client = await getRoditClientForTest();
      
      // First get own tokenId if not provided (second arg from runner is logContext, not tokenId)
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

      const data = await client.request('GET', `/api/identity/face/${tokenId}`);
      
      testData.status = 200;
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
   * 
   * Expected HOLA format (from API spec):
   * HOLA:<tokenId>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<base64url-ed25519-signature>:<checksum>
   * Example: HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A3C7E2D1B9A4C:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:7
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
      const invalidHello = "INVALID:HELLO:FORMAT";
      
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
      const client = await getRoditClientForTest();
      
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
        try {
          await client.request('GET', `/api/identity/face/${id}`);
          results.push({
            tokenId: id,
            description: desc,
            status: 200,
            rejected: false,
          });
        } catch (error) {
          // Any thrown error = API rejected the invalid tokenId (400 or similar)
          results.push({
            tokenId: id,
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
      const client = await getRoditClientForTest();
      
      // Test with a facially valid but non-existent tokenId
      // "aaaaaaaaaaaa": all 'a' (index 0 for each category), checksum = 0%26 = 'a' → valid face encoding
      const nonExistentTokenId = "aaaaaaaaaaaa"; // Valid facial encoding, should not exist on NEAR
      
      try {
        await client.request('GET', `/api/identity/face/${nonExistentTokenId}`);
        testData.status = 200;
        return {
          success: false,
          error: `Expected 404 for non-existent tokenId, got 200`,
          testData,
        };
      } catch (error) {
        const status = error.message.includes('404') ? 404 : 401;
        testData.status = status;
        
        // Should return 404 for non-existent resource
        if (status !== 404) {
          return {
            success: false,
            error: `Expected 404 for non-existent tokenId, got ${status}`,
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
      
      // Test cases for invalid HOLA formats
      const invalidHolaTests = [
        { hello: "", desc: "empty string" },
        { hello: "HOLA", desc: "missing all fields" },
        { hello: "HOLA:", desc: "only prefix" },
        { hello: "HOLA:tokenId", desc: "missing timestamp and other fields" },
        { hello: "HOLA:INVALIDTOKEN:2026-04-04T10:10:00Z:4F9A:API.IDENTYCLAW.COM:sig:7", desc: "invalid tokenId (uppercase)" },
        { hello: "HOLA:aaaaaaaaaa:2026-04-04T10:10:00Z:4F9A:API.IDENTYCLAW.COM:sig:7", desc: "tokenId too short (10 chars)" },
        { hello: "HOLA:aaaaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A:API.IDENTYCLAW.COM:sig:7", desc: "tokenId too long (14 chars)" },
        { hello: "HOLA:aaaaaaaaaaaa:BADTIMESTAMP:4F9A:API.IDENTYCLAW.COM:sig:7", desc: "invalid timestamp format" },
        { hello: "HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:NOTAHEX:API.IDENTYCLAW.COM:sig:7", desc: "invalid hex in noncets" },
        { hello: "HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A:WRONG.DOMAIN.COM:sig:7", desc: "wrong domain" },
        { hello: "HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A:API.IDENTYCLAW.COM::7", desc: "empty signature" },
        { hello: "HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A:API.IDENTYCLAW.COM:sig:", desc: "empty checksum" },
        { hello: "HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A:API.IDENTYCLAW.COM:sig:ZZ", desc: "invalid checksum (not hex)" },
      ];

      const results = [];
      
      for (const { hello, desc } of invalidHolaTests) {
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
          // Expected: API returns 400 error for invalid HOLA format
          const is400 = error.message.includes('400');
          const passed = is400;
          
          results.push({
            description: desc,
            hello: hello.substring(0, 50),
            expectedRejection: true,
            actuallyRejected: is400,
            status: is400 ? 400 : 'other',
            errorMessage: error.message.substring(0, 80),
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
      
      // Test cases for oversized inputs
      const oversizedTests = [
        {
          endpoint: '/api/identity/verify',
          method: 'POST',
          body: {
            hello: 'HOLA:' + 'a'.repeat(10000), // Extremely long hello
            constraints: { maxAgeMs: 300000 },
          },
          desc: "oversized hello string (10KB)",
        },
        {
          endpoint: '/api/identity/verify',
          method: 'POST',
          body: {
            hello: 'HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A:API.IDENTYCLAW.COM:sig:7',
            constraints: { maxAgeMs: 999999999999 }, // Unreasonably large maxAge
          },
          desc: "unreasonably large maxAgeMs",
        },
      ];

      const results = [];
      
      for (const { endpoint, method, body, desc } of oversizedTests) {
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
          // Expected to be rejected with 400
          const is400 = error.message.includes('400');
          const passed = is400;
          
          results.push({
            description: desc,
            endpoint,
            expectedRejection: true,
            actuallyRejected: is400,
            errorStatus: error.message.substring(0, 50),
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
      
      // Helper to generate valid HOLA message of specific length
      const generateHolaOfLength = (targetLength) => {
        // Format: HOLA:<tokenId>:<timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<signature>:<checksum>
        const base = 'HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A3C7E:API.IDENTYCLAW.COM:';
        const checksum = '7';
        
        // Calculate how much padding we need in the signature field
        const fixedLength = base.length + checksum.length;
        const signaturePadding = targetLength - fixedLength;
        
        if (signaturePadding < 1) {
          // If target is too short, just return a minimal valid HOLA
          return 'HOLA:aaaaaaaaaaaa:2026-04-04T10:10:00Z:4F9A:API.IDENTYCLAW.COM:sig:7';
        }
        
        // Create signature by padding with valid base64url characters
        const signature = 'n3FZ5kQ8-Lh2BsM1xY'.repeat(Math.ceil(signaturePadding / 18)).substring(0, signaturePadding);
        return base + signature + checksum;
      };
      
      // Test cases for hello string length validation
      const testCases = [
        {
          hello: generateHolaOfLength(505), // Just under limit
          desc: "valid HOLA at 505 chars (under 512 limit)",
          shouldPass: true,
        },
        {
          hello: generateHolaOfLength(512), // Exactly at limit
          desc: "valid HOLA at exactly 512 chars (at limit)",
          shouldPass: true,
        },
        {
          hello: generateHolaOfLength(513), // Over limit
          desc: "valid HOLA at 513 chars (over 512 limit)",
          shouldPass: false,
        },
        {
          hello: generateHolaOfLength(1000), // Way over limit
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
          // Request failed
          const is400 = error.message.includes('400');
          
          if (!shouldPass && is400) {
            results.push({
              description: desc,
              length: hello.length,
              shouldPass,
              actuallyPassed: false,
              passed: true,
              status: 400,
            });
          } else {
            results.push({
              description: desc,
              length: hello.length,
              shouldPass,
              actuallyPassed: false,
              passed: false,
              error: error.message.substring(0, 100),
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

      // Test /api/me/identity response structure
      const identityData = await client.request('GET', '/api/me/identity');
      const identityValidation = {
        endpoint: '/api/me/identity',
        requiredFields: ['tokenId', 'identity', 'requestId'],
        typeChecks: {
          tokenId: 'string',
          identity: 'object',
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

      // Test /api/me/face response structure
      const faceData = await client.request('GET', '/api/me/face');
      const faceValidation = {
        endpoint: '/api/me/face',
        requiredFields: ['tokenId', 'faceDescription', 'requestId'],
        typeChecks: {
          tokenId: 'string',
          faceDescription: 'object',
          requestId: 'string',
        },
      };

      const faceErrors = [];
      for (const field of faceValidation.requiredFields) {
        if (!(field in faceData)) {
          faceErrors.push(`Missing required field: ${field}`);
        } else if (typeof faceData[field] !== faceValidation.typeChecks[field]) {
          faceErrors.push(`Field ${field} has wrong type: expected ${faceValidation.typeChecks[field]}, got ${typeof faceData[field]}`);
        }
      }

      // Validate faceDescription structure
      if (faceData.faceDescription) {
        if (!('checksumValid' in faceData.faceDescription)) {
          faceErrors.push('faceDescription missing checksumValid field');
        }
        if (!('categories' in faceData.faceDescription)) {
          faceErrors.push('faceDescription missing categories field');
        }
      }

      testData.validations = {
        noncets: { errors: noncetsErrors, data: noncetsData },
        identity: { errors: identityErrors, data: identityData },
        face: { errors: faceErrors, data: faceData },
      };

      const allErrors = [...noncetsErrors, ...identityErrors, ...faceErrors];
      
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
};

module.exports = identyclawApiTests;
