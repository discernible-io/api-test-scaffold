const crypto = require('crypto');
const nacl = require('tweetnacl');
nacl.util = require('tweetnacl-util');
const { ulid } = require('ulid');
const fs = require('fs');
const path = require('path');
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
 * Load Ed25519 key pair from NEAR credentials file
 * Converts NEAR Ed25519 key format to tweetnacl format
 * @param {string} credentialsPath - Path to NEAR credentials JSON file
 * @param {string} keyType - Type of key being loaded (for logging)
 * @returns {Object} tweetnacl key pair with publicKey and secretKey
 */
function loadKeyPairFromCredentials(credentialsPath, keyType = 'unknown') {
  try {
    const credentialsJson = fs.readFileSync(credentialsPath, 'utf8');
    const credentials = JSON.parse(credentialsJson);
    
    // NEAR private key format: ed25519:<base64-encoded-key>
    const nearPrivateKey = credentials.private_key;
    const privateKeyBase64 = nearPrivateKey.replace('ed25519:', '');
    
    // Decode base64 to get the 64-byte seed (32 bytes secret + 32 bytes public)
    const seedBytes = nacl.util.decodeBase64(privateKeyBase64);
    
    // Extract the secret key (first 32 bytes)
    const secretKeyBytes = seedBytes.slice(0, 32);
    
    // Generate key pair from secret key
    const keyPair = nacl.sign.keyPair.fromSecretKey(secretKeyBytes);
    
    logger.info(`loadKeyPairFromCredentials: Successfully loaded ${keyType} credentials`, {
      component: 'loadKeyPairFromCredentials',
      keyType,
      accountId: credentials.implicit_account_id,
      publicKeyLength: keyPair.publicKey.length,
      secretKeyLength: keyPair.secretKey.length
    });
    
    return keyPair;
  } catch (error) {
    logger.error(`loadKeyPairFromCredentials: Failed to load ${keyType} credentials`, {
      component: 'loadKeyPairFromCredentials',
      keyType,
      error: error.message,
      credentialsPath
    });
    throw new Error(`Failed to load ${keyType} credentials: ${error.message}`);
  }
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
  // Format: HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<timestamp>:<noncets>:API.IDENTYCLAW.COM:
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

  logger.info('testDelegatedSignerAuthorization: START', {
    component: 'testDelegatedSignerAuthorization',
    testId,
    apiEndpoint
  });

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
    
    // Load agent credentials for signing delegated signer authorizations
    const agentCredentialsPath = path.join(__dirname, '../../.near-credentials/mainnet/0192a65a46f1e34b8ff430b419f6f8bbe4544a573e1b28e6fe9ae8b065406287.json');
    const agentKeyPair = loadKeyPairFromCredentials(agentCredentialsPath, 'agent');
    
    // Load subagent credentials for the subagent public key
    const subagentCredentialsPath = path.join(__dirname, '../../.near-credentials/mainnet/4cf2c723baf45999af4ff573f0ab063937c934eb992241757e973f26eba1113c.json');
    const subagentKeyPair = loadKeyPairFromCredentials(subagentCredentialsPath, 'subagent');
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
      // Generate real signature using agent private key
      let signature;
      if (testCase.expectSuccess && testCase.expectAuthorized) {
        // For valid authorization test, use real signature from agent credentials
        try {
          const messageToSign = `${testCase.tokenId}:${testCase.delegateId}:${testCase.timestamp}:${testCase.publicKey}`;
          const messageBytes = new TextEncoder().encode(messageToSign);
          const signatureBytes = nacl.sign.detached(messageBytes, agentKeyPair.secretKey);
          signature = nacl.util.encodeBase64(signatureBytes);

          logger.debug('testDelegatedSignerAuthorization: Generated real signature with agent credentials', {
            component: 'testDelegatedSignerAuthorization',
            testId,
            testCaseName: testCase.name,
            messageToSign,
            signatureLength: signature.length
          });
        } catch (signError) {
          logger.error('testDelegatedSignerAuthorization: Failed to generate signature', {
            component: 'testDelegatedSignerAuthorization',
            testId,
            testCaseName: testCase.name,
            error: signError.message
          });
          results.push({
            name: testCase.name,
            passed: false,
            statusCode: 0,
          });
          continue;
        }
      } else {
        // For negative tests, use fake signature
        signature = nacl.util.encodeBase64(new Uint8Array(64));
      }

      const payload = {
        tokenId: testCase.tokenId,
        base64HashOrDelegateSignerId: testCase.delegateId,
        unixTimestamp: testCase.timestamp,
        publicKey: testCase.publicKey,
        signature,
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

    const allPassed = results.every(r => r.passed);
    return {
      passed: allPassed,
      error: allPassed ? undefined : `${results.filter(r => !r.passed).length} test(s) failed: ${results.filter(r => !r.passed).map(r => r.name).join(', ')}`,
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

  logger.info('testMultipleDelegatedSigners: START', {
    component: 'testMultipleDelegatedSigners',
    testId,
    apiEndpoint
  });

  try {
    if (!apiEndpoint) {
      logger.error('testMultipleDelegatedSigners: API endpoint is required', {
        component: 'testMultipleDelegatedSigners',
        testId,
        error: 'API endpoint missing'
      });
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    logger.debug('testMultipleDelegatedSigners: Starting multiple delegated signers test', {
      component: 'testMultipleDelegatedSigners',
      testId,
      endpoint: '/api/isauthorizedsigner'
    });

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
    
    // Load agent credentials for signing delegated signer authorizations
    const agentCredentialsPath = path.join(__dirname, '../../.near-credentials/mainnet/0192a65a46f1e34b8ff430b419f6f8bbe4544a573e1b28e6fe9ae8b065406287.json');
    const agentKeyPair = loadKeyPairFromCredentials(agentCredentialsPath, 'agent');
    
    const subagents = [];

    logger.debug('testMultipleDelegatedSigners: Generating subagent keypairs', {
      component: 'testMultipleDelegatedSigners',
      testId,
      numSubagents: 3
    });

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
      
      // Generate real signature using agent private key
      let signature;
      try {
        const messageToSign = `${tokenId}:${subagent.id}:${timestamp}:${subagent.publicKey}`;
        const messageBytes = new TextEncoder().encode(messageToSign);
        const signatureBytes = nacl.sign.detached(messageBytes, agentKeyPair.secretKey);
        signature = nacl.util.encodeBase64(signatureBytes);

        logger.debug('testMultipleDelegatedSigners: Generated real signature with agent credentials', {
          component: 'testMultipleDelegatedSigners',
          testId,
          subagentId: subagent.id,
          messageToSign,
          signatureLength: signature.length
        });
      } catch (signError) {
        logger.error('testMultipleDelegatedSigners: Failed to generate signature', {
          component: 'testMultipleDelegatedSigners',
          testId,
          subagentId: subagent.id,
          error: signError.message
        });
        results.push({
          name: `Authorize ${subagent.id}`,
          passed: false,
          statusCode: 0,
        });
        continue;
      }

      const payload = {
        tokenId,
        base64HashOrDelegateSignerId: subagent.id,
        unixTimestamp: timestamp,
        publicKey: subagent.publicKey,
        signature,
      };

      logger.debug('testMultipleDelegatedSigners: Sending authorization request', {
        component: 'testMultipleDelegatedSigners',
        testId,
        subagentId: subagent.id,
        endpoint: '/api/isauthorizedsigner',
        payloadKeys: Object.keys(payload)
      });

      let data;
      try {
        data = await client.request('POST', '/api/isauthorizedsigner', payload);
        logger.debug('testMultipleDelegatedSigners: Successfully received response', {
          component: 'testMultipleDelegatedSigners',
          testId,
          subagentId: subagent.id,
          hasDelegateId: 'base64HashOrDelegateSignerId' in data,
          delegateIdMatch: data.base64HashOrDelegateSignerId === subagent.id
        });
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        logger.error('testMultipleDelegatedSigners: Request failed', {
          component: 'testMultipleDelegatedSigners',
          testId,
          subagentId: subagent.id,
          statusCode: errorInfo.statusCode,
          errorCode: errorInfo.code
        });
        results.push({
          name: `Authorize ${subagent.id}`,
          passed: false,
          statusCode: errorInfo.statusCode,
        });
        continue;
      }

      results.push({
        name: `Authorize ${subagent.id}`,
        passed: data.base64HashOrDelegateSignerId === subagent.id,
        statusCode: 200,
      });
    }

    logger.info('testMultipleDelegatedSigners: All tests completed', {
      component: 'testMultipleDelegatedSigners',
      testId,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    });

    const allPassed = results.every(r => r.passed);
    return {
      passed: allPassed,
      error: allPassed ? undefined : `${results.filter(r => !r.passed).length} test(s) failed: ${results.filter(r => !r.passed).map(r => r.name).join(', ')}`,
      testData,
      results,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testMultipleDelegatedSigners';
    const errorStack = error?.stack || 'no stack trace';
    
    logger.error('testMultipleDelegatedSigners: Outer catch block - unhandled exception', {
      component: 'testMultipleDelegatedSigners',
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

/**
 * Test subagent HOLA message verification
 * Tests the 11-field subagent HOLA format with proper Ed25519 signatures
 */
async function testSubagentHolaVerification(apiEndpoint, logContext) {
  const testData = { apiEndpoint };
  const testId = logContext?.testId || 'unknown';

  logger.info('testSubagentHolaVerification: START', {
    component: 'testSubagentHolaVerification',
    testId,
    apiEndpoint
  });

  try {
    if (!apiEndpoint) {
      logger.error('testSubagentHolaVerification: API endpoint is required', {
        component: 'testSubagentHolaVerification',
        testId,
        error: 'API endpoint missing'
      });
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    logger.debug('testSubagentHolaVerification: Starting subagent HOLA verification test', {
      component: 'testSubagentHolaVerification',
      testId,
      endpoint: '/api/identity/verify'
    });

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
    
    // Load real subagent credentials from credentials file as per TEST CONSTITUTION
    const credentialsPath = path.join(__dirname, '../../.near-credentials/mainnet/4cf2c723baf45999af4ff573f0ab063937c934eb992241757e973f26eba1113c.json');
    const subagentKeyPair = loadSubagentKeyPair(credentialsPath);
    
    const issuerTokenId = 'bjbvcjzqbdsj';
    const delegateId = 'test-subagent-001';

    // Test Case 1: Valid subagent HOLA message
    logger.debug('testSubagentHolaVerification: Generating valid subagent HOLA', {
      component: 'testSubagentHolaVerification',
      testId,
      testCase: 1,
      issuerTokenId,
      delegateId
    });

    const validSubagentHola = await generateSubagentHola(apiEndpoint, {
      recipient: 'MUNDO',
      delegateId,
      issuerTokenId,
      subagentKeyPair
    });

    logger.debug('testSubagentHolaVerification: Sending valid HOLA to API', {
      component: 'testSubagentHolaVerification',
      testId,
      testCase: 1,
      helloLength: validSubagentHola.length,
      endpoint: '/api/identity/verify'
    });

    let data1;
    try {
      data1 = await client.request('POST', '/api/identity/verify', {
        hello: validSubagentHola,
        constraints: { maxAgeMs: 300000 }
      });
      logger.debug('testSubagentHolaVerification: Successfully received response for valid HOLA', {
        component: 'testSubagentHolaVerification',
        testId,
        testCase: 1,
        hasVerified: 'verified' in data1,
        verified: data1.verified,
        fullResponse: JSON.stringify(data1)
      });
      results.push({
        name: 'Valid subagent HOLA with proper signature',
        passed: data1.verified === true,
        statusCode: 200,
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error('testSubagentHolaVerification: Request failed', {
        component: 'testSubagentHolaVerification',
        testId,
        testCase: 1,
        statusCode: errorInfo.statusCode,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message,
        errorDetails: errorInfo.details,
        fullErrorResponse: JSON.stringify(errorInfo)
      });
      results.push({
        name: 'Valid subagent HOLA with proper signature',
        passed: false,
        statusCode: errorInfo.statusCode,
        error: errorInfo.message,
      });
    }

    // Test Case 2: Subagent HOLA with invalid signature
    logger.debug('testSubagentHolaVerification: Generating invalid signature HOLA', {
      component: 'testSubagentHolaVerification',
      testId,
      testCase: 2
    });

    const invalidKeyPair = nacl.sign.keyPair();
    const invalidSubagentHola = await generateSubagentHola(apiEndpoint, {
      recipient: 'MUNDO',
      delegateId,
      issuerTokenId,
      subagentKeyPair: invalidKeyPair
    });

    logger.debug('testSubagentHolaVerification: Sending invalid signature HOLA to API', {
      component: 'testSubagentHolaVerification',
      testId,
      testCase: 2,
      helloLength: invalidSubagentHola.length,
      endpoint: '/api/identity/verify'
    });

    let data2;
    try {
      data2 = await client.request('POST', '/api/identity/verify', {
        hello: invalidSubagentHola,
        constraints: { maxAgeMs: 300000 }
      });
      logger.debug('testSubagentHolaVerification: Successfully received response for invalid signature HOLA', {
        component: 'testSubagentHolaVerification',
        testId,
        testCase: 2,
        hasVerified: 'verified' in data2,
        verified: data2.verified
      });
      results.push({
        name: 'Subagent HOLA with invalid signature',
        passed: data2.verified === false,
        statusCode: 200,
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error('testSubagentHolaVerification: Request failed', {
        component: 'testSubagentHolaVerification',
        testId,
        testCase: 2,
        statusCode: errorInfo.statusCode,
        errorCode: errorInfo.code
      });
      results.push({
        name: 'Subagent HOLA with invalid signature',
        passed: errorInfo.statusCode >= 400,
        statusCode: errorInfo.statusCode,
      });
    }

    // Test Case 3: Subagent HOLA with non-existent issuerTokenId
    logger.debug('testSubagentHolaVerification: Generating HOLA with non-existent tokenId', {
      component: 'testSubagentHolaVerification',
      testId,
      testCase: 3,
      issuerTokenId: 'zzzzzzzzzzzz'
    });

    const nonExistentHola = await generateSubagentHola(apiEndpoint, {
      recipient: 'MUNDO',
      delegateId,
      issuerTokenId: 'zzzzzzzzzzzz',
      subagentKeyPair
    });

    logger.debug('testSubagentHolaVerification: Sending non-existent tokenId HOLA to API', {
      component: 'testSubagentHolaVerification',
      testId,
      testCase: 3,
      helloLength: nonExistentHola.length,
      endpoint: '/api/identity/verify'
    });

    let data3;
    try {
      data3 = await client.request('POST', '/api/identity/verify', {
        hello: nonExistentHola,
        constraints: { maxAgeMs: 300000 }
      });
      logger.debug('testSubagentHolaVerification: Successfully received response for non-existent tokenId HOLA', {
        component: 'testSubagentHolaVerification',
        testId,
        testCase: 3,
        hasVerified: 'verified' in data3,
        verified: data3.verified
      });
      results.push({
        name: 'Subagent HOLA with non-existent issuerTokenId',
        passed: data3.verified === false,
        statusCode: 200,
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error('testSubagentHolaVerification: Request failed', {
        component: 'testSubagentHolaVerification',
        testId,
        testCase: 3,
        statusCode: errorInfo.statusCode,
        errorCode: errorInfo.code
      });
      results.push({
        name: 'Subagent HOLA with non-existent issuerTokenId',
        passed: errorInfo.statusCode >= 400,
        statusCode: errorInfo.statusCode,
      });
    }

    logger.info('testSubagentHolaVerification: All tests completed', {
      component: 'testSubagentHolaVerification',
      testId,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    });

    const allPassed = results.every(r => r.passed);
    return {
      passed: allPassed,
      error: allPassed ? undefined : `${results.filter(r => !r.passed).length} test(s) failed: ${results.filter(r => !r.passed).map(r => r.name).join(', ')}`,
      testData,
      results,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testSubagentHolaVerification';
    const errorStack = error?.stack || 'no stack trace';
    
    logger.error('testSubagentHolaVerification: Outer catch block - unhandled exception', {
      component: 'testSubagentHolaVerification',
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

module.exports = {
  testDelegatedSignerAuthorization,
  testMultipleDelegatedSigners,
  testSubagentHolaVerification,
  generateSubagentHola, // Export for use in other test modules
};
