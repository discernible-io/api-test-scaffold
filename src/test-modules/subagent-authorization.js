const crypto = require('crypto');
const nacl = require('tweetnacl');
nacl.util = require('tweetnacl-util');
const { ulid } = require('ulid');

const { extractApiErrorInfo } = require('./test-utils');

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
  const results = [];
  const context = { ...logContext, testName: 'testDelegatedSignerAuthorization' };

  try {
    // Generate test keypair for subagent
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
        expectStatusCode: 400,
      },
      {
        name: 'Invalid tokenId format (too short)',
        tokenId: 'abcdef',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Invalid tokenId format (too long)',
        tokenId: 'abcdefghijklmno',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Invalid publicKey format (not base64)',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: 'not-valid-base64!!!',
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Invalid publicKey length (too short)',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: nacl.util.encodeBase64(new Uint8Array(16)), // 16 bytes instead of 32
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Missing delegateId',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: null,
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Missing timestamp',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: null,
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Missing publicKey',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: null,
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Missing signature',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        signature: null,
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Invalid signature format (not base64)',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        signature: 'not-valid-base64!!!',
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Non-existent tokenId',
        tokenId: 'zzzzzzzzzzzz',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        expectSuccess: false,
        expectStatusCode: 400,
      },
      {
        name: 'Invalid signature (tampered data)',
        tokenId: 'bjbvcjzqbdsj',
        delegateId: 'subagent-001',
        timestamp: Math.floor(Date.now() / 1000),
        publicKey: subagentPublicKeyBase64,
        signature: nacl.util.encodeBase64(new Uint8Array(64)), // Invalid signature
        expectSuccess: false,
        expectStatusCode: 400,
      },
    ];

    for (const testCase of testCases) {
      try {
        const payload = {
          tokenId: testCase.tokenId,
          base64HashOrDelegateSignerId: testCase.delegateId,
          unixTimestamp: testCase.timestamp,
          publicKey: testCase.publicKey,
          signature: testCase.signature || nacl.util.encodeBase64(new Uint8Array(64)),
        };

        // Remove null fields
        Object.keys(payload).forEach(key => payload[key] === null && delete payload[key]);

        const response = await fetch(`${apiEndpoint}/api/isauthorizedsigner`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer test-token`,
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (testCase.expectSuccess) {
          const passed =
            response.status === 200 &&
            data.authorized === testCase.expectAuthorized &&
            data.checks &&
            data.failureReasons !== undefined;

          results.push({
            name: testCase.name,
            passed,
            statusCode: response.status,
            authorized: data.authorized,
            checks: data.checks,
          });
        } else {
          const passed =
            response.status >= 400 &&
            (!testCase.expectStatusCode || response.status === testCase.expectStatusCode);

          results.push({
            name: testCase.name,
            passed,
            statusCode: response.status,
            expectedStatusCode: testCase.expectStatusCode,
          });
        }
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        results.push({
          name: testCase.name,
          passed: false,
          error: error.message,
          statusCode: errInfo.statusCode,
        });
      }
    }

    return {
      testName: 'testDelegatedSignerAuthorization',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testDelegatedSignerAuthorization',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testMultipleDelegatedSigners(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testMultipleDelegatedSigners' };

  try {
    const tokenId = 'bjbvcjzqbdsj';
    const subagents = [];

    // Create multiple subagent keypairs
    for (let i = 0; i < 3; i++) {
      const keyPair = nacl.sign.keyPair();
      subagents.push({
        id: `subagent-${i}`,
        publicKey: nacl.util.encodeBase64(keyPair.publicKey),
        keyPair,
      });
    }

    // Test authorizing multiple subagents
    for (const subagent of subagents) {
      try {
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

        const data = await response.json();
        const passed = response.status === 200 && data.base64HashOrDelegateSignerId === subagent.id;

        results.push({
          name: `Authorize ${subagent.id}`,
          passed,
          delegateId: data.base64HashOrDelegateSignerId,
          statusCode: response.status,
        });
      } catch (error) {
        results.push({
          name: `Authorize ${subagent.id}`,
          passed: false,
          error: error.message,
        });
      }
    }

    return {
      testName: 'testMultipleDelegatedSigners',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testMultipleDelegatedSigners',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

/**
 * Test subagent HOLA message verification
 * Tests the 11-field subagent HOLA format with proper Ed25519 signatures
 */
async function testSubagentHolaVerification(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testSubagentHolaVerification' };

  try {
    // Generate subagent keypair
    const subagentKeyPair = nacl.sign.keyPair();
    const issuerTokenId = 'bjbvcjzqbdsj'; // Valid issuer token ID
    const delegateId = 'test-subagent-001';

    // Test Case 1: Valid subagent HOLA message
    try {
      const validSubagentHola = await generateSubagentHola(apiEndpoint, {
        recipient: 'MUNDO',
        delegateId,
        issuerTokenId,
        subagentKeyPair
      });

      const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
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

      const data = await response.json();
      const passed = response.status === 200 && 
                     data.verified === true &&
                     data.isSubagentFormat === true &&
                     data.delegateId === delegateId &&
                     data.issuerTokenId === issuerTokenId;

      results.push({
        name: 'Valid subagent HOLA with proper signature',
        passed,
        statusCode: response.status,
        verified: data.verified,
        isSubagentFormat: data.isSubagentFormat,
        delegateId: data.delegateId,
        issuerTokenId: data.issuerTokenId,
        checks: data.checks,
        holaLength: validSubagentHola.length,
        holaFieldCount: validSubagentHola.split(':').length
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Valid subagent HOLA with proper signature',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test Case 2: Subagent HOLA with invalid signature
    try {
      const invalidKeyPair = nacl.sign.keyPair(); // Different keypair
      const invalidSubagentHola = await generateSubagentHola(apiEndpoint, {
        recipient: 'MUNDO',
        delegateId,
        issuerTokenId,
        subagentKeyPair: invalidKeyPair // Wrong keypair for signature
      });

      const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
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

      const data = await response.json();
      // Should fail verification due to signature mismatch
      const passed = response.status === 200 && 
                     data.verified === false &&
                     data.failureReasons &&
                     data.failureReasons.includes('signature_invalid');

      results.push({
        name: 'Subagent HOLA with invalid signature (wrong keypair)',
        passed,
        statusCode: response.status,
        verified: data.verified,
        failureReasons: data.failureReasons,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Subagent HOLA with invalid signature (wrong keypair)',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test Case 3: Subagent HOLA with invalid issuerTokenId format
    try {
      const invalidHola = await generateSubagentHola(apiEndpoint, {
        recipient: 'MUNDO',
        delegateId,
        issuerTokenId: 'INVALIDTOKEN', // Uppercase, wrong format
        subagentKeyPair
      });

      const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': ulid(),
        },
        body: JSON.stringify({
          hello: invalidHola,
          constraints: { maxAgeMs: 300000 }
        }),
      });

      // Should return 400 for invalid tokenId format
      const passed = response.status === 400;

      results.push({
        name: 'Subagent HOLA with invalid issuerTokenId format',
        passed,
        statusCode: response.status,
        expectedStatus: 400,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      // Accept 400 error as passing
      const passed = errInfo.statusCode === 400;
      results.push({
        name: 'Subagent HOLA with invalid issuerTokenId format',
        passed,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test Case 4: Subagent HOLA with non-existent issuerTokenId
    try {
      const nonExistentHola = await generateSubagentHola(apiEndpoint, {
        recipient: 'MUNDO',
        delegateId,
        issuerTokenId: 'zzzzzzzzzzzz', // Valid format but doesn't exist
        subagentKeyPair
      });

      const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
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

      const data = await response.json();
      // Should fail verification - token doesn't exist
      const passed = response.status === 200 && 
                     data.verified === false &&
                     data.failureReasons &&
                     data.failureReasons.includes('token_missing');

      results.push({
        name: 'Subagent HOLA with non-existent issuerTokenId',
        passed,
        statusCode: response.status,
        verified: data.verified,
        failureReasons: data.failureReasons,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Subagent HOLA with non-existent issuerTokenId',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test Case 5: Subagent HOLA with invalid public key length
    try {
      // Create a keypair with invalid public key (manually construct)
      const invalidKeyPair = nacl.sign.keyPair();
      // Truncate the public key to invalid length
      const truncatedPublicKey = invalidKeyPair.publicKey.slice(0, 16); // 16 bytes instead of 32
      const invalidKeyPairWithBadKey = {
        publicKey: truncatedPublicKey,
        secretKey: invalidKeyPair.secretKey
      };

      const invalidPubKeyHola = await generateSubagentHola(apiEndpoint, {
        recipient: 'MUNDO',
        delegateId,
        issuerTokenId,
        subagentKeyPair: invalidKeyPairWithBadKey
      });

      const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': ulid(),
        },
        body: JSON.stringify({
          hello: invalidPubKeyHola,
          constraints: { maxAgeMs: 300000 }
        }),
      });

      const data = await response.json();
      // Should fail verification - invalid public key length
      const passed = (response.status === 400) ||
                     (response.status === 200 && 
                      data.verified === false &&
                      data.failureReasons &&
                      (data.failureReasons.includes('subagent_public_key_invalid_length') ||
                       data.failureReasons.includes('subagent_public_key_decode_failed')));

      results.push({
        name: 'Subagent HOLA with invalid public key length',
        passed,
        statusCode: response.status,
        verified: data.verified,
        failureReasons: data.failureReasons,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      // Accept 400 error as passing
      const passed = errInfo.statusCode === 400 || 
                     (errInfo.code && (errInfo.code.includes('PUBLIC_KEY') || errInfo.code.includes('HELLO')));
      results.push({
        name: 'Subagent HOLA with invalid public key length',
        passed,
        error: error.message,
        statusCode: errInfo.statusCode,
        code: errInfo.code,
      });
    }

    // Test Case 6: Multiple subagents with different delegateIds
    const multiSubagentResults = [];
    for (let i = 0; i < 3; i++) {
      try {
        const subKeyPair = nacl.sign.keyPair();
        const subDelegateId = `multi-subagent-${i}`;
        
        const multiHola = await generateSubagentHola(apiEndpoint, {
          recipient: 'MUNDO',
          delegateId: subDelegateId,
          issuerTokenId,
          subagentKeyPair: subKeyPair
        });

        const response = await fetch(`${apiEndpoint}/api/identity/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': ulid(),
          },
          body: JSON.stringify({
            hello: multiHola,
            constraints: { maxAgeMs: 300000 }
          }),
        });

        const data = await response.json();
        const passed = response.status === 200 && 
                       data.isSubagentFormat === true &&
                       data.delegateId === subDelegateId;

        multiSubagentResults.push({
          delegateId: subDelegateId,
          passed,
          verified: data.verified,
        });
      } catch (error) {
        multiSubagentResults.push({
          delegateId: `multi-subagent-${i}`,
          passed: false,
          error: error.message,
        });
      }
    }

    results.push({
      name: 'Multiple subagents with unique delegateIds',
      passed: multiSubagentResults.every(r => r.passed),
      subagentResults: multiSubagentResults,
      totalSubagents: multiSubagentResults.length,
      passedSubagents: multiSubagentResults.filter(r => r.passed).length,
    });

    return {
      testName: 'testSubagentHolaVerification',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      summary: {
        testedSubagentFormat: true,
        testedEd25519Signatures: true,
        testedPublicKeyValidation: true,
        testedMultipleSubagents: true,
      }
    };
  } catch (error) {
    return {
      testName: 'testSubagentHolaVerification',
      passed: false,
      error: error.message,
      stack: error.stack,
      results: [],
    };
  }
}

module.exports = {
  testDelegatedSignerAuthorization,
  testMultipleDelegatedSigners,
  testSubagentHolaVerification,
  generateSubagentHola, // Export for use in other test modules
};
