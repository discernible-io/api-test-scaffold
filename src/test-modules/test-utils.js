// test-utils.js
const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, RoditClient } = require('../../sdk');

/** Aggregate counter key — test-rodit-constitution.md terminology. */
const NOT_PASSED = "not-passed";

/**
 * Findings-first fields for suite-level logs (test-rodit-constitution.md § Findings-First Reporting).
 */
function buildSuiteFindingsLogContext(suiteName, suiteResults, extra = {}) {
  const notPassed = suiteResults[NOT_PASSED] ?? 0;
  const passed = suiteResults.passed ?? 0;
  const skipped = suiteResults.skipped ?? 0;
  const total = suiteResults.total ?? 0;
  const outcome = notPassed > 0 ? NOT_PASSED : "passed";

  return {
    ...extra,
    suiteName,
    outcome,
    whatHappened: `${total} test(s) in ${suiteName}: ${passed} passed, ${notPassed} not-passed, ${skipped} skipped`,
    specRequires:
      "Each case must match required or forbidden behavior in target-swagger.json",
    tallies: {
      passed,
      [NOT_PASSED]: notPassed,
      skipped,
      total,
    },
  };
}

/**
 * Log a single suite outcome (findings-first; one line per suite completion).
 */
function logSuiteOutcome(loggerApi, suiteName, suiteResults, extra = {}) {
  const context = buildSuiteFindingsLogContext(suiteName, suiteResults, extra);
  const notPassed = context.tallies[NOT_PASSED];
  const message = `Test suite outcome: ${outcomeLabel(context.outcome)} — ${suiteName}`;

  loggerApi.infoWithContext(message, context);

  if (notPassed > 0) {
    loggerApi.warnWithContext(
      `Test suite not-passed: ${suiteName} — see per-test outcome logs for case-level whatHappened/specRequires`,
      { ...context, result: NOT_PASSED }
    );
  }
}

function outcomeLabel(outcome) {
  return outcome === NOT_PASSED ? "not-passed" : "passed";
}

/**
 * Findings-first fields for per-test logs (test-rodit-constitution.md).
 */
function buildTestFindingsLogContext(passed, testName, testutils = {}) {
  const outcome = passed ? "passed" : NOT_PASSED;
  const { details = {}, error = null } = testutils;
  const nestedDetails =
    details.testDetails ||
    details.failureData?.details ||
    details.details ||
    {};
  const normalizedError =
    typeof error === "string"
      ? error
      : error?.message || (error ? JSON.stringify(error) : null);

  const whatHappened =
    nestedDetails.whatHappened ||
    (passed
      ? nestedDetails.summary ||
        `Case ${testName}: no API/spec mismatch reported`
      : normalizedError || "See error and details for observed behavior");

  const specRequires =
    nestedDetails.specRequires ||
    "Behavior required or forbidden per target-swagger.json for this endpoint/case";

  return { outcome, whatHappened, specRequires };
}

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
    logger.warn('extractApiErrorInfo called with null/undefined error', {
      component: 'test-utils',
      method: 'extractApiErrorInfo'
    });
    return {
      statusCode: null,
      code: null,
      message: 'Unknown error: error object is null or undefined',
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

  const errorInfo = {
    statusCode: error.statusCode || null,
    code: error.code || apiError.code || null,
    message: error.message || apiError.message || 'Unknown error: no message found in error object',
    requestId: error.requestId || responseData.requestId || null,
    timestamp: error.timestamp || responseData.timestamp || null,
    details: apiError.details || null,
    responseData: responseData
  };

  // Log for debugging if we couldn't extract a proper message
  if (!errorInfo.message || errorInfo.message === 'Unknown error: no message found in error object') {
    logger.warn('Could not extract proper error message', {
      component: 'test-utils',
      method: 'extractApiErrorInfo',
      errorKeys: Object.keys(error),
      hasStatusCode: !!error.statusCode,
      hasCode: !!error.code,
      hasMessage: !!error.message,
      hasResponseData: !!error.responseData,
      hasApiError: !!apiError,
      errorString: JSON.stringify(error).substring(0, 500)
    });
  }

  return errorInfo;
}

