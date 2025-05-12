/**
 * SessionManager.js - Class for managing authentication sessions
 * 
 * This class provides a unified interface for session management including
 * creation, validation, and termination of sessions.
 * 
 * Copyright (c) 2024 Cableguard, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const logger = require("../../config/logger");

class SessionManager {
  constructor() {
    // Default in-memory session storage
    // In production, this could be replaced with Redis, database, etc.
    this.sessions = new Map();
  }

  /**
   * Generate a new session ID incorporating the RODiT token ID
   * 
   * @param {string} roditId - The peer RODiT token ID to incorporate into the session ID
   * @returns {string} A unique session ID
   */
  generateSessionId(roditId) {
    return `sess_${roditId}_${ulid()}`;
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
  createSession(sessionData) {
    const requestId = ulid();
    
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
      this.sessions.set(sessionId, session);
      
      logger.info('Session created', {
        component: 'SessionManager',
        method: 'createSession',
        requestId,
        sessionId,
        roditId: sessionData.roditId,
        expiresAt: new Date(session.expiresAt * 1000).toISOString(),
      });
      
      // Emit metrics for session creation
      logger.metric && logger.metric('session_creation', 1, {
        component: 'SessionManager'
      });
      
      return session;
    } catch (error) {
      logger.error('Session creation failed', {
        component: 'SessionManager',
        method: 'createSession',
        requestId,
        error: error.message,
        stack: error.stack
      });
      
      // Emit metrics for session creation failures
      logger.metric && logger.metric('session_creation_errors', 1, {
        component: 'SessionManager',
        error: error.constructor.name
      });
      
      throw error;
    }
  }

  /**
   * Get a session by its ID
   * 
   * @param {string} sessionId - The session ID to retrieve
   * @returns {Object|null} The session object or null if not found
   */
  getSession(sessionId) {
    const requestId = ulid();
    
    try {
      if (!sessionId) {
        logger.debug('Get session called with no sessionId', {
          component: 'SessionManager',
          method: 'getSession',
          requestId
        });
        return null;
      }
      
      const session = this.sessions.get(sessionId);
      
      if (!session) {
        logger.debug('Session not found', {
          component: 'SessionManager',
          method: 'getSession',
          requestId,
          sessionId
        });
        return null;
      }
      
      // Check if session has expired
      const now = Math.floor(Date.now() / 1000);
      if (session.expiresAt && session.expiresAt < now) {
        // Session has expired
        logger.debug('Retrieved expired session', {
          component: 'SessionManager',
          method: 'getSession',
          requestId,
          sessionId,
          expiresAt: new Date(session.expiresAt * 1000).toISOString(),
          now: new Date(now * 1000).toISOString()
        });
        
        // Mark as expired but don't remove it yet
        session.status = 'expired';
        return session;
      }
      
      // Update last accessed time
      session.lastAccessedAt = now;
      
      logger.debug('Session retrieved', {
        component: 'SessionManager',
        method: 'getSession',
        requestId,
        sessionId,
        status: session.status
      });
      
      return session;
    } catch (error) {
      logger.error('Session retrieval failed', {
        component: 'SessionManager',
        method: 'getSession',
        requestId,
        sessionId,
        error: error.message,
        stack: error.stack
      });
      
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
    
    try {
      const session = this.sessions.get(sessionId);
      
      if (!session) {
        logger.warn('Attempted to update non-existent session', {
          component: 'SessionManager',
          method: 'updateSession',
          requestId,
          sessionId
        });
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
      
      logger.debug('Session updated', {
        component: 'SessionManager',
        method: 'updateSession',
        requestId,
        sessionId,
        updatedKeys: Object.keys(updates)
      });
      
      return session;
    } catch (error) {
      logger.error('Session update failed', {
        component: 'SessionManager',
        method: 'updateSession',
        requestId,
        sessionId,
        error: error.message,
        stack: error.stack
      });
      
      return null;
    }
  }

  /**
   * Close a session (mark as closed but retain data)
   * 
   * @param {string} sessionId - The ID of the session to close
   * @param {string} [reason='user_logout'] - Reason for closing the session
   * @returns {boolean} Whether the session was successfully closed
   */
  closeSession(sessionId, reason = 'user_logout') {
    const requestId = ulid();
    
    try {
      const session = this.sessions.get(sessionId);
      
      if (!session) {
        logger.warn('Attempted to close non-existent session', {
          component: 'SessionManager',
          method: 'closeSession',
          requestId,
          sessionId
        });
        return false;
      }
      
      // Update session status
      session.status = 'closed';
      session.closedAt = Math.floor(Date.now() / 1000);
      session.closeReason = reason;
      
      // Store updated session
      this.sessions.set(sessionId, session);
      
      logger.info('Session closed', {
        component: 'SessionManager',
        method: 'closeSession',
        requestId,
        sessionId,
        reason
      });
      
      // Emit metrics for session closure
      logger.metric && logger.metric('session_closures', 1, {
        component: 'SessionManager',
        reason
      });
      
      return true;
    } catch (error) {
      logger.error('Session close failed', {
        component: 'SessionManager',
        method: 'closeSession',
        requestId,
        sessionId,
        error: error.message,
        stack: error.stack
      });
      
      return false;
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
   * @returns {Array} Array of sessions for the RODiT ID
   */
  findSessionsByRoditId(roditId) {
    const result = [];
    
    for (const session of this.sessions.values()) {
      if (session.roditId === roditId) {
        result.push(session);
      }
    }
    
    return result;
  }

  /**
   * Get active session count
   * 
   * @returns {number} Number of active sessions
   */
  getActiveSessionCount() {
    let count = 0;
    const now = Math.floor(Date.now() / 1000);
    
    for (const session of this.sessions.values()) {
      if (session.status === 'active' && (!session.expiresAt || session.expiresAt > now)) {
        count++;
      }
    }
    
    return count;
  }
}

// Create a singleton instance
const sessionManager = new SessionManager();

module.exports = sessionManager;