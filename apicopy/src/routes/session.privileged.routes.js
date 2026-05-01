const express = require('express');
const router = express.Router();
const { ulid } = require('ulid');
const { logger, errorResponse } = require('@rodit/rodit-auth-be');
const { getUserRateLimiter } = require('../middleware/user-rate-limit');
const { validateContentType, validateJsonBody } = require('../middleware/request-validation');
const { sendError } = errorResponse;

// Authentication middleware - uses app.locals.roditClient
const authenticate_apicall = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    const requestId = req.requestId || ulid();
    return sendError(res, {
      statusCode: 503,
      requestId,
      code: 'AUTH_SERVICE_UNAVAILABLE',
      message: 'Authentication service unavailable'
    });
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

const authorize = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    const requestId = req.requestId || ulid();
    return sendError(res, {
      statusCode: 503,
      requestId,
      code: 'AUTHORIZATION_SERVICE_UNAVAILABLE',
      message: 'Authorization service unavailable'
    });
  }
  return client.authorize(req, res, next);
};

// Helper to get session manager from app.locals.roditClient
const getSessionManager = (req) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    throw new Error('RoditClient not available');
  }
  return client.getSessionManager();
};

// GET /api/sessions/list_all
router.get('/list_all', authenticate_apicall, authorize, async (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();

  const context = logger.createLogContext('SessionRoutes', 'listSessions', {
    requestId,
    endpoint: '/sessions/list_all',
    ip: req.ip
  });

  try {
    const sessions = [];
    const sessionManager = getSessionManager(req);
    
    // Get all sessions from storage
    let allSessions = [];
    if (sessionManager.storage && typeof sessionManager.storage.getAll === 'function') {
      allSessions = await sessionManager.storage.getAll();
    } else if (sessionManager.storage && typeof sessionManager.storage.keys === 'function') {
      const sessionIds = await sessionManager.storage.keys();
      for (const id of sessionIds) {
        const session = await sessionManager.storage.get(id);
        if (session) allSessions.push(session);
      }
    } else {
      throw new Error('Session storage interface not available');
    }

    for (const session of allSessions) {
      if (session.status === 'active') {
        sessions.push({
          id: session.id,
          roditId: session.roditId,
          ownerId: session.ownerId,
          createdAt: new Date(session.createdAt * 1000).toISOString(),
          expiresAt: new Date(session.expiresAt * 1000).toISOString(),
          lastAccessedAt: new Date(session.lastAccessedAt * 1000).toISOString(),
          status: session.status
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.infoWithContext('Session list retrieved', {
      ...context,
      sessionCount: sessions.length,
      duration
    });

    logger.metric('session_list', duration, {
      operation: 'listSessions',
      result: 'success',
      sessionCount: sessions.length
    });

    res.json({
      sessions,
      count: sessions.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      'Failed to retrieve sessions',
      { ...context, duration },
      error,
      'session_list_error',
      { operation: 'listSessions', result: 'error', duration }
    );

    sendError(res, {
      statusCode: 500,
      requestId,
      code: 'SESSIONS_RETRIEVE_FAILED',
      message: error.message
    });
  }
});

// POST /api/sessions/cleanup
router.post('/cleanup', validateContentType, authenticate_apicall, authorize, async (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();

  const context = logger.createLogContext('SessionRoutes', 'cleanupSessions', {
    requestId,
    endpoint: '/sessions/cleanup',
    httpMethod: req.method,
    ip: req.ip,
    userId: req.user?.id || 'system'
  });

  logger.infoWithContext('Session cleanup requested', context);

  try {
    const sessionManager = getSessionManager(req);
    const activeBefore = await sessionManager.getActiveSessionCount();
    const cleanupResult = await sessionManager.cleanupExpiredSessions();
    const activeAfter = await sessionManager.getActiveSessionCount();
    const removedCount = activeBefore - activeAfter;
    const totalSessions = activeAfter;
    const duration = Date.now() - startTime;

    logger.infoWithContext('Session cleanup completed', {
      ...context,
      duration,
      removedCount,
      activeBefore,
      activeAfter,
      totalSessions,
      cleanupResult
    });

    logger.metric('session_cleanup', duration, {
      operation: 'cleanupExpiredSessions',
      result: 'success',
      removedCount,
      activeSessions: activeAfter,
      totalSessions
    });

    res.status(200).json({
      success: true,
      message: 'Session cleanup completed',
      stats: {
        removedCount,
        activeSessions: activeAfter,
        totalSessions,
        cleanupResult
      },
      requestId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.logErrorWithMetrics(
      'Session cleanup failed',
      { ...context, duration },
      error,
      'session_cleanup',
      { operation: 'cleanupExpiredSessions', result: 'error', duration }
    );

    sendError(res, {
      statusCode: 500,
      requestId,
      code: 'SESSION_CLEANUP_FAILED',
      message: error.message
    });
  }
});

// POST /api/sessions/revoke
router.post('/revoke', validateContentType, validateJsonBody, authenticate_apicall, authorize, async (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();
  const { sessionId } = req.body;
  const reason = req.body.reason || 'admin_termination';

  const context = logger.createLogContext('SessionRoutes', 'terminateSession', {
    requestId,
    endpoint: '/sessions/revoke',
    sessionId,
    ip: req.ip
  });

  if (!sessionId) {
    logger.debugWithContext('Session termination missing sessionId', {
      ...context,
      duration: Date.now() - startTime
    });

    return sendError(res, {
      statusCode: 400,
      requestId,
      code: 'SESSION_ID_REQUIRED',
      message: 'Missing required parameter: sessionId'
    });
  }

  try {
    logger.infoWithContext('Session termination requested', {
      ...context,
      reason,
      adminUser: req.user.id
    });

    const sessionManager = getSessionManager(req);
    const sessionClosed = await sessionManager.closeSession(sessionId, reason);

    if (sessionClosed) {
      const duration = Date.now() - startTime;
      logger.infoWithContext('Session terminated successfully', {
        ...context,
        reason,
        duration
      });

      logger.metric('session_revoke', duration, {
        operation: 'terminateSession',
        result: 'success'
      });

      res.json({
        message: 'Session terminated successfully',
        sessionId,
        reason,
        timestamp: new Date().toISOString()
      });
    } else {
      const duration = Date.now() - startTime;
      logger.warnWithContext('Session not found or already terminated', {
        ...context,
        reason,
        duration
      });

      sendError(res, {
        statusCode: 404,
        requestId,
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found or already terminated',
        details: { sessionId }
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      'Failed to terminate session',
      { ...context, duration },
      error,
      'session_revoke_error',
      { operation: 'terminateSession', result: 'error', duration }
    );

    sendError(res, {
      statusCode: 500,
      requestId,
      code: 'SESSION_TERMINATION_FAILED',
      message: error.message,
      details: { sessionId }
    });
  }
});

module.exports = router;
