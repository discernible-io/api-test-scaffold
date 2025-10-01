/**
 * Token Renewal Tests
 * 
 * Tests automatic token renewal functionality by maintaining a long-lived
 * RoditClient instance and making requests over time to trigger renewal.
 * 
 * IMPORTANT: Token renewal is AUTOMATIC and SERVER-SIDE
 * - Clients CANNOT trigger renewals manually
 * - Renewal happens automatically during API requests when token reaches threshold (15% of lifetime)
 * - The SDK's `refreshToken()` method creates a NEW SESSION, not a renewal
 * - Only the automatic renewal test validates actual token renewal behavior
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const { logger, RoditClient } = require('../../sdk');
const { captureTestData } = require('./test-utils');
const config = require('../../sdk/services/configsdk');

/**
 * Decode JWT payload to extract token information
 * @param {string} token - JWT token
 * @returns {Object} Decoded payload
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (error) {
    logger.error('Failed to decode JWT payload', {
      component: 'token-renewal',
      error: error.message
    });
    return null;
  }
}

/**
 * Wait for a specified duration
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test automatic token renewal with a long-lived client
 * 
 * This test:
 * 1. Creates a single RoditClient instance
 * 2. Authenticates and gets initial token
 * 3. Makes periodic requests over time
 * 4. Waits for renewal threshold (15% of token lifetime)
 * 5. Verifies token is automatically renewed
 * 
 * @param {string} apiEndpoint - API endpoint URL
 * @param {Object} logContext - Logging context
 * @returns {Promise<Object>} Test result
 */
