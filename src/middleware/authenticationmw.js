/**
 * Authentication middleware for web API
 * Copyright (c) 2024 Cableguard, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
const logger = require("../../config/logger");
const nacl = require("tweetnacl");
const { decodeJwt } = require("jose");
// Import specific functions directly to avoid circular dependencies
const { 
  validate_jwt_token_be,
  generate_jwt_token,
  tokenService
} = require("../auth/tokenservice");
const { 
  send_webhook,
  verify_peerrodit_getrodit,
  verify_peerrodit_getrodit_withnep413,
} = require("../auth/authentication");
const { 
  nearorg_rpc_tokenfromroditid
} = require("../blockchain/blockchainservice");
// Direct import from statemanager to avoid circular dependencies
const stateManager = require("../blockchain/statemanager");
const { unixTimeToDateString } = require("../utils");
const sessionManager = require("../auth/sessionmanager");

/**
 * Middleware for handling authentication in routes
 */

/**
 * Authenticates a client using RODiT credentials and generates a JWT token
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - JSON response with token or error
 */
async function login_client(req, res) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.info("Client login request received", {
    component: "RoditAuth",
    method: "login_client",
    requestId,
  });

  try {
    // Extract parameters from request body
    const peer_roditid = req.body.roditid;
    const peer_timestamp = req.body.timestamp || Math.floor(Date.now() / 1000);
    
    // Handle both signature parameter names for backward compatibility
    // This aligns with the memory about supporting both parameter names
    let roditid_base64url_signature = req.body.roditid_base64url_signature;
    if (!roditid_base64url_signature && req.body.signature) {
      roditid_base64url_signature = req.body.signature;
      logger.info("Using legacy 'signature' parameter instead of 'roditid_base64url_signature'", {
        component: "RoditAuth",
        method: "login_client",
        requestId
      });
    }

    // Validate required parameters
    if (!peer_roditid) {
      const duration = Date.now() - startTime;
      
      logger.warn("Missing RODiT ID in login request", {
        component: "RoditAuth",
        method: "login_client",
        requestId,
        duration,
        bodyKeys: Object.keys(req.body)
      });
      
      // Emit metrics for Grafana dashboards
      logger.metric("login_attempt_duration_ms", duration, {
        component: "RoditAuth",
        success: false,
        error: "MISSING_RODIT_ID"
      });
      logger.metric("failed_login_attempts_total", 1, {
        component: "RoditAuth",
        reason: "MISSING_RODIT_ID"
      });
      
      return res.status(400).json({
        error: "Missing RODiT ID",
        requestId
      });
    }
    
    if (!roditid_base64url_signature) {
      const duration = Date.now() - startTime;
      
      logger.warn("Missing signature in login request", {
        component: "RoditAuth",
        method: "login_client",
        requestId,
        duration,
        bodyKeys: Object.keys(req.body)
      });
      
      // Emit metrics for Grafana dashboards
      logger.metric("login_attempt_duration_ms", duration, {
        component: "RoditAuth",
        success: false,
        error: "MISSING_SIGNATURE"
      });
      logger.metric("failed_login_attempts_total", 1, {
        component: "RoditAuth",
        reason: "MISSING_SIGNATURE"
      });
      
      return res.status(400).json({
        error: "Missing signature",
        requestId
      });
    }

    logger.debug("Login parameters extracted", {
      component: "RoditAuth",
      method: "login_client",
      requestId,
      hasRoditId: !!peer_roditid,
      hasTimestamp: !!peer_timestamp,
      hasSignature: !!roditid_base64url_signature,
      signatureLength: roditid_base64url_signature?.length
    });

    logger.debug("Retrieving server configuration", {
      component: "RoditAuth",
      method: "login_client",
      requestId,
    });

    // Import stateManager only when needed to avoid circular dependencies
    const stateManager = require("../blockchain/statemanager");
    const config_own_rodit = await stateManager.getConfigOwnRodit();

    if (!config_own_rodit) {
      const duration = Date.now() - startTime;

      logger.error("Server configuration not initialized", {
        component: "RoditAuth",
        method: "login_client",
        requestId,
        duration,
        errorCode: "CONFIG_NOT_INITIALIZED",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_attempt_duration_ms", duration, {
        component: "RoditAuth",
        success: false,
        error: "CONFIG_NOT_INITIALIZED",
      });
      logger.metric("failed_login_attempts_total", 1, {
        component: "RoditAuth",
        reason: "CONFIG_NOT_INITIALIZED",
      });

      throw new Error("Error 0112: Server configuration not initialized");
    }

    logger.debug("Verifying peer RODiT credentials", {
      component: "RoditAuth",
      method: "login_client",
      requestId,
      roditId: peer_roditid,
    });

    // Call verify_peerrodit_getrodit with direct parameters
    const result = await verify_peerrodit_getrodit(
      peer_roditid,
      peer_timestamp,
      roditid_base64url_signature
    );
    const { peer_rodit, goodrodit: isRoditValid } = result;

    if (!isRoditValid) {
      const duration = Date.now() - startTime;

      logger.warn("Invalid RODiT credentials", {
        component: "RoditAuth",
        method: "login_client",
        requestId,
        duration,
        roditId: peer_roditid,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_attempt_duration_ms", duration, {
        component: "RoditAuth",
        success: false,
        error: "INVALID_CREDENTIALS",
      });
      logger.metric("failed_login_attempts_total", 1, {
        component: "RoditAuth",
        reason: "INVALID_CREDENTIALS",
      });

      return res.status(401).json({
        message:
          "Error 102: Login attempt failed: Invalid RODiT ID or Signature",
        requestId,
      });
    }

    logger.debug("Generating JWT token", {
      component: "RoditAuth",
      method: "login_client",
      requestId,
      roditId: peer_rodit.token_id,
    });

    const token = await generate_jwt_token(
      peer_rodit,
      peer_timestamp,
      config_own_rodit.own_rodit,
      config_own_rodit.own_rodit_bytes_private_key
    );

    const duration = Date.now() - startTime;
    logger.info("Login successful", {
      component: "RoditAuth",
      method: "login_client",
      requestId,
      duration,
      roditId: peer_rodit.token_id,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("login_attempt_duration_ms", duration, {
      component: "RoditAuth",
      success: true,
    });
    logger.metric("successful_logins_total", 1, {
      component: "RoditAuth",
    });

    // Set the token in the response header
    res.setHeader('New-Token', token);

    return res.json({
      token,
      requestId,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Login authentication failed", {
      component: "RoditAuth",
      method: "login_client",
      requestId,
      duration,
      errorMessage: error.message,
      errorCode: error.code || "UNKNOWN_ERROR",
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("login_attempt_duration_ms", duration, {
      component: "RoditAuth",
      success: false,
      error: error.code || "UNKNOWN_ERROR",
    });
    logger.metric("failed_login_attempts_total", 1, {
      component: "RoditAuth",
      reason: error.code || "UNKNOWN_ERROR",
    });

    return res.status(401).json({
      message: `Error 105: Login attempt failed: ${error.message}`,
      requestId,
    });
  }
}


  /**
   * Extract token from authorization header
   *
   * @param {string} authHeader - Authorization header
   * @returns {string|null} Extracted token or null
   */
  function extractTokenFromHeader(authHeader) {
    const startTime = Date.now();
    const requestId = ulid();

    logger.debug("Extracting token from authorization header", {
      component: "TokenExtractor",
      method: "extractTokenFromHeader",
      requestId,
      hasAuthHeader: !!authHeader,
    });

    if (!authHeader) {
      logger.debug("No authorization header present", {
        component: "TokenExtractor",
        method: "extractTokenFromHeader",
        requestId,
      });
      return null;
    }

    const [bearer, token] = authHeader.split(" ");

    if (bearer.toLowerCase() !== "bearer" || !token) {
      logger.debug("Invalid authorization header format", {
        component: "TokenExtractor",
        method: "extractTokenFromHeader",
        requestId,
        headerFormat: authHeader,
      });
      return null;
    }

    logger.debug("Successfully extracted token from header", {
      component: "TokenExtractor",
      method: "extractTokenFromHeader",
      requestId,
      tokenLength: token.length,
      duration: Date.now() - startTime,
    });

    return token;
  }

  /**
   * Middleware to authenticate API calls
   *
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Next middleware function
   */
  async function authenticate_apicall(req, res, next) {
    const startTime = Date.now();
    const requestId = ulid();
    const token = extractTokenFromHeader(req.headers.authorization);

    logger.info("API authentication started", {
      component: "AuthMiddleware",
      method: "authenticate_apicall",
      requestId,
      hasToken: !!token,
      path: req.path,
      method: req.method,
    });

    try {
      if (!token) {
        logger.warn("No token provided in request", {
          component: "AuthMiddleware",
          method: "authenticate_apicall",
          requestId,
          headers: req.headers,
        });
        return res.status(401).json({
          error: {
            code: "MISSING_TOKEN",
            message: "No token provided",
            requestId,
          },
        });
      }
      
      // Check if token has been invalidated
      if (sessionManager.isTokenInvalidated(token)) {
        const invalidationInfo = sessionManager.getTokenInvalidationInfo(token);
        
        logger.warn("Attempt to use invalidated token", {
          component: "AuthMiddleware",
          method: "authenticate_apicall",
          requestId,
          invalidationInfo,
        });
        
        return res.status(401).json({
          error: {
            code: "INVALIDATED_TOKEN",
            message: "Token has been invalidated",
            reason: invalidationInfo?.reason || "user_logout",
            requestId,
          },
        });
      }

      // Get own RODiT configuration first
      const config_own_rodit = await stateManager.getConfigOwnRodit();

      if (!config_own_rodit || !config_own_rodit.own_rodit) {
        logger.error("Server configuration not initialized", {
          component: "AuthMiddleware",
          method: "authenticate_apicall",
          requestId,
          hasConfig: !!config_own_rodit,
        });
        return res.status(500).json({
          error: {
            code: "SERVER_CONFIG_ERROR",
            message: "Server configuration not initialized",
            requestId,
          },
        });
      }

      // Use the token service to validate the token WITH the own_rodit parameter
      let validationResult;
      try {
        validationResult = await validate_jwt_token_be(
          token,
          config_own_rodit.own_rodit
        );
      } catch (validationError) {
        // Handle specific validation errors
        logger.warn("Token validation failed", {
          component: "AuthMiddleware",
          method: "authenticate_apicall",
          requestId,
          error: validationError.message,
        });
        
        // Return 403 for invalid tokens
        return res.status(403).json({
          error: {
            code: "INVALID_TOKEN",
            message: validationError.message || "Invalid token",
            details: process.env.NODE_ENV === "development" ? validationError.message : undefined,
            requestId,
          },
        });
      }

      if (!validationResult.valid) {
        logger.warn("Invalid token provided", {
          component: "AuthMiddleware",
          method: "authenticate_apicall",
          requestId,
          error: validationResult.error,
        });
        // Return 403 for invalid tokens
        return res.status(403).json({
          error: {
            code: "INVALID_TOKEN",
            message: "Invalid token",
            requestId,
          },
        });
      }

      // IMPORTANT: Attach the raw payload to req.user to maintain exact compatibility
      // with digital signature verification processes
      req.user = validationResult.payload;
      
      // Store the token for potential use in the request
      req.token = token;

      // Check if a new token was generated during validation
      if (validationResult.newToken) {
        // Add the new token to the response headers ONLY (no cookies)
        res.setHeader('New-Token', validationResult.newToken);
        
        logger.debug("Added renewed token to response headers", {
          component: "AuthMiddleware",
          method: "authenticate_apicall",
          requestId,
        });
      }

      logger.info("Authentication successful", {
        component: "AuthMiddleware",
        method: "authenticate_apicall",
        requestId,
        userId: req.user.sub, // Use sub from raw payload
        duration: Date.now() - startTime,
      });

      next();
    } catch (error) {
      logger.error("Authentication error", {
        component: "AuthMiddleware",
        method: "authenticate_apicall",
        requestId,
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        error: {
          code: "AUTH_ERROR",
          message: "Authentication failed",
          details: process.env.NODE_ENV === "development" ? error.message : undefined,
          requestId,
        },
      });
    }
  }

  /**
   * Handle client logout
   *
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} Response object
   */
  async function logout_client(req, res) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.info("Logout request received", {
      component: "AuthenticationService",
      method: "logout_client",
      requestId,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    try {
      // Extract token from authorization header
      const token =
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer ")
          ? req.headers.authorization.substring(7)
          : null;

      if (!token) {
        const duration = Date.now() - startTime;

        logger.warn("Logout failed - no token provided", {
          component: "AuthenticationService",
          method: "logout_client",
          requestId,
          duration,
          ip: req.ip,
        });

        // Emit metrics for unauthorized logout attempts
        logger.metric &&
          logger.metric("logout_attempts", 1, {
            component: "AuthenticationService",
            result: "no_token",
          });

        return res.status(401).json({
          message: "No authentication token provided",
          requestId,
        });
      }

      // Decode the token to get session information
      // We're just decoding, not verifying, since even if the token is expired
      // we still want to be able to log the user out
      let decodedToken;
      try {
        // Split the token and decode the payload (middle part)
        const parts = token.split(".");
        if (parts.length !== 3) {
          throw new Error("Invalid token format");
        }

        const payload = Buffer.from(parts[1], "base64url").toString();
        decodedToken = JSON.parse(payload);

        logger.debug("Token decoded for logout", {
          component: "AuthenticationService",
          method: "logout_client",
          requestId,
          jti: decodedToken.jti,
          hasSessionId: !!decodedToken.session_id,
        });
      } catch (decodeError) {
        logger.error("Failed to decode token for logout", {
          component: "AuthenticationService",
          method: "logout_client",
          requestId,
          error: decodeError.message,
        });

        // Continue with a partial logout even if token can't be decoded
        decodedToken = {};
      }

      // Track success for metrics
      let logoutSuccess = false;
      let sessionClosed = false;
      let sessionStatus = "unknown";
      let tokenInvalidated = null;
      let finalToken = null;

      // Close the session if session_id is available
      if (decodedToken.session_id) {
        try {
          // Get the reason from request body or use default
          const reason = req.body.reason || "user_logout";

          // Always invalidate the token directly first
          tokenInvalidated = sessionManager.invalidateToken(token, reason, decodedToken.session_id);
          
          logger.info("Token invalidation result", {
            component: "AuthenticationService",
            method: "logout_client",
            requestId,
            tokenInvalidated,
            tokenLength: token.length
          });

          // Then close the session
          sessionClosed = sessionManager.closeSession(
            decodedToken.session_id,
            reason,
            null // Don't pass token here since we've already invalidated it
          );
          
          logger.info("Session closure result", {
            component: "AuthenticationService",
            method: "logout_client",
            requestId,
            sessionClosed
          });
          
          // Update tracking variables for metrics and response
          logoutSuccess = tokenInvalidated || sessionClosed;
          
          // Determine the overall session status
          if (tokenInvalidated && sessionClosed) {
            sessionStatus = "closed_complete";
          } else if (tokenInvalidated) {
            sessionStatus = "closed_token_only";
          } else if (sessionClosed) {
            sessionStatus = "closed_session_only";
          } else {
            sessionStatus = "close_failed";
          }
          
          // Generate a final token with session_status="closed"
          try {
            // Import the tokenservice dynamically to avoid circular dependencies
            const tokenService = require('../auth/tokenservice');
            
            // Generate a final token with very short expiration (1 minute)
            // This token is just for status communication, not for authentication
            finalToken = await tokenService.generate_jwt_token_fromtoken(
              decodedToken,
              60, // 1 minute duration
              new Date(Date.now() + 60000).toISOString(), // notafter
              Math.floor(Date.now() / 1000), // current timestamp
              "closed" // session status indicating this is a closed session
            );
            
            logger.info("Generated final token with closed status", {
              component: "AuthenticationService",
              method: "logout_client",
              requestId,
              hasToken: !!finalToken
            });
          } catch (tokenError) {
            logger.error("Failed to generate final token", {
              component: "AuthenticationService",
              method: "logout_client",
              requestId,
              error: tokenError.message,
              stack: tokenError.stack
            });
          }
        } catch (sessionError) {
          logger.error("Error closing session", {
            component: "AuthenticationService",
            method: "logout_client",
            requestId,
            sessionId: decodedToken.session_id,
            error: sessionError.message,
          });

          // Continue with logout process even if session closing fails
        }
      } else {
        logger.warn("Logout with token that has no session ID", {
          component: "AuthenticationService",
          method: "logout_client",
          requestId,
          jti: decodedToken.jti || "unknown",
        });

        // We still consider this a success since there's no session to log out from
        logoutSuccess = true;
      }

      // Clear auth headers if they exist
      res.removeHeader("Authorization");
      
      // Set the final token in the response header if available
      if (finalToken) {
        res.set("New-Token", finalToken);
      }

      // Send webhook notification for logout if configured
      try {
        const webhookData = {
          event: "user.logout",
          session_id: decodedToken.session_id,
          token_jti: decodedToken.jti,
          timestamp: Math.floor(Date.now() / 1000),
        };

        // Send webhook non-blocking
        send_webhook("user.logout", webhookData, false, req).catch(
          (webhookError) => {
            logger.error("Failed to send logout webhook", {
              component: "AuthenticationService",
              method: "logout_client",
              requestId,
              error: webhookError.message,
            });
          }
        );
      } catch (webhookError) {
        // Log but continue, webhook failure shouldn't affect logout
        logger.error("Error preparing logout webhook", {
          component: "AuthenticationService",
          method: "logout_client",
          requestId,
          error: webhookError.message,
        });
      }

      const duration = Date.now() - startTime;
      logger.info("Logout completed", {
        component: "AuthenticationService",
        method: "logout_client",
        requestId,
        duration,
        success: logoutSuccess,
        sessionClosed,
        hasSessionId: !!decodedToken.session_id,
      });

      // Emit metrics for logout
      logger.metric &&
        logger.metric("logout_duration_ms", duration, {
          component: "AuthenticationService",
          success: logoutSuccess,
          session_closed: sessionClosed,
          session_status: sessionStatus
        });

      logger.metric &&
        logger.metric("logout_attempts", 1, {
          component: "AuthenticationService",
          result: logoutSuccess ? "success" : "failure",
          session_closed: sessionClosed,
          session_status: sessionStatus
        });

      return res.json({
        message: "Logout successful",
        sessionClosed,
        sessionStatus,
        tokenInvalidated,
        requestId,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Logout process failed", {
        component: "AuthenticationService",
        method: "logout_client",
        requestId,
        duration,
        error: error.message,
        stack: error.stack,
      });

      // Emit metrics for logout errors
      logger.metric &&
        logger.metric("logout_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: error.constructor.name,
        });

      logger.metric &&
        logger.metric("logout_errors", 1, {
          component: "AuthenticationService",
          error: error.constructor.name,
        });

      return res.status(500).json({
        message: "Internal server error during logout",
        error: error.message,
        requestId,
      });
    }
  }

  /**
   * Handle client login with NEP-413 standard
   *
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Object} config_own_rodit - Own RODiT configuration
   * @returns {Object} Response with JWT token or error
   */
 async function login_client_withnep413(req, res, config_own_rodit = null) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.info("NEP-413 login request received", {
      component: "AuthenticationService",
      method: "login_client_withnep413",
      requestId,
    });

    try {
      const { signature, message, nonce, recipient, callbackUrl } = req.body;

      logger.debug("Received NEP-413 login parameters", {
        component: "AuthenticationService",
        method: "login_client_withnep413",
        requestId,
        message,
        recipient,
        hasSignature: !!signature,
        hasNonce: !!nonce,
        hasCallbackUrl: !!callbackUrl,
      });

      if (!config_own_rodit) {
        const duration = Date.now() - startTime;

        logger.error("Server configuration not initialized for NEP-413 login", {
          component: "AuthenticationService",
          method: "login_client_withnep413",
          requestId,
          duration,
          errorCode: "CONFIG_NOT_INITIALIZED",
        });

        // Emit metrics for Grafana dashboards
        logger.metric("nep413_login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "CONFIG_NOT_INITIALIZED",
        });
        logger.metric("failed_nep413_logins_total", 1, {
          component: "AuthenticationService",
          reason: "CONFIG_NOT_INITIALIZED",
        });

        throw new Error("Error 0114: Server configuration not initialized");
      }

      logger.debug("Verifying NEP-413 RODiT credentials", {
        component: "AuthenticationService",
        method: "login_client_withnep413",
        requestId,
        message,
      });

      const { peer_rodit, goodrodit: isRoditValid } =
        await verify_peerrodit_getrodit_withnep413(
          message,
          nonce,
          recipient,
          callbackUrl,
          signature,
          config_own_rodit
        );

      if (!isRoditValid) {
        const duration = Date.now() - startTime;

        logger.warn("NEP-413 login failed - Invalid RODiT credentials", {
          component: "AuthenticationService",
          method: "login_client_withnep413",
          requestId,
          duration,
          message,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("nep413_login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "INVALID_CREDENTIALS",
        });
        logger.metric("failed_nep413_logins_total", 1, {
          component: "AuthenticationService",
          reason: "INVALID_CREDENTIALS",
        });

        return res.status(401).json({
          message:
            "Error 106: Login attempt failed: Invalid RODiT ID or Signature",
          requestId,
        });
      }

      logger.debug("Generating JWT token for validated NEP-413 login", {
        component: "AuthenticationService",
        method: "login_client_withnep413",
        requestId,
        roditId: peer_rodit.token_id,
      });

      const token = await tokenService.generate_jwt_token(
        peer_rodit,
        Math.floor(Date.now() / 1000),
        config_own_rodit.own_rodit,
        config_own_rodit.own_rodit_bytes_private_key
      );

      const duration = Date.now() - startTime;
      logger.info("NEP-413 login successful", {
        component: "AuthenticationService",
        method: "login_client_withnep413",
        requestId,
        duration,
        roditId: peer_rodit.token_id,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("nep413_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: true,
      });
      logger.metric("successful_nep413_logins_total", 1, {
        component: "AuthenticationService",
      });

      return res.json({
        token,
        requestId,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("NEP-413 login failed", {
        component: "AuthenticationService",
        method: "login_client_withnep413",
        requestId,
        duration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("nep413_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("failed_nep413_logins_total", 1, {
        component: "AuthenticationService",
        reason: error.code || "UNKNOWN_ERROR",
      });

      return res.status(500).json({
        message: `Error 175c: Login attempt failed: ${error.message}`,
        requestId,
      });
    }
  }

  /**
   * Login the server to a RODiT portal
   *
   * @param {Object} own_rodit - Own RODiT object
   * @returns {Promise<Object>} Login result
   */
 async function login_portal(own_rodit, port) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.info("Starting portal login process", {
      component: "AuthenticationService",
      method: "login_portal",
      requestId,
      roditId: own_rodit?.token_id,
    });

    try {
      // Get configuration from state manager
      const config_own_rodit = await stateManager.getConfigOwnRodit();

      logger.debug("Retrieved configuration from state manager", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        hasConfig: !!config_own_rodit,
        apiEndpoint: config_own_rodit?.apiendpoint,
      });

      if (!config_own_rodit) {
        const duration = Date.now() - startTime;

        logger.error("Client configuration not initialized", {
          component: "AuthenticationService",
          method: "login_portal",
          requestId,
          duration,
          errorCode: "CONFIG_NOT_INITIALIZED",
        });

        // Emit metrics for Grafana dashboards
        logger.metric("portal_login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "CONFIG_NOT_INITIALIZED",
        });
        logger.metric("portal_login_errors_total", 1, {
          component: "AuthenticationService",
          error: "CONFIG_NOT_INITIALIZED",
        });

        return {
          error: "Client configuration not initialized",
          requestId,
        };
      }

      // Check RODiT metadata
      if (!own_rodit.metadata || !own_rodit.metadata.serviceprovider_id) {
        const duration = Date.now() - startTime;

        logger.error("Missing serviceprovider_id in RODiT", {
          component: "AuthenticationService",
          method: "login_portal",
          requestId,
          duration,
          roditId: own_rodit?.token_id,
          hasMetadata: !!own_rodit?.metadata,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("portal_login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "MISSING_METADATA",
        });
        logger.metric("portal_login_errors_total", 1, {
          component: "AuthenticationService",
          error: "MISSING_METADATA",
        });

        return {
          error: "Missing serviceprovider_id in RODiT",
          requestId,
        };
      }

      // Use stateManager's getPortalUrl method to get API endpoint
      const serviceProviderId = own_rodit.metadata.serviceprovider_id;
      const apiendpoint = stateManager.getPortalUrl(
        serviceProviderId,
        port
      );

      logger.info("Using portal endpoint", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        apiEndpoint: apiendpoint,
      });

      // Prepare authentication data
      let roditid = own_rodit.token_id;
      const timestamp = Math.floor(Date.now() / 1000);
      const timeString = await unixTimeToDateString(timestamp);
      const roditidandtimestamp = new TextEncoder().encode(
        roditid + timeString
      );

      logger.debug("Generating authentication signature", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        roditId: roditid,
        timestamp,
      });

      // Create signature
      const own_rodit_bytes_signature = nacl.sign.detached(
        roditidandtimestamp,
        config_own_rodit.own_rodit_bytes_private_key
      );
      const roditid_base64url_signature = Buffer.from(
        own_rodit_bytes_signature
      ).toString("base64url");

      // Send login request
      const fetchUrl = `${apiendpoint}/login`;

      logger.debug("Sending login request to portal", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        endpoint: fetchUrl,
      });

      try {
        const response = await fetch(fetchUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roditid,
            timestamp,
            roditid_base64url_signature,
          }),
        });

        if (!response.ok) {
          const duration = Date.now() - startTime;

          logger.error("Portal login request failed", {
            component: "AuthenticationService",
            method: "login_portal",
            requestId,
            duration,
            status: response.status,
            statusText: response.statusText,
            endpoint: fetchUrl,
          });

          // Emit metrics for Grafana dashboards
          logger.metric("portal_login_duration_ms", duration, {
            component: "AuthenticationService",
            success: false,
            error: "HTTP_ERROR",
            status: response.status,
          });
          logger.metric("portal_login_errors_total", 1, {
            component: "AuthenticationService",
            error: "HTTP_ERROR",
            status: response.status,
          });

          throw new Error(
            `Error 040: Portal login failed with status ${response.status}`
          );
        }

        const data = await response.json();
        let jwt_token = data.token;

        logger.debug("Received JWT token from portal, validating", {
          component: "AuthenticationService",
          method: "login_portal",
          requestId,
          hasToken: !!jwt_token,
        });

        // Validate JWT token
        try {
          // First, decode the JWT without verification to get the rodit_id
          const unverifiedPayload = decodeJwt(jwt_token);
          const peerRoditId = unverifiedPayload.rodit_id;
          
          // Fetch the peer RODiT information directly from the blockchain
          const peer_rodit = await nearorg_rpc_tokenfromroditid(peerRoditId);
          
          // Now perform the full validation
          const validationResult = await validate_jwt_token_be(jwt_token, own_rodit);

          logger.debug("JWT token validation successful", {
            component: "AuthenticationService",
            method: "login_portal",
            requestId,
            peerRoditId: peer_rodit.token_id,
          });
        } catch (validationError) {
          const duration = Date.now() - startTime;

          logger.error("JWT token validation failed", {
            component: "AuthenticationService",
            method: "login_portal",
            requestId,
            duration,
            errorMessage: validationError.message,
            stack: validationError.stack,
          });

          // Emit metrics for Grafana dashboards
          logger.metric("portal_login_duration_ms", duration, {
            component: "AuthenticationService",
            success: false,
            error: "JWT_VALIDATION_FAILED",
          });
          logger.metric("portal_login_errors_total", 1, {
            component: "AuthenticationService",
            error: "JWT_VALIDATION_FAILED",
          });

          throw new Error(
            `Error 039: Portal server validation failed: ${validationError.message}`
          );
        }

        const duration = Date.now() - startTime;
        logger.info("Portal login successful", {
          component: "AuthenticationService",
          method: "login_portal",
          requestId,
          duration,
          apiEndpoint: apiendpoint,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("portal_login_duration_ms", duration, {
          component: "AuthenticationService",
          success: true,
        });
        logger.metric("successful_portal_logins_total", 1, {
          component: "AuthenticationService",
          endpoint: apiendpoint,
        });

        return {
          jwt_token,
          apiendpoint,
          requestId,
        };
      } catch (fetchError) {
        const duration = Date.now() - startTime;

        logger.error("Portal fetch operation failed", {
          component: "AuthenticationService",
          method: "login_portal",
          requestId,
          duration,
          errorMessage: fetchError.message,
          stack: fetchError.stack,
          endpoint: fetchUrl,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("portal_login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "FETCH_FAILED",
        });
        logger.metric("portal_login_errors_total", 1, {
          component: "AuthenticationService",
          error: "FETCH_FAILED",
          endpoint: fetchUrl,
        });

        throw fetchError;
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Portal login process failed", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        duration,
        errorMessage: error.message,
        stack: error.stack,
        roditId: own_rodit?.token_id,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("portal_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: error.constructor.name,
      });
      logger.metric("portal_login_errors_total", 1, {
        component: "AuthenticationService",
        error: error.constructor.name,
      });

      return {
        error: `Failed to login to portal: ${error.message}`,
        requestId,
      };
    }
  }

  /**
   * Login to server with RODiT credentials
   *
   * @param {Object} own_rodit - Own RODiT object
   * @returns {Promise<Object>} Login result
   */
 async function login_server(own_rodit) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.info("Starting login_server process", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      roditId: own_rodit?.token_id,
    });

    try {
      const config_own_rodit = await stateManager.getConfigOwnRodit();

      logger.debug("Retrieved config from state manager", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        hasConfig: !!config_own_rodit,
        apiEndpoint: config_own_rodit?.apiendpoint,
      });

      if (!config_own_rodit) {
        const duration = Date.now() - startTime;

        logger.error("Client configuration not initialized", {
          component: "AuthenticationService",
          method: "login_server",
          requestId,
          duration,
          errorCode: "CONFIG_NOT_INITIALIZED",
        });

        // Emit metrics for Grafana dashboards
        logger.metric("login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "CONFIG_NOT_INITIALIZED",
        });
        logger.metric("login_errors_total", 1, {
          component: "AuthenticationService",
          error: "CONFIG_NOT_INITIALIZED",
        });

        return { error: "Error 0111: Client configuration not initialized" };
      }

      const apiendpoint = config_own_rodit.apiendpoint;
      let roditid = own_rodit.token_id;
      const timestamp = Math.floor(Date.now() / 1000);

      logger.debug("Preparing authentication data", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        apiEndpoint: apiendpoint,
        roditId: roditid,
        timestamp,
      });

      const timeString = await unixTimeToDateString(timestamp);
      const roditidandtimestamp = new TextEncoder().encode(
        roditid + timeString
      );

      logger.debug("Generating signature", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        hasPrivateKey: !!config_own_rodit.own_rodit_bytes_private_key,
      });

      const own_rodit_bytes_signature = nacl.sign.detached(
        roditidandtimestamp,
        config_own_rodit.own_rodit_bytes_private_key
      );

      const roditid_base64url_signature = Buffer.from(
        own_rodit_bytes_signature
      ).toString("base64url");

      logger.debug("Sending login request", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        endpoint: apiendpoint + "/login",
      });

      const response = await fetch(apiendpoint + "/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roditid,
          timestamp,
          roditid_base64url_signature,
        }),
      });

      if (!response.ok) {
        const duration = Date.now() - startTime;

        logger.error("Login request failed", {
          component: "AuthenticationService",
          method: "login_server",
          requestId,
          duration,
          status: response.status,
          statusText: response.statusText,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "HTTP_ERROR",
          status: response.status,
        });
        logger.metric("login_errors_total", 1, {
          component: "AuthenticationService",
          error: "HTTP_ERROR",
          status: response.status,
        });

        throw new Error("Error 040: Login failed");
      }

      const data = await response.json();
      let jwt_token = data.token;

      logger.debug("JWT token received, starting validation", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        hasToken: !!jwt_token,
      });

      // Validate the server
      let peer_bytes_ed25519_public_key;
      try {
        // First, decode the JWT without verification to get the rodit_id
        const unverifiedPayload = decodeJwt(jwt_token);
        const peerRoditId = unverifiedPayload.rodit_id;
        
        // Fetch the peer RODiT information directly from the blockchain
        const peer_rodit = await nearorg_rpc_tokenfromroditid(peerRoditId);
        
        // Now perform the full validation
        const validationResult = await validate_jwt_token_be(
          jwt_token,
          own_rodit
        );

        logger.debug("Token validation successful", {
          component: "AuthenticationService",
          method: "login_server",
          requestId,
          peerRoditId: peer_rodit.token_id,
        });

        peer_bytes_ed25519_public_key = new Uint8Array(
          Buffer.from(peer_rodit.owner_id, "hex")
        );
      } catch (validationError) {
        const duration = Date.now() - startTime;

        logger.error("JWT validation failed", {
          component: "AuthenticationService",
          method: "login_server",
          requestId,
          duration,
          errorMessage: validationError.message,
          stack: validationError.stack,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "JWT_VALIDATION_FAILED",
        });
        logger.metric("login_errors_total", 1, {
          component: "AuthenticationService",
          error: "JWT_VALIDATION_FAILED",
        });

        throw new Error(
          `Error 039: Server validation failed: ${validationError.message}`
        );
      }

      const duration = Date.now() - startTime;
      logger.info("Login successful", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        duration,
        apiEndpoint: apiendpoint,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_duration_ms", duration, {
        component: "AuthenticationService",
        success: true,
      });
      logger.metric("successful_logins_total", 1, {
        component: "AuthenticationService",
        endpoint: apiendpoint,
      });

      return {
        jwt_token,
        apiendpoint,
        requestId,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Login failed", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        duration,
        errorMessage: error.message,
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: error.constructor.name,
      });
      logger.metric("login_errors_total", 1, {
        component: "AuthenticationService",
        error: error.constructor.name,
      });

      return {
        error: "Failed to login to server",
        requestId,
      };
    }
  }


// Export the class directly (will be instantiated in rodit.js)
module.exports = {authenticate_apicall,login_server,login_portal,login_client,login_client_withnep413};
