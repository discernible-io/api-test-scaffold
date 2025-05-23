/**
 * Authentication State Manager for RODiT operations
 * Copyright (c) 2024 Cableguard, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
const logger = require("../../config/logger");

/**
 * Singleton class for managing authentication state
 * This includes RODiT configurations, JWT tokens, and public keys
 */
class AuthStateManager {
  constructor() {
    if (AuthStateManager.instance) {
      return AuthStateManager.instance;
    }

    // Separate variables for own key and peer key
    this.ownBase64urlJwkPublicKey = null;
    this.peerBase64urlJwkPublicKey = null;

    // Other existing properties
    this.configOwnRodit = null;
    this.signportalJwtToken = null;
    this.jwtToken = null;
    
    // Session management
    this.sessions = new Map();

    AuthStateManager.instance = this;
  }

  // Methods for own public key
  async setOwnBase64urlJwkPublicKey(key) {
    this.ownBase64urlJwkPublicKey = key;
    return key;
  }

  getOwnBase64urlJwkPublicKey() {
    return this.ownBase64urlJwkPublicKey;
  }

  // Methods for peer public key
  async setPeerBase64urlJwkPublicKey(key) {
    this.peerBase64urlJwkPublicKey = key;
    return key;
  }

  getPeerBase64urlJwkPublicKey() {
    return this.peerBase64urlJwkPublicKey;
  }

  // RODiT configuration management
  async setConfigOwnRodit(config) {
    this.configOwnRodit = config;
    return config;
  }

  getConfigOwnRodit() {
    return this.configOwnRodit;
  }

  // JWT token management
  async setSignPortalJwtToken(token) {
    this.signportalJwtToken = token;
    return token;
  }

  getSignPortalJwtToken() {
    return this.signportalJwtToken;
  }

  async setJwtToken(token) {
    this.jwtToken = token;
    return token;
  }

  getJwtToken() {
    return this.jwtToken;
  }

  // Session management
  createSession(sessionData) {
    if (!sessionData || !sessionData.id) {
      throw new Error("Session data must include an ID");
    }
    
    this.sessions.set(sessionData.id, {
      ...sessionData,
      lastAccessedAt: Math.floor(Date.now() / 1000)
    });
    
    return this.sessions.get(sessionData.id);
  }
  
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  
  updateSession(sessionId, updates) {
    if (!this.sessions.has(sessionId)) {
      return null;
    }
    
    const session = this.sessions.get(sessionId);
    const updatedSession = {
      ...session,
      ...updates,
      lastAccessedAt: Math.floor(Date.now() / 1000)
    };
    
    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }
  
  deleteSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      return false;
    }
    
    return this.sessions.delete(sessionId);
  }
  
  getAllSessions() {
    return Array.from(this.sessions.values());
  }
  
  getPortalUrl(serviceProviderId, port) {
    // Extract smart contract component from serviceprovider_id
    const components = serviceProviderId.split(";");
    const scComponent = components
      .find((c) => c.startsWith("sc="))
      ?.substring(3);

    if (!scComponent) {
      throw new Error("Invalid serviceprovider_id format");
    }

    // Extract domain parts from smart contract name
    const scParts = scComponent.split(".");
    if (scParts.length < 1) {
      throw new Error("Invalid smart contract format");
    }

    // Get domain information from the first part
    const domainPart = scParts[0];
    const domainComponents = domainPart.split("-");

    // Find domain and TLD in the components (format: 10975-cableguard-org)
    if (domainComponents.length < 3) {
      throw new Error("Invalid domain format in smart contract");
    }

    const domain = domainComponents[1]; // cableguard
    const tld = domainComponents[2]; // org

    // Build and return the API endpoint
    return `https://signportal.${domain}.${tld}:${port}`;
  }

  /**
 * Performs a fetch operation with comprehensive error handling and logging for Grafana monitoring
 *
 * @param {string} url - The URL to fetch from
 * @param {Object} options - Fetch options including method, headers, etc.
 * @returns {Promise<Object>} - The response data or error object
 */
