// test-utils.js
const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, RoditClient } = require('../../sdk');

/**
 * Extract standardized error information from any error object
 * Follows the unified error handling standard defined in UNIFIED_ERROR_HANDLING_IMPLEMENTATION.md
 * 
 * API Error Response Structure:
 * {
 *   "error": {
 *     "code": "HELLO_TOKEN_ID_INVALID",
 *     "message": "Token ID must be exactly 12 lowercase letters",
 *     "details": { ... }  // Optional
 *   },
 *   "requestId": "01HX9X0T9CS1EM0WQ7R6F5B2VY",
 *   "timestamp": "2026-04-15T08:21:45.000Z"
 * }
 * 
 * RoditClient Error Object (thrown by SDK):
 * {
 *   statusCode: 400,
 *   code: "HELLO_TOKEN_ID_INVALID",
 *   message: "Token ID must be exactly 12 lowercase letters",
 *   responseData: { error: { code, message, details }, requestId, timestamp },
 *   requestId: "01HX9X0T9CS1EM0WQ7R6F5B2VY",
 *   timestamp: "2026-04-15T08:21:45.000Z"
 * }
 * 
 * @param {Error|Object|string} error - Error object, response object, or error message
 * @returns {Object} Standardized error info with statusCode, code, message, requestId, timestamp, details
 */
function extractApiErrorInfo(error) {
  // Handle null/undefined
  if (!error) {
    return {
      statusCode: null,
      code: null,
      message: 'Unknown error',
      requestId: null,
      timestamp: null,
      details: null,
      responseData: {}
    };
  }

  // If it's a string, treat as message
  if (typeof error === 'string') {
    return {
      statusCode: null,
      code: null,
      message: error,
      requestId: null,
      timestamp: null,
      details: null,
      responseData: {}
    };
  }

  // Extract from RoditClient Error object (follows unified error handling standard)
  const responseData = error.responseData || {};
  const apiError = responseData.error || {};

  return {
    statusCode: error.statusCode || null,
    code: error.code || apiError.code || null,
    message: error.message || apiError.message || 'Unknown error',
    requestId: error.requestId || responseData.requestId || null,
    timestamp: error.timestamp || responseData.timestamp || null,
    details: apiError.details || null,
    responseData: responseData
  };
}

/**
 * Determine if a test failure is due to external server issues vs client bugs
 * @param {Object} error - Error object or error message
 * @returns {Object} Classification result
 */
function classifyTestFailure(error) {
  // Handle undefined/empty error
  if (!error) {
    return {
      type: 'unknown',
      category: 'unknown',
      shouldFailTest: true,
      reason: 'No error information provided'
    };
  }

  // Safely get error string
  let errorStr;
  if (typeof error === 'string') {
    errorStr = error;
  } else if (error?.message) {
    errorStr = error.message;
  } else if (error?.error) {
    errorStr = typeof error.error === 'string' ? error.error : JSON.stringify(error.error);
  } else {
    errorStr = JSON.stringify(error);
  }

  // Server authentication/infrastructure issues
  if (errorStr.includes('INVALID_TOKEN') || 
      errorStr.includes('JWT token validation failed') ||
      errorStr.includes('missing token_id field') ||
      errorStr.includes('fetch failed') ||
      errorStr.includes('Network error') ||
      errorStr.includes('Login failed: Failed to login to server')) {
    return {
      type: 'external_server_issue',
      category: 'infrastructure',
      shouldFailTest: false,
      reason: 'Server authentication or infrastructure issue'
    };
  }

  // Handle 404 errors specifically
  if (errorStr.includes('404') || errorStr.includes('Not Found')) {
    return {
      type: 'client_error',
      category: 'configuration',
      shouldFailTest: true,
      reason: 'Endpoint not found (404) - Check API route configuration'
    };
  }

  // Default case
  return {
    type: 'unknown',
    category: 'unknown',
    shouldFailTest: true,
    reason: `Unhandled error: ${errorStr.substring(0, 200)}` // Limit length
  };
}

/**
 * Standardized function to capture and log test results consistently
 */
