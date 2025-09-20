/**
 * sessionRoutes.js - API routes for session management
 * 
 * This module provides Express routes for session management including
 * login, logout, and administrative session operations.
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const express = require('express');
const router = express.Router();
const { ulid } = require('ulid');
const { RoditClient } = require('@rodit/rodit-auth-be');

// Create SDK client instance to access all functionality
const sdkClient = new RoditClient();
const authenticate_apicall = (req, res, next) => sdkClient.authenticateApiCall(req, res, next);
const validatePermissions = (req, res, next) => sdkClient.validatePermissions(req, res, next);
const logger = sdkClient.getLogger();
const sessionManager = sdkClient.getSessionManager();

/**
 * POST /api/sessions/login - Create a new session (login)
 * 
 * Handles client authentication and session creation
 */
router.post('/login', (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();
  
  req.logAction = "login-attempt";
  
  logger.info("Login request received", {
    component: "SessionRoutes",
    method: "createSession",
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Delegate to RoditClient instance
  if (!req.app.locals.roditClient) {
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
  req.app.locals.roditClient.login_client(req, res);
});

/**
 * POST /api/sessions/logout - End a session (logout)
 * 
 * Handles client session termination
 * Protected: Requires authentication
 */
router.post('/logout', authenticate_apicall, (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();
  
  req.logAction = "logout-attempt";
  
  logger.info("Logout request received", {
    component: "SessionRoutes",
    method: "terminateSession",
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.user ? req.user.id : "unknown",
    userAgent: req.get('User-Agent')
  });
  
  if (!req.app.locals.roditClient) {
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
  req.app.locals.roditClient.logout(req, res);
});

/**
 * GET /api/sessions/list_all - Get all sessions
 * 
 * Admin route - Get information about all active sessions
 * Protected: Requires authentication and permissions
 */
router.get('/list_all', authenticate_apicall, validatePermissions, (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();
  
  try {
    // Gather all sessions
    const sessions = [];
    
    for (const [sessionId, session] of sessionManager.sessions.entries()) {
      // Don't include closed or expired sessions
      if (session.status === 'active') {
        sessions.push({
          id: sessionId,
          roditId: session.roditId,
          ownerId: session.ownerId,
          createdAt: new Date(session.createdAt * 1000).toISOString(),
          expiresAt: new Date(session.expiresAt * 1000).toISOString(),
          lastAccessedAt: new Date(session.lastAccessedAt * 1000).toISOString(),
          status: session.status
        });
      }
    }
    
    logger.info("Session list retrieved", {
      component: "SessionRoutes",
      method: "listSessions",
      requestId,
      sessionCount: sessions.length,
      duration: Date.now() - startTime
    });
    
    res.json({
      sessions,
      count: sessions.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Failed to retrieve sessions", {
      component: "SessionRoutes",
      method: "listSessions",
      requestId,
      error: error.message,
      stack: error.stack,
      duration: Date.now() - startTime
    });
    
    res.status(500).json({
      error: "Failed to retrieve sessions",
      message: error.message,
      requestId
    });
  }
});

/**
 * POST /api/sessions/close - Terminate a specific session
 * 
 * Admin route - Force terminate a specific session
 * Protected: Requires authentication and permissions
 * 
 * Request body should contain:
 * - sessionId: ID of the session to terminate
 * - reason: (optional) Reason for termination
 */
router.post('/close', authenticate_apicall, validatePermissions, (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();
  const { sessionId } = req.body;
  const reason = req.body.reason || 'admin_termination';
  
  if (!sessionId) {
    logger.warn("Session termination missing sessionId", {
      component: "SessionRoutes",
      method: "terminateSession",
      requestId,
      duration: Date.now() - startTime
    });
    
    return res.status(400).json({
      error: "Missing required parameter: sessionId",
      requestId
    });
  }
  
  try {
    logger.info("Session termination requested", {
      component: "SessionRoutes",
      method: "terminateSession",
      requestId,
      sessionId,
      reason,
      adminUser: req.user.id
    });
    
    const sessionClosed = sessionManager.closeSession(sessionId, reason);
    
    if (sessionClosed) {
      logger.info("Session terminated successfully", {
        component: "SessionRoutes",
        method: "terminateSession",
        requestId,
        sessionId,
        reason,
        duration: Date.now() - startTime
      });
      
      res.json({
        message: "Session terminated successfully",
        sessionId,
        reason,
        timestamp: new Date().toISOString()
      });
    } else {
      logger.warn("Session not found or already terminated", {
        component: "SessionRoutes",
        method: "terminateSession",
        requestId,
        sessionId,
        reason,
        duration: Date.now() - startTime
      });
      
      res.status(404).json({
        error: "Session not found or already terminated",
        sessionId,
        requestId
      });
    }
  } catch (error) {
    logger.error("Failed to terminate session", {
      component: "SessionRoutes",
      method: "terminateSession",
      requestId,
      sessionId,
      error: error.message,
      stack: error.stack,
      duration: Date.now() - startTime
    });
    
    res.status(500).json({
      error: "Failed to terminate session",
      message: error.message,
      sessionId,
      requestId
    });
  }
});

/**
 * POST /api/sessions/cleanup - Run manual session cleanup
 * 
 * Admin route - Force cleanup of expired sessions
 * Protected: Requires authentication and permissions
 */
router.post('/cleanup', authenticate_apicall, validatePermissions, (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();
  
  try {
    logger.info("Manual session cleanup requested", {
      component: "SessionRoutes",
      method: "cleanupSessions",
      requestId,
      adminUser: req.user.id
    });
    
    const result = sessionManager.cleanupExpiredSessions();
    
    logger.info("Manual session cleanup completed", {
      component: "SessionRoutes",
      method: "cleanupSessions",
      requestId,
      removedCount: result.removedCount,
      remainingCount: result.remainingCount,
      duration: Date.now() - startTime
    });
    
    res.json({
      message: "Session cleanup completed",
      removedCount: result.removedCount,
      remainingCount: result.remainingCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Failed to run session cleanup", {
      component: "SessionRoutes",
      method: "cleanupSessions",
      requestId,
      error: error.message,
      stack: error.stack,
      duration: Date.now() - startTime
    });
    
    res.status(500).json({
      error: "Failed to run session cleanup",
      message: error.message,
      requestId
    });
  }
});

module.exports = router;