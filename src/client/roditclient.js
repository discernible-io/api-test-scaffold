/**
 * RODiT Client Interface
 * Provides a clean API for interacting with RODiT services
 * 
 * Copyright (c) 2024 Ayayai, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
const logger = require("../../config/logger");
const roditManager = require('../auth/roditmanager');
const authStateManager = require('../blockchain/statemanager');
const { ensureProtocol } = require('../utils');

/**
 * RoditClient class
 * Main client interface for interacting with RODiT API services
 * 
 * @example
 * const { RoditClient } = require('@cableguard/rodit-sdk');
 * const client = new RoditClient();
 * 
 * // Initialize with custom endpoints (optional)
 * // await client.init({
 * //   authEndpoint: 'https://auth.example.com',
 * //   dataEndpoint: 'https://api.example.com'
 * // });
 */
class RoditClient {
  /**
   * Create a new RODiT client
   * @param {Object} [options] - Optional configuration
   * @param {string} [options.credentialsPath] - Path to credentials file
   * @param {string} [options.authEndpoint] - Custom auth endpoint
   * @param {string} [options.dataEndpoint] - Custom data endpoint
   * @param {string} [options.configEndpoint] - Custom config endpoint
   */
  constructor(options = {}) {
    this.requestId = ulid();
    this.initialized = false;
    
    // Store minimal configuration
    this.config = {
      authEndpoint: options.authEndpoint,
      dataEndpoint: options.dataEndpoint,
      configEndpoint: options.configEndpoint,
      credentialsPath: options.credentialsPath
    };
    
    logger.debug('RODiT client instance created', {
      component: 'RoditClient',
      method: 'constructor',
      requestId: this.requestId
    });
  }

