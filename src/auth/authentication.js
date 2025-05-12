/**
 * Authentication service for RODiT authentication
 * Copyright (c) 2024 Cableguard, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
const logger = require("../../config/logger");
const sessionManager = require("./sessionmanager");
const nacl = require("tweetnacl");
const crypto = require("crypto");

/**
 * Authentication class that provides methods for handling RODiT authentication
 */
class Authentication {
  constructor(stateManager, tokenService, blockchainService) {
    this.stateManager = stateManager;
    this.tokenService = tokenService;
    this.blockchainService = blockchainService;
  }

  /**
   * Handle client logout
   *
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} Response object
   */
  async logout_client(req, res) {
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

      // Close the session if session_id is available
      if (decodedToken.session_id) {
        try {
          // Get the reason from request body or use default
          const reason = req.body.reason || "user_logout";

          // Close the session
          sessionClosed = sessionManager.closeSession(
            decodedToken.session_id,
            reason
          );

          if (sessionClosed) {
            logger.info("Session closed successfully", {
              component: "AuthenticationService",
              method: "logout_client",
              requestId,
              sessionId: decodedToken.session_id,
              reason,
            });

            logoutSuccess = true;
          } else {
            logger.warn("Session not found or already closed", {
              component: "AuthenticationService",
              method: "logout_client",
              requestId,
              sessionId: decodedToken.session_id,
            });

            // We still consider this a success from the client perspective
            // since the session is effectively "logged out" either way
            logoutSuccess = true;
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

      // Clear auth cookies if they exist
      res.clearCookie("auth-token");

      // Send webhook notification for logout if configured
      try {
        const webhookData = {
          event: "user.logout",
          session_id: decodedToken.session_id,
          token_jti: decodedToken.jti,
          timestamp: Math.floor(Date.now() / 1000),
        };

        // Send webhook non-blocking
        this.send_webhook("user.logout", webhookData, false, req).catch(
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
        });

      logger.metric &&
        logger.metric("logout_attempts", 1, {
          component: "AuthenticationService",
          result: logoutSuccess ? "success" : "failure",
          session_closed: sessionClosed,
        });

      return res.json({
        message: "Logout successful",
        sessionClosed,
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
   * Handle client login with RODiT credentials
   *
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @returns {Object} Response with JWT token or error
   */
  async login_client(req, res) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.info("Client login request received", {
      component: "AuthenticationService",
      method: "login_client",
      requestId,
    });

    try {
      const {
        roditid: peer_roditid,
        timestamp: peer_timestamp,
        roditid_base64url_signature,
      } = req.body;

      logger.debug("Received login credentials", {
        component: "AuthenticationService",
        method: "login_client",
        requestId,
        roditId: peer_roditid,
        hasTimestamp: !!peer_timestamp,
        hasSignature: !!roditid_base64url_signature,
      });

      if (!peer_roditid || !peer_timestamp || !roditid_base64url_signature) {
        const duration = Date.now() - startTime;

        logger.warn("Missing required login parameters", {
          component: "AuthenticationService",
          method: "login_client",
          requestId,
          duration,
          missingParams: {
            roditId: !peer_roditid,
            timestamp: !peer_timestamp,
            signature: !roditid_base64url_signature,
          },
        });

        // Emit metrics for Grafana dashboards
        logger.metric("login_attempt_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "MISSING_PARAMETERS",
        });
        logger.metric("failed_login_attempts_total", 1, {
          component: "AuthenticationService",
          reason: "MISSING_PARAMETERS",
        });

        return res.status(400).json({
          message: "Error 100: Missing RODiT ID, Signature or Timestamp",
          requestId,
        });
      }

      try {
        logger.debug("Retrieving server configuration", {
          component: "AuthenticationService",
          method: "login_client",
          requestId,
        });

        const config_own_rodit = await this.stateManager.getConfigOwnRodit();

        if (!config_own_rodit) {
          const duration = Date.now() - startTime;

          logger.error("Server configuration not initialized", {
            component: "AuthenticationService",
            method: "login_client",
            requestId,
            duration,
            errorCode: "CONFIG_NOT_INITIALIZED",
          });

          // Emit metrics for Grafana dashboards
          logger.metric("login_attempt_duration_ms", duration, {
            component: "AuthenticationService",
            success: false,
            error: "CONFIG_NOT_INITIALIZED",
          });
          logger.metric("failed_login_attempts_total", 1, {
            component: "AuthenticationService",
            reason: "CONFIG_NOT_INITIALIZED",
          });

          throw new Error("Error 0112: Server configuration not initialized");
        }

        logger.debug("Verifying peer RODiT credentials", {
          component: "AuthenticationService",
          method: "login_client",
          requestId,
          roditId: peer_roditid,
        });

        const { peer_rodit, goodrodit: isRoditValid } =
          await this.verify_peerrodit_getrodit(
            peer_roditid,
            peer_timestamp,
            roditid_base64url_signature,
            config_own_rodit.own_rodit
          );

        if (!isRoditValid) {
          const duration = Date.now() - startTime;

          logger.warn("Invalid RODiT credentials", {
            component: "AuthenticationService",
            method: "login_client",
            requestId,
            duration,
            roditId: peer_roditid,
          });

          // Emit metrics for Grafana dashboards
          logger.metric("login_attempt_duration_ms", duration, {
            component: "AuthenticationService",
            success: false,
            error: "INVALID_CREDENTIALS",
          });
          logger.metric("failed_login_attempts_total", 1, {
            component: "AuthenticationService",
            reason: "INVALID_CREDENTIALS",
          });

          return res.status(401).json({
            message:
              "Error 102: Login attempt failed: Invalid RODiT ID or Signature",
            requestId,
          });
        }

        logger.debug("Generating JWT token", {
          component: "AuthenticationService",
          method: "login_client",
          requestId,
          roditId: peer_rodit.token_id,
        });

        const token = await this.tokenService.generate_jwt_token(
          peer_rodit,
          peer_timestamp,
          config_own_rodit.own_rodit,
          config_own_rodit.own_rodit_bytes_private_key
        );

        const duration = Date.now() - startTime;
        logger.info("Login successful", {
          component: "AuthenticationService",
          method: "login_client",
          requestId,
          duration,
          roditId: peer_rodit.token_id,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("login_attempt_duration_ms", duration, {
          component: "AuthenticationService",
          success: true,
        });
        logger.metric("successful_logins_total", 1, {
          component: "AuthenticationService",
        });

        return res.json({
          token,
          requestId,
        });
      } catch (error) {
        const duration = Date.now() - startTime;

        logger.error("Login authentication failed", {
          component: "AuthenticationService",
          method: "login_client",
          requestId,
          duration,
          errorMessage: error.message,
          errorCode: error.code || "UNKNOWN_ERROR",
          stack: error.stack,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("login_attempt_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: error.code || "UNKNOWN_ERROR",
        });
        logger.metric("failed_login_attempts_total", 1, {
          component: "AuthenticationService",
          reason: error.code || "UNKNOWN_ERROR",
        });

        return res.status(401).json({
          message: `Error 105: Login attempt failed: ${error.message}`,
          requestId,
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Internal server error during login", {
        component: "AuthenticationService",
        method: "login_client",
        requestId,
        duration,
        errorMessage: error.message,
        errorCode: error.code || "INTERNAL_SERVER_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_attempt_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "INTERNAL_SERVER_ERROR",
      });
      logger.metric("failed_login_attempts_total", 1, {
        component: "AuthenticationService",
        reason: "INTERNAL_SERVER_ERROR",
      });

      return res.status(500).json({
        message: "Internal server error during login",
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
  async login_client_withnep413(req, res, config_own_rodit = null) {
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
        await this.verify_peerrodit_getrodit_withnep413(
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

      const token = await this.tokenService.generate_jwt_token(
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
  async login_portal(own_rodit, port) {
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
      const config_own_rodit = await this.stateManager.getConfigOwnRodit();

      logger.debug("Retrieved configuration from state manager", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        hasConfig: !!config_own_rodit,
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
      const apiendpoint = this.stateManager.getPortalUrl(
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
          const validationResult =
            await this.tokenService.validate_jwt_token_be(jwt_token, own_rodit);
          const peer_rodit = validationResult.peer_rodit;

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
  async login_server(own_rodit) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.info("Starting login_server process", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      roditId: own_rodit?.token_id,
    });

    try {
      const config_own_rodit = await this.stateManager.getConfigOwnRodit();

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
        const validationResult = await this.tokenService.validate_jwt_token_be(
          jwt_token,
          own_rodit
        );

        // Assuming the correct property name is peer_rodit
        const peer_rodit = validationResult.peer_rodit;

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

  /**
   * Send a webhook notification
   *
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @param {boolean} isError - Whether this is an error event
   * @param {Object} req - Express request object (optional)
   * @returns {Promise<Object>} Webhook delivery result
   */
  async send_webhook(event, data, isError = false, req = null) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.debug("Starting webhook delivery", {
      component: "WebhookSender",
      method: "send_webhook",
      requestId,
      event,
      isError,
      dataSize:
        typeof data === "object" ? JSON.stringify(data).length : "unknown",
    });

    try {
      // Get the configuration from state manager
      const config_own_rodit = this.stateManager.getConfigOwnRodit();

      // Check if webhook configuration is available
      if (
        !config_own_rodit ||
        !config_own_rodit.own_rodit.metadata.webhook_url
      ) {
        const duration = Date.now() - startTime;

        logger.warn("Webhook configuration missing", {
          component: "WebhookSender",
          method: "send_webhook",
          requestId,
          duration,
          hasConfig: !!config_own_rodit,
          hasWebhookUrl: config_own_rodit
            ? !!config_own_rodit.own_rodit.metadata.webhook_url
            : false,
        });

        // Emit metrics for Grafana dashboards
        logger.metric &&
          logger.metric("webhook_delivery_duration_ms", duration, {
            component: "WebhookSender",
            success: false,
            event,
            error: "WEBHOOK_CONFIG_ERROR",
          });
        logger.metric &&
          logger.metric("webhook_delivery_failures_total", 1, {
            component: "WebhookSender",
            reason: "CONFIG_MISSING",
            event,
          });

        return {
          isValid: false,
          error: {
            code: "WEBHOOK_CONFIG_ERROR",
            message: "Webhook URL not available in Rodit configuration",
            requestId,
          },
        };
      }

      // Get the current JWT token or login to get one
      let jwt_token = this.stateManager.getJwtToken();
      if (!jwt_token) {
        // If there's no token, we need to login first
        logger.debug("No JWT token available, attempting login", {
          component: "WebhookSender",
          method: "send_webhook",
          requestId,
        });

        try {
          // Login to get a token
          const loginResult = await this.login_server(
            config_own_rodit.own_rodit
          );

          if (loginResult && loginResult.jwt_token) {
            jwt_token = loginResult.jwt_token;
            await this.stateManager.setJwtToken(jwt_token);

            logger.info("Successfully obtained JWT token for webhook", {
              component: "WebhookSender",
              method: "send_webhook",
              requestId,
            });
          } else {
            logger.error("Failed to obtain JWT token for webhook", {
              component: "WebhookSender",
              method: "send_webhook",
              requestId,
              loginResult,
            });
            throw new Error(
              "Could not obtain authentication token for webhook"
            );
          }
        } catch (loginError) {
          logger.error("Error during login for webhook token", {
            component: "WebhookSender",
            method: "send_webhook",
            requestId,
            error: loginError.message,
            stack: loginError.stack,
          });
          throw new Error(
            `Failed to authenticate for webhook: ${loginError.message}`
          );
        }
      }

      // Determine which webhook URL to use
      let webhookUrl;

      // Check if request object is available and has user JWT payload
      if (req && req.user && req.user.rodit_webhookurl) {
        // Use the webhook URL from the peer's JWT token
        webhookUrl = req.user.rodit_webhookurl;
        logger.debug("Using webhook URL from peer JWT token", {
          component: "WebhookSender",
          method: "send_webhook",
          requestId,
          webhookSource: "peer_jwt",
          webhookUrl,
        });
      } else {
        // Fallback to config
        webhookUrl = config_own_rodit.own_rodit.metadata.webhook_url;
        logger.debug("Using webhook URL from own RODiT config", {
          component: "WebhookSender",
          method: "send_webhook",
          requestId,
          webhookSource: "own_config",
          webhookUrl,
        });
      }

      // Ensure the URL has the correct format
      // First remove any existing protocol
      webhookUrl = webhookUrl.replace(/^(https?:\/\/)/, "");

      // Then add https:// protocol
      const formattedWebhookUrl = `https://${webhookUrl}/webhook`;

      logger.debug("Webhook URL details", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        rawWebhookUrl: webhookUrl,
        formattedWebhookUrl,
      });

      const timestamp = Date.now();
      const payload = JSON.stringify({
        event,
        data,
        isError,
        timestamp,
        requestId,
      });

      logger.debug("Preparing webhook payload", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        payloadSize: payload.length,
        event,
      });

      // Generate payload hash
      const sha256_ofpayload = crypto
        .createHash("sha256")
        .update(payload)
        .digest();

      logger.debug("Creating signature", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        hasPrivateKey: !!config_own_rodit.own_rodit_bytes_private_key,
      });

      // Convert private key and generate signature
      const own_rodit_private_key = new Uint8Array(
        config_own_rodit.own_rodit_bytes_private_key
      );

      const signatureStartTime = Date.now();
      const signature_ofpayload = nacl.sign.detached(
        sha256_ofpayload,
        own_rodit_private_key
      );
      const signatureDuration = Date.now() - signatureStartTime;

      // Log signature generation metrics
      logger.metric &&
        logger.metric("signature_generation_duration_ms", signatureDuration, {
          component: "WebhookSender",
        });

      const signature_hex_ofpayload =
        Buffer.from(signature_ofpayload).toString("hex");

      logger.debug("Sending webhook request", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        webhookUrl: formattedWebhookUrl,
        event,
      });

      // Send webhook request WITH the JWT token
      const fetchStartTime = Date.now();
      const response = await fetch(formattedWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature_hex_ofpayload,
          "X-Timestamp": timestamp.toString(),
          "X-Request-ID": requestId,
          Authorization: `Bearer ${jwt_token}`, // Include JWT token here
        },
        body: payload,
      });
      const fetchDuration = Date.now() - fetchStartTime;

      // Log fetch duration metrics
      logger.metric &&
        logger.metric("webhook_http_request_duration_ms", fetchDuration, {
          component: "WebhookSender",
          success: response.ok,
          status: response.status,
          event,
        });

      if (!response.ok) {
        const duration = Date.now() - startTime;

        logger.error("Webhook delivery failed", {
          component: "WebhookSender",
          method: "send_webhook",
          requestId,
          duration,
          status: response.status,
          statusText: response.statusText,
          webhookUrl: formattedWebhookUrl,
          event,
        });

        // Emit metrics for Grafana dashboards
        logger.metric &&
          logger.metric("webhook_delivery_duration_ms", duration, {
            component: "WebhookSender",
            success: false,
            event,
            error: "HTTP_ERROR",
            status: response.status,
          });
        logger.metric &&
          logger.metric("webhook_delivery_failures_total", 1, {
            component: "WebhookSender",
            reason: "HTTP_ERROR",
            status: response.status,
            event,
          });

        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await response.text();

      const duration = Date.now() - startTime;
      logger.info("Webhook delivered successfully", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        duration,
        event,
        webhookUrl: formattedWebhookUrl,
        status: response.status,
      });

      // Emit metrics for Grafana dashboards
      logger.metric &&
        logger.metric("webhook_delivery_duration_ms", duration, {
          component: "WebhookSender",
          success: true,
          event,
        });
      logger.metric &&
        logger.metric("successful_webhook_deliveries_total", 1, {
          component: "WebhookSender",
          event,
        });

      return {
        isValid: true,
        message: "Webhook sent successfully",
        requestId,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Webhook send failed", {
        component: "WebhookSender",
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
      logger.metric &&
        logger.metric("webhook_delivery_duration_ms", duration, {
          component: "WebhookSender",
          success: false,
          event,
          error: error.constructor.name,
        });
      logger.metric &&
        logger.metric("webhook_delivery_errors_total", 1, {
          component: "WebhookSender",
          error: error.constructor.name,
          event,
        });

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
   * @param {string} peer_rodit_owner_id - RODiT owner ID
   * @returns {Promise<Object>} Authentication result
   */
  async authenticate_webhook(
    payload,
    signature_hex_ofpayload,
    timestamp,
    peer_rodit_owner_id
  ) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.debug("Starting webhook authentication", {
      component: "WebhookAuthenticator",
      method: "authenticate_webhook",
      requestId,
      hasPayload: !!payload,
      hasSignature: !!signature_hex_ofpayload,
      hasTimestamp: !!timestamp,
      hasPeerRoditOwnerId: !!peer_rodit_owner_id,
    });

    try {
      const currentTime = Date.now();
      const parsedTimestamp = parseInt(timestamp);
      const timeThreshold = 5 * 60 * 1000; // 5 minutes

      // Check if timestamp is too old
      if (currentTime - parsedTimestamp > timeThreshold) {
        const duration = Date.now() - startTime;

        logger.warn("Webhook authentication failed - timestamp too old", {
          component: "WebhookAuthenticator",
          method: "authenticate_webhook",
          requestId,
          duration,
          timestampAge: (currentTime - parsedTimestamp) / 1000,
          threshold: timeThreshold / 1000,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("webhook_authentication_duration_ms", duration, {
          component: "WebhookAuthenticator",
          success: false,
          reason: "TIMESTAMP_EXPIRED",
        });
        logger.metric("webhook_authentication_failures_total", 1, {
          component: "WebhookAuthenticator",
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
        component: "WebhookAuthenticator",
        method: "authenticate_webhook",
        requestId,
        payloadSize: payload.length,
      });

      // Calculate hash of payload
      const sha256_ofpayload = crypto
        .createHash("sha256")
        .update(payload)
        .digest();

      logger.debug("Converting signature to buffer", {
        component: "WebhookAuthenticator",
        method: "authenticate_webhook",
        requestId,
        signatureLength: signature_hex_ofpayload.length,
      });

      // Convert signature to buffer
      const buffer_signature_ofpayload = Buffer.from(
        signature_hex_ofpayload,
        "hex"
      );

      logger.debug("Creating public key for verification", {
        component: "WebhookAuthenticator",
        method: "authenticate_webhook",
        requestId,
        ownerIdLength: peer_rodit_owner_id.length,
      });

      // Create public key buffer
      const peer_bytes_public_key = new Uint8Array(
        Buffer.from(peer_rodit_owner_id, "hex")
      );

      // Verify signature
      const verificationStartTime = Date.now();
      const isValid = nacl.sign.detached.verify(
        sha256_ofpayload,
        buffer_signature_ofpayload,
        peer_bytes_public_key
      );
      const verificationDuration = Date.now() - verificationStartTime;

      // Log verification metrics
      logger.metric(
        "signature_verification_duration_ms",
        verificationDuration,
        {
          component: "WebhookAuthenticator",
          success: isValid,
        }
      );

      if (!isValid) {
        const duration = Date.now() - startTime;

        logger.warn("Webhook authentication failed - invalid signature", {
          component: "WebhookAuthenticator",
          method: "authenticate_webhook",
          requestId,
          duration,
          verificationDuration,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("webhook_authentication_duration_ms", duration, {
          component: "WebhookAuthenticator",
          success: false,
          reason: "INVALID_SIGNATURE",
        });
        logger.metric("webhook_authentication_failures_total", 1, {
          component: "WebhookAuthenticator",
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
        component: "WebhookAuthenticator",
        method: "authenticate_webhook",
        requestId,
        duration,
        verificationDuration,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("webhook_authentication_duration_ms", duration, {
        component: "WebhookAuthenticator",
        success: true,
      });
      logger.metric("successful_webhook_authentications_total", 1, {
        component: "WebhookAuthenticator",
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
        component: "WebhookAuthenticator",
        method: "authenticate_webhook",
        requestId,
        duration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("webhook_authentication_duration_ms", duration, {
        component: "WebhookAuthenticator",
        success: false,
        error: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("webhook_authentication_errors_total", 1, {
        component: "WebhookAuthenticator",
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
   * Validate a JWT token
   *
   * @param {string} token - JWT token to validate
   * @param {Object} own_rodit - Own RODiT object
   * @returns {Promise<Object>} Validation result
   */
  async validate_jwt_token_be(token, own_rodit) {
    // This would be implemented in the Authentication class
    // For now, it delegates to the TokenService
    return this.tokenService.validate_jwt_token_be(token, own_rodit);
  }

  /**
   * Verify and get a peer RODiT
   *
   * @param {string} peerroditid - Peer RODiT ID
   * @param {number} peertimestamp - Peer timestamp
   * @param {string} peerroditid_base64url_signature - Signature of RODiT ID and timestamp
   * @param {Object} own_rodit - Own RODiT object
   * @returns {Promise<Object>} Verification result with peer RODiT
   */
  async verify_peerrodit_getrodit_withnep413(
    message,
    nonce,
    recipient,
    callbackUrl,
    signature,
    config_own_rodit
  ) {
    const requestId = ulid();
    const startTime = Date.now();
  
    logger.debug("Starting NEP-413 RODiT verification", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit_withnep413",
      requestId,
      message,
      nonceType: typeof nonce,
      nonceLength: Array.isArray(nonce) ? nonce.length : nonce?.length || 0,
      recipient,
      hasCallback: !!callbackUrl,
      signatureLength: signature?.length,
    });
  
    try {
      logger.debug("Fetching peer RODiT", {
        requestId,
        message,
      });
  
      const tokenFetchStart = Date.now();
      let peer_rodit = await nearorg_rpc_tokenfromroditid(message);
      const tokenFetchDuration = Date.now() - tokenFetchStart;
  
      logger.debug("Peer RODiT retrieved", {
        requestId,
        tokenFetchDuration,
        peerRoditId: peer_rodit?.token_id,
        peerOwnerId: peer_rodit?.owner_id,
      });
  
      // Correctly access serviceprovider_id
      const serviceprovider_id =
        config_own_rodit &&
        config_own_rodit.own_rodit &&
        config_own_rodit.own_rodit.metadata
          ? config_own_rodit.own_rodit.metadata.serviceprovider_id
          : null;
  
      if (!serviceprovider_id) {
        logger.error("Missing serviceprovider_id in configuration", {
          component: "RoditAuth",
          requestId,
          duration: Date.now() - startTime,
        });
  
        throw new Error("Missing serviceprovider_id in configuration");
      }
  
      // Execute verification steps
      logger.debug("Starting verification checks", {
        requestId,
        checks: ["ownership", "match", "live", "active", "trusted"],
      });
  
      const verificationStart = Date.now();
      const verification_results = await Promise.all([
        verify_rodit_ownership_withnep413(
          message,
          nonce,
          recipient,
          callbackUrl,
          signature,
          peer_rodit
        ),
        verify_rodit_isamatch(serviceprovider_id, peer_rodit),
        verify_rodit_islive(
          peer_rodit.metadata.not_after,
          peer_rodit.metadata.not_before
        ),
        verify_rodit_isactive(
          peer_rodit.token_id,
          config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url
        ),
        verify_rodit_istrusted_issuingsmartcontract(
          config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url
        ),
      ]);
      const verificationDuration = Date.now() - verificationStart;
  
      const [ownershipVerified, isaMatch, isLive, isActive, isTrusted] =
        verification_results;
  
      logger.debug("RODiT Verification Results", {
        requestId,
        verificationDuration,
        ownershipVerified,
        isaMatch,
        isLive,
        isActive,
        isTrusted,
      });
  
      if (!ownershipVerified || !isaMatch || !isLive || !isActive || !isTrusted) {
        const failedChecks = [];
        if (!ownershipVerified) failedChecks.push("ownership");
        if (!isaMatch) failedChecks.push("match");
        if (!isLive) failedChecks.push("live");
        if (!isActive) failedChecks.push("active");
        if (!isTrusted) failedChecks.push("trusted");
  
        logger.error("Peer RODiT NEP-413 verification failed", {
          component: "RoditAuth",
          requestId,
          duration: Date.now() - startTime,
          failedChecks,
          message,
          peerRoditId: peer_rodit?.token_id,
        });
  
        // Add metrics for verification failures
        logger.metric &&
          logger.metric("rodit_nep413_verification_failures", 1, {
            failed_checks: failedChecks.join(","),
            message,
          });
  
        throw new Error("Error 037: Peer RODiT verification failed");
      }
  
      const totalDuration = Date.now() - startTime;
  
      logger.info("NEP-413 RODiT verification successful", {
        component: "RoditAuth",
        method: "verify_peerrodit_getrodit_withnep413",
        requestId,
        duration: totalDuration,
        message,
        peerRoditId: peer_rodit?.token_id,
        peerOwnerId: peer_rodit?.owner_id,
        tokenFetchDuration,
        verificationDuration,
      });
  
      // Add metrics for successful verifications
      logger.metric &&
        logger.metric("rodit_nep413_verification", totalDuration, {
          result: "success",
          message,
        });
  
      return {
        peer_rodit,
        goodrodit: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
  
      logger.error("Error in NEP-413 RODiT verification", {
        component: "RoditAuth",
        method: "verify_peerrodit_getrodit_withnep413",
        requestId,
        duration,
        message,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });
  
      // Add metrics for verification errors
      logger.metric &&
        logger.metric("rodit_nep413_verification_errors", 1, {
          error_type: error.name || "Unknown",
          message,
        });
  
      return {
        peer_rodit: null,
        goodrodit: false,
        error: `Error in verify_peerrodit_getrodit_withnep413: ${error.message}`,
      };
    }
  }

  /**
   * Verify and get a peer RODiT using NEP-413 standard
   *
   * @param {string} message - NEP-413 message
   * @param {Uint8Array} nonce - NEP-413 nonce
   * @param {string} recipient - NEP-413 recipient
   * @param {string} callbackUrl - NEP-413 callback URL
   * @param {string} signature - NEP-413 signature
   * @param {Object} config_own_rodit - Own RODiT configuration
   * @returns {Promise<Object>} Verification result with peer RODiT
   */
  async verify_peerrodit_getrodit_withnep413(
    message,
    nonce,
    recipient,
    callbackUrl,
    signature,
    config_own_rodit
  ) {
    const requestId = ulid();
    const startTime = Date.now();
  
    logger.debug("Starting NEP-413 RODiT verification", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit_withnep413",
      requestId,
      message,
      nonceType: typeof nonce,
      nonceLength: Array.isArray(nonce) ? nonce.length : nonce?.length || 0,
      recipient,
      hasCallback: !!callbackUrl,
      signatureLength: signature?.length,
    });
  
    try {
      logger.debug("Fetching peer RODiT", {
        requestId,
        message,
      });
  
      const tokenFetchStart = Date.now();
      let peer_rodit = await nearorg_rpc_tokenfromroditid(message);
      const tokenFetchDuration = Date.now() - tokenFetchStart;
  
      logger.debug("Peer RODiT retrieved", {
        requestId,
        tokenFetchDuration,
        peerRoditId: peer_rodit?.token_id,
        peerOwnerId: peer_rodit?.owner_id,
      });
  
      // Correctly access serviceprovider_id
      const serviceprovider_id =
        config_own_rodit &&
        config_own_rodit.own_rodit &&
        config_own_rodit.own_rodit.metadata
          ? config_own_rodit.own_rodit.metadata.serviceprovider_id
          : null;
  
      if (!serviceprovider_id) {
        logger.error("Missing serviceprovider_id in configuration", {
          component: "RoditAuth",
          requestId,
          duration: Date.now() - startTime,
        });
  
        throw new Error("Missing serviceprovider_id in configuration");
      }
  
      // Execute verification steps
      logger.debug("Starting verification checks", {
        requestId,
        checks: ["ownership", "match", "live", "active", "trusted"],
      });
  
      const verificationStart = Date.now();
      const verification_results = await Promise.all([
        verify_rodit_ownership_withnep413(
          message,
          nonce,
          recipient,
          callbackUrl,
          signature,
          peer_rodit
        ),
        verify_rodit_isamatch(serviceprovider_id, peer_rodit),
        verify_rodit_islive(
          peer_rodit.metadata.not_after,
          peer_rodit.metadata.not_before
        ),
        verify_rodit_isactive(
          peer_rodit.token_id,
          config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url
        ),
        verify_rodit_istrusted_issuingsmartcontract(
          config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url
        ),
      ]);
      const verificationDuration = Date.now() - verificationStart;
  
      const [ownershipVerified, isaMatch, isLive, isActive, isTrusted] =
        verification_results;
  
      logger.debug("RODiT Verification Results", {
        requestId,
        verificationDuration,
        ownershipVerified,
        isaMatch,
        isLive,
        isActive,
        isTrusted,
      });
  
      if (!ownershipVerified || !isaMatch || !isLive || !isActive || !isTrusted) {
        const failedChecks = [];
        if (!ownershipVerified) failedChecks.push("ownership");
        if (!isaMatch) failedChecks.push("match");
        if (!isLive) failedChecks.push("live");
        if (!isActive) failedChecks.push("active");
        if (!isTrusted) failedChecks.push("trusted");
  
        logger.error("Peer RODiT NEP-413 verification failed", {
          component: "RoditAuth",
          requestId,
          duration: Date.now() - startTime,
          failedChecks,
          message,
          peerRoditId: peer_rodit?.token_id,
        });
  
        // Add metrics for verification failures
        logger.metric &&
          logger.metric("rodit_nep413_verification_failures", 1, {
            failed_checks: failedChecks.join(","),
            message,
          });
  
        throw new Error("Error 037: Peer RODiT verification failed");
      }
  
      const totalDuration = Date.now() - startTime;
  
      logger.info("NEP-413 RODiT verification successful", {
        component: "RoditAuth",
        method: "verify_peerrodit_getrodit_withnep413",
        requestId,
        duration: totalDuration,
        message,
        peerRoditId: peer_rodit?.token_id,
        peerOwnerId: peer_rodit?.owner_id,
        tokenFetchDuration,
        verificationDuration,
      });
  
      // Add metrics for successful verifications
      logger.metric &&
        logger.metric("rodit_nep413_verification", totalDuration, {
          result: "success",
          message,
        });
  
      return {
        peer_rodit,
        goodrodit: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
  
      logger.error("Error in NEP-413 RODiT verification", {
        component: "RoditAuth",
        method: "verify_peerrodit_getrodit_withnep413",
        requestId,
        duration,
        message,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });
  
      // Add metrics for verification errors
      logger.metric &&
        logger.metric("rodit_nep413_verification_errors", 1, {
          error_type: error.name || "Unknown",
          message,
        });
  
      return {
        peer_rodit: null,
        goodrodit: false,
        error: `Error in verify_peerrodit_getrodit_withnep413: ${error.message}`,
      };
    }
  }

  /**
 * Verify RODiT ownership by validating signature
 * 
 * @param {string} peerroditid - Peer RODiT ID
 * @param {number} peertimestamp - Peer timestamp
 * @param {string} peerroditid_base64url_signature - Signature of RODiT ID and timestamp
 * @param {Object} peer_rodit - Peer RODiT object
 * @returns {Promise<boolean>} Whether the ownership is verified
 */
async verify_rodit_ownership(
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
  });

  try {
    // DO NOT DELETE THE FOLLOWING COMMENT
    /* Maybe for NEP413 compatibility, the following line added "NEAR" before peerroditid */
    const timeString = await utils.unixTimeToDateString(peertimestamp);
    const roditidandtimestamp = new TextEncoder().encode(
      peerroditid + timeString
    );

    logger.debug("Encoded roditid and timestamp", {
      requestId,
      timeString,
      bufferLength: roditidandtimestamp.length,
    });

    const bytes_ed25519_signature = new Uint8Array(
      Buffer.from(peerroditid_base64url_signature, "base64url")
    );

    logger.debug("Decoded signature", {
      requestId,
      signatureLength: bytes_ed25519_signature.length,
    });

    const peer_bytes_ed25519_public_key = await this.blockchainService.nearorg_rpc_fetchpublickeybytes(
      peer_rodit.owner_id
    );

    logger.debug("Retrieved public key", {
      requestId,
      ownerId: peer_rodit.owner_id,
      keyLength: peer_bytes_ed25519_public_key.length,
    });

    const isaMatch = nacl.sign.detached.verify(
      roditidandtimestamp,
      bytes_ed25519_signature,
      peer_bytes_ed25519_public_key
    );

    const duration = Date.now() - startTime;

    if (isaMatch) {
      logger.info("Peer RODiT ownership check passed", {
        component: "RoditAuth",
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
        component: "RoditAuth",
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
      component: "RoditAuth",
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

/**
 * Verify and get a peer RODiT
 * 
 * @param {string} peerroditid - Peer RODiT ID
 * @param {number} peertimestamp - Peer timestamp
 * @param {string} peerroditid_base64url_signature - Signature of RODiT ID and timestamp
 * @param {Object} own_rodit - Own RODiT object
 * @returns {Promise<Object>} Verification result with peer RODiT
 */
async verify_peerrodit_getrodit(
  peerroditid,
  peertimestamp,
  peerroditid_base64url_signature,
  own_rodit
) {
  const requestId = ulid();
  const startTime = Date.now();

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
    const peer_rodit = await this.blockchainService.nearorg_rpc_tokenfromroditid(peerroditid);
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
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
        peerRoditId: peerroditid,
      });

      throw new Error("Failed to retrieve peer RODiT data");
    }

    if (!peer_rodit.metadata) {
      logger.error("Peer RODiT missing metadata", {
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
        peerRoditId: peerroditid,
        peerRoditOwnerId: peer_rodit.owner_id,
      });

      throw new Error("Peer RODiT missing metadata");
    }

    logger.debug("Starting verification checks", {
      requestId,
      checks: ["ownership", "match", "live", "active", "trusted"],
    });

    // Initialize verification results
    let ownershipVerified, isaMatch, isLive, isActive, isTrusted;
    let verificationDetails = {};

    try {
      logger.debug("Verifying RODiT ownership", { requestId });
      const ownershipStart = Date.now();
      ownershipVerified = await this.verify_rodit_ownership(
        peerroditid,
        peertimestamp,
        peerroditid_base64url_signature,
        peer_rodit
      );
      verificationDetails.ownershipDuration = Date.now() - ownershipStart;
      logger.debug("Ownership verification result", {
        requestId,
        ownershipVerified,
        duration: verificationDetails.ownershipDuration,
      });
    } catch (ownershipError) {
      logger.error("Error during ownership verification", {
        requestId,
        error: ownershipError.message,
        stack: ownershipError.stack,
      });
      ownershipVerified = false;
      verificationDetails.ownershipError = ownershipError.message;
    }

    try {
      logger.debug("Verifying RODiT match", {
        requestId,
        serviceProviderId: own_rodit.metadata.serviceprovider_id,
      });
      const matchStart = Date.now();
      isaMatch = await this.verify_rodit_isamatch(
        own_rodit.metadata.serviceprovider_id,
        peer_rodit
      );
      verificationDetails.matchDuration = Date.now() - matchStart;
      logger.debug("Match verification result", {
        requestId,
        isaMatch,
        duration: verificationDetails.matchDuration,
      });
    } catch (matchError) {
      logger.error("Error during match verification", {
        requestId,
        error: matchError.message,
        stack: matchError.stack,
      });
      isaMatch = false;
      verificationDetails.matchError = matchError.message;
    }

    try {
      logger.debug("Verifying RODiT is live", {
        requestId,
        notAfter: peer_rodit.metadata.not_after,
        notBefore: peer_rodit.metadata.not_before,
      });

      const liveStart = Date.now();
      isLive = await this.verify_rodit_islive(
        peer_rodit.metadata.not_after,
        peer_rodit.metadata.not_before
      );
      verificationDetails.liveDuration = Date.now() - liveStart;
      logger.debug("Live verification result", {
        requestId,
        isLive,
        duration: verificationDetails.liveDuration,
      });
    } catch (liveError) {
      logger.error("Error during live verification", {
        requestId,
        error: liveError.message,
        stack: liveError.stack,
      });
      isLive = false;
      verificationDetails.liveError = liveError.message;
    }

    try {
      logger.debug("Verifying RODiT is active", {
        requestId,
        tokenId: peer_rodit.token_id,
        url: own_rodit.metadata.subjectuniqueidentifier_url,
      });
      const activeStart = Date.now();
      isActive = await this.verify_rodit_isactive(
        peer_rodit.token_id,
        own_rodit.metadata.subjectuniqueidentifier_url
      );
      verificationDetails.activeDuration = Date.now() - activeStart;
      logger.debug("Active verification result", {
        requestId,
        isActive,
        duration: verificationDetails.activeDuration,
      });
    } catch (activeError) {
      logger.error("Error during active verification", {
        requestId,
        error: activeError.message,
        stack: activeError.stack,
      });
      isActive = false;
      verificationDetails.activeError = activeError.message;
    }

    try {
      logger.debug("Verifying RODiT issuing smart contract is trusted", {
        requestId,
        url: own_rodit.metadata.subjectuniqueidentifier_url,
      });
      const trustedStart = Date.now();
      isTrusted = await this.verify_rodit_istrusted_issuingsmartcontract(
        own_rodit.metadata.subjectuniqueidentifier_url
      );
      verificationDetails.trustedDuration = Date.now() - trustedStart;
      logger.debug("Trust verification result", {
        requestId,
        isTrusted,
        duration: verificationDetails.trustedDuration,
      });
    } catch (trustError) {
      logger.error("Error during trust verification", {
        requestId,
        error: trustError.message,
        stack: trustError.stack,
      });
      isTrusted = false;
      verificationDetails.trustError = trustError.message;
    }

    // Log all verification results
    logger.debug("All verification results", {
      requestId,
      ownershipVerified,
      isaMatch,
      isLive,
      isActive,
      isTrusted,
      verificationDetails,
    });

    if (!ownershipVerified || !isaMatch || !isLive || !isActive || !isTrusted) {
      const failedChecks = [];
      if (!ownershipVerified) failedChecks.push("ownership");
      if (!isaMatch) failedChecks.push("match");
      if (!isLive) failedChecks.push("live");
      if (!isActive) failedChecks.push("active");
      if (!isTrusted) failedChecks.push("trusted");

      const duration = Date.now() - startTime;
      logger.error("Peer RODiT verification failed", {
        component: "RoditAuth",
        method: "verify_peerrodit_getrodit",
        requestId,
        duration,
        peerRoditId: peerroditid,
        failedChecks,
        verificationDetails,
      });

      // Add metrics for verification failures
      logger.metric &&
        logger.metric("rodit_verification_failures", 1, {
          failed_checks: failedChecks.join(","),
          peer_rodit_id: peerroditid,
        });

      logger.metric &&
        logger.metric("rodit_verification", duration, {
          result: "failure",
          peer_rodit_id: peerroditid,
        });

      throw new Error(
        `Error 037: Peer RODiT verification failed on: ${failedChecks.join(
          ", "
        )}`
      );
    }

    const totalDuration = Date.now() - startTime;

    logger.info("Peer RODiT verification successful", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit",
      requestId,
      duration: totalDuration,
      peerRoditId: peerroditid,
      peerOwnerId: peer_rodit.owner_id,
      verificationDetails,
    });

    // Add metrics for successful verifications
    logger.metric &&
      logger.metric("rodit_verification", totalDuration, {
        result: "success",
        peer_rodit_id: peerroditid,
      });

    return {
      peer_rodit,
      goodrodit: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Error in verify_peerrodit_getrodit", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit",
      requestId,
      duration,
      peerRoditId: peerroditid,
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
        peer_rodit_id: peerroditid,
      });

    return {
      peer_rodit: null,
      goodrodit: false,
      error: `Error in verify_peerrodit_getrodit: ${error.message}`,
    };
  }
}
}

module.exports = Authentication;