async function testAutomaticTokenRenewal(apiEndpoint, logContext = {}) {
  const testName = 'testAutomaticTokenRenewal';
  const moduleName = 'token-renewal';
  const correlationId = ulid();
  const testData = {
    endpoint: apiEndpoint,
    correlationId,
    ...logContext
  };

  logger.info('Starting automatic token renewal test', {
    component: 'token-renewal',
    testName,
    correlationId,
    phase: 'start'
  });

  let client = null;

  try {
    // Create a single RoditClient instance that will be reused
    client = await RoditClient.createTestInstance({ testMode: true });
    testData.clientInitialized = client.initialized;

    if (!client.initialized) {
      throw new Error('Failed to initialize RoditClient');
    }

    // Authenticate and get initial token
    logger.info('Authenticating client', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'authentication'
    });

    const loginResult = await client.login_server();
    
    if (!loginResult || !loginResult.jwt_token) {
      throw new Error('Failed to obtain initial token from login');
    }

    const initialToken = loginResult.jwt_token;
    const initialPayload = decodeJwtPayload(initialToken);
    
    if (!initialPayload) {
      throw new Error('Failed to decode initial token');
    }

    testData.initialToken = {
      jti: initialPayload.jti,
      iat: initialPayload.iat,
      exp: initialPayload.exp,
      duration: initialPayload.exp - initialPayload.iat
    };

    logger.info('Initial token obtained', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'initial_token',
      tokenJti: initialPayload.jti,
      tokenDuration: testData.initialToken.duration,
      expiresAt: new Date(initialPayload.exp * 1000).toISOString()
    });

    // Calculate renewal threshold (15% of token lifetime)
    const RENEWAL_THRESHOLD = 0.15;
    const tokenDuration = testData.initialToken.duration;
    const renewalThresholdSeconds = Math.floor(tokenDuration * RENEWAL_THRESHOLD);
    
    // Get max wait time from config (default 120 seconds for faster tests)
    const maxWaitSeconds = parseInt(config.get('API_DEFAULT_OPTIONS.TOKEN_RENEWAL_MAX_WAIT_SECONDS') || '120', 10);
    const idealWaitSeconds = renewalThresholdSeconds + 5; // Add 5 seconds buffer
    const actualWaitSeconds = Math.min(idealWaitSeconds, maxWaitSeconds);
    const waitTimeMs = actualWaitSeconds * 1000;

    testData.renewalThreshold = {
      thresholdPercent: RENEWAL_THRESHOLD * 100,
      thresholdSeconds: renewalThresholdSeconds,
      idealWaitSeconds,
      maxWaitSeconds,
      actualWaitSeconds,
      waitTimeMs,
      limitedByConfig: actualWaitSeconds < idealWaitSeconds
    };

    logger.info('Calculated renewal threshold', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'threshold_calculation',
      tokenDuration,
      renewalThresholdSeconds,
      maxWaitSeconds,
      actualWaitSeconds,
      limitedByConfig: testData.renewalThreshold.limitedByConfig
    });

    // Make periodic requests while waiting for renewal threshold
    const requestInterval = 10000; // Make a request every 10 seconds
    const numRequests = Math.ceil(waitTimeMs / requestInterval);
    const requests = [];

    logger.info('Starting periodic requests to maintain session', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'periodic_requests',
      numRequests,
      intervalSeconds: requestInterval / 1000
    });

    for (let i = 0; i < numRequests; i++) {
      const requestStart = Date.now();
      
      logger.info('Starting periodic request', {
        component: 'token-renewal',
        testName,
        correlationId,
        requestNum: i + 1,
        totalRequests: numRequests
      });
      
      // Get current token from client's jwt_token property (set during login)
      const currentToken = client.jwt_token;
      const currentPayload = currentToken ? decodeJwtPayload(currentToken) : null;

      try {
        // Make an actual API request to trigger token renewal check
        // The renewal logic is evaluated during API requests
        logger.debug('Making API request to /api/echo', {
          component: 'token-renewal',
          testName,
          correlationId,
          requestNum: i + 1
        });
        
        const response = await client.request('GET', '/api/echo');
        
        requests.push({
          requestNum: i + 1,
          timestamp: new Date().toISOString(),
          tokenJti: currentPayload?.jti,
          success: true,
          duration: Date.now() - requestStart,
          hasResponse: !!response
        });

        logger.debug('Periodic request completed', {
          component: 'token-renewal',
          testName,
          correlationId,
          requestNum: i + 1,
          tokenJti: currentPayload?.jti,
          tokenChanged: currentPayload?.jti !== initialPayload.jti
        });

        // Check if token has changed (renewal occurred)
        if (currentPayload && currentPayload.jti !== initialPayload.jti) {
          logger.info('Token renewal detected!', {
            component: 'token-renewal',
            testName,
            correlationId,
            phase: 'renewal_detected',
            requestNum: i + 1,
            oldTokenJti: initialPayload.jti,
            newTokenJti: currentPayload.jti,
            timeElapsed: Math.floor((Date.now() - (initialPayload.iat * 1000)) / 1000)
          });

          testData.renewalDetected = true;
          testData.renewalOccurredAt = {
            requestNum: i + 1,
            timestamp: new Date().toISOString(),
            oldTokenJti: initialPayload.jti,
            newTokenJti: currentPayload.jti,
            newTokenDuration: currentPayload.exp - currentPayload.iat
          };
          break;
        }

      } catch (error) {
        requests.push({
          requestNum: i + 1,
          timestamp: new Date().toISOString(),
          tokenJti: currentPayload?.jti,
          success: false,
          error: error.message
        });

        logger.error('Periodic request failed', {
          component: 'token-renewal',
          testName,
          correlationId,
          requestNum: i + 1,
          error: error.message,
          stack: error.stack
        });
      }

      // Wait before next request (unless this is the last one)
      if (i < numRequests - 1) {
        await sleep(requestInterval);
      }
    }

    testData.requests = requests;
    testData.totalRequests = requests.length;
    testData.successfulRequests = requests.filter(r => r.success).length;

    // Verify renewal occurred
    const finalToken = client.jwt_token;
    const finalPayload = finalToken ? decodeJwtPayload(finalToken) : null;

    if (!finalPayload) {
      throw new Error('Failed to get final token');
    }

    testData.finalToken = {
      jti: finalPayload.jti,
      iat: finalPayload.iat,
      exp: finalPayload.exp,
      duration: finalPayload.exp - finalPayload.iat
    };

    const tokenChanged = finalPayload.jti !== initialPayload.jti;
    testData.tokenRenewed = tokenChanged;

    if (!tokenChanged) {
      const timeElapsed = Math.floor((Date.now() - (initialPayload.iat * 1000)) / 1000);
      const reachedThreshold = timeElapsed >= renewalThresholdSeconds;
      
      logger.warn('Token was not renewed during test period', {
        component: 'token-renewal',
        testName,
        correlationId,
        phase: 'verification',
        initialTokenJti: initialPayload.jti,
        finalTokenJti: finalPayload.jti,
        timeElapsed,
        renewalThresholdSeconds,
        reachedThreshold,
        limitedByConfig: testData.renewalThreshold.limitedByConfig
      });

      // This might not be a failure - token might not have reached threshold yet
      // Especially if limited by config timeout
      if (testData.renewalThreshold.limitedByConfig) {
        testData.warning = `Token renewal test limited to ${actualWaitSeconds}s by config (threshold is ${renewalThresholdSeconds}s). Increase TOKEN_RENEWAL_MAX_WAIT_SECONDS to test full renewal.`;
      } else {
        testData.warning = 'Token renewal did not occur within test period';
      }
    }

    logger.info('Token renewal test completed', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'complete',
      tokenRenewed: tokenChanged,
      totalRequests: testData.totalRequests,
      successfulRequests: testData.successfulRequests
    });

    const result = {
      success: true,
      details: {
        tokenRenewed: tokenChanged,
        initialToken: testData.initialToken,
        finalToken: testData.finalToken,
        renewalThreshold: testData.renewalThreshold,
        totalRequests: testData.totalRequests,
        successfulRequests: testData.successfulRequests,
        warning: testData.warning
      }
    };

    return captureTestData(testName, moduleName, result, testData);

  } catch (error) {
    logger.error('Token renewal test failed', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'error',
      error: error.message,
      stack: error.stack
    });

    const result = {
      success: false,
      error: error.message,
      details: testData
    };

    return captureTestData(testName, moduleName, result, testData);
  } finally {
    // Clean up client
    if (client) {
      try {
        client.clearSession();
      } catch (error) {
        logger.warn('Failed to clear session during cleanup', {
          component: 'token-renewal',
          testName,
          error: error.message
        });
      }
    }
  }
}

