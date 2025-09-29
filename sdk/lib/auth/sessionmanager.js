const { ulid } = require('ulid');
const logger = require("../../services/logger");
const { createLogContext, logErrorWithMetrics } = logger;
const baseModuleContext = createLogContext("ModuleLoader", "SessionManager", {
  loadedAt: new Date().toISOString()
});
const config = require('../../services/configsdk');
const DEFAULT_CLEANUP_INTERVAL = config.get('SESSION_CLEANUP_INTERVAL', 60 * 60 * 1000); // 1 hour in milliseconds
const DEFAULT_TOKEN_RETENTION_PERIOD = config.get('SESSION_TOKEN_RETENTION_PERIOD', 86400 * 7); // 7 days in seconds
class InMemorySessionStorage {
  constructor() {
    this.sessions = new Map();

  }

  async get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // Check if session is expired and auto-cleanup
    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAt && session.expiresAt < now) {
      // Session is expired, remove it
      this.sessions.delete(sessionId);
      return null;
    }
    
    return session;
  }

  async set(sessionId, session) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId must be a non-empty string');
    }
    
    // Add timestamp for tracking
    if (session && typeof session === 'object') {
      session.updatedAt = Math.floor(Date.now() / 1000);
    }
    
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

  async getAll() {
    // Return an array of all session objects
    return Array.from(this.sessions.values());
  }

  // Additional helper methods for debugging
  async getAllSessions() {
    const sessions = {};
    for (const [sessionId, session] of this.sessions.entries()) {
      sessions[sessionId] = session;
    }
    return sessions;
  }

  async getStorageInfo() {
    return {
      type: 'InMemorySessionStorage',
      sessionCount: this.sessions.size,
      memoryUsage: process.memoryUsage ? process.memoryUsage() : 'unavailable',
      timestamp: new Date().toISOString()
    };
  }

  // Validate session structure
  _validateSession(session) {
    if (!session || typeof session !== 'object') {
      return false;
    }
    const required = ['id', 'status', 'createdAt'];
    return required.every(prop => prop in session);
  }
}

const defaultStorage = new InMemorySessionStorage();

let currentStorage = defaultStorage;

function setStorage(customStorage) {
  if (!customStorage || typeof customStorage !== 'object') {
    throw new Error('setStorage(customStorage) requires a storage object');
  }
  
  const required = ['get', 'set', 'delete', 'keys', 'size', 'clear'];
  const missing = required.filter(method => typeof customStorage[method] !== 'function');
  
  if (missing.length) {
    throw new Error(`Injected storage is missing methods: ${missing.join(', ')}`);
  }
  

  
  currentStorage = customStorage;
}

function configureStorageFromConfig() {
  const config = require('../../services/configsdk');
  let storageType;
  
  try {
    storageType = config.get('SESSION_STORAGE_TYPE');
  } catch (error) {
    // If config fails, keep default storage

    return;
  }

  
  switch (storageType.toLowerCase()) {
    case 'memory':
      // Already using in-memory storage by default

      break;
      
    case 'redis':

      break;
      
    case 'database':
    case 'db':

      break;
      
    case 'file':

      break;
      
    default:

  }
}

class SessionManager {
  constructor() {
    const instanceId = ulid();
    const baseContext = createLogContext("SessionManager", "constructor", { instanceId });

    
    // Note: Token invalidation is now handled via session state checking
    // No separate invalidatedTokens Map needed - tokens are invalid when their session is closed
    
    // Cleanup interval reference
    this.cleanupInterval = null;
    
    this._instanceId = instanceId;

  }

  // Storage facade - delegates to current storage with proper binding
  get storage() {
    return {
      get: currentStorage.get.bind(currentStorage),
      set: currentStorage.set.bind(currentStorage),
      delete: currentStorage.delete.bind(currentStorage),
      keys: currentStorage.keys.bind(currentStorage),
      size: currentStorage.size.bind(currentStorage),
      clear: currentStorage.clear.bind(currentStorage),
      getAll: currentStorage.getAll ? currentStorage.getAll.bind(currentStorage) : undefined
    };
  }


  generateSessionId(roditId) {
    const requestId = ulid();
    const baseContext = createLogContext("SessionManager", "generateSessionId", { requestId, roditId });
        
    const sessionId = `sess_${roditId}_${ulid()}`;
 
    
    return sessionId;
  }


