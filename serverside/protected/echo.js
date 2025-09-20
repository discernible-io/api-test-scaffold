const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const { RoditClient } = require("@rodit/rodit-auth-be");

// Create SDK client instance to access all functionality
const sdkClient = new RoditClient();
const logger = sdkClient.getLogger();
const { createLogContext, logErrorWithMetrics } = logger;

// Middleware for logging action - enhanced with structured context
const logActionMiddleware = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || ulid();
  const startTime = Date.now();
  const inputString = req.body.message;
  
  req.logAction = "echo-some-text";
  req.logMessage = inputString;
  req.requestId = requestId; // Set requestId for downstream handlers
  req.startTime = startTime; // Track when the request started
  
  const baseContext = createLogContext({
    requestId,
    component: 'EchoMiddleware',
    method: 'logActionMiddleware',
    endpoint: req.path,
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    headers: Object.keys(req.headers),
    messageLength: inputString ? inputString.length : 0,
    bodyKeys: Object.keys(req.body || {}),
    bodySize: req.body ? JSON.stringify(req.body).length : 0
  });
  
  logger.debugWithContext("Request processed by middleware", baseContext);
  
  const middlewareDuration = Date.now() - startTime;
  logger.metric('middleware_operations', middlewareDuration, {
    operation: 'echoMiddleware',
    result: 'processed'
  });
  
  next();
};

// Protected route that echoes the input
// Note: This route is now at "/" because it will be mounted at "/api/echo" in app.js
router.post("/echo", logActionMiddleware, (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = req.startTime || Date.now(); // Use middleware time if available
  const routeStartTime = Date.now(); // Track when route handler started
  const inputString = req.body.message;
  
  const baseContext = createLogContext({
    requestId,
    component: 'EchoRoutes',
    method: 'echoMessage',
    endpoint: '/api/echo',
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    messageReceived: !!inputString,
    messageLength: inputString ? inputString.length : 0
  });
  
  try {
    // Validate input
    if (!inputString || typeof inputString !== 'string') {
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logger.warnWithContext("Invalid input for echo", {
        ...baseContext,
        validationError: 'Invalid or missing message',
        duration,
        routeDuration
      });
      
      // Add metric for validation failure
      logger.metric('echo_operations', duration, {
        operation: 'echoMessage',
        result: 'validation_error',
        statusCode: 400
      });
      
      return res.status(400).json({
        error: "Invalid input",
        requestId
      });
    }
    
    logger.debugWithContext("Processing echo request", baseContext);
    
    // Create the response
    const response = { echo: inputString.toUpperCase() };
    
    const duration = Date.now() - startTime;
    const routeDuration = Date.now() - routeStartTime;
    
    logger.infoWithContext("Echo request completed successfully", {
      ...baseContext,
      status: "success",
      responseType: "json",
      duration,
      routeDuration
    });
    
    // Add metric for successful operation
    logger.metric('echo_operations', duration, {
      operation: 'echoMessage',
      result: 'success',
      messageLength: inputString.length
    });
    
    res.json({
      ...response,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const routeDuration = Date.now() - routeStartTime;
    
    logErrorWithMetrics(
      'Error processing echo request',
      {
        ...baseContext,
        duration,
        routeDuration
      },
      error,
      'echo_error',
      {
        operation: 'echoMessage',
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: 'Failed to process echo request',
      message: 'An internal server error occurred',
      requestId
    });
  }
});

module.exports = router;