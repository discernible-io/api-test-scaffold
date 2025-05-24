/**
 * Authentication service for RODiT authentication
 * Copyright (c) 2024 Cableguard, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
const logger = require("../../config/logger");
const nacl = require("tweetnacl");
const crypto = require("crypto");
const { Resolver } = require("dns").promises;
const { calculateCanonicalHash, unixTimeToDateString } = require("../utils");
// Import specific functions to avoid circular dependencies
const { generate_jwt_token } = require("./tokenservice");
const stateManager = require("../blockchain/statemanager");
const { 
  nearorg_rpc_timestamp, 
  nearorg_rpc_tokenfromroditid, 
  nearorg_rpc_fetchpublickeybytes,
  RODiT,
  PayloadNEP413,
  PayloadNEP413Schema,
  CONSTANTS,
} = require("../blockchain/blockchainservice");

async function verify_rodit_ownership(
    peerroditid,
    peertimestamp,
    peerroditid_base64url_signature,
    peer_rodit
  ) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.debug("Starting RODiT ownership verification", {
      component: "RoditAuth",
      method: "verify_rodit_ownership",
      requestId,
      peerRoditId: peerroditid,
      timestamp: peertimestamp,
      signatureLength: peerroditid_base64url_signature?.length,
      signatureValue: peerroditid_base64url_signature?.substring(0, 20) + '...',
    });

    try {
      // DO NOT DELETE THE FOLLOWING COMMENT
      /* Maybe for NEP413 compatibility, the following line added "NEAR" before peerroditid */
      
      // Match legacy implementation exactly
      const timeString = await unixTimeToDateString(peertimestamp);
      const roditidandtimestamp = new TextEncoder().encode(
        peerroditid + timeString
      );

      logger.debug("Encoded roditid and timestamp", {
        component: "AuthServices",
        method: "verify_rodit_ownership",
        requestId,
        timeString,
        peerRoditId: peerroditid,
        combinedString: peerroditid + timeString,
        bufferLength: roditidandtimestamp.length,
        bufferHex: Buffer.from(roditidandtimestamp).toString('hex').substring(0, 64) + '...',
      });

      // Check if signature is defined before proceeding
      if (!peerroditid_base64url_signature) {
        logger.error("Missing signature in authentication request", {
          component: "AuthServices",
          method: "verify_rodit_ownership",
          requestId,
          peerRoditId: peerroditid,
        });
        throw new Error("Missing signature in authentication request");
      }

      const bytes_ed25519_signature = new Uint8Array(
        Buffer.from(peerroditid_base64url_signature, "base64url")
      );
      
      logger.debug("Decoded signature using base64url", {
        component: "AuthServices",
        method: "verify_rodit_ownership",
        requestId,
        signatureLength: bytes_ed25519_signature.length,
        signatureHex: Buffer.from(bytes_ed25519_signature).toString('hex').substring(0, 64) + '...',
        expectedLength: 64, // Ed25519 signatures should be 64 bytes
      });

      const peer_bytes_ed25519_public_key =
        await nearorg_rpc_fetchpublickeybytes(
          peer_rodit.owner_id
        );

      logger.debug("Retrieved public key", {
        component: "AuthServices",
        method: "verify_rodit_ownership",
        requestId,
        ownerId: peer_rodit.owner_id,
        keyLength: peer_bytes_ed25519_public_key?.length || 0,
        keyHex: peer_bytes_ed25519_public_key ? Buffer.from(peer_bytes_ed25519_public_key).toString('hex') : 'null',
        expectedLength: 32, // Ed25519 public keys should be 32 bytes
      });

      // Add more detailed debugging for verification inputs
      logger.debug("Verification inputs", {
        component: "AuthServices",
        method: "verify_rodit_ownership",
        requestId,
        messageLength: roditidandtimestamp.length,
        messageContent: peerroditid + timeString,
        signatureLength: bytes_ed25519_signature.length,
        publicKeyLength: peer_bytes_ed25519_public_key?.length,
        messageHex: Buffer.from(roditidandtimestamp).toString('hex'),
        signatureHex: Buffer.from(bytes_ed25519_signature).toString('hex'),
        publicKeyHex: peer_bytes_ed25519_public_key ? Buffer.from(peer_bytes_ed25519_public_key).toString('hex') : 'null',
      });

      const isaMatch = nacl.sign.detached.verify(
        roditidandtimestamp,
        bytes_ed25519_signature,
        peer_bytes_ed25519_public_key
      );
      
      const duration = Date.now() - startTime;

      if (isaMatch) {
        logger.info("Peer RODiT ownership check successful", {
          component: "AuthServices",
          requestId,
          duration,
          peerRoditId: peerroditid,
          ownerId: peer_rodit.owner_id,
          outcome: "success",
        });

        // Add metric for successful verification
        logger.metric &&
          logger.metric("rodit_ownership_verification", duration, {
            result: "success",
            peer_rodit_id: peerroditid,
          });

        return true;
      } else {
        logger.error("Peer RODiT ownership check failed", {
          component: "AuthServices",
          requestId,
          duration,
          peerRoditId: peerroditid,
          ownerId: peer_rodit.owner_id,
          outcome: "failed",
        });

        // Add metric for failed verification
        logger.metric &&
          logger.metric("rodit_ownership_verification", duration, {
            result: "failure",
            peer_rodit_id: peerroditid,
          });

        throw new Error("Error 035: PeerEd25519SignatureVerificationFailure");
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("RODiT ownership verification failed", {
        component: "AuthServices",
        method: "verify_rodit_ownership",
        requestId,
        duration,
        peerRoditId: peerroditid,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });

      // Add metric for verification errors
      logger.metric &&
        logger.metric("rodit_ownership_verification_errors", 1, {
          error_type: error.name || "Unknown",
          peer_rodit_id: peerroditid,
        });

      throw new Error("Error A33: " + error.message);
    }
  }

 async function verify_rodit_ownership_withnep413(
    message,
    nonce,
    recipient,
    callbackUrl,
    signature,
    peer_rodit
  ) {
    try {
      logger.debug("Starting NEP-413 signature verification");

      // Ensure nonce is correctly formatted
      let nonceArray;
      if (typeof nonce === "string") {
        // Handle base64url encoded nonce
        nonceArray = new Uint8Array(Buffer.from(nonce, "base64url"));
      } else if (Array.isArray(nonce)) {
        nonceArray = new Uint8Array(nonce);
      } else if (typeof nonce === "object" && nonce !== null) {
        nonceArray = new Uint8Array(Object.values(nonce));
      } else {
        throw new Error(`Invalid nonce format: ${typeof nonce}`);
      }

      if (nonceArray.length !== 32) {
        logger.error(`Invalid nonce length: ${nonceArray.length}`);
        throw new Error(
          `Invalid nonce length: ${nonceArray.length}, expected 32`
        );
      }

      const payload = new PayloadNEP413({
        tag: 2147484061,
        message,
        nonce: nonceArray,
        recipient,
        callbackUrl,
      });

      const serializedPayload = borsh.serialize(PayloadNEP413Schema, payload);
      const payloadHash = crypto
        .createHash("sha256")
        .update(serializedPayload)
        .digest();

      // Convert base64url signature to standard base64
      const standardBase64 = signature
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(signature.length + ((4 - (signature.length % 4)) % 4), "=");
      const signatureBytes = nacl.util.decodeBase64(standardBase64);

      // Get public key bytes
      const publicKeyBytes = await nearorg_rpc_fetchpublickeybytes(
        peer_rodit.owner_id
      );

      // Perform verification
      const isaMatch = nacl.sign.detached.verify(
        payloadHash,
        signatureBytes,
        publicKeyBytes
      );

      if (isaMatch) {
        logger.info("Peer RODiT possession check successful");
        return true;
      } else {
        logger.error("Peer RODiT possession check failed");
        throw new Error("PeerEd25519SignatureVerificationFailure");
      }
    } catch (error) {
      logger.error(
        `Error in this.verify_rodit_ownership_withnep413: ${error.message}`
      );
      throw error;
    }
  }

  /**
 * Send a webhook notification with comprehensive logging and test tracking
 *
 * @param {string} event - Event name
 * @param {Object} data - Event data
 * @param {boolean} isError - Whether this is an error event
 * @param {boolean} isTest - Whether this is a test webhook (for recording in database)
 * @param {Object} req - Express request object (optional)
 * @returns {Promise<Object>} Webhook delivery result with requestId
 */