function captureTestData(testName, moduleName, result, testData) {
  if (!testData || typeof testData !== 'object') {
    testData = {};
  }

  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    apiEndpoint: testData.endpoint || (testData.ctd_api_ep ? `${testData.ctd_api_ep} (derived)` : "unknown"),
  };

  if (!result.passed) {
    const correlationId = ulid();
    result.testInfo.correlationId = correlationId;
    
    // Extract error message properly - handle various error formats
    let errorMessage = "Unknown error";
    if (typeof result.error === 'string') {
      errorMessage = result.error;
    } else if (result.error?.message) {
      errorMessage = result.error.message;
    } else if (result.error?.error) {
      errorMessage = typeof result.error.error === 'string' ? result.error.error : JSON.stringify(result.error.error);
    } else if (result.error) {
      errorMessage = JSON.stringify(result.error);
    } else if (Array.isArray(result.results)) {
      const failedResult = result.results.find((entry) => entry && entry.passed === false);
      if (failedResult) {
        if (typeof failedResult.error === 'string') {
          errorMessage = failedResult.error;
        } else if (failedResult.error?.message) {
          errorMessage = failedResult.error.message;
        } else if (failedResult.name) {
          errorMessage = `Failed subtest: ${failedResult.name}`;
        }
      }
    }
    
    // Classify the failure type
    const failureClassification = classifyTestFailure(errorMessage);
    result.failureClassification = failureClassification;

    // Use standardized logging format for not-passed tests
    logTestResult(false, testName, {
      testId: correlationId,
      component: "TestRunner",
      details: {
        moduleName,
        apiEndpoint: result.testInfo.endpoint,
        failureData: {
          testInfo: result.testInfo,
          testData,
          details: result.details || {},
          failureClassification
        }
      },
      error: errorMessage
    });

    // Only count as test failure if it's a client bug
    if (failureClassification.shouldFailTest) {
      logger.metric("test_failure", 1, {
        module: moduleName,
        test: testName,
        apiEndpoint: result.testInfo.endpoint,
        correlation_id: correlationId,
        failure_type: failureClassification.type
      });
    } else {
      logger.metric("test_skipped_external_issue", 1, {
        module: moduleName,
        test: testName,
        apiEndpoint: result.testInfo.endpoint,
        correlation_id: correlationId,
        failure_type: failureClassification.type,
        reason: failureClassification.reason
      });
    }
  } else {
    // Use standardized logging format for passed tests
    logTestResult(true, testName, {
      component: "TestRunner",
      details: {
        moduleName,
        apiEndpoint: result.testInfo.endpoint,
        testDetails: result.details || {}
      }
    });

    logger.metric("test_success", 1, {
      module: moduleName,
      test: testName,
      apiEndpoint: result.testInfo.endpoint,
    });
  }

  return result;
}

/**
 * Capture test data for reporting and analysis
 * @param {string} moduleName - Name of test module
 * @param {string} testName - Name of test
 * @param {string} operation - Operation being performed
 * @param {Object} data - Data to capture
 */
function captureTestDataForReporting(moduleName, testName, operation, data) {
  // Add timestamp and identifiers
  const capturedData = {
    timestamp: new Date().toISOString(),
    moduleName,
    testName,
    operation,
    ...data
  };

  // Log the captured data
  logger.debug(`Test data captured: ${moduleName}.${testName}.${operation}`, capturedData);
  
  return capturedData;
}

/**
 * Fetch with error handling for API calls
 * @param {string} url - URL to fetch
 * @param {Object} testutils - Fetch testutils
 * @returns {Promise<Object>} - Response data
 */
