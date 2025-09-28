/**
 * SessionManager.js - Class for managing authentication sessions
 * 
 * This class provides a unified interface for session management including
 * creation, validation, termination of sessions, and scheduled cleanup_sessions tasks.
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const logger = require("../../services/logger");
const { createLogContext, logErrorWithMetrics } = logger;

const baseModuleContext = createLogContext("ModuleLoader", "SessionManager", {
  loadedAt: new Date().toISOString()
});

logger.debugWithContext("Loading SessionManager.js module", baseModuleContext);

// Get configuration values with fallbacks
const config = require('../../services/configsdk');
const DEFAULT_CLEANUP_INTERVAL = config.get('SESSION_CLEANUP_INTERVAL', 60 * 60 * 1000); // 1 hour in milliseconds
const DEFAULT_TOKEN_RETENTION_PERIOD = config.get('SESSION_TOKEN_RETENTION_PERIOD', 86400 * 7); // 7 days in seconds

/**
 * In-memory session storage implementation
 * Default storage for development and production when no external storage is configured
 */
class InMemorySessionStorage {
  constructor() {
    this.sessions = new Map();
    logger.debugWithContext("InMemorySessionStorage initialized", {
      component: "InMemorySessionStorage",
      storageType: "memory"
    });
  }

  async get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  async set(sessionId, session) {
    this.sessions.set(sessionId, session);
    return true;
  }

  async delete(sessionId) {
    return this.sessions.delete(sessionId);
  }

  async keys() {
    return Array.from(this.sessions.keys());
  }

  async size() {
    return this.sessions.size;
  }

  async clear() {
    this.sessions.clear();
    return true;
  }

  // Additional helper methods for debugging
  getAllSessions() {
    const sessions = {};
    for (const [sessionId, session] of this.sessions.entries()) {
      sessions[sessionId] = session;
    }
    return sessions;
  }

  getStorageInfo() {
    return {
      type: 'InMemorySessionStorage',
      sessionCount: this.sessions.size,
      memoryUsage: process.memoryUsage ? process.memoryUsage() : 'unavailable'
    };
  }
}

// Create default storage instance
const defaultStorage = new InMemorySessionStorage();

// Current storage implementation (starts with default)
let currentStorage = defaultStorage;

// Allow consumers to inject their own storage that implements the required interface
function setStorage(customStorage) {
  if (!customStorage || typeof customStorage !== 'object') {
    throw new Error('setStorage(customStorage) requires a storage object');
  }
  
  const required = ['get', 'set', 'delete', 'keys', 'size', 'clear'];
  const missing = required.filter(method => typeof customStorage[method] !== 'function');
  
  if (missing.length) {
    throw new Error(`Injected storage is missing methods: ${missing.join(', ')}`);
  }
  
  logger.infoWithContext("Custom storage injected", {
    component: "SessionManager",
    storageType: customStorage.constructor?.name || 'CustomStorage',
    requiredMethods: required
  });
  
  currentStorage = customStorage;
}

// Configure storage based on configuration
function configureStorageFromConfig() {
  const config = require('../../services/configsdk');
  let storageType;
  
  try {
    storageType = config.get('SESSION_STORAGE_TYPE');
  } catch (error) {
    // If config fails, keep default storage
    logger.debugWithContext("Using default in-memory storage - config not available", {
      component: "SessionManager",
      error: error.message
    });
    return;
  }
  
  logger.infoWithContext("Configuring session storage from config", {
    component: "SessionManager",
    storageType
  });
  
  switch (storageType.toLowerCase()) {
    case 'memory':
      // Already using in-memory storage by default
      logger.infoWithContext("Using default in-memory storage", {
        component: "SessionManager"
      });
      break;
      
    case 'redis':
      logger.warnWithContext("Redis storage requested but not configured - using in-memory storage", {
        component: "SessionManager",
        note: "Use setStorage() to configure Redis storage with your Redis client"
      });
      break;
      
    case 'database':
    case 'db':
      logger.warnWithContext("Database storage requested but not configured - using in-memory storage", {
        component: "SessionManager", 
        note: "Use setStorage() to configure database storage with your database connection"
      });
      break;
      
    case 'file':
      logger.warnWithContext("File storage requested but not configured - using in-memory storage", {
        component: "SessionManager",
        note: "Use setStorage() to configure file storage with your storage directory"
      });
      break;
      
    default:
      logger.warnWithContext("Unknown storage type - using in-memory storage", {
        component: "SessionManager",
        storageType,
        supportedTypes: ['memory', 'redis', 'database', 'file']
      });
  }
}

