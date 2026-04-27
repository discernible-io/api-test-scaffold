/**
 * Webhook Tests Module
 * Tests for webhook functionality including signature verification, authentication, and event processing
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { logger, stateManager } = require('../../sdk');
const { captureTestData, getRoditClientForTest, extractApiErrorInfo } = require('./test-utils');
const { authenticate_webhook } = require('../../sdk/lib/auth/authentication');

/**
 * Webhook Tests
 */
const webhookTests = {
  /**
   * Test webhook signature generation and verification
   * Validates that signatures are properly generated and can be verified
   */
  testWebhookSignatureGeneration: async (twsg_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookSignatureGeneration";
    const correlationId = ulid();
    const testData = { twsg_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Get the server's private key from state manager
      const config_own_rodit = stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        return {
          success: false,
          error: "Server private key not available in state manager",
          testData,
        };
      }

      // Create a test payload
      const testPayload = JSON.stringify({
        event: 'test_event',
        data: { test: 'data' },
        requestId: ulid()
      });

      const timestamp = Date.now();
      const payloadWithTimestamp = testPayload + timestamp.toString();

      // Generate hash
      const sha256_hash = crypto
        .createHash("sha256")
        .update(payloadWithTimestamp)
        .digest();

      // Sign the hash
      const privateKey = new Uint8Array(config_own_rodit.own_rodit_bytes_private_key);
      const signature = nacl.sign.detached(sha256_hash, privateKey);
      const signatureHex = Buffer.from(signature).toString('hex');

      testData.payloadSize = testPayload.length;
      testData.timestampSize = timestamp.toString().length;
      testData.signatureLength = signatureHex.length;
      testData.signatureGenerated = true;

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Webhook signature generated successfully",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook authentication with valid signature
   * Validates that valid signatures are accepted
   */
  testWebhookAuthentication: async (twa_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookAuthentication";
    const correlationId = ulid();
    const testData = { twa_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const config_own_rodit = stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        return {
          success: false,
          error: "Server private key not available",
          testData,
        };
      }

      // Create test payload
      const testPayload = JSON.stringify({
        event: 'test_authentication',
        data: { test: 'webhook_auth' },
        requestId: ulid()
      });

      const timestamp = Date.now().toString();
      const payloadWithTimestamp = testPayload + timestamp;

      // Generate signature
      const sha256_hash = crypto
        .createHash("sha256")
        .update(payloadWithTimestamp)
        .digest();

      const privateKey = new Uint8Array(config_own_rodit.own_rodit_bytes_private_key);
      const signature = nacl.sign.detached(sha256_hash, privateKey);
      const signatureHex = Buffer.from(signature).toString('hex');

      // Get our own public key for verification
      const publicKeyBase64url = stateManager.getOwnBase64urlJwkPublicKey();

      // Verify the signature using authenticate_webhook
      const authResult = await authenticate_webhook(
        testPayload,
        signatureHex,
        timestamp,
        publicKeyBase64url
      );

      testData.authenticationValid = authResult.isValid;
      testData.authDuration = authResult.duration;

      if (!authResult.isValid) {
        return {
          success: false,
          error: `Authentication failed: ${authResult.error?.message || 'Unknown error'}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Webhook authentication successful",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook authentication with invalid signature
   * Validates that invalid signatures are rejected
   */
  testWebhookInvalidSignature: async (twis_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookInvalidSignature";
    const correlationId = ulid();
    const testData = { twis_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const testPayload = JSON.stringify({
        event: 'test_invalid_sig',
        data: { test: 'invalid' },
        requestId: ulid()
      });

      const timestamp = Date.now().toString();
      
      // Create an invalid signature (random hex string)
      const invalidSignature = crypto.randomBytes(64).toString('hex');

      // Get our own public key
      const publicKeyBase64url = stateManager.getOwnBase64urlJwkPublicKey();

      // Try to verify with invalid signature
      const authResult = await authenticate_webhook(
        testPayload,
        invalidSignature,
        timestamp,
        publicKeyBase64url
      );

      testData.authenticationValid = authResult.isValid;
      testData.rejectedAsExpected = !authResult.isValid;

      if (authResult.isValid) {
        return {
          success: false,
          error: "Invalid signature was incorrectly accepted",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Invalid signature properly rejected",
        testData,
      };
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Webhook test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test webhook timestamp validation
   * Validates that stale timestamps are rejected
   */
  testWebhookTimestampValidation: async (twtv_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookTimestampValidation";
    const correlationId = ulid();
    const testData = { twtv_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const config_own_rodit = stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        return {
          success: false,
          error: "Server private key not available",
          testData,
        };
      }

      const testPayload = JSON.stringify({
        event: 'test_timestamp',
        data: { test: 'timestamp_validation' },
        requestId: ulid()
      });

      // Test 1: Fresh timestamp (should be accepted)
      const freshTimestamp = Date.now().toString();
      const freshPayloadWithTimestamp = testPayload + freshTimestamp;
      const freshHash = crypto.createHash("sha256").update(freshPayloadWithTimestamp).digest();
      const privateKey = new Uint8Array(config_own_rodit.own_rodit_bytes_private_key);
      const freshSignature = nacl.sign.detached(freshHash, privateKey);
      const freshSignatureHex = Buffer.from(freshSignature).toString('hex');

      const publicKeyBase64url = stateManager.getOwnBase64urlJwkPublicKey();
      const freshAuthResult = await authenticate_webhook(
        testPayload,
        freshSignatureHex,
        freshTimestamp,
        publicKeyBase64url
      );

      testData.freshTimestampValid = freshAuthResult.isValid;

      // Test 2: Stale timestamp (should be rejected)
      const staleTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 minutes ago
      const stalePayloadWithTimestamp = testPayload + staleTimestamp;
      const staleHash = crypto.createHash("sha256").update(stalePayloadWithTimestamp).digest();
      const staleSignature = nacl.sign.detached(staleHash, privateKey);
      const staleSignatureHex = Buffer.from(staleSignature).toString('hex');

      const staleAuthResult = await authenticate_webhook(
        testPayload,
        staleSignatureHex,
        staleTimestamp,
        publicKeyBase64url
      );

      testData.staleTimestampRejected = !staleAuthResult.isValid;

      if (!freshAuthResult.isValid || staleAuthResult.isValid) {
        return {
          success: false,
          error: "Timestamp validation not working correctly",
          details: {
            freshTimestampValid: freshAuthResult.isValid,
            staleTimestampRejected: !staleAuthResult.isValid
          },
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Timestamp validation working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook event processing
   * Validates that webhook events are properly extracted and processed
   */
  testWebhookEventProcessing: async (twep_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookEventProcessing";
    const correlationId = ulid();
    const testData = { twep_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const { processWebhookEvent } = require('../../sdk/lib/middleware/webhookhandler');

      // Test 1: Valid event
      const validEventPayload = {
        event: 'test_event',
        data: { test: 'data' },
        isError: false,
        timestamp: new Date().toISOString(),
        requestId: ulid()
      };

      const mockReq = {
        body: validEventPayload,
        headers: {}
      };

      const event = processWebhookEvent(mockReq);
      testData.validEventProcessed = !event.error && event.type === 'test_event';

      // Test 2: Missing event type
      const invalidEventPayload = {
        data: { test: 'data' }
      };

      const mockReq2 = {
        body: invalidEventPayload,
        headers: {}
      };

      const event2 = processWebhookEvent(mockReq2);
      testData.invalidEventRejected = !!event2.error;

      if (!testData.validEventProcessed || !testData.invalidEventRejected) {
        return {
          success: false,
          error: "Event processing not working correctly",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Webhook event processing working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook endpoint accessibility
   * Validates that the webhook endpoint is properly configured
   */
  testWebhookEndpointAccessibility: async (twea_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookEndpointAccessibility";
    const correlationId = ulid();
    const testData = { twea_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Test that webhook endpoint exists and requires authentication
      const response = await fetch(`${twea_api_ep}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': ulid()
        },
        body: JSON.stringify({
          event: 'test',
          data: {}
        })
      });

      testData.webhookEndpointExists = response.status !== 404;
      testData.webhookRequiresAuth = response.status === 400 || response.status === 401;
      testData.responseStatus = response.status;

      if (!testData.webhookEndpointExists) {
        return {
          success: false,
          error: "Webhook endpoint not found (404)",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Webhook endpoint is accessible",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook delivery to /hooks/wake endpoint
   * Validates that webhooks can be sent to the wake endpoint with custom endpoint option
   */
  testWebhookWakeEndpoint: async (twwe_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookWakeEndpoint";
    const correlationId = ulid();
    const testData = { twwe_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const config_own_rodit = stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        return {
          success: false,
          error: "Server private key not available",
          testData,
        };
      }

      // Create test payload for wake endpoint
      const testPayload = JSON.stringify({
        event: 'wake_event',
        data: { action: 'wake', timestamp: Date.now() },
        requestId: ulid()
      });

      const timestamp = Date.now().toString();
      const payloadWithTimestamp = testPayload + timestamp;

      // Generate signature
      const sha256_hash = crypto
        .createHash("sha256")
        .update(payloadWithTimestamp)
        .digest();

      const privateKey = new Uint8Array(config_own_rodit.own_rodit_bytes_private_key);
      const signature = nacl.sign.detached(sha256_hash, privateKey);
      const signatureHex = Buffer.from(signature).toString('hex');

      // Test that /hooks/wake endpoint is accessible
      const response = await fetch(`${twwe_api_ep}/hooks/wake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signatureHex,
          'X-Timestamp': timestamp,
          'X-Request-ID': ulid()
        },
        body: testPayload
      });

      testData.wakeEndpointExists = response.status !== 404;
      testData.wakeEndpointStatus = response.status;
      testData.wakeEndpointAccessible = response.status >= 200 && response.status < 500;

      if (!testData.wakeEndpointExists) {
        return {
          success: false,
          error: "Wake endpoint not found (404)",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Wake endpoint is accessible",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook delivery to /hooks/agent endpoint
   * Validates that webhooks can be sent to the agent endpoint with custom endpoint option
   */
  testWebhookAgentEndpoint: async (twae_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookAgentEndpoint";
    const correlationId = ulid();
    const testData = { twae_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const config_own_rodit = stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        return {
          success: false,
          error: "Server private key not available",
          testData,
        };
      }

      // Create test payload for agent endpoint
      const testPayload = JSON.stringify({
        event: 'agent_event',
        data: { action: 'agent_action', agentId: ulid() },
        requestId: ulid()
      });

      const timestamp = Date.now().toString();
      const payloadWithTimestamp = testPayload + timestamp;

      // Generate signature
      const sha256_hash = crypto
        .createHash("sha256")
        .update(payloadWithTimestamp)
        .digest();

      const privateKey = new Uint8Array(config_own_rodit.own_rodit_bytes_private_key);
      const signature = nacl.sign.detached(sha256_hash, privateKey);
      const signatureHex = Buffer.from(signature).toString('hex');

      // Test that /hooks/agent endpoint is accessible
      const response = await fetch(`${twae_api_ep}/hooks/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signatureHex,
          'X-Timestamp': timestamp,
          'X-Request-ID': ulid()
        },
        body: testPayload
      });

      testData.agentEndpointExists = response.status !== 404;
      testData.agentEndpointStatus = response.status;
      testData.agentEndpointAccessible = response.status >= 200 && response.status < 500;

      if (!testData.agentEndpointExists) {
        return {
          success: false,
          error: "Agent endpoint not found (404)",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "Agent endpoint is accessible",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook reception and processing at multiple endpoints
   * Validates that the client can receive webhooks at different endpoints
   */
  testWebhookReceptionAtMultipleEndpoints: async (twrme_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookReceptionAtMultipleEndpoints";
    const correlationId = ulid();
    const testData = { twrme_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Test that all three webhook endpoints are available for receiving webhooks
      const endpoints = [
        { path: '/webhook', name: 'default' },
        { path: '/hooks/wake', name: 'wake' },
        { path: '/hooks/agent', name: 'agent' }
      ];

      const endpointResults = {};

      for (const endpoint of endpoints) {
        try {
          // Test endpoint availability by sending OPTIONS or HEAD request
          const response = await fetch(`${twrme_api_ep}${endpoint.path}`, {
            method: 'OPTIONS',
            headers: {
              'Content-Type': 'application/json',
              'X-Request-ID': ulid()
            }
          }).catch(() => null);

          // If OPTIONS not supported, try POST with minimal payload (will fail auth but shows endpoint exists)
          if (!response || response.status === 405) {
            const postResponse = await fetch(`${twrme_api_ep}${endpoint.path}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Request-ID': ulid()
              },
              body: JSON.stringify({ event: 'test' })
            });

            endpointResults[endpoint.name] = {
              exists: postResponse.status !== 404,
              status: postResponse.status,
              requiresAuth: postResponse.status === 400 || postResponse.status === 401
            };
          } else {
            endpointResults[endpoint.name] = {
              exists: response.status !== 404,
              status: response.status,
              supportsOptions: true
            };
          }
        } catch (error) {
          endpointResults[endpoint.name] = {
            exists: false,
            error: error.message
          };
        }
      }

      testData.endpointResults = endpointResults;

      // Verify all endpoints exist
      const allEndpointsExist = endpoints.every(ep => endpointResults[ep.name].exists);

      if (!allEndpointsExist) {
        return {
          success: false,
          error: "Not all webhook endpoints are available",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        success: true,
        message: "All webhook endpoints are available for receiving webhooks",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} failed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        testData,
      };
    }
  }
};

module.exports = webhookTests;