async function send_webhook(event, data, isError = false, isTest = false, req = null) {
  // Use test_id from data if available (for test correlation) or generate a new ID
  const requestId = (data && data.test_id) ? data.test_id : ulid();
  const startTime = Date.now();

  // Create a context object for consistent logging
  const webhookContext = {
    event,
    requestId,
    isError,
    isTest,
    dataType: typeof data,
    operation: "webhook",
    method: "send_webhook",
    component: "AuthServices"
  };

  // Log the webhook attempt with both logging patterns for backward compatibility
  logger.debug("Starting webhook delivery", {
    component: "RoditAuth",
    method: "send_webhook",
    requestId,
    event,
    isError,
    isTest,
    dataSize: typeof data === "object" ? JSON.stringify(data).length : "unknown",
  });

  // Also log with the infoWithContext pattern used in cruda.js
  logger.infoWithContext && logger.infoWithContext("Sending webhook", {
    ...webhookContext,
    status: "attempt",
    eventType: event
  });

  try {
    // Get the configuration from state manager
    const config_own_rodit = await stateManager.getConfigOwnRodit();
    
    // Check if webhook configuration is available
    if (
      !config_own_rodit ||
      !config_own_rodit.own_rodit.metadata.webhook_url
    ) {
      const duration = Date.now() - startTime;

      logger.warn("Webhook configuration missing", {
        component: "AuthServices",
        method: "send_webhook",
        requestId,
        duration,
        hasConfig: !!config_own_rodit,
        hasOwnRodit: !!config_own_rodit?.own_rodit,
        hasMetadata: !!config_own_rodit?.own_rodit?.metadata,
      });

      // Emit metrics for Grafana dashboards
      logger.metric &&
        logger.metric("webhook_delivery_duration_ms", duration, {
          component: "AuthServices",
          success: false,
          event,
          error: "WEBHOOK_CONFIG_ERROR",
        });
      logger.metric &&
        logger.metric("webhook_delivery_failures_total", 1, {
          component: "AuthServices",
          reason: "CONFIG_MISSING",
          event,
        });

      // Log error with errorWithContext pattern
      logger.errorWithContext && logger.errorWithContext(
        "Webhook configuration missing", 
        {
          ...webhookContext,
          status: "failed",
          errorMessage: "Webhook URL not available in Rodit configuration"
        }
      );
      
      // Record test failure if this is a test webhook
      if (isTest && global.db) {
        try {
          await global.db.run(
            `INSERT INTO webhook_tests (correlation_id, event_type, payload, success, timestamp, error_message) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              requestId,
              event,
              JSON.stringify(data),
              0, // failure
              new Date().toISOString(),
              "Webhook URL not available in Rodit configuration"
            ]
          );
        } catch (dbError) {
          logger.errorWithContext && logger.errorWithContext(
            "Failed to record webhook test failure", 
            {
              ...webhookContext,
              status: "database_error"
            },
            dbError
          );
        }
      }
      
      return {
        isValid: false,
        error: {
          code: "WEBHOOK_CONFIG_ERROR",
          message: "Webhook URL not available in Rodit configuration",
          requestId,
        },
      };
    }

    // Determine webhook URL from request or config
    let webhookUrl;
    
    // Check if request object is available and has user with webhook URL
    if (req && req.user && req.user.rodit_webhookurl) {
      // Use the webhook URL from the peer's JWT token
      webhookUrl = req.user.rodit_webhookurl;
      logger.debug("Using webhook URL from peer JWT token", {
        component: "AuthServices",
        method: "send_webhook",
        requestId,
        webhookSource: "peer_jwt",
        webhookUrl,
      });
    } else {
      // Fallback to config
      webhookUrl = config_own_rodit.own_rodit.metadata.webhook_url;
      logger.debug("Using webhook URL from own RODiT config", {
        component: "AuthServices",
        method: "send_webhook",
        requestId,
        webhookSource: "own_config",
        webhookUrl,
      });
    }

    // First remove any existing protocol
    const cleanWebhookUrl = webhookUrl.replace(/^(https?:\/\/)/, "");

    // Then add https:// protocol
    const formattedWebhookUrl = `https://${cleanWebhookUrl}/webhook`;

    logger.debug("Webhook URL details", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      rawWebhookUrl: webhookUrl,
      formattedWebhookUrl,
    });

    const timestamp = Date.now();
    
    // Ensure data is serializable before stringifying
    let sanitizedData;
    try {
      // Test if data can be properly serialized
      if (typeof data === 'object' && data !== null) {
        // Create a deep copy to avoid modifying the original data
        sanitizedData = JSON.parse(JSON.stringify(data));
      } else if (data === undefined || data === null) {
        // Handle null/undefined explicitly
        sanitizedData = null;
      } else if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        // Primitive types can be used directly
        sanitizedData = data;
      } else {
        // For other types (functions, symbols, etc.), create a string representation
        sanitizedData = {
          type: typeof data,
          stringValue: String(data)
        };
      }
    } catch (serializeError) {
      // If data can't be serialized, create a simplified version
      logger.warn("Data serialization failed, creating simplified version", {
        component: "AuthServices",
        method: "send_webhook",
        requestId,
        error: serializeError.message
      });
      
      // Create a simplified version with basic properties
      sanitizedData = {
        type: typeof data,
        summary: "Data could not be serialized to JSON",
        error: serializeError.message
      };
    }
    
    // Create the payload object
    const payloadObj = {
      event,
      data: sanitizedData,
      isError,
      requestId,
    };
    
    // Create the payload with consistent JSON formatting
    // Sort keys to ensure canonical representation regardless of object creation order
    const payload = JSON.stringify(payloadObj, function(key, value) {
      // Handle special numeric values consistently
      if (typeof value === 'number') {
        if (isNaN(value)) return 'NaN';
        if (value === Infinity) return 'Infinity';
        if (value === -Infinity) return '-Infinity';
      }
      return value;
    }, 0);
    
    // Ensure consistent handling of Unicode characters
    const normalizedPayload = payload.normalize('NFC');
    
    logger.debug("Preparing webhook payload", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      payloadSize: normalizedPayload.length,
      event,
    });
    
    // Create the string to hash: payload + timestamp
    // This binds the timestamp to the payload for signature verification
    const payloadWithTimestamp = normalizedPayload + timestamp.toString();
    
    logger.debug("Creating payload+timestamp string for signing", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      payloadSize: normalizedPayload.length,
      timestampLength: timestamp.toString().length,
      combinedLength: payloadWithTimestamp.length
    });

    // Generate hash of payload+timestamp
    const sha256_ofpayload = crypto
      .createHash("sha256")
      .update(payloadWithTimestamp)
      .digest();

    // Log hash details for visibility
    logger.debug("Webhook hash details", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      hashHex: sha256_ofpayload.toString('hex'),
      hashLength: sha256_ofpayload.length
    });

    logger.debug("Creating signature", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      hasPrivateKey: !!config_own_rodit.own_rodit_bytes_private_key,
    });

    // Convert private key and generate signature
    const own_rodit_private_key = new Uint8Array(
      config_own_rodit.own_rodit_bytes_private_key
    );

    // Log the public key from state manager
    const publicKey = stateManager.getOwnBase64urlJwkPublicKey();
    
    // Log the key in multiple formats for precise comparison
    logger.debug("Webhook signing key information", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      publicKeyBase64url: publicKey,
      publicKeyHex: publicKey ? Buffer.from(publicKey, 'base64url').toString('hex') : null,
      keyLength: publicKey ? Buffer.from(publicKey, 'base64url').length : 0
    });

    const signatureStartTime = Date.now();
    const signature_ofpayload = nacl.sign.detached(
      sha256_ofpayload,
      own_rodit_private_key
    );
    const signatureDuration = Date.now() - signatureStartTime;

    // Log signature generation metrics
    logger.metric &&
      logger.metric("signature_generation_duration_ms", signatureDuration, {
        component: "AuthServices",
      });

    const signature_hex_ofpayload =
      Buffer.from(signature_ofpayload).toString("hex");

    // Log signature details for visibility and comparison with client logs
    logger.debug("Webhook signature details", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      signatureHex: signature_hex_ofpayload,
      signatureBase64: Buffer.from(signature_ofpayload).toString("base64"),
      signatureBase64url: Buffer.from(signature_ofpayload).toString("base64").replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      signatureLength: signature_hex_ofpayload.length,
      signatureByteLength: signature_ofpayload.length
    });
    
    // Log the exact hash that was signed for comparison
    logger.debug("Webhook hash that was signed", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      hashHex: Buffer.from(sha256_ofpayload).toString('hex'),
      hashBase64: Buffer.from(sha256_ofpayload).toString('base64'),
      hashBase64url: Buffer.from(sha256_ofpayload).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      hashLength: sha256_ofpayload.length
    });

    logger.debug("Sending webhook request", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      webhookUrl: formattedWebhookUrl,
      event,
      timestamp: timestamp.toString(),
      payload: process.env.NODE_ENV === 'development' ? payload : undefined, // Only log payload in development
      signatureHex: signature_hex_ofpayload
    });

    // Prepare headers for the webhook request
    const headers = {
      "Content-Type": "application/json",
      "X-Signature": signature_hex_ofpayload,
      "X-Timestamp": timestamp.toString(),
      "X-Request-ID": requestId
    };
    
    // Log the exact headers being sent
    logger.debug("Webhook request headers", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      headers: headers,
      signatureHeader: signature_hex_ofpayload,
      timestampHeader: timestamp.toString()
    });
    
    // SELF-VERIFICATION: Call authenticate_webhook with the same parameters the client will use
    // This helps determine if the issue is in the signature generation/verification or in the data flow
    try {
      logger.info("Performing self-verification before sending webhook", {
        component: "AuthServices",
        method: "send_webhook",
        requestId
      });
      
      // Get our own public key for verification
      const publicKeyForVerification = stateManager.getOwnBase64urlJwkPublicKey();
      
      // Call authenticate_webhook with the same parameters the client will receive
      const verificationResult = await authenticate_webhook(
        payload,                  // The exact payload being sent
        signature_hex_ofpayload,  // The signature in hex format
        timestamp.toString(),     // The timestamp as a string
        publicKeyForVerification  // Our own public key for verification
      );
      
      logger.info("Self-verification result", {
        component: "AuthServices",
        method: "send_webhook",
        requestId,
        selfVerificationSuccess: verificationResult.isValid,
        selfVerificationError: verificationResult.error ? verificationResult.error.message : null
      });
      
      if (!verificationResult.isValid) {
        logger.warn("Self-verification failed - client verification will likely fail too", {
          component: "AuthServices",
          method: "send_webhook",
          requestId,
          error: verificationResult.error ? verificationResult.error.message : "Unknown verification error"
        });
      }
    } catch (verificationError) {
      logger.error("Error during self-verification", {
        component: "AuthServices",
        method: "send_webhook",
        requestId,
        error: verificationError.message,
        stack: verificationError.stack
      });
    }
    
    // Send webhook request
    const fetchStartTime = Date.now();
    const response = await fetch(formattedWebhookUrl, {
      method: "POST",
      headers: headers,
      body: payload,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    // Log fetch duration metrics
    logger.metric("webhook_http_request_duration_ms", fetchDuration, {
      component: "AuthServices",
      success: response.ok,
      status: response.status,
      event,
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;

      logger.error("Webhook delivery failed", {
        component: "AuthServices",
        method: "send_webhook",
        requestId,
        duration,
        status: response.status,
        statusText: response.statusText,
        webhookUrl: formattedWebhookUrl,
        event,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("webhook_delivery_duration_ms", duration, {
        component: "AuthServices",
        success: false,
        event,
        error: "HTTP_ERROR",
        status: response.status,
      });
      logger.metric("webhook_delivery_failures_total", 1, {
        component: "AuthServices",
        reason: "HTTP_ERROR",
        status: response.status,
        event,
      });

      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await response.text();

    const duration = Date.now() - startTime;
    logger.info("Webhook delivered successfully", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      duration,
      event,
      webhookUrl: formattedWebhookUrl,
      status: response.status,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("webhook_delivery_duration_ms", duration, {
      component: "AuthServices",
      success: true,
      event,
    });
    logger.metric("successful_webhook_deliveries_total", 1, {
      component: "AuthServices",
      event,
    });

    // Record test results if this is a test webhook
    if (isTest && global.db) {
      try {
        await global.db.run(
          `INSERT INTO webhook_tests (correlation_id, event_type, payload, success, timestamp, error_message) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            requestId,
            event,
            JSON.stringify(data),
            1, // success
            new Date().toISOString(),
            null // no error
          ]
        );

        logger.infoWithContext && logger.infoWithContext("Webhook test result recorded", {
          ...webhookContext,
          status: "success",
          databaseRecorded: true
        });
      } catch (dbError) {
        logger.errorWithContext && logger.errorWithContext(
          "Failed to record webhook test result", 
          {
            ...webhookContext,
            status: "database_error"
          },
          dbError
        );
      }
    }

    // Log success with infoWithContext pattern
    logger.infoWithContext && logger.infoWithContext("Webhook sent successfully", {
      ...webhookContext,
      status: "success"
    });
    
    // Return success result with requestId for tracing
    return {
      isValid: true,
      message: "Webhook sent successfully",
      requestId,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Webhook send failed", {
      component: "AuthServices",
      method: "send_webhook",
      requestId,
      duration,
      event,
      errorMessage: error.message,
      errorCode: error.code || "UNKNOWN_ERROR",
      stack: error.stack,
      isError,
      isTest: data && data.test_id ? true : false,
      operation: "webhook",
      status: "failed",
    });

    // Emit metrics for Grafana dashboards
    logger.metric("webhook_delivery_duration_ms", duration, {
      component: "AuthServices",
      success: false,
      event,
      error: error.constructor.name,
    });
    logger.metric("webhook_delivery_errors_total", 1, {
      component: "AuthServices",
      error: error.constructor.name,
      event,
    });

    // Record test failure if this is a test webhook
    if (isTest && global.db) {
      try {
        await global.db.run(
          `INSERT INTO webhook_tests (correlation_id, event_type, payload, success, timestamp, error_message) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            requestId,
            event,
            JSON.stringify(data),
            0, // failure
            new Date().toISOString(),
            error.message || JSON.stringify(error)
          ]
        );
        
        logger.infoWithContext && logger.infoWithContext("Webhook test failure recorded", {
          ...webhookContext,
          status: "failure",
          databaseRecorded: true
        });
      } catch (dbError) {
        logger.errorWithContext && logger.errorWithContext(
          "Failed to record webhook test failure", 
          {
            ...webhookContext,
            status: "database_error"
          },
          dbError
        );
      }
    }
    
    // Log error with errorWithContext pattern
    logger.errorWithContext && logger.errorWithContext(
      "Webhook send failed", 
      {
        ...webhookContext,
        status: "failed",
        errorMessage: error.message
      },
      error
    );
    
    // Return error result with requestId for tracing
    return {
      isValid: false,
      error: {
        code: "WEBHOOK_SEND_ERROR",
        message: `Failed to send webhook: ${error.message}`,
        requestId,
      },
    };
  }
}

  /**
   * Authenticate a webhook request
   *
   * @param {string} payload - Webhook payload
   * @param {string} signature_hex_ofpayload - Signature of payload
   * @param {number} timestamp - Request timestamp
   * @param {string} server_public_key_base64url - Server's public key from RODiT in base64url format
   * @returns {Promise<Object>} Authentication result
   */
  async function authenticate_webhook(
    payload,
    signature_hex_ofpayload,
    timestamp,
    server_public_key_base64url
  ) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.debug("Starting webhook authentication", {
      component: "AuthServices",
      method: "authenticate_webhook",
      requestId,
      hasPayload: !!payload,
      hasSignature: !!signature_hex_ofpayload,
      hasTimestamp: !!timestamp,
      hasServerPublicKey: !!server_public_key_base64url,
      serverKeyLength: server_public_key_base64url?.length,
      payloadLength: payload?.length || 0,
      signatureLength: signature_hex_ofpayload?.length || 0,
      timestampValue: timestamp,
      signatureFirstChars: signature_hex_ofpayload ? signature_hex_ofpayload.substring(0, 15) + '...' : 'null',
      serverKeyFirstChars: server_public_key_base64url ? server_public_key_base64url.substring(0, 15) + '...' : 'null'
    });

    // Log the call stack to understand where this function is being called from
    const stackTrace = new Error().stack;
    logger.debug("Webhook authentication call stack", {
      component: "AuthServices",
      method: "authenticate_webhook",
      requestId,
      stack: stackTrace
    });

    try {
      const currentTime = Date.now();
      const parsedTimestamp = parseInt(timestamp);
      const timeThreshold = 5 * 60 * 1000; // 5 minutes

      // Check if timestamp is too old
      if (currentTime - parsedTimestamp > timeThreshold) {
        const duration = Date.now() - startTime;

        logger.warn("Webhook authentication failed - timestamp too old", {
          component: "AuthServices",
          method: "authenticate_webhook",
          requestId,
          duration,
          timestampAge: (currentTime - parsedTimestamp) / 1000,
          threshold: timeThreshold / 1000,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("webhook_authentication_duration_ms", duration, {
          component: "AuthServices",
          success: false,
          reason: "TIMESTAMP_EXPIRED",
        });
        logger.metric("webhook_authentication_failures_total", 1, {
          component: "AuthServices",
          reason: "TIMESTAMP_EXPIRED",
        });

        return {
          isValid: false,
          error: {
            code: "TIMESTAMP_EXPIRED",
            message: "Webhook timestamp is too old",
            requestId,
          },
        };
      }

      logger.debug("Calculating payload hash for verification", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        payloadSize: payload.length
      });
      
      // IMPORTANT: The server normalizes the payload before signing
      // We must use the raw payload as received without additional normalization
      
      // Log the raw payload for complete visibility with detailed format information
      logger.debug("Raw payload for verification", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        payload: payload, // Log the full payload
        payloadSize: payload.length,
        payloadType: typeof payload,
        payloadIsString: typeof payload === 'string',
        payloadFirstChars: payload.substring(0, 100) + (payload.length > 100 ? '...' : '')
      });
      
      // Create the string to hash: payload + timestamp (same as in send_webhook)
      // Use the raw payload without normalization
      const payloadWithTimestamp = payload + timestamp.toString();
      
      logger.debug("Creating payload+timestamp string for verification", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        payloadSize: payload.length,
        timestampLength: timestamp.toString().length,
        combinedLength: payloadWithTimestamp.length,
        wasNormalized: false,
        // Check if timestamp is properly appended
        endsWithTimestamp: payloadWithTimestamp.endsWith(timestamp.toString())
      });
      
      // Calculate hash of payload+timestamp
      const sha256_ofpayload = crypto
        .createHash("sha256")
        .update(payloadWithTimestamp)
        .digest();
        
      // Log the hash in hex format for debugging
      const sha256_hex = Buffer.from(sha256_ofpayload).toString('hex');
      logger.debug("Calculated hash for verification", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        sha256_hex: sha256_hex,
        hashLength: sha256_ofpayload.length
      });
      


      logger.debug("Converting signature to buffer", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        signatureHex: signature_hex_ofpayload,
        signatureHexLength: signature_hex_ofpayload.length,
        // Check if signature is valid hex (should be even length and only hex chars)
        isValidHex: /^[0-9a-fA-F]+$/.test(signature_hex_ofpayload) && signature_hex_ofpayload.length % 2 === 0
      });
      
      // Convert the hex signature to a Uint8Array for verification
      // This matches how signatures are created in send_webhook
      const buffer_signature_ofpayload = new Uint8Array(
        Buffer.from(signature_hex_ofpayload, "hex")
      );
      
      logger.debug("Signature converted to buffer", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        bufferLength: buffer_signature_ofpayload.length,
        // Log first few bytes of the buffer for verification
        bufferFirstBytes: Array.from(buffer_signature_ofpayload.slice(0, 4)),
        // Log last few bytes of the buffer for verification
        bufferLastBytes: Array.from(buffer_signature_ofpayload.slice(-4))
      });

      // Log the server public key before conversion for debugging
      logger.debug("Server public key before conversion", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        serverKeyBase64Url: server_public_key_base64url,
        serverKeyBase64UrlLength: server_public_key_base64url.length,
        // Check if key is valid base64url (no +, /, or =)
        isValidBase64Url: /^[A-Za-z0-9_-]*$/.test(server_public_key_base64url)
      });
      
      // Convert base64url encoded key to bytes for use with nacl
      const server_public_key = new Uint8Array(
        Buffer.from(server_public_key_base64url, "base64url")
      );

      logger.debug("Using server public key for verification", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        serverKeyLength: server_public_key.length,
        // Log the key in different formats for comparison with server logs
        serverKeyHex: Buffer.from(server_public_key).toString('hex'),
        serverKeyBase64: Buffer.from(server_public_key).toString('base64'),
        serverKeyBase64Url: Buffer.from(server_public_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        serverKeyHexShort: Buffer.from(server_public_key).toString('hex').substring(0, 16) + '...',
      });

      // Log detailed information about the verification inputs
      logger.debug("Signature verification details", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        payloadHashHex: Buffer.from(sha256_ofpayload).toString('hex'),
        signatureHex: signature_hex_ofpayload,
        signatureLength: buffer_signature_ofpayload.length,
        serverKeyHex: Buffer.from(server_public_key).toString('hex'),
        serverKeyBase64: Buffer.from(server_public_key).toString('base64'),
        serverKeyBase64url: server_public_key_base64url
      });

      // Verify signature using the server's public key
      const verificationStartTime = Date.now();
      
      // Log all verification inputs in detail with multiple encoding formats
      logger.debug("Detailed verification inputs", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        // Hash in different formats
        hashHex: Buffer.from(sha256_ofpayload).toString('hex'),
        hashBase64: Buffer.from(sha256_ofpayload).toString('base64'),
        hashBase64Url: Buffer.from(sha256_ofpayload).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        hashLength: sha256_ofpayload.length,
        // Signature in different formats
        signatureHex: Buffer.from(buffer_signature_ofpayload).toString('hex'),
        signatureBase64: Buffer.from(buffer_signature_ofpayload).toString('base64'),
        signatureBase64Url: Buffer.from(buffer_signature_ofpayload).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        signatureLength: buffer_signature_ofpayload.length,
        // Public key in different formats
        publicKeyHex: Buffer.from(server_public_key).toString('hex'),
        publicKeyBase64: Buffer.from(server_public_key).toString('base64'),
        publicKeyBase64Url: Buffer.from(server_public_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        publicKeyLength: server_public_key.length
      });
      
      // Perform standard signature verification
      let isValid = false;
      
      try {
        // Use the standard verification method only
        isValid = nacl.sign.detached.verify(
          sha256_ofpayload,
          buffer_signature_ofpayload,
          server_public_key
        );
        
        logger.debug("Standard signature verification completed", {
          component: "AuthServices",
          method: "authenticate_webhook",
          requestId,
          isValid
        });
      } catch (error) {
        logger.warn("Signature verification failed with error", {
          component: "AuthServices",
          method: "authenticate_webhook",
          requestId,
          error: error.message
        });
        isValid = false;
      }
      
      const verificationDuration = Date.now() - verificationStartTime;
      
      // Log the verification result
      logger.info("Webhook signature verification result", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        isValid,
        verificationDuration
      });

      // Log verification metrics
      logger.metric(
        "signature_verification_duration_ms",
        verificationDuration,
        {
          component: "AuthServices",
          success: isValid,
        }
      );

      if (!isValid) {
        const duration = Date.now() - startTime;

        logger.warn("Webhook authentication failed - invalid signature", {
          component: "AuthServices",
          method: "authenticate_webhook",
          requestId,
          duration,
          verificationDuration,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("webhook_authentication_duration_ms", duration, {
          component: "AuthServices",
          success: false,
          reason: "INVALID_SIGNATURE",
        });
        logger.metric("webhook_authentication_failures_total", 1, {
          component: "AuthServices",
          reason: "INVALID_SIGNATURE",
        });

        return {
          isValid: false,
          error: {
            code: "INVALID_SIGNATURE",
            message: "Invalid webhook signature",
            requestId,
          },
        };
      }

      const duration = Date.now() - startTime;
      logger.info("Webhook authentication successful", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        duration,
        verificationDuration,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("webhook_authentication_duration_ms", duration, {
        component: "AuthServices",
        success: true,
      });
      logger.metric("successful_webhook_authentications_total", 1, {
        component: "AuthServices",
      });

      return {
        isValid: true,
        message: "Webhook authentication successful",
        requestId,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Webhook authentication error", {
        component: "AuthServices",
        method: "authenticate_webhook",
        requestId,
        duration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("webhook_authentication_duration_ms", duration, {
        component: "AuthServices",
        success: false,
        error: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("webhook_authentication_errors_total", 1, {
        component: "AuthServices",
        error: error.constructor.name,
      });

      return {
        isValid: false,
        error: {
          code: "AUTHENTICATION_ERROR",
          message: "An unexpected error occurred during webhook authentication",
          details: error.message,
          requestId,
        },
      };
    }
  }

  /**
   * Verify and get a peer RODiT
   *
   * @param {string} peerroditid - Peer RODiT ID
   * @param {number} peertimestamp - Peer timestamp
   * @param {string} peerroditid_base64url_signature - Base64URL signature
   * @returns {Promise<Object>} Verification result with peer RODiT
   */
  async function verify_peerrodit_getrodit(
    peerroditid,
    peertimestamp,
    peerroditid_base64url_signature
  ) {
    const requestId = ulid();
    const startTime = Date.now();

    // Get own_rodit from stateManager
    const own_rodit = await stateManager.getConfigOwnRodit();

    logger.debug("Starting peer RODiT verification", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit",
      requestId,
      peerRoditId: peerroditid,
      timestamp: peertimestamp,
      signatureLength: peerroditid_base64url_signature?.length,
      hasOwnRodit: !!own_rodit,
      ownRoditId: own_rodit?.token_id,
    });

    try {
      logger.debug("Fetching peer RODiT from blockchain", {
        requestId,
        peerRoditId: peerroditid,
      });

      const tokenFetchStart = Date.now();
      const peer_rodit = await nearorg_rpc_tokenfromroditid(peerroditid);
      const tokenFetchDuration = Date.now() - tokenFetchStart;

      logger.debug("Received peer RODiT from blockchain", {
        requestId,
        tokenFetchDuration,
        hasPeerRodit: !!peer_rodit,
        peerRoditId: peer_rodit?.token_id,
        peerRoditOwnerId: peer_rodit?.owner_id,
        hasPeerRoditMetadata: peer_rodit && !!peer_rodit.metadata,
        metadataKeys:
          peer_rodit && peer_rodit.metadata
            ? Object.keys(peer_rodit.metadata)
            : [],
      });

      if (!peer_rodit) {
        logger.error("Failed to retrieve peer RODiT data", {
          component: "AuthServices",
          method: "verify_peerrodit_getrodit",
          requestId,
          duration: Date.now() - startTime,
          peerRoditId: peerroditid,
        });
        return { peer_rodit: null, goodrodit: false };
      }

      if (!peer_rodit.metadata) {
        logger.error("Peer RODiT missing metadata", {
          component: "AuthServices",
          method: "verify_peerrodit_getrodit",
          requestId,
          duration: Date.now() - startTime,
          peerRoditId: peerroditid,
          peerRoditOwnerId: peer_rodit.owner_id,
        });
        return { peer_rodit: null, goodrodit: false };
      }

      // Verify ownership
      const ownershipStart = Date.now();
      const ownershipVerified = await verify_rodit_ownership(
        peerroditid,
        peertimestamp,
        peerroditid_base64url_signature,
        peer_rodit
      );
      const ownershipDuration = Date.now() - ownershipStart;

      logger.debug("Ownership verification completed", {
        requestId,
        ownershipDuration,
        ownershipVerified,
      });

      if (!ownershipVerified) {
        logger.warn("Invalid signature, aborting RODiT verification", {
          requestId,
          roditId: peerroditid,
        });
        return { peer_rodit, goodrodit: false };
      }

      // Verify match
      const matchStart = Date.now();
      const isaMatch = await verify_rodit_isamatch(
        own_rodit.own_rodit.metadata.serviceprovider_id,
        peer_rodit
      );
      const matchDuration = Date.now() - matchStart;

      logger.debug("Match verification completed", {
        requestId,
        matchDuration,
        isaMatch,
      });

      if (!isaMatch) {
        logger.warn("RODiT match verification failed", {
          requestId,
          roditId: peerroditid,
        });
        return { peer_rodit, goodrodit: false };
      }

      // Verify live
      const liveStart = Date.now();
      const isLive = await verify_rodit_islive(
        peer_rodit.metadata.not_after,
        peer_rodit.metadata.not_before
      );
      const liveDuration = Date.now() - liveStart;

      logger.debug("Live verification completed", {
        requestId,
        liveDuration,
        isLive,
      });

      if (!isLive) {
        logger.warn("RODiT live verification failed", {
          requestId,
          roditId: peerroditid,
        });
        return { peer_rodit, goodrodit: false };
      }

      // Verify active
      const activeStart = Date.now();
      const isActive = await verify_rodit_isactive(
        peer_rodit.token_id,
        own_rodit.own_rodit.metadata.subjectuniqueidentifier_url
      );
      const activeDuration = Date.now() - activeStart;

      logger.debug("Active verification completed", {
        requestId,
        activeDuration,
        isActive,
      });

      if (!isActive) {
        logger.warn("RODiT active verification failed", {
          requestId,
          roditId: peerroditid,
        });
        return { peer_rodit, goodrodit: false };
      }

      // Verify trusted
      const trustedStart = Date.now();
      const isTrusted = await verify_rodit_istrusted_issuingsmartcontract(
        own_rodit.own_rodit.metadata.subjectuniqueidentifier_url
      );
      const trustedDuration = Date.now() - trustedStart;

      logger.debug("Trust verification completed", {
        requestId,
        trustedDuration,
        isTrusted,
      });

      if (!isTrusted) {
        logger.warn("RODiT trusted verification failed", {
          requestId,
          roditId: peerroditid,
        });
        return { peer_rodit, goodrodit: false };
      }

      const totalDuration = Date.now() - startTime;

      logger.info("Peer RODiT verification successful", {
        component: "AuthServices",
        method: "verify_peerrodit_getrodit",
        requestId,
        duration: totalDuration,
        peerRoditId: peerroditid,
        peerOwnerId: peer_rodit.owner_id,
      });

      return {
        peer_rodit,
        goodrodit: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Error in verify_peerrodit_getrodit", {
        component: "AuthServices",
        method: "verify_peerrodit_getrodit",
        requestId,
        duration,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });

      // Add metrics for verification errors
      logger.metric &&
        logger.metric("rodit_verification_errors", 1, {
          error_type: error.name || "Unknown",
        });

      return {
        peer_rodit: null,
        goodrodit: false,
        error: `Error in verify_peerrodit_getrodit: ${error.message}`,
      };
    }
  }

  async function verify_rodit_islive(peer_rodit_notafter, peer_rodit_notbefore) {
    const requestId = ulid();
    const startTime = Date.now();
  
    logger.debug("Checking RODiT time validity", {
      component: "RoditAuth",
      method: "verify_rodit_islive",
      requestId,
      notAfter: peer_rodit_notafter,
      notBefore: peer_rodit_notbefore,
    });
  
    function parseDate(datestring) {
      const date = new Date(datestring);
      return isNaN(date.getTime()) ? new Date(0) : date;
    }
  
    const datetimenul = new Date(0);
    const datetimenotafter = parseDate(peer_rodit_notafter);
    const datetimenotbefore = parseDate(peer_rodit_notbefore);
  
    logger.debug("Parsed validity dates", {
      requestId,
      parsedNotAfter: datetimenotafter.toISOString(),
      parsedNotBefore: datetimenotbefore.toISOString(),
      isNotAfterNull: datetimenotafter.getTime() === datetimenul.getTime(),
      isNotBeforeNull: datetimenotbefore.getTime() === datetimenul.getTime(),
    });
  
    try {
      const rpcStart = Date.now();
      const stringtimenow = await nearorg_rpc_timestamp();
      const rpcDuration = Date.now() - rpcStart;
  
      logger.debug("Retrieved blockchain timestamp", {
        requestId,
        rpcDuration,
        blockchainTimestamp: stringtimenow,
      });
  
      const timestamp = parseInt(stringtimenow, 10);
  
      if (isNaN(timestamp)) {
        logger.error("Failed to parse blockchain timestamp", {
          component: "AuthServices",
          requestId,
          duration: Date.now() - startTime,
          blockchainTimestamp: stringtimenow,
        });
  
        // Add metrics for timestamp parsing errors
        logger.metric &&
          logger.metric("rodit_islive_errors", 1, {
            error_type: "timestamp_parse_error",
            blockchain_timestamp: stringtimenow,
          });
  
        return false;
      }
  
      const datetimetimestamp = new Date(timestamp / 1000000); // Convert nanoseconds to milliseconds
  
      logger.debug("Converted blockchain time", {
        requestId,
        blockchainTime: datetimetimestamp.toISOString(),
        originalTimestamp: timestamp,
      });
  
      const isAfterNotBefore =
        datetimetimestamp >= datetimenotbefore ||
        datetimenotbefore.getTime() === datetimenul.getTime();
  
      const isBeforeNotAfter =
        datetimetimestamp <= datetimenotafter ||
        datetimenotafter.getTime() === datetimenul.getTime();
  
      const isLive = isAfterNotBefore && isBeforeNotAfter;
  
      const totalDuration = Date.now() - startTime;
  
      if (isLive) {
        logger.info("RODiT is live", {
          component: "AuthServices",
          method: "verify_rodit_islive",
          requestId,
          duration: totalDuration,
          rpcDuration,
          currentTime: datetimetimestamp.toISOString(),
          notBefore: datetimenotbefore.toISOString(),
          notAfter: datetimenotafter.toISOString(),
          isLive: true,
        });
  
        // Add metrics for live tokens
        logger.metric &&
          logger.metric("rodit_time_checks", totalDuration, {
            result: "live",
          });
  
        return true;
      } else {
        logger.warn("RODiT is not live - outside valid time period", {
          component: "AuthServices",
          method: "verify_rodit_islive",
          requestId,
          duration: totalDuration,
          rpcDuration,
          currentTime: datetimetimestamp.toISOString(),
          notBefore: datetimenotbefore.toISOString(),
          notAfter: datetimenotafter.toISOString(),
          isBeforeExpiry: isBeforeNotAfter,
          isAfterStart: isAfterNotBefore,
          isLive: false,
        });
  
        // Add metrics for expired or not-yet-valid tokens
        logger.metric &&
          logger.metric("rodit_time_checks", totalDuration, {
            result: "not_live",
            not_before_valid: isAfterNotBefore,
            not_after_valid: isBeforeNotAfter,
          });
  
        return false;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
  
      logger.error("Failed to check RODiT time validity", {
        component: "AuthServices",
        method: "verify_rodit_islive",
        requestId,
        duration,
        notAfter: peer_rodit_notafter,
        notBefore: peer_rodit_notbefore,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });
  
      // Add metrics for validation errors
      logger.metric &&
        logger.metric("rodit_islive_errors", 1, {
          error_type: error.name || "Unknown",
        });
  
      return false;
    }
  }

  async function verify_rodit_isactive(tokenId, ownsubjectuniqueidentifier_url) {
    const requestId = ulid();
    const startTime = Date.now();
  
    // WHILE DEBUGGING TEMPORARY FIX DO NOT REMOVE THIS LINE EVER WITHOUT PERMISSION
    return true;
  
    logger.debug("Checking RODiT activity status", {
      component: "RoditAuth",
      method: "verify_rodit_isactive",
      requestId,
      tokenId,
      subjectUrl: ownsubjectuniqueidentifier_url,
    });
  
    const domainandextensionRegex =
      /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/i;
  
    const match = ownsubjectuniqueidentifier_url.match(domainandextensionRegex);
  
    if (match) {
      const domainandextension = match[1];
      const revokingDnsEntry = `${tokenId}.revoked.${domainandextension}`;
  
      logger.debug("Checking DNS revocation entry", {
        requestId,
        domain: domainandextension,
        revokingDnsEntry,
      });
  
      try {
        const dnsStart = Date.now();
        const resolver = new Resolver();
        await resolver.resolveTxt(revokingDnsEntry);
        const dnsDuration = Date.now() - dnsStart;
        const totalDuration = Date.now() - startTime;
  
        logger.info("RODiT revocation found", {
          component: "AuthServices",
          method: "verify_rodit_isactive",
          requestId,
          duration: totalDuration,
          dnsDuration,
          tokenId,
          domain: domainandextension,
          revokingDnsEntry,
          isActive: false,
        });
  
        // Add metrics for revoked tokens
        logger.metric &&
          logger.metric("rodit_revocation_checks", totalDuration, {
            result: "revoked",
            token_id: tokenId,
          });
  
        return false;
      } catch (error) {
        // DNS error usually means no revocation entry found, which is good
        const dnsDuration = Date.now() - dnsStart || 0;
        const totalDuration = Date.now() - startTime;
  
        logger.debug("No revocation found for RODiT", {
          requestId,
          dnsDuration,
          tokenId,
          error: error.code,
        });
  
        logger.info("RODiT is active", {
          component: "AuthServices",
          method: "verify_rodit_isactive",
          requestId,
          duration: totalDuration,
          dnsDuration,
          tokenId,
          domain: domainandextension,
          isActive: true,
        });
  
        // Add metrics for active tokens
        logger.metric &&
          logger.metric("rodit_revocation_checks", totalDuration, {
            result: "active",
            token_id: tokenId,
          });
  
        return true;
      }
    } else {
      const duration = Date.now() - startTime;
  
      logger.warn("Unable to parse domain from URL", {
        component: "AuthServices",
        method: "verify_rodit_isactive",
        requestId,
        duration,
        tokenId,
        subjectUrl: ownsubjectuniqueidentifier_url,
      });
  
      // Add metrics for parsing errors
      logger.metric &&
        logger.metric("rodit_revocation_checks", duration, {
          result: "parse_error",
          token_id: tokenId,
        });
  
      // Default to allowing the token if domain parsing fails
      return true;
    }
  }

  async function verify_rodit_istrusted_issuingsmartcontract(
    ownsubjectuniqueidentifier_url
  ) {
    const requestId = ulid();
    const startTime = Date.now();
  
    logger.debug("Verifying smart contract trust", {
      component: "RoditAuth",
      method: "verify_rodit_istrusted_issuingsmartcontract",
      requestId,
      url: ownsubjectuniqueidentifier_url,
      smartContract: CONSTANTS.SMART_CONTRACT,
    });
  
    try {
      const smartcontract = CONSTANTS.SMART_CONTRACT;
      const smartontractnonear = smartcontract.replace(".testnet", "");
      const smartcontracturl = smartontractnonear.replace("-", ".");
  
      logger.debug("Prepared smart contract identifiers", {
        requestId,
        originalContract: smartcontract,
        nonearContract: smartontractnonear,
        urlContract: smartcontracturl,
      });
  
      const domainRegex =
        /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/i;
  
      const maindomainmatch = domainRegex.exec(ownsubjectuniqueidentifier_url);
  
      if (!maindomainmatch) {
        logger.error("Failed to parse domain from URL", {
          component: "AuthServices",
          requestId,
          duration: Date.now() - startTime,
          url: ownsubjectuniqueidentifier_url,
        });
  
        // Add metrics for domain parsing failures
        logger.metric &&
          logger.metric("rodit_trust_errors", 1, {
            error_type: "domain_parse_error",
            url: ownsubjectuniqueidentifier_url,
          });
  
        throw new Error(
          `Domain can't be parsed from URL: ${ownsubjectuniqueidentifier_url}`
        );
      }
  
      const extractedDomain = maindomainmatch[1];
      const enablingdnsentry = `${smartontractnonear}.smartcontract.${extractedDomain}`;
  
      logger.debug("Checking DNS trust entry", {
        requestId,
        extractedDomain,
        enablingDnsEntry: enablingdnsentry,
      });
  
      try {
        const dnsStart = Date.now();
        const resolver = new Resolver();
        const cfgresponse = await resolver.resolveTxt(enablingdnsentry);
        const dnsDuration = Date.now() - dnsStart;
  
        logger.debug("DNS response received", {
          requestId,
          dnsDuration,
          recordCount: cfgresponse?.length || 0,
        });
  
        if (cfgresponse.length > 0) {
          const totalDuration = Date.now() - startTime;
  
          logger.info("Smart contract is trusted", {
            component: "AuthServices",
            method: "verify_rodit_istrusted_issuingsmartcontract",
            requestId,
            duration: totalDuration,
            dnsDuration,
            smartContract: smartcontracturl,
            domain: extractedDomain,
            dnsEntry: enablingdnsentry,
            recordCount: cfgresponse.length,
            isTrusted: true,
          });
  
          // Add metrics for trusted contracts
          logger.metric &&
            logger.metric("rodit_trust_checks", totalDuration, {
              result: "trusted",
              domain: extractedDomain,
            });
  
          return true;
        } else {
          const totalDuration = Date.now() - startTime;
  
          logger.warn("Smart contract not trusted - empty DNS record", {
            component: "AuthServices",
            method: "verify_rodit_istrusted_issuingsmartcontract",
            requestId,
            duration: totalDuration,
            dnsDuration,
            smartContract: smartcontracturl,
            domain: extractedDomain,
            dnsEntry: enablingdnsentry,
            isTrusted: false,
          });
  
          // Add metrics for untrusted contracts
          logger.metric &&
            logger.metric("rodit_trust_checks", totalDuration, {
              result: "empty_dns",
              domain: extractedDomain,
            });
  
          return false;
        }
      } catch (error) {
        const totalDuration = Date.now() - startTime;
  
        logger.warn("Smart contract not trusted - DNS lookup failed", {
          component: "AuthServices",
          method: "verify_rodit_istrusted_issuingsmartcontract",
          requestId,
          duration: totalDuration,
          smartContract: smartcontracturl,
          domain: extractedDomain,
          dnsEntry: enablingdnsentry,
          dnsError: error.code,
          isTrusted: false,
        });
  
        // Add metrics for DNS errors
        logger.metric &&
          logger.metric("rodit_trust_checks", totalDuration, {
            result: "dns_error",
            domain: extractedDomain,
            error_code: error.code,
          });
  
        return false;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
  
      logger.error("Trust verification failed", {
        component: "AuthServices",
        method: "verify_rodit_istrusted_issuingsmartcontract",
        requestId,
        duration,
        url: ownsubjectuniqueidentifier_url,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });
  
      // Add metrics for verification errors
      logger.metric &&
        logger.metric("rodit_trust_errors", 1, {
          error_type: error.name || "Unknown",
          message: error.message,
        });
  
      return false;
    }
  }

  async function verify_rodit_isamatch(own_service_provider_id, peer_rodit) {
    const requestId = ulid();
    const startTime = Date.now();
  
    logger.debug("Starting RODiT match verification", {
      component: "RoditAuth",
      method: "verify_rodit_isamatch",
      requestId,
      ownServiceProviderId: own_service_provider_id,
      peerRoditId: peer_rodit?.token_id,
    });
  
    try {
      const own_provider_components = own_service_provider_id.split(";");
  
      logger.debug("Split provider components", {
        requestId,
        componentCount: own_provider_components.length,
        components: own_provider_components,
      });
  
      // Get blockchain and contract parts
      const bcPart = own_provider_components.find((part) =>
        part.startsWith("bc=")
      );
      const scPart = own_provider_components.find((part) =>
        part.startsWith("sc=")
      );
  
      // Find all ID components
      const idComponents = own_provider_components.filter(
        (part) =>
          part.startsWith("id=") &&
          !part.startsWith("bc=") &&
          !part.startsWith("sc=")
      );
  
      if (!bcPart || !scPart || idComponents.length < 1) {
        logger.error("Invalid provider ID format", {
          component: "AuthServices",
          requestId,
          duration: Date.now() - startTime,
          providerId: own_service_provider_id,
          components: own_provider_components,
          hasBlockchain: !!bcPart,
          hasSmartContract: !!scPart,
          idCount: idComponents.length,
        });
  
        // Add metrics for format errors
        logger.metric &&
          logger.metric("rodit_match_format_errors", 1, {
            error_type: "invalid_provider_id",
            bc_part_present: !!bcPart,
            sc_part_present: !!scPart,
            id_count: idComponents.length,
          });
  
        return false;
      }
  
      // Construct the base prefix
      const base_prefix = `${bcPart};${scPart}`;
      logger.debug("Constructed base prefix", {
        requestId,
        basePrefix: base_prefix,
      });
  
      // Try verification with each ID component
      for (let i = 0; i < idComponents.length; i++) {
        const idIndex = i + 1;
        const signing_token_id = `${base_prefix};${idComponents[i]}`;
  
        logger.debug(
          `Trying verification with ID [${idIndex}/${idComponents.length}]`,
          {
            requestId,
            idIndex,
            totalIds: idComponents.length,
            signingTokenId: signing_token_id,
          }
        );
  
        const tokenFetchStart = Date.now();
        const signing_rodit = await nearorg_rpc_tokenfromroditid(
          signing_token_id
        );
        const tokenFetchDuration = Date.now() - tokenFetchStart;
  
        logger.debug("Retrieved signing RODiT", {
          requestId,
          idIndex,
          tokenFetchDuration,
          tokenId: signing_rodit?.token_id,
          ownerId: signing_rodit?.owner_id,
        });
  
        // Process the owner ID
        try {
          const bytes_signing_owner_id = new Uint8Array(
            Buffer.from(signing_rodit.owner_id, "hex")
          );
  
          if (bytes_signing_owner_id.length !== CONSTANTS.RODIT_ID_PK_SZ) {
            logger.warn(`Invalid signing key length for ID ${idIndex}`, {
              requestId,
              actual: bytes_signing_owner_id.length,
              expected: CONSTANTS.RODIT_ID_PK_SZ,
            });
            continue; // Try the next ID
          }
  
          // Process the signature
          const base64urlSignature =
            peer_rodit.metadata.serviceprovider_signature;
          const base64Signature = base64urlSignature
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(
              base64urlSignature.length +
                ((4 - (base64urlSignature.length % 4)) % 4),
              "="
            );
  
          const signatureBytes = new Uint8Array(
            Buffer.from(base64Signature, "base64")
          );
  
          if (signatureBytes.length !== CONSTANTS.RODIT_ID_SIGNATURE_SZ) {
            logger.warn(`Invalid signature length for ID ${idIndex}`, {
              requestId,
              actual: signatureBytes.length,
              expected: CONSTANTS.RODIT_ID_SIGNATURE_SZ,
            });
            continue; // Try the next ID
          }
  
          // Prepare the hash input
          const hashInput = {
            token_id: peer_rodit.token_id,
            openapijson_url: peer_rodit.metadata.openapijson_url,
            not_after: peer_rodit.metadata.not_after,
            not_before: peer_rodit.metadata.not_before,
            max_requests: peer_rodit.metadata.max_requests,
            maxrq_window: peer_rodit.metadata.maxrq_window,
            webhook_cidr: peer_rodit.metadata.webhook_cidr,
            allowed_cidr: peer_rodit.metadata.allowed_cidr,
            allowed_iso3166list: peer_rodit.metadata.allowed_iso3166list,
            jwt_duration: peer_rodit.metadata.jwt_duration,
            permissioned_routes: peer_rodit.metadata.permissioned_routes,
            serviceprovider_id: peer_rodit.metadata.serviceprovider_id,
            subjectuniqueidentifier_url:
              peer_rodit.metadata.subjectuniqueidentifier_url,
          };
  
          const hashStart = Date.now();
          const hashHex = calculateCanonicalHash(hashInput);
          const hashBytes = new Uint8Array(Buffer.from(hashHex, "hex"));
          const hashDuration = Date.now() - hashStart;
  
          logger.debug("Calculated hash for verification", {
            requestId,
            idIndex,
            hashDuration,
            hashLength: hashBytes.length,
          });
  
          // Verify the signature
          const verifyStart = Date.now();
          const is_valid = nacl.sign.detached.verify(
            hashBytes,
            signatureBytes,
            bytes_signing_owner_id
          );
          const verifyDuration = Date.now() - verifyStart;
  
          logger.debug("Signature verification result", {
            requestId,
            idIndex,
            verifyDuration,
            isValid: is_valid,
          });
  
          if (is_valid) {
            const totalDuration = Date.now() - startTime;
  
            // Log based on which ID worked
            if (i === 0) {
              logger.info("Partner login verified successfully", {
                component: "AuthServices",
                method: "verify_rodit_isamatch",
                requestId,
                duration: totalDuration,
                partnerVerification: true,
                idIndex,
              });
            } else {
              logger.info("Peer login verified successfully", {
                component: "AuthServices",
                method: "verify_rodit_isamatch",
                requestId,
                duration: totalDuration,
                peerVerification: true,
                idIndex,
              });
            }
  
            // Add metrics for successful matching
            logger.metric &&
              logger.metric("rodit_match_verification", totalDuration, {
                result: "success",
                id_index: idIndex,
                verification_type: i === 0 ? "partner" : "peer",
              });
  
            return true;
          }
  
          logger.debug(`Verification with ID ${idIndex} failed`, {
            requestId,
          });
        } catch (verifyError) {
          logger.warn(`Error during verification with ID ${idIndex}`, {
            requestId,
            error: verifyError.message,
            stack: verifyError.stack,
          });
        }
      }
  
      // If we get here, all verification attempts failed
      const totalDuration = Date.now() - startTime;
  
      logger.error("All verification attempts failed", {
        component: "AuthServices",
        method: "verify_rodit_isamatch",
        requestId,
        duration: totalDuration,
        ownServiceProviderId: own_service_provider_id,
        peerRoditId: peer_rodit?.token_id,
        attemptCount: idComponents.length,
      });
  
      // Add metrics for failed matching
      logger.metric &&
        logger.metric("rodit_match_verification", totalDuration, {
          result: "failure",
          attempts: idComponents.length,
        });
  
      return false;
    } catch (error) {
      const duration = Date.now() - startTime;
  
      logger.error("RODiT match verification failed", {
        component: "AuthServices",
        method: "verify_rodit_isamatch",
        requestId,
        duration,
        ownServiceProviderId: own_service_provider_id,
        peerRoditId: peer_rodit?.token_id,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });
  
      // Add metrics for verification errors
      logger.metric &&
        logger.metric("rodit_match_errors", 1, {
          error_type: error.name || "Unknown",
        });
  
      return false;
    }
  }

// Export the functions directly (following the pattern used in tokenservice.js)
/**
 * Helper function to log events locally (migrated from cruda.js)
 * @param {string} event - Event name
 * @param {Object} data - Event data
 * @param {boolean} isError - Whether this is an error event
 */
function logEvent(event, data, isError = false) {
  try {
    // Simple logging of events to console/log system
    const logLevel = isError ? "error" : "info";
    const logMethod = logger[logLevel] || logger.info;
    
    logMethod(`Event: ${event}`, {
      component: "EventLogger",
      event,
      isError,
      dataType: typeof data,
      dataKeys: typeof data === 'object' && data !== null ? Object.keys(data) : null
    });
  } catch (error) {
    logger.error("Error logging event", {
      component: "EventLogger",
      error: error.message,
      event
    });
  }
}

module.exports = {
  verify_rodit_ownership,
  verify_rodit_ownership_withnep413,
  verify_peerrodit_getrodit,
  verify_rodit_isactive,
  verify_rodit_isamatch,
  verify_rodit_islive,
  verify_rodit_istrusted_issuingsmartcontract,
  authenticate_webhook,
  send_webhook,
  logEvent
};