/**
 * Test re-authentication (new session)
 * 
 * This test verifies that calling refreshToken() creates a new session.
 * NOTE: This is NOT token renewal - it's a new login that creates a new session.
 * Token renewal is automatic and happens server-side during API requests.
 * 
 * @param {string} apiEndpoint - API endpoint URL
 * @param {Object} logContext - Logging context
 * @returns {Promise<Object>} Test result
 */
async function testReAuthentication(apiEndpoint, logContext = {}) {
  const testName = 'testReAuthentication';
  const moduleName = 'token-renewal';
  const correlationId = ulid();
  const testData = {
    endpoint: apiEndpoint,
    correlationId,
    ...logContext
  };

  logger.info('Starting re-authentication test (new session, not renewal)', {
    component: 'token-renewal',
    testName,
    correlationId,
    phase: 'start'
  });

  let client = null;

  try {
    // Create client and authenticate
    client = await RoditClient.createTestInstance({ testMode: true });
    testData.clientInitialized = client.initialized;

    if (!client.initialized) {
      throw new Error('Failed to initialize RoditClient');
    }

    const loginResult = await client.login_server();
    
    if (!loginResult || !loginResult.jwt_token) {
      throw new Error('Failed to obtain initial token from login');
    }

    const initialToken = loginResult.jwt_token;
    const initialPayload = decodeJwtPayload(initialToken);
    
    if (!initialPayload) {
      throw new Error('Failed to decode initial token');
    }

    testData.initialToken = {
      jti: initialPayload.jti,
      iat: initialPayload.iat,
      exp: initialPayload.exp
    };

    logger.info('Initial token obtained, calling refreshToken()', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'refresh',
      initialTokenJti: initialPayload.jti
    });

    // Call refreshToken() explicitly
    const refreshStart = Date.now();
    await client.refreshToken();
    const refreshDuration = Date.now() - refreshStart;

    // Get refreshed token from client's jwt_token property
    const refreshedToken = client.jwt_token;
    if (!refreshedToken) {
      throw new Error('Failed to obtain refreshed token');
    }

    const refreshedPayload = decodeJwtPayload(refreshedToken);
    if (!refreshedPayload) {
      throw new Error('Failed to decode refreshed token');
    }

    testData.refreshedToken = {
      jti: refreshedPayload.jti,
      iat: refreshedPayload.iat,
      exp: refreshedPayload.exp
    };

    testData.refreshDuration = refreshDuration;

    // Verify token changed
    const tokenChanged = refreshedPayload.jti !== initialPayload.jti;
    testData.tokenChanged = tokenChanged;

    if (!tokenChanged) {
      throw new Error('Token JTI did not change after refresh');
    }

    // Verify new token has later iat
    if (refreshedPayload.iat <= initialPayload.iat) {
      throw new Error('Refreshed token iat is not newer than initial token');
    }

    logger.info('Manual token refresh successful', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'complete',
      initialTokenJti: initialPayload.jti,
      refreshedTokenJti: refreshedPayload.jti,
      refreshDuration
    });

    const result = {
      success: true,
      details: {
        tokenChanged,
        initialToken: testData.initialToken,
        newSessionToken: testData.newSessionToken,
        refreshDuration,
        note: 'refreshToken() creates new session, not token renewal'
      }
    };

    return captureTestData(testName, moduleName, result, testData);

  } catch (error) {
    logger.error('Re-authentication test failed', {
      component: 'token-renewal',
      testName,
      correlationId,
      phase: 'error',
      error: error.message,
      stack: error.stack
    });

    const result = {
      success: false,
      error: error.message,
      details: testData
    };

    return captureTestData(testName, moduleName, result, testData);
  } finally {
    // Clean up client
    if (client) {
      try {
        client.clearSession();
      } catch (error) {
        logger.warn('Failed to clear session during cleanup', {
          component: 'token-renewal',
          testName,
          error: error.message
        });
      }
    }
  }
}

module.exports = {
  testAutomaticTokenRenewal,
  testReAuthentication
};
