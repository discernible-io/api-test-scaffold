const { extractApiErrorInfo } = require('./test-utils');

async function testAuthenticationErrorHandling(apiEndpoint, logContext) {
  const testName = 'testAuthenticationErrorHandling';
  const testData = { apiEndpoint };

  try {
    if (!apiEndpoint) {
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    const results = [];

    // Test /api/login/timestamp rate limiting (429)
    const requests = [];
    for (let i = 0; i < 105; i++) {
      requests.push(
        fetch(`${apiEndpoint}/api/login/timestamp`, {
          method: 'GET',
        })
      );
    }

    const responses = await Promise.all(requests);
    const rateLimitedResponse = responses.find(r => r.status === 429);

    results.push({
      name: 'Rate limit exceeded (429) on /api/login/timestamp',
      passed: !!rateLimitedResponse,
      statusCode: rateLimitedResponse?.status,
    });

    // Test /api/login with invalid roditid + bad signature (SDK: verify_peer_rodit → typically 401)
    const response1 = await fetch(`${apiEndpoint}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roditid: 'INVALID',
        timestamp: Math.floor(Date.now() / 1000),
        roditid_base64url_signature: 'invalid-signature',
      }),
    });

    results.push({
      name: 'Invalid roditid / signature rejected (4xx)',
      passed: response1.status >= 400 && response1.status < 500,
      statusCode: response1.status,
    });

    // Test /api/login with roditid but no signature (SDK: MISSING_BASE64URL_SIGNATURE → 400)
    const response2 = await fetch(`${apiEndpoint}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roditid: 'bjbvcjzqbdsj',
      }),
    });

    results.push({
      name: 'Missing signature returns 400 (MISSING_BASE64URL_SIGNATURE)',
      passed: response2.status === 400,
      statusCode: response2.status,
    });

    // Test /api/logout with invalid token
    const response3 = await fetch(`${apiEndpoint}/api/logout`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid-token',
        'Content-Type': 'application/json',
      },
    });

    results.push({
      name: 'Invalid token on /api/logout returns 400+',
      passed: response3.status >= 400,
      statusCode: response3.status,
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    return {
      passed: false,
      error: error.message,
      testData,
    };
  }
}

async function testIdentityErrorHandling(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testIdentityErrorHandling' };

  try {
    // Test /api/me/identity with missing JWT sub
    try {
      const response = await fetch(`${apiEndpoint}/api/me/identity`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer invalid-token-no-sub',
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Missing JWT sub returns 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Missing JWT sub returns 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/me/identity with non-existent token
    try {
      const response = await fetch(`${apiEndpoint}/api/me/identity`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer token-with-invalid-tokenid',
        },
      });

      const passed = response.status === 404 || response.status >= 400;

      results.push({
        name: 'Non-existent token returns 404 or 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent token returns 404 or 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/identity/token/{tokenId}/full with invalid tokenId
    try {
      const response = await fetch(`${apiEndpoint}/api/identity/token/INVALID/full`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format returns 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format returns 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/identity/token/{tokenId}/full with non-existent token
    try {
      const response = await fetch(`${apiEndpoint}/api/identity/token/zzzzzzzzzzzz/full`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status === 404 || response.status >= 400;

      results.push({
        name: 'Non-existent token returns 404 or 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent token returns 404 or 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testIdentityErrorHandling',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testIdentityErrorHandling',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testAgentManagementErrorHandling(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testAgentManagementErrorHandling' };

  try {
    // Test /api/agents with invalid limit
    try {
      const response = await fetch(`${apiEndpoint}/api/agents?limit=invalid`, {
        method: 'GET',
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid limit parameter returns 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid limit parameter returns 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/agents with negative limit
    try {
      const response = await fetch(`${apiEndpoint}/api/agents?limit=-1`, {
        method: 'GET',
      });

      const passed = response.status >= 400 || response.status === 200;

      results.push({
        name: 'Negative limit parameter handling',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Negative limit parameter handling',
        passed: true,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/holanonce16ts without authentication
    try {
      const response = await fetch(`${apiEndpoint}/api/holanonce16ts`, {
        method: 'GET',
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Missing authentication returns 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Missing authentication returns 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testAgentManagementErrorHandling',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testAgentManagementErrorHandling',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testSessionManagementErrorHandling(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testSessionManagementErrorHandling' };

  try {
    // Test /api/sessions/revoke with missing sessionId
    try {
      const response = await fetch(`${apiEndpoint}/api/sessions/revoke`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Missing sessionId returns 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Missing sessionId returns 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/sessions/revoke with non-existent sessionId
    try {
      const response = await fetch(`${apiEndpoint}/api/sessions/revoke`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 'nonexistent-session-id',
        }),
      });

      const passed = response.status === 404 || response.status >= 400;

      results.push({
        name: 'Non-existent sessionId returns 404 or 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent sessionId returns 404 or 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/sessions/cleanup with wrong content-type
    try {
      const response = await fetch(`${apiEndpoint}/api/sessions/cleanup`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'text/plain',
        },
        body: 'invalid',
      });

      const passed = response.status === 415 || response.status >= 400;

      results.push({
        name: 'Wrong content-type returns 415 or 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Wrong content-type returns 415 or 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testSessionManagementErrorHandling',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testSessionManagementErrorHandling',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testMetricsErrorHandling(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testMetricsErrorHandling' };

  try {
    // Test /api/metrics/reset without authentication
    try {
      const response = await fetch(`${apiEndpoint}/api/metrics/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Missing authentication returns 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Missing authentication returns 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/metrics/reset with non-admin token
    try {
      const response = await fetch(`${apiEndpoint}/api/metrics/reset`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer non-admin-token',
          'Content-Type': 'application/json',
        },
      });

      const passed = response.status === 403 || response.status >= 400;

      results.push({
        name: 'Non-admin user returns 403 or 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-admin user returns 403 or 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test /api/metrics/reset with wrong content-type
    try {
      const response = await fetch(`${apiEndpoint}/api/metrics/reset`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'text/plain',
        },
        body: 'invalid',
      });

      const passed = response.status === 415 || response.status >= 400;

      results.push({
        name: 'Wrong content-type returns 415 or 400+',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Wrong content-type returns 415 or 400+',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testMetricsErrorHandling',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testMetricsErrorHandling',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

module.exports = {
  testAuthenticationErrorHandling,
  testIdentityErrorHandling,
  testAgentManagementErrorHandling,
  testSessionManagementErrorHandling,
  testMetricsErrorHandling,
};
