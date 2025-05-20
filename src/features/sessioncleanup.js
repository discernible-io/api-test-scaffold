/**
 * sessionCleanup.js - Scheduled task to clean up expired sessions
 * 
 * This module provides functionality to clean up expired sessions periodically
 * to prevent memory leaks in the session store.
 * 
 * Copyright (c) 2024 Cableguard, Inc. All rights reserved.
 */

const logger = require("../../config/logger");
const sessionManager = require("./SessionManager");

// Default interval is 1 hour
const DEFAULT_CLEANUP_INTERVAL = 60 * 60 * 1000;

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
      const duration = Date.now() - startTime;
      
      logger.info("Session cleanup completed", {
        component: "SessionCleanup",
        method: "scheduledCleanup",
        requestId,
        duration,
        removedCount,
        remainingSessions: sessionManager.getActiveSessionCount()
      });
      
      // Emit metrics for scheduled cleanup
      logger.metric && logger.metric("scheduled_session_cleanup_duration_ms", duration, {
        component: "SessionCleanup",
        removed: removedCount
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
 * Run a manual cleanup immediately
 * 
 * @returns {number} Number of sessions removed
 */
async function runManualCleanup() {
  const requestId = `manual-cleanup-${Date.now()}`;
  const startTime = Date.now();
  
  logger.info("Starting manual session cleanup", {
    component: "SessionCleanup",
    method: "manualCleanup",
    requestId
  });
  
  try {
    const removedCount = sessionManager.cleanupExpiredSessions();
    const duration = Date.now() - startTime;
    
    logger.info("Manual session cleanup completed", {
      component: "SessionCleanup",
      method: "manualCleanup",
      requestId,
      duration,
      removedCount,
      remainingSessions: sessionManager.getActiveSessionCount()
    });
    
    // Emit metrics for manual cleanup
    logger.metric && logger.metric("manual_session_cleanup_duration_ms", duration, {
      component: "SessionCleanup",
      removed: removedCount
    });
    
    return removedCount;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error("Manual session cleanup failed", {
      component: "SessionCleanup",
      method: "manualCleanup",
      requestId,
      duration,
      error: error.message,
      stack: error.stack
    });
    
    // Emit metrics for cleanup failures
    logger.metric && logger.metric("manual_session_cleanup_errors", 1, {
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