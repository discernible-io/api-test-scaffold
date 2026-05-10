/**
 * Test Result Formatter
 * 
 * Standardizes test result reporting across all test modules with:
 * - Explicit passed/not-passed/skipped/inconclusive states
 * - Structured error responses with code, message, details
 * - Coverage notes for optional behaviors
 * - Stable test IDs for matrix correlation
 */

const { ulid } = require('ulid');

/**
 * Test result status enum
 */
const TestStatus = {
  PASSED: 'passed',
  NOT_PASSED: 'not-passed',
  SKIPPED: 'skipped',
  INCONCLUSIVE: 'inconclusive'
};

/**
 * Create a standard test result
 * @param {Object} options
 * @returns {Object} Standardized result
 */
function createTestResult(options = {}) {
  const {
    status = TestStatus.PASSED,
    testId = ulid(),
    testName = 'unknown',
    module = 'unknown',
    endpoint = null,
    method = null,
    statusCode = null,
    error = null,
    message = null,
    details = null,
    skipReason = null,
    inconclusiveReason = null,
    coverageNotes = null,
    duration = 0,
    timestamp = new Date().toISOString()
  } = options;

  const result = {
    status,
    testId,
    testName,
    module,
    timestamp,
    duration
  };

  // Add endpoint context if available
  if (endpoint || method) {
    result.endpoint = {
      path: endpoint,
      method: method
    };
  }

  // Add error details for not-passed tests
  if (status === TestStatus.NOT_PASSED) {
    result.error = {
      code: error?.code || 'UNKNOWN_ERROR',
      message: message || error?.message || 'Test assertion failed',
      details: details || error?.details || null,
      statusCode: statusCode || error?.statusCode || null
    };
  }

  // Add skip reason for skipped tests
  if (status === TestStatus.SKIPPED) {
    result.skipReason = skipReason || 'No reason provided';
  }

  // Add inconclusive reason and coverage notes
  if (status === TestStatus.INCONCLUSIVE) {
    result.inconclusiveReason = inconclusiveReason || 'No reason provided';
    result.coverageNotes = coverageNotes || null;
  }

  return result;
}

/**
 * Create a passed result
 */
function passed(testName, module, options = {}) {
  return createTestResult({
    status: TestStatus.PASSED,
    testName,
    module,
    ...options
  });
}

/**
 * Create a not-passed result
 */
function notPassed(testName, module, error, options = {}) {
  return createTestResult({
    status: TestStatus.NOT_PASSED,
    testName,
    module,
    error,
    ...options
  });
}

/**
 * Create a skipped result
 */
function skipped(testName, module, skipReason, options = {}) {
  return createTestResult({
    status: TestStatus.SKIPPED,
    testName,
    module,
    skipReason,
    ...options
  });
}

/**
 * Create an inconclusive result
 * Used when optional behavior is not observed but test is still valid
 */
function inconclusive(testName, module, inconclusiveReason, options = {}) {
  return createTestResult({
    status: TestStatus.INCONCLUSIVE,
    testName,
    module,
    inconclusiveReason,
    ...options
  });
}

/**
 * Validate error response structure against Swagger schema
 * @param {Object} errorResponse - The error response from API
 * @param {Object} expectedSchema - Expected schema from Swagger
 * @returns {Object} Validation result { valid: boolean, errors: [] }
 */
function validateErrorResponse(errorResponse, expectedSchema = null) {
  const errors = [];

  // Check required fields per Swagger ErrorResponse schema
  if (!errorResponse) {
    errors.push('Error response is null or undefined');
    return { valid: false, errors };
  }

  // Check error object structure
  if (!errorResponse.error || typeof errorResponse.error !== 'object') {
    errors.push('Missing or invalid error object');
  } else {
    if (!errorResponse.error.code) {
      errors.push('Missing error.code');
    }
    if (!errorResponse.error.message) {
      errors.push('Missing error.message');
    }
  }

  // Check requestId
  if (!errorResponse.requestId) {
    errors.push('Missing requestId');
  }

  // Check timestamp
  if (!errorResponse.timestamp) {
    errors.push('Missing timestamp');
  } else if (isNaN(Date.parse(errorResponse.timestamp))) {
    errors.push('Invalid timestamp format (not ISO 8601)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create a structured error object for test failures
 */
function createError(code, message, details = null, statusCode = null) {
  return {
    code,
    message,
    details,
    statusCode
  };
}

/**
 * Common error codes
 */
const ErrorCodes = {
  // Validation errors
  HOLA_VALIDATION_FAILED: 'HOLA_VALIDATION_FAILED',
  INVALID_TOKEN_ID: 'INVALID_TOKEN_ID',
  INVALID_CONTENT_TYPE: 'INVALID_CONTENT_TYPE',
  
  // Auth errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_JWT: 'INVALID_JWT',
  EXPIRED_TOKEN: 'EXPIRED_TOKEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Server errors
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  
  // Test infrastructure
  TEST_ASSERTION_FAILED: 'TEST_ASSERTION_FAILED',
  TEST_TIMEOUT: 'TEST_TIMEOUT',
  TEST_SETUP_FAILED: 'TEST_SETUP_FAILED'
};

/**
 * Assert HTTP status code
 */
function assertStatus(actual, expected, message = null) {
  if (actual !== expected) {
    throw createError(
      ErrorCodes.TEST_ASSERTION_FAILED,
      message || `Expected status ${expected}, got ${actual}`,
      { expected, actual },
      actual
    );
  }
}

/**
 * Assert response has required fields
 */
function assertHasFields(obj, fields, message = null) {
  const missing = fields.filter(f => !(f in obj));
  if (missing.length > 0) {
    throw createError(
      ErrorCodes.TEST_ASSERTION_FAILED,
      message || `Missing required fields: ${missing.join(', ')}`,
      { missing, expected: fields }
    );
  }
}

/**
 * Assert response field matches value
 */
function assertEqual(actual, expected, fieldName = null, message = null) {
  if (actual !== expected) {
    throw createError(
      ErrorCodes.TEST_ASSERTION_FAILED,
      message || `${fieldName || 'Value'} mismatch: expected ${expected}, got ${actual}`,
      { expected, actual, field: fieldName }
    );
  }
}

module.exports = {
  TestStatus,
  createTestResult,
  passed,
  notPassed,
  skipped,
  inconclusive,
  validateErrorResponse,
  createError,
  ErrorCodes,
  assertStatus,
  assertHasFields,
  assertEqual
};