  async createSession(sessionData) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "createSession", { 
      requestId, 
      roditId: sessionData?.roditId 
    });
    
    
    try {
      if (!sessionData || !sessionData.roditId) {
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
    
      
      return session;
    } catch (error) {
      const duration = Date.now() - startTime;
        
      throw error;
    }
  }


  async getSession(sessionId) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "getSession", { requestId, sessionId });
    
    try {
      if (!sessionId) {
        return null;
      }
      
      const session = await this.storage.get(sessionId);
      
      if (!session) {
        return null;
      }
      
      // Check if session has expired
      const now = Math.floor(Date.now() / 1000);
      if (session.expiresAt && session.expiresAt < now) {
  
        
        // Mark as expired but don't remove it yet
        session.status = 'expired';
        
        const duration = Date.now() - startTime;
 
        
        return session;
      }
      
      // Update last accessed time
      session.lastAccessedAt = now;
      // Persist updated access time back to storage
      await this.storage.set(sessionId, session);
      
      const duration = Date.now() - startTime;
      
 

      
      return session;
    } catch (error) {
      const duration = Date.now() - startTime;
      

      
      
      return null;
    }
  }


  async updateSession(sessionId, updates) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "updateSession", { 
      requestId, 
      sessionId,
      updatedFields: updates ? Object.keys(updates) : [] 
    });
    

    
    try {
      // Load session from configured storage
      const session = await this.storage.get(sessionId);
      
      if (!session) {
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
      
      // Store updated session in storage
      await this.storage.set(sessionId, session);
      
      const duration = Date.now() - startTime;
      
            
      return session;
    } catch (error) {
      const duration = Date.now() - startTime;
    
      
      return null;
    }
  }

  async closeSession(sessionId, reason = 'user_logout', token = null) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "closeSession", { 
      requestId, 
      sessionId,
      reason,
      hasToken: !!token
    });
    
    try {
      const session = await this.storage.get(sessionId);
      
      if (!session) {
        // Enhanced debugging for session not found
        const allSessionIds = await this.storage.keys();
        const sessionCount = await this.storage.size();

        
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
      
      
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      

      
      return false;
    }
  }


  async invalidateToken(token, reason = 'user_logout', sessionId = null) {
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext("SessionManager", "invalidateToken", { 
      requestId, 
      reason,
      sessionId: sessionId || 'will_extract_from_token'
    });
    
    try {
      // If sessionId not provided, extract it from the token
      let targetSessionId = sessionId;
      if (!targetSessionId && token) {
        try {
          const tokenParts = token.split('.');
          if (tokenParts.length === 3) {
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
            targetSessionId = payload.session_id;
          }
        } catch (decodeError) {

        }
      }
      
      if (!targetSessionId) {
        return false;
      }
      
      // Close the session - this will invalidate the token
      const sessionClosed = await this.closeSession(targetSessionId, reason, null); // Don't pass token to avoid recursion
      
      const duration = Date.now() - startTime;

      
      return sessionClosed;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      
      return false;
    }
  }
  

  async isTokenInvalidated(token) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "isTokenInvalidated", { requestId });
      
    if (!token) {
      return true; // No token = invalidated
    }
    
    try {
      // Decode JWT token to extract session_id
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        return true; // Invalid format = invalidated
      }
      
      // Decode the payload (second part) using base64url
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
      const sessionId = payload.session_id;
      
      if (!sessionId) {
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

      return isInvalidated;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // If we can't check due to error, assume it's invalidated for security
      return true;
    }
  }
  

  async getTokenInvalidationInfo(token) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "getTokenInvalidationInfo", { requestId });
    
    
    if (!token) {
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
            return invalidationInfo;
    } catch (error) {
      const duration = Date.now() - startTime;
  
      
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
  

  hashToken(token) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "hashToken", { requestId });
    
    try {
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      
      const duration = Date.now() - startTime;
      
      
      return hash;
    } catch (error) {
      const duration = Date.now() - startTime;

      
      throw error; // Rethrow as this is a critical operation
    }
  }
  

  async isSessionActive(sessionId) {
    if (!sessionId) return false;
    const session = await this.getSession(sessionId);
    // Session is active if it exists, isn't closed or expired
    return !!(session && session.status === 'active');
  }

  async cleanupExpiredSessions() {
    const requestId = ulid();
    const now = Math.floor(Date.now() / 1000);
    let removedCount = 0;
    
    try {
      // Get all sessions from storage (support backends without getAll)
      let allSessions = [];
      if (typeof this.storage.getAll === 'function') {
        allSessions = await this.storage.getAll();
      } else {
        const ids = await this.storage.keys();
        for (const id of ids) {
          const s = await this.storage.get(id);
          if (s) allSessions.push(s);
        }
      }
      
      // Find expired sessions
      for (const session of allSessions) {
        const sessionId = session.id || session.sessionId;
        if (!sessionId) {
          continue;
        }
        if (
          (session.expiresAt && session.expiresAt < now) || 
          (session.status === 'closed' && session.closedAt < now - 86400) // Remove closed sessions after 24 hours
        ) {
          await this.storage.delete(sessionId);
          removedCount++;
        }
      }
      
      if (removedCount > 0) {


      }
      
      return removedCount;
    } catch (error) {

      
      return 0;
    }
  }


  async findSessionsByRoditId(roditId) {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "findSessionsByRoditId", { requestId, roditId });
    
    
    try {
      let result = [];
      // Get sessions from storage
      let allSessions = [];
      if (typeof this.storage.getAll === 'function') {
        allSessions = await this.storage.getAll();
      } else {
        const ids = await this.storage.keys();
        for (const id of ids) {
          const s = await this.storage.get(id);
          if (s) allSessions.push(s);
        }
      }
      result = allSessions.filter(s => s && s.roditId === roditId);
      
      const duration = Date.now() - startTime;
      
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
          
      
      return [];
    }
  }


  async getActiveSessionCount() {
    const requestId = ulid();
    const startTime = Date.now();
    const baseContext = createLogContext("SessionManager", "getActiveSessionCount", { requestId });
    
    try {
      let count = 0;
      const now = Math.floor(Date.now() / 1000);
      
      // Get all sessions from storage with fallback mechanisms
      let allSessions = [];
      try {
        // First try to use getAll if available
        if (this.storage.getAll) {
          allSessions = await this.storage.getAll();
        } else {
          // Fall back to getting keys and fetching each one
          const ids = await this.storage.keys();
          for (const id of ids) {
            try {
              const s = await this.storage.get(id);
              if (s) allSessions.push(s);
            } catch (err) {
              // Skip any invalid sessions
              continue;
            }
          }
        }
      } catch (err) {
        // If we can't get sessions, return 0
        logger.error('Error getting sessions', { ...baseContext, error: err.message });
        return 0;
      }
      
      // Count active sessions
      for (const session of allSessions) {
        try {
          if (session && 
              typeof session === 'object' && 
              session.status === 'active' && 
              (!session.expiresAt || session.expiresAt > now)) {
            count++;
          }
        } catch (err) {
          // Skip any invalid session objects
          continue;
        }
      }
      
      const duration = Date.now() - startTime;
      logger.debug('Active session count calculated', { ...baseContext, count, duration });
      
      return count;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error in getActiveSessionCount', { 
        ...baseContext, 
        error: error.message, 
        duration 
      });
      
      // Return 0 on any error to ensure the application remains available
      return 0;
    }
  }

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
    }
    
    // Schedule the cleanup job
    this.cleanupInterval = setInterval(async () => {
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
      
      
      try {
        const removedCount = await this.cleanupExpiredSessions();

        const duration = Date.now() - startTime;
   
      } catch (error) {
        const duration = Date.now() - startTime;

      }
    }, interval);

  }


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
      
    } else {
    }
  }

  async runManualCleanup(tokenRetentionPeriod = DEFAULT_TOKEN_RETENTION_PERIOD) {
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      "SessionManager",
      "runManualCleanup",
      { requestId }
    );
    
    
    try {
      const removedSessionsCount = await this.cleanupExpiredSessions();

      const duration = Date.now() - startTime;
      
      const resultContext = {
        ...baseContext,
        duration,
        removedSessionsCount,
        remainingSessions: await this.getActiveSessionCount()
      };
            
      return {
        removedSessionsCount,
        remainingSessions: await this.getActiveSessionCount(),
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;    
      throw error;
    }
  }
}

const sessionManager = new SessionManager();

module.exports = {
  sessionManager,
  InMemorySessionStorage,
  setStorage,
  configureStorageFromConfig,
  DEFAULT_CLEANUP_INTERVAL,
  DEFAULT_TOKEN_RETENTION_PERIOD
};