const express = require('express');
const router = express.Router();
const { ulid } = require('ulid');
const { logger } = require('@rodit/rodit-auth-be');
const { getUserRateLimiter } = require('../middleware/user-rate-limit');

// Authentication middleware - uses app.locals.roditClient
const authenticate_apicall = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
  return client.authenticate(req, res, (authErr) => {
    if (authErr) {
      return next(authErr);
    }

    const userRateLimiter = getUserRateLimiter(req);
    if (!userRateLimiter) {
      return next();
    }

    return userRateLimiter(req, res, next);
  });
};

// Authorization middleware - uses app.locals.roditClient
const authorize = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    return res.status(503).json({ error: 'Authorization service unavailable' });
  }
  return client.authorize(req, res, next);
};

const { createLogContext, logErrorWithMetrics } = logger;

// Get performance service from app.locals (must be initialized at startup)
const getPerformanceService = (req) => {
  if (!req?.app?.locals?.performanceService) {
    throw new Error('Performance service not initialized');
  }
  return req.app.locals.performanceService;
};

// GET /api/metrics
router.get('/', authenticate_apicall, authorize, async (req, res) => {
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
    const performanceService = getPerformanceService(req);
    const rawMetrics = performanceService.getMetrics();

    const client = req?.app?.locals?.roditClient;
    if (!client) throw new Error('Authentication service unavailable');
    const sessionManager = client.getSessionManager();
    let activeSessionCount = 0;
    let sessionDebugInfo = {};

    try {
      if (sessionManager.getAllSessions) {
        const allSessions = await sessionManager.getAllSessions();
        activeSessionCount = allSessions.filter(session => session.status === 'active').length;
        sessionDebugInfo.totalSessions = allSessions.length;
        sessionDebugInfo.sessionStatuses = allSessions.map(s => s.status);
      } else if (sessionManager.getActiveSessionCount) {
        activeSessionCount = await sessionManager.getActiveSessionCount();
      } else if (sessionManager.getStorageInfo) {
        const storageInfo = await sessionManager.getStorageInfo();
        activeSessionCount = storageInfo.sessionCount || 0;
        sessionDebugInfo.storageInfo = storageInfo;
      }

      sessionDebugInfo.activeSessionCount = activeSessionCount;
      sessionDebugInfo.sessionManagerType = sessionManager.constructor.name;
      sessionDebugInfo.availableMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(sessionManager));
    } catch (error) {
      logger.warn('Could not retrieve session count', {
        error: error.message,
        sessionManagerType: sessionManager?.constructor?.name,
        availableMethods: sessionManager ? Object.getOwnPropertyNames(Object.getPrototypeOf(sessionManager)) : []
      });
      sessionDebugInfo.error = error.message;
    }

    const transformedMetrics = {
      requestCount: rawMetrics.requestCount || 0,
      errorCount: rawMetrics.errorCount || 0,
      requestsPerMinute: rawMetrics.requestsPerMinute || 0,
      currentLoadLevel: rawMetrics.currentLoadLevel || 'low',
      requests: {
        total: rawMetrics.requestCount || 0,
        errors: rawMetrics.errorCount || 0,
        perMinute: rawMetrics.requestsPerMinute || 0
      },
      sessions: {
        active: activeSessionCount,
        active_count: activeSessionCount,
        total: activeSessionCount
      },
      active: activeSessionCount,
      ...rawMetrics
    };

    const duration = Date.now() - startTime;
    logger.infoWithContext('Metrics retrieved successfully', {
      ...baseContext,
      metricsCount: Object.keys(transformedMetrics).length,
      activeSessionCount,
      duration
    });

    logger.metric('metrics_operations', duration, {
      operation: 'getMetrics',
      result: 'success'
    });

    const response = {
      ...transformedMetrics,
      metrics: transformedMetrics,
      requests: {
        total: rawMetrics.requestCount || 0,
        errors: rawMetrics.errorCount || 0,
        perMinute: rawMetrics.requestsPerMinute || 0
      },
      timestamp: new Date().toISOString(),
      requestId,
      active: activeSessionCount,
      'sessions.active': activeSessionCount,
      'sessions.active_count': activeSessionCount,
      sessionDebug: sessionDebugInfo
    };

    res.json(response);
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

router.head('/system', authenticate_apicall, (req, res) => {
  res.status(200).end();
});

router.head('/', authenticate_apicall, (req, res) => {
  res.status(200).end();
});

// GET /api/metrics/system
router.get('/system', authenticate_apicall, authorize, (req, res) => {
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
    const performanceService = getPerformanceService(req);
    const systemMetrics = performanceService.getSystemMetrics();

    const duration = Date.now() - startTime;
    logger.infoWithContext('System metrics retrieved successfully', {
      ...baseContext,
      metricsCount: Object.keys(systemMetrics).length,
      duration
    });

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

// POST /api/metrics/reset
router.post('/reset', authenticate_apicall, authorize, (req, res) => {
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
    const performanceService = getPerformanceService(req);
    performanceService.resetMetrics();

    const duration = Date.now() - startTime;
    logger.infoWithContext('Performance metrics reset successfully', {
      ...baseContext,
      duration
    });

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

// GET /api/metrics/debug
router.get('/debug', authenticate_apicall, authorize, (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  try {
    const performanceService = getPerformanceService(req);
    const metrics = performanceService.getMetrics();

    const client = req?.app?.locals?.roditClient;
    const clientInfo = {
      hasRoditClient: !!req?.app?.locals?.roditClient,
      clientType: client ? client.constructor.name : 'Unknown',
      hasPerformanceService: !!performanceService,
      performanceServiceType: performanceService?.constructor?.name
    };

    const duration = Date.now() - startTime;

    res.json({
      debug: {
        ...clientInfo,
        metricsSnapshot: metrics,
        timestamp: Date.now(),
        requestProcessingTime: duration
      },
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Debug endpoint error', {
      component: 'MetricsRoutes',
      method: 'debug',
      requestId,
      error: error.message,
      duration
    });

    res.status(500).json({
      error: {
        code: 'DEBUG_ERROR',
        message: 'Failed to retrieve debug information',
        details: error.message,
        requestId
      }
    });
  }
});

module.exports = router;
