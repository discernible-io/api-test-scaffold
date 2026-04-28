const crypto = require('crypto');
const nacl = require('tweetnacl');
nacl.util = require('tweetnacl-util');
const { ulid } = require('ulid');
const logger = require('../../sdk/services/logger');

const { extractApiErrorInfo, getRoditClientForTest } = require('./test-utils');

/**
 * Fetch fresh noncets and timestamp from API
 */
async function fetchNoncetsFromApi(apiEndpoint) {
  try {
    const response = await fetch(`${apiEndpoint}/api/holanonce16ts`, {
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
    // Fallback to defaults if API call fails
    return {
      noncets: "4F9A3C7E2D1B9A4C",
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Compute HOLA checksum (single hex character)
 * Algorithm: sum all UTF-8 byte values, take modulo 16, convert to uppercase hex
 */
function computeHolaChecksum(messagePrefix) {
  const bytes = Buffer.from(messagePrefix, 'utf8');
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum += bytes[i];
  }
  return (sum % 16).toString(16).toUpperCase();
}

/**
 * Convert base64 to base64url encoding
 */
function base64ToBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a subagent HOLA message with proper Ed25519 signature
 * 
 * SUBAGENT FORMAT (11 fields):
 * HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<timestamp>:<noncets>:API.IDENTYCLAW.COM:<signature>:<checksum>
 * 
 * The signature is computed over:
 * HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<timestamp>:<noncets>:API.IDENTYCLAW.COM:
 * 
 * @param {string} apiEndpoint - API endpoint for fetching noncets
 * @param {Object} options - Configuration options
 * @param {string} options.recipient - Recipient (defaults to MUNDO)
 * @param {string} options.delegateId - Unique identifier for the subagent
 * @param {string} options.issuerTokenId - Parent agent's token ID (12 lowercase letters)
 * @param {Object} options.subagentKeyPair - Ed25519 keypair for the subagent (from nacl.sign.keyPair())
 * @returns {Promise<string>} Complete subagent HOLA message
 */
async function generateSubagentHola(apiEndpoint, options = {}) {
  const {
    recipient = 'MUNDO',
    delegateId,
    issuerTokenId,
    subagentKeyPair
  } = options;

  if (!delegateId) {
    throw new Error('delegateId is required for subagent HOLA');
  }
  if (!issuerTokenId) {
    throw new Error('issuerTokenId is required for subagent HOLA');
  }
  if (!subagentKeyPair || !subagentKeyPair.publicKey || !subagentKeyPair.secretKey) {
    throw new Error('subagentKeyPair with publicKey and secretKey is required');
  }

  // Get fresh noncets and timestamp from API
  const { noncets, timestamp } = await fetchNoncetsFromApi(apiEndpoint);

  // Encode subagent public key as base64url
  const publicKeyBase64 = nacl.util.encodeBase64(subagentKeyPair.publicKey);
  const publicKeyBase64Url = base64ToBase64Url(publicKeyBase64);

  // Build the message to be signed (everything before the signature field)
  const messageToSign = `HOLA:${recipient}:${delegateId}:${issuerTokenId}:${publicKeyBase64Url}:${timestamp}:${noncets}:API.IDENTYCLAW.COM:`;

  // Sign the message with subagent's private key
  const messageBytes = new TextEncoder().encode(messageToSign);
  const signatureBytes = nacl.sign.detached(messageBytes, subagentKeyPair.secretKey);
  const signatureBase64 = nacl.util.encodeBase64(signatureBytes);
  const signatureBase64Url = base64ToBase64Url(signatureBase64);

  // Build the complete message prefix (with signature, before checksum)
  const messagePrefix = `${messageToSign}${signatureBase64Url}:`;

  // Compute checksum
  const checksum = computeHolaChecksum(messagePrefix);

  // Return complete subagent HOLA message
  return `${messagePrefix}${checksum}`;
}

async function testDelegatedSignerAuthorization(apiEndpoint, logContext) {
  const testData = { apiEndpoint };
  const testId = logContext?.testId || 'unknown';

  try {
    if (!apiEndpoint) {
      logger.error('testDelegatedSignerAuthorization: API endpoint is required', {
        component: 'testDelegatedSignerAuthorization',
        testId,
        error: 'API endpoint missing'
      });
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    logger.debug('testDelegatedSignerAuthorization: Starting delegated signer authorization tests', {
      component: 'testDelegatedSignerAuthorization',
      testId,
      endpoint: '/api/isauthorizedsigner'
    });

    // Get independent RoditClient instance for test isolation
    let client;
    try {
      client = await getRoditClientForTest();
    } catch (clientError) {
      const errorInfo = extractApiErrorInfo(clientError);
      logger.error('testDelegatedSignerAuthorization: Failed to create RoditClient', {
        component: 'testDelegatedSignerAuthorization',
        testId,
        errorMessage: errorInfo.message,
        errorStack: clientError?.stack
      });
      return {
        passed: false,
        error: `Failed to create RoditClient: ${errorInfo.message}`,
        testData,
      };
    }
    const results = [];
    const subagentKeyPair = nacl.sign.keyPair();
    const subagentPublicKeyBase64 = nacl.util.encodeBase64(subagentKeyPair.publicKey);

    const testCases = [
      {
        name: 'Valid delegated signer authorization',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: true,
        expectAuthorized: true,
      },
      {
        name: 'Invalid tokenId format (uppercase)',
        tokenId: 'BJBVCJZQBDSJ',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
      },
      {
        name: 'Invalid tokenId format (too short)',
        tokenId: 'abcdef',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
      },
      {
        name: 'Invalid publicKey format (not base64)',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: 'not-valid-base64!!!',
        expectSuccess: false,
      },
      {
        name: 'Missing delegateId',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: null,
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
      },
      {
        name: 'Non-existent tokenId',
        tokenId: 'zzzzzzzzzzzz',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
      },
    ];

    for (const testCase of testCases) {
      const payload = {
        tokenId: testCase.tokenId,
        base64HashOrDelegateSignerId: testCase.delegateId,
        unixTimestamp: testCase.timestamp,
        publicKey: testCase.publicKey,
        signature: nacl.util.encodeBase64(new Uint8Array(64)),
      };

      Object.keys(payload).forEach(key => payload[key] === null && delete payload[key]);

      logger.debug('testDelegatedSignerAuthorization: Sending request', {
        component: 'testDelegatedSignerAuthorization',
        testId,
        testCaseName: testCase.name,
        endpoint: '/api/isauthorizedsigner',
        payloadKeys: Object.keys(payload)
      });

      try {
        const data = await client.request('POST', '/api/isauthorizedsigner', payload);
        
        logger.debug('testDelegatedSignerAuthorization: Successfully received response', {
          component: 'testDelegatedSignerAuthorization',
          testId,
          testCaseName: testCase.name,
          hasAuthorized: 'authorized' in data
        });

        if (testCase.expectSuccess) {
          const passed = data.authorized === testCase.expectAuthorized;
          results.push({
            name: testCase.name,
            passed,
            statusCode: 200,
          });
        } else {
          results.push({
            name: testCase.name,
            passed: false,
            statusCode: 200,
          });
        }
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        logger.debug('testDelegatedSignerAuthorization: Request failed as expected', {
          component: 'testDelegatedSignerAuthorization',
          testId,
          testCaseName: testCase.name,
          statusCode: errorInfo.statusCode,
          errorCode: errorInfo.code
        });

        if (testCase.expectSuccess) {
          results.push({
            name: testCase.name,
            passed: false,
            statusCode: errorInfo.statusCode,
          });
        } else {
          results.push({
            name: testCase.name,
            passed: errorInfo.statusCode >= 400,
            statusCode: errorInfo.statusCode,
          });
        }
      }
    }

    logger.info('testDelegatedSignerAuthorization: All tests completed', {
      component: 'testDelegatedSignerAuthorization',
      testId,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testDelegatedSignerAuthorization';
    const errorStack = error?.stack || 'no stack trace';
    
    logger.error('testDelegatedSignerAuthorization: Outer catch block - unhandled exception', {
      component: 'testDelegatedSignerAuthorization',
      testId,
      errorMessage,
      errorName: error?.name,
      errorStack,
      errorType: typeof error,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    
    return {
      passed: false,
      error: errorMessage,
      testData,
    };
  }
}

async function testMultipleDelegatedSigners(apiEndpoint, logContext) {
  const testData = { apiEndpoint };
  const testId = logContext?.testId || 'unknown';

  try {
    if (!apiEndpoint) {
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    // Get independent RoditClient instance for test isolation
    let client;
    try {
      client = await getRoditClientForTest();
    } catch (clientError) {
      const errorInfo = extractApiErrorInfo(clientError);
      logger.error('testMultipleDelegatedSigners: Failed to create RoditClient', {
        component: 'testMultipleDelegatedSigners',
        testId,
        errorMessage: errorInfo.message,
        errorStack: clientError?.stack
      });
      return {
        passed: false,
        error: `Failed to create RoditClient: ${errorInfo.message}`,
        testData,
      };
    }

    const results = [];
    const tokenId = 'bjbvcjzqbdsj';
    const subagents = [];

    for (let i = 0; i < 3; i++) {
      const keyPair = nacl.sign.keyPair();
      subagents.push({
        id: `subagent-${i}`,
        publicKey: nacl.util.encodeBase64(keyPair.publicKey),
        keyPair,
      });
    }

    for (const subagent of subagents) {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        tokenId,
        base64HashOrDelegateSignerId: subagent.id,
        unixTimestamp: timestamp,
        publicKey: subagent.publicKey,
        signature: nacl.util.encodeBase64(new Uint8Array(64)),
      };

      const response = await fetch(`${apiEndpoint}/api/isauthorizedsigner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer test-token`,
        },
        body: JSON.stringify(payload),
      });

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        return {
          passed: false,
          error: `Failed to parse JSON response from /api/isauthorizedsigner for ${subagent.id}: ${parseError.message}`,
          testData,
        };
      }
      results.push({
        name: `Authorize ${subagent.id}`,
        passed: response.status === 200 && data.base64HashOrDelegateSignerId === subagent.id,
        statusCode: response.status,
      });
    }

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testMultipleDelegatedSigners';
    return {
      passed: false,
      error: errorMessage,
      testData,
    };
  }
}

/**
 * Test subagent HOLA message verification
 * Tests the 11-field subagent HOLA format with proper Ed25519 signatures
 */
async function testSubagentHolaVerification(apiEndpoint, logContext) {
  const testData = { apiEndpoint };
  const testId = logContext?.testId || 'unknown';

  try {
    if (!apiEndpoint) {
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    // Get independent RoditClient instance for test isolation
    let client;
    try {
      client = await getRoditClientForTest();
    } catch (clientError) {
      const errorInfo = extractApiErrorInfo(clientError);
      logger.error('testSubagentHolaVerification: Failed to create RoditClient', {
        component: 'testSubagentHolaVerification',
        testId,
        errorMessage: errorInfo.message,
        errorStack: clientError?.stack
      });
      return {
        passed: false,
        error: `Failed to create RoditClient: ${errorInfo.message}`,
        testData,
      };
    }

    const results = [];
    const subagentKeyPair = nacl.sign.keyPair();
    const issuerTokenId = 'bjbvcjzqbdsj';
    const delegateId = 'test-subagent-001';

    // Test Case 1: Valid subagent HOLA message
    const validSubagentHola = await generateSubagentHola(apiEndpoint, {
      recipient: 'MUNDO',
      delegateId,
      issuerTokenId,
      subagentKeyPair
    });

    const response1 = await fetch(`${apiEndpoint}/api/identity/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': ulid(),
      },
      body: JSON.stringify({
        hello: validSubagentHola,
        constraints: { maxAgeMs: 300000 }
      }),
    });

    let data1;
    try {
      data1 = await response1.json();
    } catch (parseError) {
      return {
        passed: false,
        error: `Failed to parse JSON response from /api/identity/verify (test case 1): ${parseError.message}`,
        testData,
      };
    }
    results.push({
      name: 'Valid subagent HOLA with proper signature',
      passed: response1.status === 200 && data1.verified === true,
      statusCode: response1.status,
    });

    // Test Case 2: Subagent HOLA with invalid signature
    const invalidKeyPair = nacl.sign.keyPair();
    const invalidSubagentHola = await generateSubagentHola(apiEndpoint, {
      recipient: 'MUNDO',
      delegateId,
      issuerTokenId,
      subagentKeyPair: invalidKeyPair
    });

    const response2 = await fetch(`${apiEndpoint}/api/identity/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': ulid(),
      },
      body: JSON.stringify({
        hello: invalidSubagentHola,
        constraints: { maxAgeMs: 300000 }
      }),
    });

    let data2;
    try {
      data2 = await response2.json();
    } catch (parseError) {
      return {
        passed: false,
        error: `Failed to parse JSON response from /api/identity/verify (test case 2): ${parseError.message}`,
        testData,
      };
    }
    results.push({
      name: 'Subagent HOLA with invalid signature',
      passed: response2.status === 200 && data2.verified === false,
      statusCode: response2.status,
    });

    // Test Case 3: Subagent HOLA with non-existent issuerTokenId
    const nonExistentHola = await generateSubagentHola(apiEndpoint, {
      recipient: 'MUNDO',
      delegateId,
      issuerTokenId: 'zzzzzzzzzzzz',
      subagentKeyPair
    });

    const response3 = await fetch(`${apiEndpoint}/api/identity/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': ulid(),
      },
      body: JSON.stringify({
        hello: nonExistentHola,
        constraints: { maxAgeMs: 300000 }
      }),
    });

    let data3;
    try {
      data3 = await response3.json();
    } catch (parseError) {
      return {
        passed: false,
        error: `Failed to parse JSON response from /api/identity/verify (test case 3): ${parseError.message}`,
        testData,
      };
    }
    results.push({
      name: 'Subagent HOLA with non-existent issuerTokenId',
      passed: response3.status === 200 && data3.verified === false,
      statusCode: response3.status,
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testSubagentHolaVerification';
    return {
      passed: false,
      error: errorMessage,
      testData,
    };
  }
}

module.exports = {
  testDelegatedSignerAuthorization,
  testMultipleDelegatedSigners,
  testSubagentHolaVerification,
  generateSubagentHola, // Export for use in other test modules
};
