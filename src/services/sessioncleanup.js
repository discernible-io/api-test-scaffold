/**
 * sessionCleanup.js - Scheduled task to clean up expired sessions
 * 
 * This module provides functionality to clean up expired sessions periodically
 * to prevent memory leaks in the session store.
 * 
 * Copyright (c) 2024 Ayayai, Inc. All rights reserved.
 */

const logger = require("../../config/logger");
const sessionManager = require("../auth/sessionmanager");

// Default interval is 1 hour
const DEFAULT_CLEANUP_INTERVAL = 60 * 60 * 1000;

// Default token retention period is 7 days (in seconds)
const DEFAULT_TOKEN_RETENTION_PERIOD = 86400 * 7;

let cleanupInterval = null;

/**
 * Start the session cleanup job
 * 
 * @param {number} [interval=DEFAULT_CLEANUP_INTERVAL] - Cleanup interval in milliseconds
 */
function startCleanupJob(interval = DEFAULT_CLEANUP_INTERVAL) {
  // Clear any existing interval
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  
  // Schedule the cleanup job
  cleanupInterval = setInterval(() => {
    const requestId = `cleanup-${Date.now()}`;
    const startTime = Date.now();
    
    logger.info("Starting scheduled session cleanup", {
      component: "SessionCleanup",
      method: "scheduledCleanup",
      requestId,
      interval: interval / 1000 + "s"
    });
    
    try {
      const removedCount = sessionManager.cleanupExpiredSessions();
      
      // Also clean up invalidated tokens
      const removedTokensCount = sessionManager.cleanupInvalidatedTokens(DEFAULT_TOKEN_RETENTION_PERIOD);
      
      const duration = Date.now() - startTime;
      
      logger.info("Session and token cleanup completed", {
        component: "SessionCleanup",
        method: "scheduledCleanup",
        requestId,
        duration,
        removedSessionsCount: removedCount,
        removedTokensCount,
        remainingSessions: sessionManager.getActiveSessionCount(),
        remainingInvalidatedTokens: sessionManager.getInvalidatedTokenCount()
      });
      
      // Emit metrics for scheduled cleanup
      logger.metric && logger.metric("scheduled_session_cleanup_duration_ms", duration, {
        component: "SessionCleanup",
        removedSessions: removedCount,
        removedTokens: removedTokensCount
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error("Scheduled session cleanup failed", {
        component: "SessionCleanup",
        method: "scheduledCleanup",
        requestId,
        duration,
        error: error.message,
        stack: error.stack
      });
      
      // Emit metrics for cleanup failures
      logger.metric && logger.metric("scheduled_session_cleanup_errors", 1, {
        component: "SessionCleanup",
        error: error.constructor.name
      });
    }
  }, interval);
  
  logger.info("Session cleanup job started", {
    component: "SessionCleanup",
    method: "startCleanupJob",
    interval: interval / 1000 + "s"
  });
}

/**
 * Stop the session cleanup job
 */
function stopCleanupJob() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    
    logger.info("Session cleanup job stopped", {
      component: "SessionCleanup",
      method: "stopCleanupJob"
    });
  }
}

/**
 * Run a manual cleanup of expired sessions and invalidated tokens
 * 
 * @returns {Promise<Object>} Cleanup results with counts
 */
async function runManualCleanup() {
  const requestId = `manual-cleanup-${Date.now()}`;
  const startTime = Date.now();
  
  logger.info("Starting manual session and token cleanup", {
    component: "SessionCleanup",
    method: "runManualCleanup",
    requestId
  });
  
  try {
    const removedSessionsCount = sessionManager.cleanupExpiredSessions();
    
    // Also clean up invalidated tokens
    const removedTokensCount = sessionManager.cleanupInvalidatedTokens(DEFAULT_TOKEN_RETENTION_PERIOD);
    
    const duration = Date.now() - startTime;
    
    logger.info("Manual cleanup completed", {
      component: "SessionCleanup",
      method: "runManualCleanup",
      requestId,
      duration,
      removedSessionsCount,
      removedTokensCount,
      remainingSessions: sessionManager.getActiveSessionCount(),
      remainingInvalidatedTokens: sessionManager.getInvalidatedTokenCount()
    });
    
    // Emit metrics for manual cleanup
    logger.metric && logger.metric("manual_cleanup_duration_ms", duration, {
      component: "SessionCleanup",
      removedSessions: removedSessionsCount,
      removedTokens: removedTokensCount
    });
    
    return {
      removedSessionsCount,
      removedTokensCount,
      remainingSessions: sessionManager.getActiveSessionCount(),
      remainingInvalidatedTokens: sessionManager.getInvalidatedTokenCount(),
      duration
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error("Manual cleanup failed", {
      component: "SessionCleanup",
      method: "runManualCleanup",
      requestId,
      duration,
      error: error.message,
      stack: error.stack
    });
    
    // Emit metrics for manual cleanup failures
    logger.metric && logger.metric("manual_cleanup_errors", 1, {
      component: "SessionCleanup",
      error: error.constructor.name
    });
    
    throw error;
  }
}

module.exports = {
  startCleanupJob,
  stopCleanupJob,
  runManualCleanup,
  DEFAULT_CLEANUP_INTERVAL
};