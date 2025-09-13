/**
 * RODiT Client Interface
 * Provides a clean API for interacting with RODiT services
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
const roditManager = require('./lib/auth/roditmanager');
const stateManager = require('./lib/blockchain/statemanager');
const authMw = require('./lib/middleware/authenticationmw');
const { ensureProtocol } = require('./utils');
const { versionManager } = require('./lib/versioning/versionmanager');

// External logger for compatibility during transition
const externalLogger = require('./services/logger');

// Internal logger implementation for the SDK
const logger = {
  debug: (message, context = {}) => {
    if (process.env.DEBUG) {
      console.debug(`[RODiT-SDK][DEBUG] ${message}`, context);
    }
  },
  info: (message, context = {}) => {
    console.info(`[RODiT-SDK][INFO] ${message}`, context);
  },
  warn: (message, context = {}) => {
    console.warn(`[RODiT-SDK][WARN] ${message}`, context);
  },
  error: (message, context = {}, error) => {
    console.debug(`[RODiT-SDK][ERROR] ${message}`, context, error);
  },
  debugWithContext: (message, context = {}) => {
    if (process.env.DEBUG) {
      console.debug(`[RODiT-SDK][DEBUG] ${message}`, context);
    }
  },
  infoWithContext: (message, context = {}) => {
    console.info(`[RODiT-SDK][INFO] ${message}`, context);
  },
  warnWithContext: (message, context = {}) => {
    console.warn(`[RODiT-SDK][WARN] ${message}`, context);
  },
  errorWithContext: (message, context = {}, error) => {
    console.debug(`[RODiT-SDK][ERROR] ${message}`, context, error);
  }
};
// Avoid circular dependency - will require filecredentialsstore dynamically when needed

// Track state of SDK client execution
const sdkClientState = {
  isInitialized: false,
  client: null,
  lastTestResults: null,
  lastError: null,
  initTime: null,
  apiEndpoint: null,
  metrics: {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    lastRequestTime: null
  }
};

/**
 * RoditClient class
 * Main client interface for interacting with RODiT ID API services
 * 
 * @example
 * const { RoditClient } = require('@rodit/rodit-sdk');
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
   * @param {string} [options.credentialsFilePath] - Path to credentials file
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
      credentialsFilePath: options.credentialsFilePath,
      apiVersion: options.apiVersion || '1.0.0',
      versionHeaderType: options.versionHeaderType || 'both'
    };
    
    // Configure version manager if custom version is specified
    if (options.apiVersion) {
      versionManager.setVersion(options.apiVersion);
    }
    
    if (options.versionHeaderType) {
      versionManager.setHeaderType(options.versionHeaderType);
    }
    
    logger.debug('RODiT client instance created', {
      component: 'RoditClient',
      method: 'constructor',
      requestId: this.requestId,
      apiVersion: this.config.apiVersion
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
      /*
      // Initialize RoditManager if credentials path is provided
      if (this.config.credentialsFilePath) {
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
          // Resolve the full path to the credentials file
          const credentialsPath = path.isAbsolute(this.config.credentialsFilePath) 
            ? this.config.credentialsFilePath 
            : path.join(process.cwd(), this.config.credentialsFilePath);
          
          // Check if file exists and is readable
          await fs.access(credentialsPath, fs.constants.R_OK);
          
          // Read and parse the credentials file
          const credentialsData = await fs.readFile(credentialsPath, 'utf8');
          const credentials = JSON.parse(credentialsData);
          
          // Set the configuration in the state manager
          if (typeof stateManager.setConfigOwnRodit === 'function') {
            await stateManager.setConfigOwnRodit({ own_rodit: credentials });
            
            logger.debug('Successfully loaded RODiT configuration', {
              component: 'RoditClient',
              method: 'init',
              requestId,
              credentialsPath
            });
          }
          
          // Initialize RoditManager with the config path if needed
          if (typeof roditManager.setConfigPath === 'function') {
            await roditManager.setConfigPath(credentialsPath);
            
            logger.debug('Initialized RoditManager with credentials', {
              component: 'RoditClient',
              method: 'init',
              requestId,
              credentialsPath
            });
          }
        } catch (error) {
          logger.error('Failed to load RODiT configuration', {
            component: 'RoditClient',
            method: 'init',
            requestId,
            error: error.message,
            stack: error.stack,
            credentialsFilePath: this.config.credentialsFilePath
          });
          
          throw new Error(`Failed to load RODiT configuration: ${error.message}`);
        }
      } */

      // Verify we can access required configuration
      const config_own_rodit = await stateManager.getConfigOwnRodit();
      if (!config_own_rodit) {
        throw new Error('Failed to load RODiT configuration');
      }

      // Store token metadata for later use
      // The metadata is nested inside config_own_rodit.own_rodit.metadata based on the AuthStateManager structure
      this.roditMetadata = (config_own_rodit.own_rodit && config_own_rodit.own_rodit.metadata) || {};
      
      // Set default endpoints from config if not provided
      if (!this.config.authEndpoint && this.roditMetadata.auth_endpoint) {
        this.config.authEndpoint = ensureProtocol(this.roditMetadata.auth_endpoint);
      }
      
      if (!this.config.dataEndpoint && this.roditMetadata.subjectuniqueidentifier_url) {
        this.config.dataEndpoint = ensureProtocol(this.roditMetadata.subjectuniqueidentifier_url);
      }
      
      // Initialize rate limiting state if max_requests is defined
      if (this.roditMetadata.max_requests && this.roditMetadata.maxrq_window) {
        this.rateLimitState = {
          maxRequests: parseInt(this.roditMetadata.max_requests, 10),
          windowSeconds: parseInt(this.roditMetadata.maxrq_window, 10),
          requestCount: 0,
          windowStart: Date.now()
        };
      }
      
      // Parse JSON fields
      try {
        if (this.roditMetadata.allowed_iso3166list) {
          this.allowedRegions = JSON.parse(this.roditMetadata.allowed_iso3166list);
        }
        
        if (this.roditMetadata.permissioned_routes) {
          this.permissionedRoutes = JSON.parse(this.roditMetadata.permissioned_routes);
        }
      } catch (parseError) {
        logger.warn('Failed to parse JSON metadata fields', {
          component: 'RoditClient',
          method: 'init',
          requestId,
          error: parseError.message
        });
      }

      // Initialize OpenAPI spec if URL is provided
      if (this.roditMetadata.openapijson_url) {
        this.openApiUrl = ensureProtocol(this.roditMetadata.openapijson_url);
        // We'll fetch this on-demand to avoid slowing down initialization
      }

      // Initialize webhook configuration if URL is provided
      if (this.roditMetadata.webhook_url) {
        this.webhookUrl = ensureProtocol(this.roditMetadata.webhook_url);
        this.webhookCidr = this.roditMetadata.webhook_cidr || '0.0.0.0/0';
      }

      this.initialized = true;
      
      logger.info('RODiT client initialized successfully', {
        component: 'RoditClient',
        method: 'init',
        requestId,
        endpoints: {
          auth: this.config.authEndpoint,
          data: this.config.dataEndpoint,
          openApi: this.openApiUrl,
          webhook: this.webhookUrl
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
   * Make an authenticated request to the RODiT ID API
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
    
    // Check token validity before proceeding
    if (!this.isTokenValid()) {
      throw new Error('RODiT token is not valid at the current time');
    }
    
    // Check if the operation is permitted
    if (!this.isOperationPermitted(method, path)) {
      throw new Error(`Operation not permitted: ${method} ${path}`);
    }
    
    // Apply rate limiting if configured
    if (this.rateLimitState) {
      await this.applyRateLimit();
    }

    const url = new URL(path, this.config.dataEndpoint).toString();
    const headers = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      ...options.headers
    };
    
    // Apply API version headers
    const versionHeaders = versionManager.getVersionHeaders();
    Object.assign(headers, versionHeaders);

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
        requestMethod: options.method || 'POST'
      });

      const response = await fetch(url, config);
      
      // Update rate limit counters
      if (this.rateLimitState) {
        this.rateLimitState.requestCount++;
      }
      
      // Handle rate limiting response headers if present
      if (response.headers.has('X-RateLimit-Remaining')) {
        const remaining = parseInt(response.headers.get('X-RateLimit-Remaining'), 10);
        const reset = parseInt(response.headers.get('X-RateLimit-Reset'), 10);
        
        logger.debug('Rate limit info from server', {
          component: 'RoditClient',
          method: 'request',
          requestId,
          rateLimitRemaining: remaining,
          rateLimitReset: reset
        });
      }

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Handle specific error types
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        } else if (response.status === 401) {
          // Token might be expired, try to refresh
          if (options.autoRefresh !== false) {
            logger.debug('Attempting to refresh authentication token', {
              component: 'RoditClient',
              method: 'request',
              requestId
            });
            
            await this.refreshToken();
            
            // Retry the request once with the new token
            return this.request(method, path, data, { ...options, autoRefresh: false });
          }
          throw new Error('Authentication failed');
        }
        
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
      const session = await stateManager.getSession();
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
    stateManager.setJwtToken(token);
    
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
   * Get session data
   * 
   * @returns {Object|null} Session data or null if not set
   */
  getSessionData() {
    const requestId = ulid();
    
    logger.debug('Getting session data', {
      component: 'RoditClient',
      method: 'getSessionData',
      requestId,
      hasSessionData: !!this.sessionData,
      sessionId: this.sessionData?.id
    });
    
    return this.sessionData;
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
   * Get the RODiT token metadata (deprecated, use getRoditMetadata instead)
   * @deprecated Use getRoditMetadata instead
   * @returns {Object} RODiT token metadata
   */
  getTokenMetadata() {
    return this.getRoditMetadata();
  }
  
  /**
   * Get the current state of the client
   * @returns {Object} Current client state
   */
  getClientState() {
    return {
      ...sdkClientState,
      // Add computed properties
      uptime: sdkClientState.initTime ? 
        Math.floor((Date.now() - new Date(sdkClientState.initTime).getTime()) / 1000) : 
        null,
      status: sdkClientState.isInitialized ? 
        (sdkClientState.lastError ? 'warning' : 'healthy') : 
        'not_initialized',
      lastTestSummary: sdkClientState.lastTestResults ? {
        success: sdkClientState.lastTestResults.success,
        passRate: sdkClientState.lastTestResults.totalTests > 0 ? 
          (sdkClientState.lastTestResults.passedTests / sdkClientState.lastTestResults.totalTests) * 100 : 
          0,
        timestamp: sdkClientState.lastTestResults.timestamp
      } : null
    };
  }
  
  /**
   * Create and initialize a new RODiT client
   * @returns {Promise<RoditClient>} Initialized RoditClient instance
   */
  static async createClient() {
    const requestId = ulid();
    const startTime = Date.now();
    
    try {
      logger.info('Creating RODiT client', {
        component: 'RoditClient',
        method: 'createClient',
        requestId
      });
      
      // Step 1: Initialize the RODiT configuration with the client namespace
      // This will load credentials from file, fetch RODiT from blockchain, and set up the AuthStateManager
      await roditManager.initializeRoditConfig('client');
      
      // Step 2: Create a new client instance
      const client = new RoditClient();
      
      // Step 3: Initialize the client with the configuration from AuthStateManager
      await client.init();
      
      // Update our SDK client state with information from the client
      if (client) {
        const metadata = client.getTokenMetadata();
        const apiEndpoint = metadata?.subjectuniqueidentifier_url;
        
        if (apiEndpoint) {
          sdkClientState.apiEndpoint = apiEndpoint;
        }
        
        sdkClientState.isInitialized = true;
        sdkClientState.client = client;
        sdkClientState.initTime = new Date().toISOString();
        
        logger.info('RODiT client created successfully', {
          component: 'RoditClient',
          method: 'createClient',
          requestId,
          duration: Date.now() - startTime,
          apiEndpoint
        });
      }
      
      return client;
    } catch (error) {
      // Update error state
      sdkClientState.lastError = {
        message: error.message,
        stack: error.stack,
        time: new Date().toISOString()
      };
      
      logger.error('Failed to create client', {
        component: 'RoditClient',
        method: 'createClient',
        requestId,
        error: error.message,
        stack: error.stack,
        duration: Date.now() - startTime
      });
      
      throw error;
    }
  }
  
  /**
   * Login to the RODiT ID API
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
      const config_own_rodit = await stateManager.getConfigOwnRodit();
      
      if (!config_own_rodit) {
        logger.error('RODiT configuration not set in AuthStateManager', {
          component: 'RoditClient',
          method: 'login',
          requestId
        });
        throw new Error('RODiT configuration not set in AuthStateManager');
      }
      
      // Check if the config_own_rodit has a valid own_rodit property
      if (!config_own_rodit.own_rodit) {
        logger.error('Valid RODiT configuration not found in AuthStateManager', {
          component: 'RoditClient',
          method: 'login',
          requestId,
          configKeys: Object.keys(config_own_rodit)
        });
        throw new Error('Valid RODiT configuration not found in AuthStateManager');
      }
      
      logger.debug('Using login_server for authentication to ensure consistent mutual authentication', {
        component: 'RoditClient',
        method: 'login',
        requestId,
        roditId: config_own_rodit.own_rodit.token_id
      });
      
      // Use login_server directly to ensure consistent mutual authentication
      let loginResult;
      try {
        // Pass the entire config_own_rodit object to login_server
        loginResult = await authMw.login_server(config_own_rodit);
      } catch (error) {
        // Handle server connectivity issues
        const errorMessage = 'Unable to connect to authentication server. The server may be down or unreachable.';
        
        logger.error(errorMessage, {
          component: 'RoditClient',
          method: 'login',
          requestId,
          error: error.message,
          stack: error.stack
        });
        
        throw new Error(errorMessage);
      }
      
      // Check if login was successful
      if (loginResult.error) {
        logger.error('Login failed', {
          component: 'RoditClient',
          method: 'login',
          requestId,
          error: {
            message: 'Failed to login to server',
            details: loginResult.error
          },
          loginResult: JSON.stringify(loginResult)
        });
        
        // Add more detailed debugging information with safe property access
        logger.debug('Login result details', {
          component: 'RoditClient',
          method: 'login',
          requestId,
          apiEndpoint: config_own_rodit?.apiendpoint || 'unknown',
          roditId: config_own_rodit?.own_rodit?.token_id || 'unknown',
          hasPrivateKey: !!(config_own_rodit?.own_rodit_bytes_private_key)
        });
        
        // Provide a more informative error message
        let errorMessage = `Login failed: ${loginResult.error}`;
        
        // Add troubleshooting suggestions based on the error
        if (loginResult.error.includes('server')) {
          errorMessage += '. The authentication server may be down or experiencing issues. Please try again later or contact support.';
        } else if (loginResult.error.includes('credential') || loginResult.error.includes('authentication')) {
          errorMessage += '. Please check your RODiT credentials and try again.';
        }
        
        throw new Error(errorMessage);
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
        roditId: config_own_rodit?.own_rodit?.token_id || 'unknown',
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
   * Logout from the RODiT ID API
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
          authorization: `Bearer ${this.token}`,
          'user-agent': 'RoditClient SDK'
        },
        requestId,
        path: '/api/logout',
        method: 'POST',
        ip: '127.0.0.1',
        get: function(header) {
          // Case-insensitive header lookup
          const headerLower = header.toLowerCase();
          if (headerLower === 'user-agent') {
            return this.headers['user-agent'];
          }
          return this.headers[headerLower];
        }
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
    
    // If we don't have a token, we're definitely not authenticated
    if (!this.token) {
      logger.debug('No token available, client is not authenticated', {
        component: 'RoditClient',
        method: 'isAuthenticated',
        requestId
      });
      return false;
    }
    
    try {
      // Check if we have a valid session
      const sessionData = this.getSessionData();
      
      if (!sessionData) {
        logger.debug('No session data available, client is not authenticated', {
          component: 'RoditClient',
          method: 'isAuthenticated',
          requestId
        });
        return false;
      }
      
      // Check if the session has expired
      const currentTime = Math.floor(Date.now() / 1000);
      if (sessionData.expiresAt && sessionData.expiresAt < currentTime) {
        logger.debug('Session has expired', {
          component: 'RoditClient',
          method: 'isAuthenticated',
          requestId,
          sessionId: sessionData.id,
          expiresAt: sessionData.expiresAt,
          currentTime
        });
        return false;
      }
      
      // If we have a token and a valid non-expired session, we're authenticated
      logger.debug('Client is authenticated with valid token and session', {
        component: 'RoditClient',
        method: 'isAuthenticated',
        requestId,
        sessionId: sessionData.id,
        sessionStatus: sessionData.status
      });
      
      return true;
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
    const config_own_rodit = stateManager.getConfigOwnRodit();
    
    logger.debug('Getting API endpoint from AuthStateManager', {
      component: 'RoditClient',
      method: '_getApiEndpoint',
      requestId,
      hasConfigOwnRodit: !!config_own_rodit,
      configKeys: config_own_rodit ? Object.keys(config_own_rodit) : []
    });
    
    if (!config_own_rodit) {
      throw new Error('RODiT configuration not set in AuthStateManager');
    }
    
    // Check if the RODiT token metadata exists and has the required field
    if (!config_own_rodit.own_rodit || !config_own_rodit.own_rodit.metadata || !config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url) {
      logger.error('Missing required metadata in RODiT configuration', {
        component: 'RoditClient',
        method: '_getApiEndpoint',
        requestId,
        hasOwnRodit: !!config_own_rodit.own_rodit,
        hasMetadata: config_own_rodit.own_rodit ? !!config_own_rodit.own_rodit.metadata : false,
        metadataKeys: config_own_rodit.own_rodit && config_own_rodit.own_rodit.metadata ? 
                     Object.keys(config_own_rodit.own_rodit.metadata) : []
      });
      
      throw new Error('subjectuniqueidentifier_url not found in RODiT token metadata');
    }
    
    let baseUrl = config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url;
    
    // Handle localhost with port for local testing
    try {
      const config = require('./services/config');
      if (baseUrl === 'localhost' && config.has('SERVERPORT')) {
        baseUrl = `${baseUrl}:${config.get('SERVERPORT')}`;
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
  
  /**
   * Check if the RODiT token is valid at the current time
   * @returns {boolean} True if the token is valid
   */
  isTokenValid() {
    if (!this.roditMetadata) {
      return false;
    }
    
    const now = new Date();
    let isValid = true;
    
    // Check not_before date if present
    if (this.roditMetadata.not_before) {
      const notBefore = new Date(this.roditMetadata.not_before);
      if (now < notBefore) {
        logger.debug('Token not yet valid', {
          component: 'RoditClient',
          method: 'isTokenValid',
          now: now.toISOString(),
          notBefore: notBefore.toISOString()
        });
        isValid = false;
      }
    }
    
    // Check not_after date if present
    if (this.roditMetadata.not_after) {
      const notAfter = new Date(this.roditMetadata.not_after);
      if (now > notAfter) {
        logger.debug('Token has expired', {
          component: 'RoditClient',
          method: 'isTokenValid',
          now: now.toISOString(),
          notAfter: notAfter.toISOString()
        });
        isValid = false;
      }
    }
    
    return isValid;
  }
  
  /**
   * Check if an operation is permitted based on permissioned_routes
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @returns {boolean} True if the operation is permitted
   */
  isOperationPermitted(method, path) {
    // If no permissioned routes are defined, allow all
    if (!this.permissionedRoutes) {
      return true;
    }
    
    try {
      // Check if the path matches any permissioned route
      const entities = this.permissionedRoutes.entities;
      if (!entities) {
        return true;
      }
      
      // Check if the method+path combination is in the permissioned routes
      const methods = entities.methods;
      if (!methods) {
        return true;
      }
      
      // If the path is explicitly listed, check its permission value
      if (methods[path]) {
        const permission = methods[path];
        // "+0" or any positive value indicates permission is granted
        return permission.startsWith('+');
      }
      
      // If not explicitly listed, check for wildcard patterns
      // This is a simplified implementation - could be enhanced with proper pattern matching
      const wildcardPaths = Object.keys(methods).filter(p => p.includes('*'));
      for (const wildcardPath of wildcardPaths) {
        const pattern = wildcardPath.replace('*', '.*');
        const regex = new RegExp(pattern);
        if (regex.test(path)) {
          const permission = methods[wildcardPath];
          return permission.startsWith('+');
        }
      }
      
      // Default to allowed if not explicitly denied
      return true;
    } catch (error) {
      logger.error('Error checking operation permission', {
        component: 'RoditClient',
        method: 'isOperationPermitted',
        error: error.message,
        path,
        httpMethod: method
      });
      // Default to allowed on error
      return true;
    }
  }
  
  /**
   * Get the webhook secret for signature verification
   * @returns {Promise<string>} Webhook secret
   */
  async getWebhookSecret() {
    // In a real implementation, this would retrieve the webhook secret from a secure location
    // For now, we'll use a placeholder
    return 'webhook-secret';
  }
  
  /**
   * Get the RODiT token metadata
   * @returns {Object} RODiT token metadata
   */
  getRoditMetadata() {
    return this.tokenMetadata || {};
  }
  
  /**
   * Checks if a subscription is active based on token metadata dates
   * @returns {boolean} True if subscription is active
   */
  isSubscriptionActive() {
    const metadata = this.getRoditMetadata();
    
    if (!metadata) {
      return false;
    }
    
    const now = new Date();
    let isActive = true;
    
    // Check not_before date if present
    if (metadata.not_before) {
      const notBefore = new Date(metadata.not_before);
      if (now < notBefore) {
        logger.debug('Subscription not yet active', {
          component: 'RoditClient',
          method: 'isSubscriptionActive',
          now: now.toISOString(),
          notBefore: notBefore.toISOString()
        });
        isActive = false;
      }
    }
    
    // Check not_after date if present
    if (metadata.not_after) {
      const notAfter = new Date(metadata.not_after);
      if (now > notAfter) {
        logger.debug('Subscription has expired', {
          component: 'RoditClient',
          method: 'isSubscriptionActive',
          now: now.toISOString(),
          notAfter: notAfter.toISOString()
        });
        isActive = false;
      }
    }
    
    return isActive;
  }

  /**
   * Apply rate limiting based on token configuration
   * @returns {Promise<void>}
   */
  async applyRateLimit() {
    if (!this.rateLimitState) {
      return;
    }
    
    const now = Date.now();
    const { maxRequests, windowSeconds, requestCount, windowStart } = this.rateLimitState;
    
    // Reset window if it has expired
    if (now - windowStart > windowSeconds * 1000) {
      this.rateLimitState.requestCount = 0;
      this.rateLimitState.windowStart = now;
      return;
    }
    
    // Check if we've exceeded the rate limit
    if (requestCount >= maxRequests) {
      const waitTime = windowStart + (windowSeconds * 1000) - now;
      
      logger.warn('Rate limit reached, waiting before next request', {
        component: 'RoditClient',
        method: 'applyRateLimit',
        waitTimeMs: waitTime,
        maxRequests,
        requestCount
      });
      
      // Wait until the window resets
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // Reset the window
      this.rateLimitState.requestCount = 0;
      this.rateLimitState.windowStart = Date.now();
    }
  }
  
  /**
   * Refresh the authentication token
   * @returns {Promise<string>} New token
   */
  async refreshToken() {
    logger.debug('Refreshing authentication token', {
      component: 'RoditClient',
      method: 'refreshToken'
    });
    
    // Re-authenticate to get a fresh token
    await this.login();
    
    return this.getSessionToken();
  }
  
  /**
   * Fetch and parse the OpenAPI specification
   * @returns {Promise<Object>} OpenAPI specification
   */
  async getOpenApiSpec() {
    if (!this.openApiUrl) {
      throw new Error('OpenAPI URL not configured');
    }
    
    if (this.openApiSpec) {
      return this.openApiSpec;
    }
    
    try {
      const response = await fetch(this.openApiUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch OpenAPI spec: ${response.status}`);
      }
      
      this.openApiSpec = await response.json();
      return this.openApiSpec;
    } catch (error) {
      logger.error('Failed to fetch OpenAPI specification', {
        component: 'RoditClient',
        method: 'getOpenApiSpec',
        url: this.openApiUrl,
        error: error.message
      });
      throw error;
    }
  }
  
  /**
   * Get available API endpoints from the OpenAPI spec
   * @returns {Promise<Object>} Map of available endpoints
   */
  async getAvailableEndpoints() {
    const spec = await this.getOpenApiSpec();
    const endpoints = {};
    
    // Extract endpoints from the OpenAPI spec
    const paths = spec.paths || {};
    
    for (const [path, methods] of Object.entries(paths)) {
      endpoints[path] = {};
      
      for (const [method, definition] of Object.entries(methods)) {
        if (method === 'parameters') continue; // Skip non-method properties
        
        endpoints[path][method] = {
          operationId: definition.operationId,
          summary: definition.summary,
          description: definition.description,
          parameters: definition.parameters,
          requestBody: definition.requestBody,
          responses: definition.responses
        };
      }
    }
    
    return endpoints;
  }
  
  /**
   * Register a webhook callback
   * @param {string} event - Event type to subscribe to
   * @param {string} callbackUrl - URL to receive webhook events
   * @returns {Promise<Object>} Registration result
   */
  async registerWebhook(event, callbackUrl) {
    if (!this.webhookUrl) {
      throw new Error('Webhook URL not configured in token metadata');
    }
    
    return this.request('POST', '/webhooks/register', {
      event,
      callback_url: callbackUrl
    });
  }
  
  /**
   * Unregister a webhook callback
   * @param {string} event - Event type to unsubscribe from
   * @param {string} callbackUrl - URL that was registered
   * @returns {Promise<Object>} Unregistration result
   */
  async unregisterWebhook(event, callbackUrl) {
    if (!this.webhookUrl) {
      throw new Error('Webhook URL not configured in token metadata');
    }
    
    return this.request('POST', '/webhooks/unregister', {
      event,
      callback_url: callbackUrl
    });
  }
  
  /**
   * Verify a webhook signature
   * @param {string} payload - Webhook payload
   * @param {string} signature - Webhook signature
   * @param {number} timestamp - Webhook timestamp
   * @returns {Promise<boolean>} True if signature is valid
   */
  async verifyWebhookSignature(payload, signature, timestamp) {
    try {
      // This is a placeholder - actual implementation would depend on the signature method
      // used by the webhook sender
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', await this.getWebhookSecret());
      
      hmac.update(`${timestamp}.${payload}`);
      const expectedSignature = hmac.digest('hex');
      
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(signature, 'hex')
      );
    } catch (error) {
      logger.error('Failed to verify webhook signature', {
        component: 'RoditClient',
        method: 'verifyWebhookSignature',
        error: error.message
      });
      return false;
    }
  }
}

/**
 * Create a new RODiT client and initialize it
 * @param {Object} [options] - Client options
 * @returns {Promise<RoditClient>} Initialized client
 */
async function createClient(options = {}) {
  const client = new RoditClient(options);
  await client.init(options);
  return client;
}

/**
 * Get current client state
 * @returns {Object} Client state
 */
function getClientState() {
  if (sdkClientState.client) {
    return sdkClientState.client.getClientState();
  }
  return {
    ...sdkClientState,
    status: 'not_initialized'
  };
}

// Export the SDK components
module.exports = {
  RoditClient,
  createClient,
  getClientState,
  // Export the logger for SDK users who want to customize logging
  logger
};