/** JWT clock tolerance used when comparing session vs credential durations. */
const JWT_CLOCK_TOLERANCE_SECONDS = 2;

function isPermissionDeniedErrorInfo(errorInfo) {
  if (!errorInfo || typeof errorInfo !== "object") {
    return false;
  }
  return errorInfo.statusCode === 403 || errorInfo.code === "PERMISSION_DENIED";
}

function isPermissionDeniedCaughtError(error) {
  return isPermissionDeniedErrorInfo(extractApiErrorInfo(error));
}

function buildAdminAuthSkippedDetails({ endpoint, errorInfo }) {
  const status = errorInfo?.statusCode ?? 403;
  const code = errorInfo?.code ?? "PERMISSION_DENIED";
  return {
    skippedAdminPath: true,
    whatHappened: `Non-admin token received HTTP ${status} ${code} on ${endpoint}`,
    specRequires: `${endpoint} is admin-only; 403 PERMISSION_DENIED for non-admin token matches target-swagger.json`,
    errorInfo,
  };
}

/**
 * True when session and credential clocks share the same duration (no renewal headroom).
 * @param {Object} payload - Decoded JWT payload
 * @param {number} [toleranceSeconds=2]
 */
function isDualClockCollapsedJwtPayload(payload, toleranceSeconds = JWT_CLOCK_TOLERANCE_SECONDS) {
  if (!payload || payload.session_exp == null || payload.exp == null || payload.iat == null) {
    return false;
  }
  const sessionIat = Number(payload.session_iat ?? payload.iat);
  const sessionDur = Number(payload.session_exp) - sessionIat;
  const credDur = Number(payload.exp) - Number(payload.iat);
  return Math.abs(sessionDur - credDur) <= toleranceSeconds;
}

/** True when session_exp exceeds credential exp by more than tolerance (renewal can extend exp). */
function hasRenewalHeadroomJwtPayload(payload, toleranceSeconds = JWT_CLOCK_TOLERANCE_SECONDS) {
  if (!payload || payload.session_exp == null || payload.exp == null) {
    return false;
  }
  return Number(payload.session_exp) > Number(payload.exp) + toleranceSeconds;
}

/**
 * Absolute URL for a path under the configured API base (trailing slashes normalized).
 * @param {string} apiBaseUrl
 * @param {string} path - Path beginning with / or a path segment
 */