async fetchWithErrorHandling(url, options, retryCount = 0) {
  const requestId = ulid();
  const startTime = Date.now();
  const operation = options?.method || "GET";
  const urlObj = new URL(url);
  const endpoint = urlObj.pathname;
  const MAX_AUTH_RETRIES = 1; // Retries for expired tokens
  const MAX_RATE_LIMIT_RETRIES = 3; // Retries for rate limiting

  logger.info("API request initiated", {
    component: "APIClient",
    method: "fetchWithErrorHandling",
    requestId,
    url: endpoint,
    operation,
    retryCount,
  });

  try {
    // Get the current JWT token for authentication
    const jwt_token = this.getJwtToken();

    // Add authorization and tracking headers
    options.headers = {
      ...options.headers,
      ...(jwt_token ? { Authorization: `Bearer ${jwt_token}` } : {}),
      "X-Request-ID": requestId,
    };

    // Make the API request
    const response = await fetch(url, options);
    const responseTime = Date.now() - startTime;

    // Check for a renewed token in response headers
    const newToken = response.headers.get("New-Token");
    if (newToken) {
      try {
        await this.setJwtToken(newToken);
        logger.debug("JWT token refreshed from header", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          requestId,
        });
      } catch (tokenError) {
        logger.error("Failed to update JWT token", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          requestId,
          error: tokenError.message,
        });
      }
    }

    // Record response time metrics
    logger.metric("api_request_duration_milliseconds", responseTime, {
      endpoint,
      method: operation,
      status: response.status,
    });

    // Handle 401 Unauthorized with retry for token expiration
    if (response.status === 401 && retryCount < MAX_AUTH_RETRIES) {
      const responseData = await response.json();

      // Only retry for expired tokens
      if (responseData.error && responseData.error.code === "TOKEN_EXPIRED") {
        logger.info("Token expired, attempting login refresh", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          requestId,
        });

        // Try to login again to get a fresh token
        // This implementation depends on your authentication flow
        try {
          const config_own_rodit = this.getConfigOwnRodit();
          if (config_own_rodit && config_own_rodit.own_rodit) {
            const loginResult = await login_server(config_own_rodit.own_rodit);

            if (loginResult && loginResult.jwt_token) {
              // Save the new token
              await this.setJwtToken(loginResult.jwt_token);

              // Retry the request with the new token
              return this.fetchWithErrorHandling(url, options, retryCount + 1);
            }
          }
        } catch (loginError) {
          logger.error("Failed to refresh token through login", {
            component: "APIClient",
            method: "fetchWithErrorHandling",
            requestId,
            error: loginError.message,
          });
        }
      }
    }
    
    // Handle 429 Too Many Requests with retry and exponential backoff
    if (response.status === 429 && retryCount < MAX_RATE_LIMIT_RETRIES) {
      // Get retry-after header or default to exponential backoff
      const retryAfter = response.headers.get('Retry-After');
      let waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, retryCount) * 1000;
      
      // Cap the wait time at 30 seconds
      waitTime = Math.min(waitTime, 30000);
      
      // Log rate limiting information
      logger.warn("Rate limit exceeded", {
        component: "APIClient",
        method: "fetchWithErrorHandling",
        requestId,
        url: endpoint,
        statusCode: response.status,
        retryCount,
        retryAfter: retryAfter || 'not specified',
        waitTime: waitTime / 1000,
        event: "rate_limit_exceeded",
        maxRequests: response.headers.get('X-RateLimit-Limit'),
        windowMinutes: response.headers.get('X-RateLimit-Window') || 15,
      });
      
      // Record rate limit metric
      logger.metric("api_rate_limit_exceeded_total", 1, {
        endpoint,
        method: operation,
      });
      
      // Wait for the specified time before retrying
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // Retry the request
      return this.fetchWithErrorHandling(url, options, retryCount + 1);
    }

    // Parse response as JSON for all status codes
    let responseData;
    try {
      responseData = await response.json();
    } catch (parseError) {
      // Handle non-JSON responses
      const text = await response.text();
      responseData = {
        rawResponse: text.substring(0, 100), // Only include a preview
        parseError: parseError.message,
      };
    }

    if (!response.ok) {
      // Handle error responses
      logger.error("API request failed", {
        component: "APIClient",
        method: "fetchWithErrorHandling",
        requestId,
        url: endpoint,
        statusCode: response.status,
        errorDetails: responseData,
      });

      // Record error metrics
      logger.metric("api_request_errors_total", 1, {
        endpoint,
        method: operation,
        status: response.status,
      });

      return {
        error: responseData.error || "RequestFailed",
        message:
          responseData.message || `Request failed: ${response.statusText}`,
        statusCode: response.status,
        details: responseData,
      };
    }

    // Log successful request
    logger.info("API request completed", {
      component: "APIClient",
      method: "fetchWithErrorHandling",
      requestId,
      url: endpoint,
      statusCode: response.status,
      duration: responseTime,
    });

    return responseData;
  } catch (error) {
    const errorDuration = Date.now() - startTime;

    // Log detailed error information
    logger.error("Fetch operation failed", {
      component: "APIClient",
      method: "fetchWithErrorHandling",
      requestId,
      url: endpoint,
      errorMessage: error.message,
      errorStack: error.stack,
      duration: errorDuration,
    });

    // Return a standardized error object
    return {
      error: "RequestFailed",
      message: error.message,
      isNetworkError:
        error.message.includes("fetch") || error.message.includes("network"),
    };
  }
}

