/**
 * Negative Test Packs
 * 
 * Systematic negative test cases for common failure modes:
 * - Authentication failures (invalid JWT, missing auth, wrong permissions)
 * - Content-Type validation
 * - Schema conformance on error responses
 * - Rate limiting detection
 * 
 * These packs are imported by specific test modules and used to generate
 * negative assertions without duplicating test code.
 */

const { createError, ErrorCodes, validateErrorResponse } = require('./test-result-formatter');

/**
 * Authentication negative test pack
 * Tests invalid JWT, missing auth, expired tokens, wrong permissions
 */
const authNegativePack = {
  name: 'AUTH-NEG',
  tests: [
    {
      id: 'AUTH-NEG-001',
      name: 'Missing Authorization header',
      description: 'Request without Authorization header should return 401',
      request: (endpoint) => ({
        method: 'GET',
        url: endpoint,
        headers: {
          // No Authorization header
        }
      }),
      expectedStatus: 401,
      expectedErrorCode: 'UNAUTHORIZED',
      validate: (response) => {
        const validation = validateErrorResponse(response.body);
        if (!validation.valid) {
          throw createError(
            ErrorCodes.TEST_ASSERTION_FAILED,
            'Error response does not match Swagger schema',
            { validationErrors: validation.errors }
          );
        }
        if (response.body.error.code !== 'UNAUTHORIZED') {
          throw createError(
            ErrorCodes.TEST_ASSERTION_FAILED,
            `Expected error code UNAUTHORIZED, got ${response.body.error.code}`
          );
        }
      }
    },
    {
      id: 'AUTH-NEG-002',
      name: 'Invalid JWT format',
      description: 'Malformed JWT should return 401',
      request: (endpoint) => ({
        method: 'GET',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer not.a.valid.jwt'
        }
      }),
      expectedStatus: 401,
      expectedErrorCode: 'INVALID_JWT',
      validate: (response) => {
        const validation = validateErrorResponse(response.body);
        if (!validation.valid) {
          throw createError(
            ErrorCodes.TEST_ASSERTION_FAILED,
            'Error response does not match Swagger schema',
            { validationErrors: validation.errors }
          );
        }
      }
    },
    {
      id: 'AUTH-NEG-003',
      name: 'Empty Authorization header',
      description: 'Empty Bearer token should return 401',
      request: (endpoint) => ({
        method: 'GET',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer '
        }
      }),
      expectedStatus: 401,
      expectedErrorCode: 'UNAUTHORIZED'
    },
    {
      id: 'AUTH-NEG-004',
      name: 'Wrong Authorization scheme',
      description: 'Non-Bearer auth scheme should return 401',
      request: (endpoint) => ({
        method: 'GET',
        url: endpoint,
        headers: {
          'Authorization': 'Basic dXNlcjpwYXNz'
        }
      }),
      expectedStatus: 401,
      expectedErrorCode: 'UNAUTHORIZED'
    }
  ]
};

/**
 * Content-Type negative test pack
 * Tests invalid Content-Type headers and malformed payloads
 */
const contentTypeNegativePack = {
  name: 'CONTENT-TYPE-NEG',
  tests: [
    {
      id: 'CONTENT-TYPE-NEG-001',
      name: 'Missing Content-Type header',
      description: 'POST without Content-Type should return 400',
      request: (endpoint, payload) => ({
        method: 'POST',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer valid-token',
          // No Content-Type
        },
        body: payload
      }),
      expectedStatus: 400,
      expectedErrorCode: 'INVALID_CONTENT_TYPE'
    },
    {
      id: 'CONTENT-TYPE-NEG-002',
      name: 'Wrong Content-Type for JSON',
      description: 'POST with text/plain instead of application/json',
      request: (endpoint, payload) => ({
        method: 'POST',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'text/plain'
        },
        body: payload
      }),
      expectedStatus: 415,
      expectedErrorCode: 'INVALID_CONTENT_TYPE'
    },
    {
      id: 'CONTENT-TYPE-NEG-003',
      name: 'Malformed JSON body',
      description: 'POST with invalid JSON should return 400',
      request: (endpoint) => ({
        method: 'POST',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: '{invalid json}'
      }),
      expectedStatus: 400,
      expectedErrorCode: 'INVALID_JSON'
    },
    {
      id: 'CONTENT-TYPE-NEG-004',
      name: 'Empty body with Content-Type',
      description: 'POST with Content-Type but empty body',
      request: (endpoint) => ({
        method: 'POST',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: ''
      }),
      expectedStatus: 400,
      expectedErrorCode: 'EMPTY_BODY'
    }
  ]
};

/**
 * Schema validation negative test pack
 * Tests invalid field values, missing required fields, type mismatches
 */