function apiUrl(apiBaseUrl, path) {
  const base = String(apiBaseUrl || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * Direct `fetch` for negative/security tests when RoditClient must not build the request
 * (e.g. malformed Authorization, bad login JSON). See TEST CONSTITUTION — SDK exceptions.
 * @param {string} apiBaseUrl
 * @param {string} path
 * @param {RequestInit} [init]
 */
function fetchDirect(apiBaseUrl, path, init = {}) {
  return fetch(apiUrl(apiBaseUrl, path), init);
}

/**
 * Full Authorization header value with an exact bearer payload (may be empty or invalid on purpose).
 * @param {string} rawToken - Literal string sent after `Bearer ` (not URL-encoded by this helper).
 */
function bearerAuthorizationHeader(rawToken) {
  return `Bearer ${rawToken}`;
}

/**
 * Classify how a negative login attempt was rejected.
 *
 * - **swagger_http_error**: POST /api/login returned a completed HTTP 4xx/5xx response (documented
 *   in api-docs/target-swagger.json — ErrorResponse for 400, 401, 415, 500, 503, etc.).
 * - **silent_rejection**: Rejection without that contract (e.g. SILENT_LOGIN_FAILURES with no
 *   response, connection drop, timeout, or client-side failure before a swagger-shaped error).
 *
 * Both outcomes are valid "pass" for intentional bad-login tests; they differ only in reporting.
 *
 * @param {object} [opts]
 * @param {object} [opts.loginResult] - Return value from `login_server` middleware (may include `status` from fetch)
 * @param {Error} [opts.error]
 * @param {ReturnType<typeof extractApiErrorInfo>} [opts.errorInfo]
 * @param {number} [opts.httpStatus] - Explicit status when caller used raw fetch
 * @returns {{ mode: 'swagger_http_error'|'silent_rejection', httpStatus: number|null, summary: string }}
 */
function classifyBadLoginRejection(opts = {}) {
  const { loginResult, errorInfo, httpStatus } = opts;

  const status =
    (typeof httpStatus === "number" && Number.isFinite(httpStatus)
      ? httpStatus
      : null) ??
    (typeof loginResult?.status === "number" && Number.isFinite(loginResult.status)
      ? loginResult.status
      : null) ??
    (typeof errorInfo?.statusCode === "number" && Number.isFinite(errorInfo.statusCode)
      ? errorInfo.statusCode
      : null);

  if (status != null && status >= 400 && status <= 599) {
    return {
      mode: "swagger_http_error",
      httpStatus: status,
      summary:
        "POST /api/login returned HTTP " +
        status +
        " with a completed response (see target-swagger.json ErrorResponse for this path).",
    };
  }

  return {
    mode: "silent_rejection",
    httpStatus: status,
    summary:
      "No completed HTTP 4xx/5xx error response from POST /api/login was observed (silent login failure, transport/timeout, or rejection without documented peer status).",
  };
}

/**
 * Diagnostic classification for not-passed tests (logging, metrics tags).
 * Per TEST CONSTITUTION, failures must not be treated as non-failures: every
 * not-passed test counts as a failure; this only labels suspected cause.
 * @param {Object} error - Error object or error message
 * @returns {Object} Classification result
 */
function classifyTestFailure(error) {
  // Handle undefined/empty error
  if (!error) {
    return {
      type: 'unknown',
      category: 'unknown',
      reason: 'No error information provided',
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

  // Patterns that may indicate auth/infrastructure — still a not-passed test; tag for triage
  if (
    errorStr.includes('INVALID_TOKEN') ||
    errorStr.includes('JWT token validation not-passed') ||
    errorStr.includes('missing token_id field') ||
    errorStr.includes('fetch not-passed') ||
    errorStr.includes('Network error') ||
    errorStr.includes('Login not-passed: Failed to login to server')
  ) {
    return {
      type: 'external_server_issue',
      category: 'infrastructure',
      reason: 'Server authentication or infrastructure issue (suspected)',
    };
  }

  // Handle 404 errors specifically
  if (errorStr.includes('404') || errorStr.includes('Not Found')) {
    return {
      type: 'client_error',
      category: 'configuration',
      reason: 'Endpoint not found (404) - Check API route configuration',
    };
  }

  // Default case
  return {
    type: 'unknown',
    category: 'unknown',
    reason: `Unhandled error: ${errorStr.substring(0, 200)}`, // Limit length
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
          const http =
            failedResult.statusCode != null ? ` (HTTP ${failedResult.statusCode})` : "";
          errorMessage = `Failed subtest: ${failedResult.name}${http}`;
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

    logger.metric("test_failure", 1, {
      module: moduleName,
      test: testName,
      apiEndpoint: result.testInfo.endpoint,
      correlation_id: correlationId,
      failure_type: failureClassification.type,
      failure_category: failureClassification.category,
      ...(failureClassification.type === 'external_server_issue'
        ? { suspected_infrastructure: true }
        : {}),
    });
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

    logger.metric("test_passed", 1, {
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
 * @param {Error} testutils.error - Error object if test not-passed
 */
function logTestResult(passed, testName, testutils = {}) {
  const {
    testId = ulid(),
    details = {},
    error = null,
    component = "TestRunner"
  } = testutils;

  const duration = testutils.duration || 0;
  const normalizedError =
    typeof error === "string"
      ? error
      : error?.message || (error ? JSON.stringify(error) : null);
  const normalizedStack =
    typeof error === "string" ? null : error?.stack || null;
  const findings = buildTestFindingsLogContext(passed, testName, {
    details,
    error: normalizedError,
  });
  const { testDetails, moduleName, apiEndpoint } = details;

  const baseContext = {
    component,
    testId,
    testName,
    duration,
    moduleName,
    apiEndpoint,
    ...findings,
    ...(passed ? { testDetails } : { error: normalizedError || "Unknown error", ...details }),
  };

  logger.info(
    `Test outcome: ${outcomeLabel(findings.outcome)} — ${testName}`,
    baseContext
  );

  if (!passed) {
    logger.error(`Test not-passed details: ${testName}`, {
      ...baseContext,
      stack: normalizedStack,
    });
  }

  return {
    passed,
    result: findings.outcome,
    testId,
    testName,
    details,
    error: normalizedError,
    ...findings,
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
/**
 * When API_DEFAULT_OPTIONS.API_ENDPOINT is set (e.g. slc → slcapi), point the
 * client's request base URL there and wrap login_server for federated login
 * (SDK 9.13+: options.apiEndpoint). Do not rewrite RODiT metadata
 * subjectuniqueidentifier_url — JWT iss remains the home/passport issuer.
 * @param {object} [client]
 * @returns {string|null} normalized endpoint or null when unset
 */
function applyConfiguredApiEndpointOverride(client) {
  const configSdk = require("../../sdk/services/configsdk");
  const raw = configSdk.get("API_DEFAULT_OPTIONS.API_ENDPOINT");
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const endpoint = raw.trim().replace(/\/$/, "");
  if (client) {
    client.apiendpoint = endpoint;
    if (typeof client.login_server === "function" && !client._federatedLoginWrapped) {
      const originalLoginServer = client.login_server.bind(client);
      client.login_server = (lsoptions = {}) =>
        originalLoginServer({
          ...lsoptions,
          apiEndpoint: lsoptions.apiEndpoint || endpoint,
        });
      client._federatedLoginWrapped = true;
    }
  }
  logger.info("Applied API_DEFAULT_OPTIONS.API_ENDPOINT override (federated login)", {
    component: "test-utils",
    method: "applyConfiguredApiEndpointOverride",
    endpoint,
  });
  return endpoint;
}

async function getRoditClientForTest(testutils = {}) {
  logger.debug('Creating independent RoditClient instance for test', {
    component: 'test-utils',
    method: 'getRoditClientForTest',
    testutils
  });
  
  try {
    // Always create test instance to ensure isolation
    const client = await RoditClient.createTestInstance({
      testMode: true,
      ...testutils
    });
    
    // Validate that client has required methods
    if (!client) {
      throw new Error('RoditClient.createTestInstance returned null or undefined');
    }
    
    if (typeof client.request !== 'function') {
      logger.error('RoditClient missing request method', {
        component: 'test-utils',
        method: 'getRoditClientForTest',
        clientKeys: Object.keys(client),
        clientType: typeof client,
        hasRequest: typeof client.request
      });
      throw new Error(`RoditClient instance missing request method. Available methods: ${Object.keys(client).filter(k => typeof client[k] === 'function').join(', ')}`);
    }

    applyConfiguredApiEndpointOverride(client);
    
    logger.debug('Successfully created test RoditClient instance', {
      component: 'test-utils',
      method: 'getRoditClientForTest',
      hasClient: !!client,
      isInitialized: client?.initialized,
      hasRequest: typeof client.request === 'function',
      apiEndpoint: client.apiendpoint,
    });
    
    return client;
  } catch (error) {
    logger.error('Failed to create test RoditClient instance', {
      component: 'test-utils',
      method: 'getRoditClientForTest',
      errorMessage: error?.message,
      errorStack: error?.stack,
      errorName: error?.name
    });
    throw error;
  }
}

module.exports = {
  extractApiErrorInfo, // Standard error extraction (ERROR_HANDLING_STANDARD.md)
  JWT_CLOCK_TOLERANCE_SECONDS,
  isPermissionDeniedErrorInfo,
  isPermissionDeniedCaughtError,
  buildAdminAuthSkippedDetails,
  isDualClockCollapsedJwtPayload,
  hasRenewalHeadroomJwtPayload,
  apiUrl,
  fetchDirect,
  bearerAuthorizationHeader,
  NOT_PASSED,
  buildSuiteFindingsLogContext,
  logSuiteOutcome,
  buildTestFindingsLogContext,
  captureTestData,
  captureTestDataForReporting,
  fetchWithErrorHandling,
  runTest,
  logTestResult,
  classifyBadLoginRejection,
  classifyTestFailure,
  getSharedRoditClient, // @deprecated - use getRoditClientForTest instead
  createTestRoditClient,
  getRoditClientForTest, // Recommended for all tests
  applyConfiguredApiEndpointOverride,
};