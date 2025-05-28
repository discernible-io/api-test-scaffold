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

// Import authentication middleware for direct use
const authMw = require("../middleware/authenticationmw");

/**
 * RoditClient class
 * Main client interface for interacting with RODiT API services
 */
class RoditClient {
  /**
   * Create a new RODiT client
   * 
   * @param {Object} config - Client configuration
   */
  constructor(options = {}) {
    this.requestId = ulid();
    
    // Store configuration
    this.config = {
      authEndpoint: options.authEndpoint,
      dataEndpoint: options.dataEndpoint,
      configEndpoint: options.configEndpoint
    };
    
    // Initialize state
    this.token = null;
    this.sessionData = null;
    
    logger.debug('Initializing RODiT client', {
      component: 'RoditClient',
      method: 'constructor',
      requestId: this.requestId
    });
    
    // No need to initialize from RoditManager here
    // We'll always get the latest credentials directly from RoditManager when needed
    
    logger.info('RODiT client initialized', {
      component: 'RoditClient',
      method: 'constructor',
      requestId: this.requestId
    });
  }
  
  /**
   * Set configuration - only for non-RODiT derived settings
   * 
   * @param {Object} config - Configuration object
   * @returns {boolean} Success indicator
   */
  setConfig(config) {
    const requestId = ulid();
    
    logger.debug('Setting client configuration', {
      component: 'RoditClient',
      method: 'setConfig',
      requestId,
      configKeys: Object.keys(config)
    });
    
    // Store minimal config for client use
    this.config = {
      ...this.config,
      ...config
    };
    
    // If credentialsPath is provided, pass it to the RoditManager
    if (config.credentialsPath && typeof roditManager.setConfigPath === 'function') {
      roditManager.setConfigPath(config.credentialsPath);
      
      logger.debug('Set credentials path in RoditManager', {
        component: 'RoditClient',
        method: 'setConfig',
        requestId,
        credentialsPath: config.credentialsPath
      });
    }
    
    return true;
  }
  
  /**
   * Set authentication token
   * 
   * @param {string} token - Authentication token
   * @returns {boolean} Success indicator
   */
  setToken(token) {
    const requestId = ulid();
    
    logger.debug('Setting authentication token', {
      component: 'RoditClient',
      method: 'setToken',
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
        this.setToken(loginResult.jwt_token);
        
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
