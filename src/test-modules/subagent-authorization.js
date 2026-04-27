const crypto = require('crypto');
const nacl = require('tweetnacl');
nacl.util = require('tweetnacl-util');

const { extractApiErrorInfo } = require('./test-utils');

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

module.exports = {
  testDelegatedSignerAuthorization,
  testMultipleDelegatedSigners,
};