/**
 * Performs a fetch operation with comprehensive error handling and logging for Grafana monitoring
 *
 * @param {string} url - The URL to fetch from
 * @param {Object} options - Fetch options including method, headers, etc.
 * @returns {Promise<Object>} - The response data or error object
 */
async fetchWithErrorHandlingSignPortal(url, options, retryCount = 0) {
  const requestId = ulid();
  const startTime = Date.now();
  const operation = options?.method || "GET";
  const urlObj = new URL(url);
  const endpoint = urlObj.pathname;
  const MAX_RETRIES = 1; // Only retry once for expired tokens

  logger.info("API request initiated", {
    component: "APIClient",
    method: "fetchWithErrorHandling",
    requestId,
    url: endpoint,
    operation,
    retryCount,
  });

  try {
    // Get the current JWT token for authentication
    const jwt_token = this.getSignPortalJwtToken();

    // Add authorization and tracking headers
    options.headers = {
      ...options.headers,
      ...(jwt_token ? { Authorization: `Bearer ${jwt_token}` } : {}),
      "X-Request-ID": requestId,
    };

    // Make the API request
    const response = await fetch(url, options);
    const responseTime = Date.now() - startTime;

    // Check for a renewed token in response headers
    const newToken = response.headers.get("New-Token");
    if (newToken) {
      try {
        await this.setSignPortalJwtToken(newToken);
        logger.debug("JWT token refreshed from header", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          requestId,
        });
      } catch (tokenError) {
        logger.error("Failed to update JWT token", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          requestId,
          error: tokenError.message,
        });
      }
    }

    // Record response time metrics
    logger.metric("api_request_duration_milliseconds", responseTime, {
      endpoint,
      method: operation,
      status: response.status,
    });

    // Handle 401 Unauthorized with retry for token expiration
    if (response.status === 401 && retryCount < MAX_RETRIES) {
      const responseData = await response.json();

      // Only retry for expired tokens
      if (responseData.error && responseData.error.code === "TOKEN_EXPIRED") {
        logger.info("Token expired, attempting login refresh", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          requestId,
        });

        // Try to login again to get a fresh token
        // This implementation depends on your authentication flow
        try {
          const config_own_rodit = stateManager.getConfigOwnRodit();
          if (config_own_rodit && config_own_rodit.own_rodit) {
            const loginResult = await login_server(config_own_rodit.own_rodit);

            if (loginResult && loginResult.jwt_token) {
              // Save the new token
              await this.setSignPortalJwtToken(loginResult.jwt_token);

              // Retry the request with the new token
              return this.fetchWithErrorHandlingSignPortal(url, options, retryCount + 1);
            }
          }
        } catch (loginError) {
          logger.error("Failed to refresh token through login", {
            component: "APIClient",
            method: "fetchWithErrorHandling",
            requestId,
            error: loginError.message,
          });
        }
      }
    }

    // Parse response as JSON for all status codes
    let responseData;
    try {
      responseData = await response.json();
    } catch (parseError) {
      // Handle non-JSON responses
      const text = await response.text();
      responseData = {
        rawResponse: text.substring(0, 100), // Only include a preview
        parseError: parseError.message,
      };
    }

    if (!response.ok) {
      // Handle error responses
      logger.error("API request failed", {
        component: "APIClient",
        method: "fetchWithErrorHandling",
        requestId,
        url: endpoint,
        statusCode: response.status,
        errorDetails: responseData,
      });

      // Record error metrics
      logger.metric("api_request_errors_total", 1, {
        endpoint,
        method: operation,
        status: response.status,
      });

      return {
        error: responseData.error || "RequestFailed",
        message:
          responseData.message || `Request failed: ${response.statusText}`,
        statusCode: response.status,
        details: responseData,
      };
    }

    // Log successful request
    logger.info("API request completed", {
      component: "APIClient",
      method: "fetchWithErrorHandling",
      requestId,
      url: endpoint,
      statusCode: response.status,
      duration: responseTime,
    });

    return responseData;
  } catch (error) {
    const errorDuration = Date.now() - startTime;

    // Log detailed error information
    logger.error("Fetch operation failed", {
      component: "APIClient",
      method: "fetchWithErrorHandling",
      requestId,
      url: endpoint,
      errorMessage: error.message,
      errorStack: error.stack,
      duration: errorDuration,
    });

    // Return a standardized error object
    return {
      error: "RequestFailed",
      message: error.message,
      isNetworkError:
        error.message.includes("fetch") || error.message.includes("network"),
    };
  }
}



};

// Create and export a singleton instance
const stateManager = new AuthStateManager();
module.exports = stateManager;