async function fetchWithErrorHandling(url, testutils = {}) {
  const requestId = ulid();
  const startTime = Date.now();
  
  try {
    logger.debug(`Fetching ${url}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: testutils.method || "GET"
    });

    const response = await fetch(url, {
      ...testutils,
      headers: {
        "Content-Type": "application/json",
        ...testutils.headers
      }
    });

    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      
      logger.error(`Fetch error: ${response.status} ${response.statusText}`, {
        component: "fetchWithErrorHandling",
        requestId,
        url,
        method: testutils.method || "GET",
        status: response.status,
        statusText: response.statusText,
        duration,
        errorText
      });
      
      throw new Error(`HTTP error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    logger.debug(`Fetch successful: ${url}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: testutils.method || "GET",
      status: response.status,
      duration
    });
    
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error(`Fetch exception: ${error.message}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: testutils.method || "GET",
      duration,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
}

/**
 * Run a single test and record the result
 * @param {Object} results - Results object to update
 * @param {string} testName - Name of the test
 * @param {Function} testFn - Test function to execute
 * @returns {Promise<Object>} - Test result
 */
async function runTest(results, testName, testFn) {
  const testId = ulid();
  const startTime = new Date().toISOString();
  const startTimeMs = Date.now();
  
  // Add sdk- prefix to test names for better identification
  const displayTestName = testName.startsWith('sdk-') ? testName : `sdk-${testName}`;
  
  // Ensure results object has required arrays
  if (!results || typeof results !== 'object') {
    results = {};
  }
  if (!Array.isArray(results.tests)) {
    results.tests = [];
  }
  if (!Array.isArray(results.errors)) {
    results.errors = [];
  }
  
  // Use INFO level for test execution to ensure visibility in console logs
  logger.info(`Running test: ${displayTestName}`, {
    component: "TestRunner",
    testId,
    testName: displayTestName,
    startTime,
    phase: "start"
  });
  
  try {
    await testFn();
    
    const endTimeMs = Date.now();
    const duration = endTimeMs - startTimeMs;
    
    const result = {
      id: testId,
      name: displayTestName,
      passed: true,
      startTime,
      endTime: new Date().toISOString(),
      duration,
      result: "passed" // Explicitly set result for consistency
    };
    
    results.tests.push(result);
    
    // Use captureTestData for consistent test result reporting
    return captureTestData(displayTestName, "sdk", result, {
      ctd_api_ep: "local",
      testId,
      duration
    });
  } catch (error) {
    const endTimeMs = Date.now();
    const duration = endTimeMs - startTimeMs;
    
    const result = {
      id: testId,
      name: displayTestName,
      passed: false,
      startTime,
      endTime: new Date().toISOString(),
      duration,
      error: error.message,
      stack: error.stack,
      result: "not-passed" // Explicitly set result for consistency
    };
    
    results.tests.push(result);
    results.errors.push({
      test: displayTestName,
      error: error.message,
      stack: error.stack
    });
    
    // Use captureTestData for consistent test result reporting
    return captureTestData(displayTestName, "sdk", result, {
      ctd_api_ep: "local",
      testId,
      duration,
      error: error.message,
      stack: error.stack
    });
    
    // Note: captureTestData already handles proper logging and metrics
  }
}

/**
 * Log test result with standardized format
 * @param {boolean} success - Whether the test passed
 * @param {string} testName - Name of the test
 * @param {Object} testutils - Additional testutils
 * @param {string} testutils.testId - Test ID
 * @param {Object} testutils.details - Additional details to log
 * @param {Error} testutils.error - Error object if test failed
 */
function logTestResult(success, testName, testutils = {}) {
  const {
    testId = ulid(),
    details = {},
    error = null,
    component = "TestRunner"
  } = testutils;
  
  const duration = testutils.duration || 0;
  const normalizedError =
    typeof error === 'string'
      ? error
      : error?.message || (error ? JSON.stringify(error) : null);
  const normalizedStack =
    typeof error === 'string'
      ? null
      : error?.stack || null;
  
  if (success) {
    // Log passed test with consistent format - using INFO level for visibility
    logger.info(`Test passed: ${testName}`, {
      component,
      testId,
      testName,
      duration,
      result: "passed",
      ...details
    });
    
    // Also log at debug level for detailed logs
    logger.debug(`Test details: ${testName}`, {
      component,
      testId,
      testName,
      duration,
      result: "passed",
      ...details
    });
  } else {
    // Log not-passed test with consistent format
    logger.info(`Test not-passed: ${testName}`, {
      component,
      testId,
      testName,
      error: normalizedError || "Unknown error",
      result: "not-passed",
      duration,
      ...details
    });
    
    // Also log at error level for alerting
    logger.error(`Test error details: ${testName}`, {
      component,
      testId,
      testName,
      error: normalizedError || "Unknown error",
      stack: normalizedStack,
      result: "not-passed",
      duration,
      ...details
    });
  }
  
  return {
    success,
    result: success ? "passed" : "not-passed",
    testId,
    testName,
    details,
    error: normalizedError
  };
}

/**
 * Get shared RoditClient instance or create a new one
 * @deprecated Use createTestRoditClient instead to avoid test interference
 * This function tries to access the shared roditClient from app.locals if available,
 * otherwise creates a new instance and initializes it.
 * @param {Object} testutils - Options object
 * @param {Object} testutils.app - Express app instance with roditClient in app.locals
 * @returns {Promise<RoditClient>} Initialized RoditClient instance
 */
async function getSharedRoditClient(testutils = {}) {
    logger.warn('getSharedRoditClient is deprecated - use createTestRoditClient for test isolation', {
      component: 'test-utils',
      method: 'getSharedRoditClient',
      source: 'app.locals'
    });
    return testutils.app.locals.roditClient;
}

/**
 * Create a test instance of RoditClient with independent state
 * This is useful for testing multiple concurrent sessions
 * @param {Object} testutils - Options object
 * @returns {Promise<RoditClient>} Initialized test RoditClient instance
 */
async function createTestRoditClient(testutils = {}) {
  logger.debug('Creating test RoditClient instance', {
    component: 'test-utils',
    method: 'createTestRoditClient',
    testutils
  });
  
  return await RoditClient.createTestInstance(testutils);
}

/**
 * Get RoditClient instance for tests - always creates independent test instance
 * This is the recommended way to get RoditClient instances in tests to avoid interference
 * @param {Object} testutils - Options object
 * @returns {Promise<RoditClient>} Initialized test RoditClient instance
 */
async function getRoditClientForTest(testutils = {}) {
  logger.debug('Creating independent RoditClient instance for test', {
    component: 'test-utils',
    method: 'getRoditClientForTest',
    testutils
  });
  
  // Always create test instance to ensure isolation
  return await RoditClient.createTestInstance({
    testMode: true,
    ...testutils
  });
}

module.exports = {
  extractApiErrorInfo, // Standard error extraction (ERROR_HANDLING_STANDARD.md)
  captureTestData,
  captureTestDataForReporting,
  fetchWithErrorHandling,
  runTest,
  logTestResult,
  classifyTestFailure,
  getSharedRoditClient, // @deprecated - use getRoditClientForTest instead
  createTestRoditClient,
  getRoditClientForTest // Recommended for all tests
};