  /**
   * Initialize the client with configuration
   * @param {Object} [config] - Configuration overrides
   * @returns {Promise<boolean>} True if initialization was successful
   */
  async init(config = {}) {
    const requestId = this.requestId;
    
    try {
      // Update configuration
      this.config = {
        ...this.config,
        ...config
      };

      // Initialize RoditManager if credentials path is provided
      if (this.config.credentialsPath) {
        if (typeof roditManager.setConfigPath === 'function') {
          await roditManager.setConfigPath(this.config.credentialsPath);
          
          logger.debug('Initialized RoditManager with credentials', {
            component: 'RoditClient',
            method: 'init',
            requestId,
            credentialsPath: this.config.credentialsPath
          });
        }
      }

      // Verify we can access required configuration
      const configOwnRodit = await authStateManager.getConfigOwnRodit();
      if (!configOwnRodit) {
        throw new Error('Failed to load RODiT configuration');
      }

      // Set default endpoints from config if not provided
      if (!this.config.authEndpoint && configOwnRodit.metadata?.auth_endpoint) {
        this.config.authEndpoint = ensureProtocol(configOwnRodit.metadata.auth_endpoint);
      }
      
      if (!this.config.dataEndpoint && configOwnRodit.metadata?.api_endpoint) {
        this.config.dataEndpoint = ensureProtocol(configOwnRodit.metadata.api_endpoint);
      }

      this.initialized = true;
      
      logger.info('RODiT client initialized successfully', {
        component: 'RoditClient',
        method: 'init',
        requestId,
        endpoints: {
          auth: this.config.authEndpoint,
          data: this.config.dataEndpoint
        }
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize RODiT client', {
        component: 'RoditClient',
        method: 'init',
        requestId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Make an authenticated request to the RODiT API
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {Object} [data] - Request data
   * @param {Object} [options] - Additional options
   * @returns {Promise<Object>} API response
   */
  async request(method, path, data = null, options = {}) {
    if (!this.initialized) {
      throw new Error('Client not initialized. Call init() first.');
    }

    const requestId = ulid();
    const url = new URL(path, this.config.dataEndpoint).toString();
    const headers = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      ...options.headers
    };

    // Get current session token
    const token = await this.getSessionToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      method,
      headers,
      ...options
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    try {
      logger.debug('Making API request', {
        component: 'RoditClient',
        method: 'request',
        requestId,
        url,
        method,
        hasData: !!data
      });

      const response = await fetch(url, config);
      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(responseData.message || `Request failed with status ${response.status}`);
      }

      return responseData;
    } catch (error) {
      logger.error('API request failed', {
        component: 'RoditClient',
        method: 'request',
        requestId,
        url,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get current session token
   * @returns {Promise<string|null>} Current session token or null if not authenticated
   */
  async getSessionToken() {
    try {
      const session = await authStateManager.getSession();
      return session?.token || null;
    } catch (error) {
      logger.error('Failed to get session token', {
        component: 'RoditClient',
        method: 'getSessionToken',
        requestId: this.requestId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Set authentication token
   * 
   * @param {string} token - Authentication token
   * @returns {boolean} Success indicator
   */
  async setSessionToken(token) {
    const requestId = ulid();
    
    logger.debug('Setting authentication token', {
      component: 'RoditClient',
      method: 'setSessionToken',
      requestId,
      hasToken: !!token
    });
    
    // Store token in AuthStateManager
    authStateManager.setJwtToken(token);
    
    // Also cache locally for quick access
    this.token = token;
    
    return true;
  }
  
  /**
   * Set session data
   * 
   * @param {Object} sessionData - Session data
   * @returns {boolean} Success indicator
   */
  setSessionData(sessionData) {
    const requestId = ulid();
    
    logger.debug('Setting session data', {
      component: 'RoditClient',
      method: 'setSessionData',
      requestId,
      hasSessionData: !!sessionData,
      sessionId: sessionData?.id
    });
    
    this.sessionData = sessionData;
    
    return true;
  }
  
  /**
   * Clear session data and token
   * 
   * @returns {boolean} Success indicator
   */
  clearSession() {
    const requestId = ulid();
    
    logger.debug('Clearing session data', {
      component: 'RoditClient',
      method: 'clearSession',
      requestId,
      hasSession: !!this.sessionData,
      sessionId: this.sessionData?.id
    });
    
    this.sessionData = null;
    this.token = null;
    
    return true;
  }
  

  

  
  /**
   * Login to the RODiT API
   * 
   * @param {Object} options - Login options
   * @param {string} options.roditId - Optional RODiT ID to use for login
   * @returns {Promise<Object>} Login result with token
   */
  async login(options = {}) {
    const requestId = ulid();
    const startTime = Date.now();
    
    logger.debug('Starting login process', {
      component: 'RoditClient',
      method: 'login',
      requestId,
      options: {
        roditId: options.roditId || 'using default'
      }
    });
    
    try {
      // Get the RODiT configuration from the AuthStateManager singleton
      const configOwnRodit = authStateManager.getConfigOwnRodit();
      
      if (!configOwnRodit) {
        logger.error('RODiT configuration not set in AuthStateManager', {
          component: 'RoditClient',
          method: 'login',
          requestId
        });
        throw new Error('RODiT configuration not set in AuthStateManager');
      }
      
      if (!configOwnRodit.own_rodit) {
        logger.error('own_rodit not found in AuthStateManager configuration', {
          component: 'RoditClient',
          method: 'login',
          requestId,
          configKeys: Object.keys(configOwnRodit)
        });
        throw new Error('own_rodit not found in AuthStateManager configuration');
      }
      
      logger.debug('Using login_server for authentication to ensure consistent mutual authentication', {
        component: 'RoditClient',
        method: 'login',
        requestId,
        roditId: configOwnRodit.own_rodit.token_id
      });
      
      // Use login_server directly to ensure consistent mutual authentication
      const loginResult = await authMw.login_server(configOwnRodit.own_rodit);
      
      // Check if login was successful
      if (loginResult.error) {
        logger.error('Login failed', {
          component: 'RoditClient',
          method: 'login',
          requestId,
          error: loginResult.error,
          loginResult: JSON.stringify(loginResult)
        });
        
        // Add more detailed debugging information
        logger.debug('Login result details', {
          component: 'RoditClient',
          method: 'login',
          requestId,
          apiEndpoint: configOwnRodit.apiendpoint,
          roditId: configOwnRodit.own_rodit.token_id,
          hasPrivateKey: !!configOwnRodit.own_rodit_bytes_private_key
        });
        
        throw new Error(`Login failed: ${loginResult.error}`);
      }
      
      // login_server returns jwt_token, not token
      if (loginResult.jwt_token) {
        this.token = loginResult.jwt_token;
        this.setSessionToken(loginResult.jwt_token);
        
        // Generate a session ID if not provided
        const sessionId = ulid();
        this.sessionId = sessionId;
        this.setSessionData({ 
          id: sessionId, 
          createdAt: Math.floor(Date.now() / 1000), 
          // Set default expiration to 1 hour from now
          expiresAt: Math.floor(Date.now() / 1000) + 3600, 
          status: 'active' 
        });
      }
      
      const duration = Date.now() - startTime;
      logger.info('Login successful', {
        component: 'RoditClient',
        method: 'login',
        requestId,
        duration,
        roditId: configOwnRodit.own_rodit.token_id,
        hasToken: !!this.token,
        sessionId: this.sessionId
      });
      
      // Track metric
      logger.metric && logger.metric('login_duration_ms', duration, {
        component: 'RoditClient',
        success: true
      });
      
      // Return a properly structured result that matches what the calling code expects
      return {
        token: this.token,
        sessionId: this.sessionId
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Login failed', {
        component: 'RoditClient',
        method: 'login',
        requestId,
        duration,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      });
      
      // Track error metric
      logger.metric && logger.metric('login_duration_ms', duration, {
        component: 'RoditClient',
        success: false,
        error: error.name
      });
      
      logger.metric && logger.metric('login_errors', 1, {
        component: 'RoditClient',
        error: error.name
      });
      
      throw error;
    }
  }
  
  /**
   * Logout from the RODiT API
   * 
   * @returns {Promise<boolean>} True if logout was successful
   */
  async logout() {
    const requestId = ulid();
    const startTime = Date.now();
    
    logger.debug('Starting logout process', {
      component: 'RoditClient',
      method: 'logout',
      requestId,
      hasToken: !!this.token,
      sessionId: this.sessionId
    });
    
    if (!this.token) {
      logger.warn('Logout called without an active token', {
        component: 'RoditClient',
        method: 'logout',
        requestId
      });
      return false;
    }
    
    try {
      // Get auth endpoint
      const authEndpoint = this._getApiEndpoint();
      
      if (!authEndpoint) {
        throw new Error('Auth endpoint not configured');
      }
      
      // Create mock request and response objects for the authentication middleware
      const mockReq = {
        headers: {
          authorization: `Bearer ${this.token}`
        },
        requestId,
        path: '/logout',
        method: 'POST'
      };
      
      const mockRes = {
        status: function(code) {
          this.statusCode = code;
          return this;
        },
        json: function(data) {
          this.data = data;
          return this;
        },
        data: null,
        statusCode: 200
      };
      
      logger.debug('Making logout request using auth middleware', {
        component: 'RoditClient',
        method: 'logout',
        requestId,
        url: `${authEndpoint}/logout`
      });
      
      // Use the authentication middleware's logout_client function
      await authMw.logout_client(mockReq, mockRes);
      
      // Clear session data regardless of response
      this.token = null;
      this.sessionId = null;
      this.clearSession();
      
      // Check response
      if (mockRes.statusCode !== 200) {
        logger.warn('Logout API call failed, but session invalidated locally', {
          component: 'RoditClient',
          method: 'logout',
          requestId,
          status: mockRes.statusCode,
          error: mockRes.data ? JSON.stringify(mockRes.data) : 'No error details'
        });
      }
      
      const duration = Date.now() - startTime;
      logger.info('Logout successful', {
        component: 'RoditClient',
        method: 'logout',
        requestId,
        duration,
        status: mockRes.statusCode
      });
      
      // Track metric
      logger.metric && logger.metric('logout_duration_ms', duration, {
        component: 'RoditClient',
        success: true
      });
      
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Logout failed', {
        component: 'RoditClient',
        method: 'logout',
        requestId,
        duration,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      });
      
      // Track error metric
      logger.metric && logger.metric('logout_duration_ms', duration, {
        component: 'RoditClient',
        success: false,
        error: error.name
      });
      
      // Clear session data even if the API call fails
      this.token = null;
      this.sessionId = null;
      this.clearSession();
      
      return false;
    }
  }
  
  /**
   * Check if the client is authenticated
   * 
   * @returns {Promise<boolean>} True if the client is authenticated
   */
  async isAuthenticated() {
    const requestId = ulid();
    
    logger.debug('Checking authentication status', {
      component: 'RoditClient',
      method: 'isAuthenticated',
      requestId,
      hasToken: !!this.token,
      sessionId: this.sessionId
    });
    
    if (!this.token) {
      return false;
    }
    
    try {
      // Get auth endpoint
      const authEndpoint = this._getApiEndpoint();
      
      if (!authEndpoint) {
        throw new Error('Auth endpoint not configured');
      }
      
      // Make a request to verify token
      const verifyUrl = `${authEndpoint}/verify`;
      
      logger.debug('Making token verification request', {
        component: 'RoditClient',
        method: 'isAuthenticated',
        requestId,
        url: verifyUrl
      });
      
      const response = await fetch(verifyUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });
      
      const isAuthenticated = response.ok;
      
      logger.debug('Authentication check result', {
        component: 'RoditClient',
        method: 'isAuthenticated',
        requestId,
        isAuthenticated,
        status: response.status
      });
      
      return isAuthenticated;
    } catch (error) {
      logger.error('Authentication check failed', {
        component: 'RoditClient',
        method: 'isAuthenticated',
        requestId,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      });
      
      return false;
    }
  }
    
  /**
   * Get the API endpoint URL (private method)
   * 
   * @returns {string} API endpoint URL
   * @private
   */
  _getApiEndpoint() {
    const requestId = ulid();
    
    // Get the RODiT configuration from the AuthStateManager singleton
    const configOwnRodit = authStateManager.getConfigOwnRodit();
    
    logger.debug('Getting API endpoint from AuthStateManager', {
      component: 'RoditClient',
      method: '_getApiEndpoint',
      requestId,
      hasConfigOwnRodit: !!configOwnRodit,
      configKeys: configOwnRodit ? Object.keys(configOwnRodit) : []
    });
    
    if (!configOwnRodit) {
      throw new Error('RODiT configuration not set in AuthStateManager');
    }
    
    // Check if the RODiT token metadata exists and has the required field
    if (!configOwnRodit.own_rodit || !configOwnRodit.own_rodit.metadata || !configOwnRodit.own_rodit.metadata.subjectuniqueidentifier_url) {
      logger.error('Missing required metadata in RODiT configuration', {
        component: 'RoditClient',
        method: '_getApiEndpoint',
        requestId,
        hasOwnRodit: !!configOwnRodit.own_rodit,
        hasMetadata: configOwnRodit.own_rodit ? !!configOwnRodit.own_rodit.metadata : false,
        metadataKeys: configOwnRodit.own_rodit && configOwnRodit.own_rodit.metadata ? 
                     Object.keys(configOwnRodit.own_rodit.metadata) : []
      });
      
      throw new Error('subjectuniqueidentifier_url not found in RODiT token metadata');
    }
    
    let baseUrl = configOwnRodit.own_rodit.metadata.subjectuniqueidentifier_url;
    
    // Handle localhost with port for local testing
    try {
      if (baseUrl === 'localhost' && require('config').has('SERVERPORT')) {
        baseUrl = `${baseUrl}:${require('config').get('SERVERPORT')}`;
      }
    } catch (error) {
      // If config module fails, just use the baseUrl as is
      logger.debug('Config error when checking SERVERPORT', {
        component: 'RoditClient',
        method: '_getApiEndpoint',
        requestId,
        error: error.message
      });
    }
    
    // Use the imported ensureProtocol function
    return ensureProtocol(baseUrl);
  }
  
  /**
   * Make an authenticated API request
   * 
   * @param {string} endpoint - API endpoint path
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} API response
   */
  async request(endpoint, options = {}) {
    const requestId = ulid();
    const startTime = Date.now();
    
    logger.debug('Making API request', {
      component: 'RoditClient',
      method: 'request',
      requestId,
      endpoint,
      method: options.method || 'GET'
    });
    
    // Check if authenticated
    if (!this.token) {
      throw new Error('Not authenticated. Please login first.');
    }
    
    // Get the API endpoint URL
    const baseUrl = this._getApiEndpoint();
    
    // Ensure the endpoint starts with a slash
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    // Prepare the request options
    const requestOptions = {
      ...options,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options.headers
      }
    };
    
    // Convert body to JSON if it's an object
    if (requestOptions.body && typeof requestOptions.body === 'object') {
      requestOptions.body = JSON.stringify(requestOptions.body);
    }
    
    try {
      // Make the request using fetchWithErrorHandling
      // Note: Ensuring the URL has the proper protocol prefix
      const url = `${baseUrl}${path}`;
      
      logger.debug('Sending API request', {
        component: 'RoditClient',
        method: 'request',
        requestId,
        url,
        requestMethod: requestOptions.method
      });
      
      // Use the fetchWithErrorHandling method from the stateManager
      const result = await authStateManager.fetchWithErrorHandling(url, requestOptions);
      
      const duration = Date.now() - startTime;
      logger.debug('API request completed', {
        component: 'RoditClient',
        method: 'request',
        requestId,
        duration
      });
      
      // Track metric
      logger.metric && logger.metric('api_request_duration_ms', duration, {
        component: 'RoditClient',
        endpoint: path,
        method: requestOptions.method,
        success: true
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('API request failed', {
        component: 'RoditClient',
        method: 'request',
        requestId,
        duration,
        endpoint,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      });
      
      // Track error metric
      logger.metric && logger.metric('api_request_errors', 1, {
        component: 'RoditClient',
        endpoint: path,
        method: options.method || 'GET',
        error: error.name
      });
      
      logger.metric && logger.metric('api_request_duration_ms', duration, {
        component: 'RoditClient',
        endpoint: path,
        method: options.method || 'GET',
        success: false
      });
      
      throw error;
    }
  }
  
  /**
   * Convert a Unix timestamp to a date string
   * 
   * @param {number} unixTime - Unix timestamp in seconds
   * @returns {Promise<string>} Formatted date string
   */
  async _unixTimeToDateString(unixTime) {
    // Ensure the timestamp is a number
    const timestamp = Number(unixTime);
    
    if (isNaN(timestamp)) {
      throw new Error('Invalid timestamp format');
    }
    
    // Convert to milliseconds and create Date object
    const date = new Date(timestamp * 1000);
    
    // Format the date string in the expected format: YYYY-MM-DDTHH:MM:SSZ
    const isoString = date.toISOString();
    
    // Return the formatted date string
    return isoString;
  }
}

module.exports = RoditClient;