const schemaValidationNegativePack = {
  name: 'SCHEMA-VAL-NEG',
  tests: [
    {
      id: 'SCHEMA-VAL-NEG-001',
      name: 'Invalid TokenId format',
      description: 'TokenId must be exactly 12 lowercase letters',
      request: (endpoint) => ({
        method: 'GET',
        url: `${endpoint}/invalid-token-id`,
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      }),
      expectedStatus: 400,
      expectedErrorCode: 'HOLA_VALIDATION_FAILED',
      validate: (response) => {
        if (!response.body.error.message.includes('12 lowercase')) {
          throw createError(
            ErrorCodes.TEST_ASSERTION_FAILED,
            'Error message should reference TokenId format requirement'
          );
        }
      }
    },
    {
      id: 'SCHEMA-VAL-NEG-002',
      name: 'Missing required field',
      description: 'Request missing required field should return 400',
      request: (endpoint) => ({
        method: 'POST',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          // Missing required field
        })
      }),
      expectedStatus: 400,
      expectedErrorCode: 'VALIDATION_FAILED'
    },
    {
      id: 'SCHEMA-VAL-NEG-003',
      name: 'Invalid field type',
      description: 'Field with wrong type should return 400',
      request: (endpoint) => ({
        method: 'POST',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          limit: 'not-a-number' // Should be integer
        })
      }),
      expectedStatus: 400,
      expectedErrorCode: 'VALIDATION_FAILED'
    },
    {
      id: 'SCHEMA-VAL-NEG-004',
      name: 'Field exceeds maximum length',
      description: 'String field exceeding max length should return 400',
      request: (endpoint) => ({
        method: 'POST',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: 'x'.repeat(10000) // Exceeds max length
        })
      }),
      expectedStatus: 400,
      expectedErrorCode: 'VALIDATION_FAILED'
    }
  ]
};

/**
 * Rate limiting negative test pack
 * Tests rate limit detection and 429 responses
 */
const rateLimitingNegativePack = {
  name: 'RATE-LIMIT-NEG',
  tests: [
    {
      id: 'RATE-LIMIT-NEG-001',
      name: 'Rate limit exceeded',
      description: 'Excessive requests should return 429',
      request: (endpoint) => ({
        method: 'GET',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      }),
      expectedStatus: 429,
      expectedErrorCode: 'RATE_LIMIT_EXCEEDED',
      validate: (response) => {
        if (!response.headers['retry-after']) {
          console.warn('Rate limit response missing Retry-After header');
        }
      },
      inconclusive: true,
      inconclusiveReason: 'Rate limit depends on deployment configuration and request history'
    }
  ]
};

/**
 * Permission negative test pack
 * Tests insufficient permissions and resource access control
 */
const permissionNegativePack = {
  name: 'PERMISSION-NEG',
  tests: [
    {
      id: 'PERMISSION-NEG-001',
      name: 'Insufficient permissions',
      description: 'Request with valid JWT but insufficient permissions should return 403',
      request: (endpoint) => ({
        method: 'DELETE',
        url: endpoint,
        headers: {
          'Authorization': 'Bearer read-only-token'
        }
      }),
      expectedStatus: 403,
      expectedErrorCode: 'INSUFFICIENT_PERMISSIONS'
    },
    {
      id: 'PERMISSION-NEG-002',
      name: 'Resource not found for user',
      description: 'Request for resource user does not own should return 404 or 403',
      request: (endpoint) => ({
        method: 'GET',
        url: `${endpoint}/other-user-resource`,
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      }),
      expectedStatus: [403, 404],
      expectedErrorCode: ['INSUFFICIENT_PERMISSIONS', 'NOT_FOUND']
    }
  ]
};

/**
 * Apply a negative test pack to an endpoint
 * @param {string} endpoint - API endpoint URL
 * @param {Object} pack - Negative test pack
 * @param {Function} httpClient - HTTP client function (fetch-like)
 * @returns {Promise<Array>} Array of test results
 */
async function applyNegativePack(endpoint, pack, httpClient) {
  const results = [];

  for (const test of pack.tests) {
    try {
      const request = test.request(endpoint);
      const response = await httpClient(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });

      const statusOk = Array.isArray(test.expectedStatus)
        ? test.expectedStatus.includes(response.status)
        : response.status === test.expectedStatus;

      if (!statusOk) {
        results.push({
          testId: test.id,
          status: 'not-passed',
          reason: `Expected status ${test.expectedStatus}, got ${response.status}`
        });
        continue;
      }

      // Validate error response structure
      if (response.status >= 400) {
        const validation = validateErrorResponse(response.body);
        if (!validation.valid) {
          results.push({
            testId: test.id,
            status: 'not-passed',
            reason: `Error response validation failed: ${validation.errors.join(', ')}`
          });
          continue;
        }
      }

      // Run custom validation if provided
      if (test.validate) {
        try {
          test.validate(response);
        } catch (error) {
          results.push({
            testId: test.id,
            status: 'not-passed',
            reason: error.message
          });
          continue;
        }
      }

      // Mark as inconclusive if applicable
      if (test.inconclusive) {
        results.push({
          testId: test.id,
          status: 'inconclusive',
          reason: test.inconclusiveReason
        });
      } else {
        results.push({
          testId: test.id,
          status: 'passed'
        });
      }
    } catch (error) {
      results.push({
        testId: test.id,
        status: 'not-passed',
        reason: error.message
      });
    }
  }

  return results;
}

module.exports = {
  authNegativePack,
  contentTypeNegativePack,
  schemaValidationNegativePack,
  rateLimitingNegativePack,
  permissionNegativePack,
  applyNegativePack
};
