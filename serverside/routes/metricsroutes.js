/**
 * Metrics routes for performance monitoring
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const express = require('express');
const router = express.Router();
const { ulid } = require('ulid');
const { RoditClient } = require('@rodit/rodit-auth-be');

// Create SDK client instance to access all functionality
const sdkClient = new RoditClient();
const logger = sdkClient.getLogger();
const performanceService = sdkClient.getPerformanceService();
const authenticate_apicall = (req, res, next) => sdkClient.authenticateApiCall(req, res, next);

// Directly use SDK's authenticate_apicall middleware
;
const { createLogContext, logErrorWithMetrics } = logger;

/**
 * GET /api/metrics
 * 
 * Get current performance metrics
 * Protected: Requires authentication
 */
router.get('/', authenticate_apicall, (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'MetricsRoutes',
    method: 'getMetrics',
    endpoint: '/api/metrics',
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip
  });
  
  logger.debugWithContext('Processing metrics request', baseContext);
  
  try {
    const metrics = performanceService.getMetrics();
    
    const duration = Date.now() - startTime;
    logger.infoWithContext('Metrics retrieved successfully', {
      ...baseContext,
      metricsCount: Object.keys(metrics).length,
      duration
    });
    
    // Add metric for successful operation
    logger.metric('metrics_operations', duration, {
      operation: 'getMetrics',
      result: 'success'
    });
    
    res.json({
      metrics,
      timestamp: Date.now(),
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      'Error retrieving metrics',
      {
        ...baseContext,
        duration
      },
      error,
      'metrics_error',
      {
        operation: 'getMetrics',
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: {
        code: 'METRICS_ERROR',
        message: 'Failed to retrieve metrics',
        requestId
      }
    });
  }
});

/**
 * GET /api/metrics/system
 * 
 * Get system resource metrics (CPU, memory, etc.)
 * Protected: Requires authentication
 */
router.get('/system', authenticate_apicall, (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'MetricsRoutes',
    method: 'getSystemMetrics',
    endpoint: '/api/metrics/system',
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip
  });
  
  logger.debugWithContext('Processing system metrics request', baseContext);
  
  try {
    const systemMetrics = performanceService.getSystemMetrics();
    
    const duration = Date.now() - startTime;
    logger.infoWithContext('System metrics retrieved successfully', {
      ...baseContext,
      metricsCount: Object.keys(systemMetrics).length,
      duration
    });
    
    // Add metric for successful operation
    logger.metric('metrics_operations', duration, {
      operation: 'getSystemMetrics',
      result: 'success'
    });
    
    res.json({
      metrics: systemMetrics,
      timestamp: Date.now(),
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      'Error retrieving system metrics',
      {
        ...baseContext,
        duration
      },
      error,
      'metrics_error',
      {
        operation: 'getSystemMetrics',
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: {
        code: 'SYSTEM_METRICS_ERROR',
        message: 'Failed to retrieve system metrics',
        requestId
      }
    });
  }
});

/**
 * POST /api/metrics/reset
 * 
 * Reset performance metrics counters
 * Protected: Requires authentication and admin permissions
 */
router.post('/reset', authenticate_apicall, (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'MetricsRoutes',
    method: 'resetMetrics',
    endpoint: '/api/metrics/reset',
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip,
    hasAdminPermission: req.user?.permissions?.includes('admin')
  });
  
  logger.debugWithContext('Processing metrics reset request', baseContext);
  
  // Check if user has admin permissions
  if (!req.user || !req.user.permissions || !req.user.permissions.includes('admin')) {
    logger.warnWithContext('Permission denied for metrics reset', {
      ...baseContext,
      reason: 'Missing admin permission'
    });
    
    return res.status(403).json({
      error: {
        code: 'PERMISSION_DENIED',
        message: 'Admin permission required to reset metrics',
        requestId
      }
    });
  }
  
  try {
    performanceService.resetMetrics();
    
    const duration = Date.now() - startTime;
    logger.infoWithContext('Performance metrics reset successfully', {
      ...baseContext,
      duration
    });
    
    // Add metric for successful operation
    logger.metric('metrics_operations', duration, {
      operation: 'resetMetrics',
      result: 'success'
    });
    
    res.json({
      message: 'Performance metrics reset successfully',
      timestamp: Date.now(),
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      'Error resetting metrics',
      {
        ...baseContext,
        duration
      },
      error,
      'metrics_error',
      {
        operation: 'resetMetrics',
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: {
        code: 'METRICS_RESET_ERROR',
        message: 'Failed to reset metrics',
        requestId
      }
    });
  }
});

module.exports = router;