class SessionManager {
  constructor() {
    const instanceId = ulid();
    const baseContext = createLogContext("SessionManager", "constructor", { instanceId });
    logger.debugWithContext("SessionManager constructor called", baseContext);
    
    // Note: Token invalidation is now handled via session state checking
    // No separate invalidatedTokens Map needed - tokens are invalid when their session is closed
    
    // Cleanup interval reference
    this.cleanupInterval = null;
    
    this._instanceId = instanceId;
    logger.infoWithContext("SessionManager instance initialized", {
      ...baseContext,
      storageType: currentStorage.constructor?.name || 'DefaultStorage',
      tokenValidationMethod: "session_state_based"
    });
  }

  // Storage facade - delegates to current storage
  get storage() {
    return currentStorage;
  }

  /**
   * Generate a new session ID incorporating the RODiT token ID
   * 
   * @param {string} roditId - The peer RODiT token ID to incorporate into the session ID
   * @returns {string} A unique session ID
   */
  generateSessionId(roditId) {
    const requestId = ulid();
    const baseContext = createLogContext("SessionManager", "generateSessionId", { requestId, roditId });
    
    logger.debugWithContext("Generating new session ID", baseContext);
    
    const sessionId = `sess_${roditId}_${ulid()}`;
    
    logger.debugWithContext("Session ID generated", {
      ...baseContext,
      sessionId
    });
    
    return sessionId;
  }

