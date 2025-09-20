/**
 * logout.js - API routes for user logout
 * 
 * This module provides Express routes for user logout, delegating to
 * the centralized session management in sessionroutes.js.
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const express = require("express");
const router = express.Router();
const { RoditClient } = require("@rodit/rodit-auth-be");

// Create SDK client instance to access all functionality
const sdkClient = new RoditClient();
const logger = sdkClient.getLogger();
const { createLogContext, logErrorWithMetrics } = logger;
const { ulid } = require("ulid");

// Handling logout request
router.post("/logout", (req, res) => {
  const requestId = req.headers['x-request-id'] || ulid();
  const startTime = Date.now();
  req.logAction = "logout-attempt";
  
  const baseContext = createLogContext({
    requestId,
    component: 'LogoutRoutes',
    method: 'logout',
    endpoint: '/api/logout',
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    headers: Object.keys(req.headers)
  });
  
  logger.debugWithContext("Processing logout request", baseContext);
  
  try {
    // Forward to the session routes
    // This is just a redirect to maintain backward compatibility
    // with existing code that might be using /logout endpoint
    res.redirect(307, '/api/sessions/logout');
    
    const duration = Date.now() - startTime;
    logger.infoWithContext("Logout request redirected successfully", {
      ...baseContext,
      redirectUrl: '/api/sessions/logout',
      statusCode: 307,
      duration
    });
    
    // Add metric for successful operation
    logger.metric('auth_operations', duration, {
      operation: 'logout_redirect',
      result: 'success'
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      'Error processing logout request',
      {
        ...baseContext,
        duration
      },
      error,
      'auth_error',
      {
        operation: 'logout_redirect',
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: 'Failed to process logout request',
      message: error.message,
      requestId
    });
  }
});

module.exports = router;