  /**
   * Create and register a new session
   * 
   * @param {Object} sessionData - Session data to store
   * @param {string} sessionData.roditId - The peer RODiT token ID
   * @param {string} sessionData.ownerId - The peer RODiT owner ID
   * @param {number} sessionData.createdAt - Session creation timestamp (Unix time)
   * @param {number} sessionData.expiresAt - Session expiration timestamp (Unix time)
   * @param {Object} [sessionData.metadata] - Additional session metadata
   * @returns {Object} Session information including the generated session ID
   */
  async createSession(sessionData) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "createSession", { 
      requestId, 
      roditId: sessionData?.roditId 
    });
    
    logger.infoWithContext("Creating new session", baseContext);
    
    try {
      if (!sessionData || !sessionData.roditId) {
        logger.warnWithContext("Missing required session data", baseContext);
        throw new Error('Missing required session data');
      }

      const sessionId = this.generateSessionId(sessionData.roditId);
      const now = Math.floor(Date.now() / 1000);
      
      // Create the session object
      const session = {
        id: sessionId,
        roditId: sessionData.roditId,
        ownerId: sessionData.ownerId,
        createdAt: sessionData.createdAt || now,
        expiresAt: sessionData.expiresAt,
        lastAccessedAt: now,
        status: 'active',
        metadata: sessionData.metadata || {},
      };
      
      // Store the session
      await this.storage.set(sessionId, session);
      
      const duration = Date.now() - startTime;
      
      // Verify the session was stored correctly
      const storedSession = await this.storage.get(sessionId);
      const verificationSuccess = !!storedSession;
      
      logger.infoWithContext("Session created successfully", {
        ...baseContext,
        sessionId,
        expiresAt: new Date(session.expiresAt * 1000).toISOString(),
        duration,
        activeSessionCount: this.getActiveSessionCount(),
        verificationSuccess,
        sessionIdLength: sessionId.length,
        sessionIdPrefix: sessionId.substring(0, 20),
        totalSessionsAfterCreate: await this.storage.size()
      });
      
      // Emit metrics for session creation
      logger.metric("session_creation_ms", duration, {
        component: "SessionManager",
        success: true
      });
      
      return session;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit metrics for session creation failures
      logger.metric("session_creation_ms", duration, {
        component: "SessionManager",
        success: false,
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Session creation failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "session_creation",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      throw error;
    }
  }

  /**
   * Get a session by its ID
   * 
   * @param {string} sessionId - The session ID to retrieve
   * @returns {Promise<Object|null>} The session object or null if not found
   */
  async getSession(sessionId) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "getSession", { requestId, sessionId });
    
    try {
      if (!sessionId) {
        logger.debugWithContext("Get session called with no sessionId", baseContext);
        return null;
      }
      
      const session = await this.storage.get(sessionId);
      
      if (!session) {
        logger.debugWithContext("Session not found", baseContext);
        return null;
      }
      
      // Check if session has expired
      const now = Math.floor(Date.now() / 1000);
      if (session.expiresAt && session.expiresAt < now) {
        // Session has expired
        logger.debugWithContext("Retrieved expired session", {
          ...baseContext,
          expiresAt: new Date(session.expiresAt * 1000).toISOString(),
          now: new Date(now * 1000).toISOString()
        });
        
        // Mark as expired but don't remove it yet
        session.status = 'expired';
        
        const duration = Date.now() - startTime;
        logger.metric("session_retrieval_ms", duration, {
          component: "SessionManager",
          success: true,
          status: "expired"
        });
        
        return session;
      }
      
      // Update last accessed time
      session.lastAccessedAt = now;
      
      const duration = Date.now() - startTime;
      
      logger.debugWithContext("Session retrieved", {
        ...baseContext,
        status: session.status,
        duration
      });
      
      logger.metric("session_retrieval_ms", duration, {
        component: "SessionManager",
        success: true,
        status: session.status
      });
      
      return session;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.metric("session_retrieval_ms", duration, {
        component: "SessionManager",
        success: false,
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Session retrieval failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "session_retrieval",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      return null;
    }
  }

  /**
   * Update an existing session
   * 
   * @param {string} sessionId - The ID of the session to update
   * @param {Object} updates - Fields to update in the session
   * @returns {Object|null} The updated session or null if not found
   */
  updateSession(sessionId, updates) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "updateSession", { 
      requestId, 
      sessionId,
      updatedFields: updates ? Object.keys(updates) : [] 
    });
    
    logger.debugWithContext("Updating session", baseContext);
    
    try {
      const session = this.sessions.get(sessionId);
      
      if (!session) {
        logger.warnWithContext("Attempted to update non-existent session", baseContext);
        return null;
      }
      
      // Apply updates except id which should be immutable
      Object.entries(updates).forEach(([key, value]) => {
        if (key !== 'id') {
          session[key] = value;
        }
      });
      
      // Update last accessed time
      session.lastAccessedAt = Math.floor(Date.now() / 1000);
      
      // Store updated session
      this.sessions.set(sessionId, session);
      
      const duration = Date.now() - startTime;
      
      logger.debugWithContext("Session updated successfully", {
        ...baseContext,
        duration,
        status: session.status
      });
      
      // Emit metrics for session update
      logger.metric("session_update_ms", duration, {
        component: "SessionManager",
        success: true,
        fieldCount: Object.keys(updates).length
      });
      
      return session;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit metrics for session update failures
      logger.metric("session_update_ms", duration, {
        component: "SessionManager",
        success: false,
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Session update failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "session_update",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      return null;
    }
  }

  /**
   * Close a session (mark as closed but retain data)
   * 
   * @param {string} sessionId - The ID of the session to close
   * @param {string} [reason='user_logout'] - Reason for closing the session
   * @param {string} [token=null] - The JWT token associated with this session to invalidate
   * @returns {boolean} Whether the session was successfully closed
   */
  async closeSession(sessionId, reason = 'user_logout', token = null) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "closeSession", { 
      requestId, 
      sessionId,
      reason,
      hasToken: !!token
    });
    
    logger.infoWithContext("Closing session", baseContext);
    
    try {
      const session = await this.storage.get(sessionId);
      
      if (!session) {
        // Enhanced debugging for session not found
        const allSessionIds = await this.storage.keys();
        const sessionCount = await this.storage.size();
        
        logger.warnWithContext("Session not found for closure - may have been cleaned up or expired", {
          ...baseContext,
          sessionCount,
          allSessionIds: allSessionIds.slice(0, 5), // Show first 5 session IDs for debugging
          searchingFor: sessionId,
          sessionIdLength: sessionId?.length,
          sessionIdPrefix: sessionId?.substring(0, 20),
          hasMatchingPrefix: allSessionIds.some(id => id.startsWith(sessionId?.substring(0, 10) || ''))
        });
        
        // Even if session is not found, we should still consider this a successful closure
        // The session may have been cleaned up, expired, or already closed
        // What matters is that the user's intent to logout is honored
        
        // Emit metrics for session not found but still successful logout
        logger.metric("session_closure_ms", Date.now() - startTime, {
          component: "SessionManager",
          success: true, // Changed to true - logout intent is what matters
          reason: "session_not_found_but_logout_successful"
        });
        
        logger.infoWithContext("Session closure considered successful despite session not found", {
          ...baseContext,
          reason: "Session may have been cleaned up, expired, or already closed"
        });
        
        return true; // Changed to true - allow logout to succeed
      }
      
      // Update session status
      session.status = 'closed';
      session.closedAt = Math.floor(Date.now() / 1000);
      session.closeReason = reason;
      
      // Store updated session
      await this.storage.set(sessionId, session);
      
      // Token invalidation is handled by the session state change above
      // No need to call invalidateToken since isTokenInvalidated() checks session status
      let jwt_tokenInvalidated = true; // Token is invalidated by session closure
      
      const duration = Date.now() - startTime;
      
      logger.infoWithContext("Session closed successfully", {
        ...baseContext,
        duration,
        jwt_tokenInvalidated
      });
      
      // Emit metrics for session closure
      logger.metric("session_closure_ms", duration, {
        component: "SessionManager",
        success: true,
        reason,
        jwt_tokenInvalidated
      });
      
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit metrics for session closure failures
      logger.metric("session_closure_ms", duration, {
        component: "SessionManager",
        success: false,
        reason,
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Session close failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "session_closure",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      return false;
    }
  }

  /**
   * Invalidate a token by closing its associated session
   * This is now a wrapper around closeSession for backward compatibility
   * 
   * @param {string} token - The JWT token to invalidate
   * @param {string} reason - Reason for invalidation
   * @param {string} sessionId - Associated session ID (optional, will be extracted from token if not provided)
   * @returns {boolean} Whether the token was successfully invalidated
   */
  async invalidateToken(token, reason = 'user_logout', sessionId = null) {
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext("SessionManager", "invalidateToken", { 
      requestId, 
      reason,
      sessionId: sessionId || 'will_extract_from_token'
    });
    
    logger.debugWithContext("Invalidating token by closing session", baseContext);
    
    try {
      // If sessionId not provided, extract it from the token
      let targetSessionId = sessionId;
      if (!targetSessionId && token) {
        try {
          const tokenParts = token.split('.');
          if (tokenParts.length === 3) {
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            targetSessionId = payload.session_id;
          }
        } catch (decodeError) {
          logger.warnWithContext("Could not extract session_id from token", {
            ...baseContext,
            error: decodeError.message
          });
        }
      }
      
      if (!targetSessionId) {
        logger.warnWithContext("No session ID available for token invalidation", baseContext);
        return false;
      }
      
      // Close the session - this will invalidate the token
      const sessionClosed = await this.closeSession(targetSessionId, reason, null); // Don't pass token to avoid recursion
      
      const duration = Date.now() - startTime;
      
      logger.infoWithContext("Token invalidated by closing session", {
        ...baseContext,
        targetSessionId,
        sessionClosed,
        duration
      });
      
      // Emit metrics for token invalidation
      logger.metric("token_invalidation_ms", duration, {
        component: "SessionManager",
        success: sessionClosed,
        reason,
        method: "session_closure"
      });
      
      return sessionClosed;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit metrics for token invalidation failures
      logger.metric("token_invalidation_ms", duration, {
        component: "SessionManager",
        success: false,
        reason,
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Token invalidation failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "token_invalidation",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      return false;
    }
  }
  
  /**
   * Check if a token has been invalidated based on session state
   * 
   * @param {string} token - The JWT token to check
   * @returns {Promise<boolean>} True if the token is invalidated
   */
  async isTokenInvalidated(token) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "isTokenInvalidated", { requestId });
    
    logger.debugWithContext("Checking if token is invalidated via session state", baseContext);
    
    if (!token) {
      logger.debugWithContext("No token provided to check", baseContext);
      return true; // No token = invalidated
    }
    
    try {
      // Decode JWT token to extract session_id
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        logger.debugWithContext("Invalid JWT format", baseContext);
        return true; // Invalid format = invalidated
      }
      
      // Decode the payload (second part)
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const sessionId = payload.session_id;
      
      if (!sessionId) {
        logger.debugWithContext("No session_id in token", baseContext);
        return true; // No session ID = invalidated
      }
      
      // Check if session exists and is active
      const session = await this.storage.get(sessionId);
      const now = Math.floor(Date.now() / 1000);
      
      let isInvalidated = false;
      let reason = null;
      
      if (!session) {
        isInvalidated = true;
        reason = "session_not_found";
      } else if (session.status !== 'active') {
        isInvalidated = true;
        reason = `session_status_${session.status}`;
      } else if (session.expiresAt && session.expiresAt < now) {
        isInvalidated = true;
        reason = "session_expired";
      }
      
      const duration = Date.now() - startTime;
      
      logger.debugWithContext("Token invalidation check completed via session state", {
        ...baseContext,
        sessionId,
        sessionExists: !!session,
        sessionStatus: session?.status,
        sessionExpiresAt: session?.expiresAt,
        currentTime: now,
        isInvalidated,
        reason,
        duration
      });
      
      // Emit metrics for token invalidation check
      logger.metric("token_invalidation_check_ms", duration, {
        component: "SessionManager",
        success: true,
        isInvalidated,
        reason: reason || "active"
      });
      
      return isInvalidated;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit metrics for token invalidation check failures
      logger.metric("token_invalidation_check_ms", duration, {
        component: "SessionManager",
        success: false,
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Token invalidation check failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "token_invalidation_check",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      // If we can't check due to error, assume it's invalidated for security
      return true;
    }
  }
  
  /**
   * Get invalidation info for a token based on session state
   * 
   * @param {string} token - The JWT token to check
   * @returns {Promise<Object|null>} Invalidation info or null if not invalidated
   */
  async getTokenInvalidationInfo(token) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "getTokenInvalidationInfo", { requestId });
    
    logger.debugWithContext("Getting token invalidation info via session state", baseContext);
    
    if (!token) {
      logger.debugWithContext("No token provided to get invalidation info", baseContext);
      return {
        reason: "no_token_provided",
        invalidatedAt: Math.floor(Date.now() / 1000),
        timestamp: new Date().toISOString(),
        sessionId: null
      };
    }
    
    try {
      // Decode JWT token to extract session_id
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        return {
          reason: "invalid_jwt_format",
          invalidatedAt: Math.floor(Date.now() / 1000),
          timestamp: new Date().toISOString(),
          sessionId: null
        };
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const sessionId = payload.session_id;
      
      if (!sessionId) {
        return {
          reason: "no_session_id_in_token",
          invalidatedAt: Math.floor(Date.now() / 1000),
          timestamp: new Date().toISOString(),
          sessionId: null
        };
      }
      
      // Check session state
      const session = await this.storage.get(sessionId);
      const now = Math.floor(Date.now() / 1000);
      
      let invalidationInfo = null;
      
      if (!session) {
        invalidationInfo = {
          reason: "session_not_found",
          invalidatedAt: now,
          timestamp: new Date().toISOString(),
          sessionId
        };
      } else if (session.status !== 'active') {
        invalidationInfo = {
          reason: `session_status_${session.status}`,
          invalidatedAt: session.closedAt || now,
          timestamp: session.closedAt ? new Date(session.closedAt * 1000).toISOString() : new Date().toISOString(),
          sessionId,
          closeReason: session.closeReason
        };
      } else if (session.expiresAt && session.expiresAt < now) {
        invalidationInfo = {
          reason: "session_expired",
          invalidatedAt: session.expiresAt,
          timestamp: new Date(session.expiresAt * 1000).toISOString(),
          sessionId
        };
      }
      
      const duration = Date.now() - startTime;
      
      logger.debugWithContext("Token invalidation info retrieval completed via session state", {
        ...baseContext,
        sessionId,
        hasInfo: !!invalidationInfo,
        reason: invalidationInfo?.reason,
        duration
      });
      
      // Emit metrics for token invalidation info retrieval
      logger.metric("token_invalidation_info_ms", duration, {
        component: "SessionManager",
        success: true,
        hasInfo: !!invalidationInfo,
        reason: invalidationInfo?.reason || "active"
      });
      
      return invalidationInfo;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit metrics for token invalidation info retrieval failures
      logger.metric("token_invalidation_info_ms", duration, {
        component: "SessionManager",
        success: false,
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Token invalidation info retrieval failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "token_invalidation_info",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      // Return error info
      return {
        reason: "error_checking_session",
        invalidatedAt: Math.floor(Date.now() / 1000),
        timestamp: new Date().toISOString(),
        sessionId: null,
        error: error.message
      };
    }
  }
  
  /**
   * Hash a token for storage in the invalidated tokens list
   * 
   * @param {string} token - The JWT token to hash
   * @returns {string} Hashed token
   * @private
   */
  hashToken(token) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "hashToken", { requestId });
    
    try {
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      
      const duration = Date.now() - startTime;
      
      // Only log at trace level since this is a private internal method
      logger.debugWithContext("Token hashed successfully", {
        ...baseContext,
        duration
      });
      
      return hash;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Token hashing failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "token_hashing",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      throw error; // Rethrow as this is a critical operation
    }
  }
  
  /**
   * Get the count of invalidated tokens
   * 
   * @returns {number} Number of invalidated tokens
   */
  getInvalidatedTokenCount() {
    const requestId = ulid();
    const baseContext = createLogContext("SessionManager", "getInvalidatedTokenCount", { requestId });
    
    const count = this.invalidatedTokens.size;
    
    logger.debugWithContext("Retrieved invalidated token count", {
      ...baseContext,
      count
    });
    
    return count;
  }
  
  /**
   * Clean up old invalidated tokens
   * This should be called periodically to prevent memory leaks
   * 
   * @param {number} maxAge - Maximum age in seconds before removing invalidated token records
   * @returns {number} Number of invalidated token records removed
   */
  cleanupInvalidatedTokens(maxAge = 86400 * 7) { // Default: 7 days
    const requestId = ulid();
    const now = Math.floor(Date.now() / 1000);
    let removedCount = 0;
    
    try {
      // Find old invalidated tokens
      for (const [tokenHash, info] of this.invalidatedTokens.entries()) {
        if (info.invalidatedAt < now - maxAge) {
          this.invalidatedTokens.delete(tokenHash);
          removedCount++;
        }
      }
      
      if (removedCount > 0) {
        logger.info('Cleaned up old invalidated tokens', {
          component: 'SessionManager',
          method: 'cleanupInvalidatedTokens',
          requestId,
          removedCount,
          remainingCount: this.invalidatedTokens.size
        });
        
        // Emit metrics for invalidated token cleanup
        logger.metric && logger.metric('invalidated_tokens_cleaned', removedCount, {
          component: 'SessionManager'
        });
      }
      
      return removedCount;
    } catch (error) {
      logger.error('Invalidated token cleanup failed', {
        component: 'SessionManager',
        method: 'cleanupInvalidatedTokens',
        requestId,
        error: error.message,
        stack: error.stack
      });
      
      return 0;
    }
  }

  /**
   * Check if a session is active
   * 
   * @param {string} sessionId - The ID of the session to check
   * @returns {boolean} Whether the session is active
   */
  isSessionActive(sessionId) {
    if (!sessionId) return false;
    
    const session = this.getSession(sessionId);
    
    // Session is active if it exists, isn't closed or expired
    return session && session.status === 'active';
  }

  /**
   * Clean up expired sessions
   * This should be called periodically to prevent memory leaks
   * 
   * @returns {number} Number of sessions removed
   */
  cleanupExpiredSessions() {
    const requestId = ulid();
    const now = Math.floor(Date.now() / 1000);
    let removedCount = 0;
    
    try {
      // Find expired sessions
      for (const [sessionId, session] of this.sessions.entries()) {
        if (
          (session.expiresAt && session.expiresAt < now) || 
          (session.status === 'closed' && session.closedAt < now - 86400) // Remove closed sessions after 24 hours
        ) {
          this.sessions.delete(sessionId);
          removedCount++;
        }
      }
      
      if (removedCount > 0) {
        logger.info('Cleaned up expired sessions', {
          component: 'SessionManager',
          method: 'cleanupExpiredSessions',
          requestId,
          removedCount,
          remainingCount: this.sessions.size
        });
        
        // Emit metrics for session cleanup
        logger.metric && logger.metric('sessions_cleaned', removedCount, {
          component: 'SessionManager'
        });
      }
      
      return removedCount;
    } catch (error) {
      logger.error('Session cleanup failed', {
        component: 'SessionManager',
        method: 'cleanupExpiredSessions',
        requestId,
        error: error.message,
        stack: error.stack
      });
      
      return 0;
    }
  }

  /**
   * Find all sessions for a given RODiT token ID
   * 
   * @param {string} roditId - The RODiT token ID to search for
   * @returns {Array} Array of sessions for the RODiT
   */
  findSessionsByRoditId(roditId) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "findSessionsByRoditId", { requestId, roditId });
    
    logger.debugWithContext("Finding sessions by RODiT", baseContext);
    
    try {
      const result = [];
      
      for (const session of this.sessions.values()) {
        if (session.roditId === roditId) {
          result.push(session);
        }
      }
      
      const duration = Date.now() - startTime;
      
      logger.debugWithContext("Sessions found by RODiT", {
        ...baseContext,
        count: result.length,
        duration
      });
      
      // Emit metrics for session search
      logger.metric("sessions_search_by_rodit_ms", duration, {
        component: "SessionManager",
        success: true,
        resultCount: result.length
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit metrics for session search failures
      logger.metric("sessions_search_by_rodit_ms", duration, {
        component: "SessionManager",
        success: false,
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Finding sessions by RODiT failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "sessions_search_by_rodit",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      return [];
    }
  }

  /**
   * Get active session count
   * 
   * @returns {number} Number of active sessions
   */
  getActiveSessionCount() {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "getActiveSessionCount", { requestId });
    
    logger.debugWithContext("Counting active sessions", baseContext);
    
    try {
      let count = 0;
      const now = Math.floor(Date.now() / 1000);
      
      for (const session of this.sessions.values()) {
        if (session.status === 'active' && (!session.expiresAt || session.expiresAt > now)) {
          count++;
        }
      }
      
      const duration = Date.now() - startTime;
      
      logger.debugWithContext("Active session count retrieved", {
        ...baseContext,
        count,
        totalSessions: this.sessions.size,
        duration
      });
      
      // Emit metrics for active session count
      logger.metric("active_session_count", count, {
        component: "SessionManager",
        totalSessions: this.sessions.size
      });
      
      return count;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Getting active session count failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "active_session_count",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      return 0;
    }
  }
  /**
   * Start the session cleanup job
   * 
   * @param {number} [interval=DEFAULT_CLEANUP_INTERVAL] - Cleanup interval in milliseconds
   */
  startCleanupJob(interval = DEFAULT_CLEANUP_INTERVAL) {
    const requestId = ulid();
    
    const baseContext = createLogContext(
      "SessionManager",
      "startCleanupJob",
      {
        requestId,
        intervalMs: interval,
        intervalSeconds: interval / 1000
      }
    );
    
    // Clear any existing interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      logger.debugWithContext("Cleared existing cleanup interval", baseContext);
    }
    
    // Schedule the cleanup job
    this.cleanupInterval = setInterval(() => {
      const cleanupRequestId = ulid();
      const startTime = Date.now();
      
      const cleanupContext = createLogContext(
        "SessionManager",
        "scheduledCleanup",
        {
          requestId: cleanupRequestId,
          intervalSeconds: interval / 1000
        }
      );
      
      logger.infoWithContext("Starting scheduled session cleanup", cleanupContext);
      
      try {
        const removedCount = this.cleanupExpiredSessions();
        
        // Also clean up invalidated tokens
        const removedTokensCount = this.cleanupInvalidatedTokens(DEFAULT_TOKEN_RETENTION_PERIOD);
        
        const duration = Date.now() - startTime;
        
        logger.infoWithContext("Session and token cleanup completed", {
          ...cleanupContext,
          duration,
          removedSessionsCount: removedCount,
          removedTokensCount,
          remainingSessions: this.getActiveSessionCount(),
          remainingInvalidatedTokens: this.getInvalidatedTokenCount()
        });
        
        // Emit metrics for scheduled cleanup
        logger.metric("scheduled_session_cleanup_ms", duration, {
          component: "SessionManager",
          success: true,
          removedSessions: removedCount,
          removedTokens: removedTokensCount
        });
        logger.metric("sessions_removed_total", removedCount, {
          component: "SessionManager",
          cleanupType: "scheduled"
        });
        logger.metric("tokens_removed_total", removedTokensCount, {
          component: "SessionManager",
          cleanupType: "scheduled"
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        
        // Emit metrics for cleanup failures
        logger.metric("scheduled_session_cleanup_ms", duration, {
          component: "SessionManager",
          success: false,
          error: error.name || "Unknown"
        });
        logger.metric("cleanup_errors_total", 1, {
          component: "SessionManager",
          cleanupType: "scheduled",
          error_type: error.name || "Unknown"
        });
        
        logErrorWithMetrics(
          "Scheduled session cleanup failed", 
          {
            ...cleanupContext,
            duration,
            errorMessage: error.message
          },
          error,
          "scheduled_cleanup",
          {
            result: "error",
            error_type: error.name || "Unknown",
            duration
          }
        );
      }
    }, interval);
    
    logger.infoWithContext("Session cleanup job started", {
      ...baseContext,
      intervalSeconds: interval / 1000
    });
    
    // Emit metrics for job start
    logger.metric("cleanup_job_started", 1, {
      component: "SessionManager",
      intervalSeconds: interval / 1000
    });
  }

  /**
   * Stop the session cleanup job
   */
  stopCleanupJob() {
    const requestId = ulid();
    
    const baseContext = createLogContext(
      "SessionManager",
      "stopCleanupJob",
      { requestId }
    );
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      
      logger.infoWithContext("Session cleanup job stopped", baseContext);
      
      // Emit metrics for job stop
      logger.metric("cleanup_job_stopped", 1, {
        component: "SessionManager"
      });
    } else {
      logger.debugWithContext("No cleanup job running to stop", baseContext);
    }
  }

  /**
   * Run a manual cleanup of expired sessions and invalidated tokens
   * 
   * @param {number} [tokenRetentionPeriod=DEFAULT_TOKEN_RETENTION_PERIOD] - How long to keep invalidated tokens in seconds
   * @returns {Promise<Object>} Cleanup results with counts
   */
  async runManualCleanup(tokenRetentionPeriod = DEFAULT_TOKEN_RETENTION_PERIOD) {
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      "SessionManager",
      "runManualCleanup",
      { requestId }
    );
    
    logger.infoWithContext("Starting manual session and token cleanup", baseContext);
    
    try {
      const removedSessionsCount = this.cleanupExpiredSessions();
      
      // Also clean up invalidated tokens
      const removedTokensCount = this.cleanupInvalidatedTokens(tokenRetentionPeriod);
      
      const duration = Date.now() - startTime;
      
      const resultContext = {
        ...baseContext,
        duration,
        removedSessionsCount,
        removedTokensCount,
        remainingSessions: this.getActiveSessionCount(),
        remainingInvalidatedTokens: this.getInvalidatedTokenCount()
      };
      
      logger.infoWithContext("Manual cleanup completed", resultContext);
      
      // Emit metrics for manual cleanup
      logger.metric("manual_cleanup_ms", duration, {
        component: "SessionManager",
        success: true,
        removedSessions: removedSessionsCount,
        removedTokens: removedTokensCount
      });
      logger.metric("sessions_removed_total", removedSessionsCount, {
        component: "SessionManager",
        cleanupType: "manual"
      });
      logger.metric("tokens_removed_total", removedTokensCount, {
        component: "SessionManager",
        cleanupType: "manual"
      });
      
      return {
        removedSessionsCount,
        removedTokensCount,
        remainingSessions: this.getActiveSessionCount(),
        remainingInvalidatedTokens: this.getInvalidatedTokenCount(),
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Emit metrics for manual cleanup failures
      logger.metric("manual_cleanup_ms", duration, {
        component: "SessionManager",
        success: false,
        error: error.name || "Unknown"
      });
      logger.metric("cleanup_errors_total", 1, {
        component: "SessionManager",
        cleanupType: "manual",
        error_type: error.name || "Unknown"
      });
      
      logErrorWithMetrics(
        "Manual cleanup failed", 
        {
          ...baseContext,
          duration,
          errorMessage: error.message
        },
        error,
        "manual_cleanup",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );
      
      throw error;
    }
  }
}

// Create a singleton instance
const sessionManager = new SessionManager();

// Export the singleton instance, storage class, configuration functions, and constants
module.exports = {
  sessionManager,
  InMemorySessionStorage,
  setStorage,
  configureStorageFromConfig,
  DEFAULT_CLEANUP_INTERVAL,
  DEFAULT_TOKEN_RETENTION_PERIOD
};