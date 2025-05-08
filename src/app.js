// app.js - Client Side
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const logger = require("./config/logger");
const config = require("config");
const { ulid } = require("ulid");
const morgan = require("morgan");
const cors = require("cors");

// Import rodit middleware functionality
const { 
  roditManager, 
  stateManager, 
  authenticate_apicall
} = require("./routes/middleware/rodit");

// Import route handlers
const indexRouter = require("./routes/index");
const crudaRouter = require("./routes/cruda_router");

// Configuration constants
const SERVERPORT = config.get("SERVERPORT");
const API_PROTOCOL = config.get("API_PROTOCOL");
const API_OPTIONS = config.get("API_OPTIONS");

// Create Express application
const app = express();

// Configure logging middleware
morgan.token('id', function getId(req) {
  return req.id;
});

morgan.token('remote-ip', function(req) {
  return req.headers['x-forwarded-for'] || req.ip;
});

// Set up the morgan logger with custom format
app.use(morgan(':id :remote-ip :method :url :status :response-time ms', {
  stream: {
    write: (message) => logger.http(message.trim())
  }
}));

// Add request ID and timestamp to each request
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || ulid();
  req.timestamp = Date.now();
  next();
});

// Set up middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow all origins for now, or configure as needed
    callback(null, true);
  },
  credentials: true,
  exposedHeaders: ['New-Token']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Rodit configuration at startup
(async () => {
  try {
    const startTime = Date.now();
    const requestId = ulid();
    
    logger.info("Initializing Rodit configuration", {
      component: "AppStartup",
      method: "initializeRoditConfig",
      requestId,
      event: "initialization_start"
    });
    
    // Initialize with 'client' configuration profile
    const config = await roditManager.initializeRoditConfig("client");
    
    // Log successful initialization
    const duration = Date.now() - startTime;
    logger.info("Rodit configuration initialized successfully", {
      component: "AppStartup",
      method: "initializeRoditConfig",
      requestId,
      duration,
      event: "initialization_complete",
      hasConfig: !!config,
      configLevel: config && config.own_rodit.token_id ? "full" : "minimal"
    });
    
    // Log metrics for successful initialization
    logger.metric && logger.metric("rodit_initialization_duration_ms", duration, {
      component: "AppStartup",
      success: true,
      configLevel: config && config.own_rodit.token_id ? "full" : "minimal"
    });
    
  } catch (error) {
    logger.error("Failed to initialize Rodit configuration", {
      component: "AppStartup",
      method: "initializeRoditConfig",
      error: error.message,
      stack: error.stack
    });
    
    // Log metrics for failed initialization
    logger.metric && logger.metric("rodit_initialization_errors_total", 1, {
      component: "AppStartup",
      error: error.constructor.name
    });
  }
})();

// Public routes
app.use('/', indexRouter);

// Routes requiring authentication
app.use('/cruda', authenticate_apicall, crudaRouter);

// Webhook test endpoint that doesn't require authentication
app.post('/webhook-test', async (req, res) => {
  const requestId = req.id || ulid();
  
  logger.info("Webhook test request received", {
    component: "WebhookTester",
    requestId,
    method: "POST",
    path: "/webhook-test",
    ip: req.ip
  });
  
  try {
    // Get database from router to record test
    const db = crudaRouter.getDatabase ? crudaRouter.getDatabase() : null;
    
    if (!db) {
      logger.error("Database not available for webhook test", {
        component: "WebhookTester",
        requestId
      });
      
      return res.status(500).json({
        success: false,
        error: "Database not initialized"
      });
    }
    
    // Record the webhook test attempt
    const webhookTestResult = {
      correlation_id: requestId,
      event_type: "webhook_direct_test",
      payload: JSON.stringify(req.body),
      success: 1,
      timestamp: new Date().toISOString(),
      error_message: null
    };
    
    await db.run(
      `INSERT INTO webhook_tests (correlation_id, event_type, payload, success, timestamp, error_message) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        webhookTestResult.correlation_id,
        webhookTestResult.event_type,
        webhookTestResult.payload,
        webhookTestResult.success,
        webhookTestResult.timestamp,
        webhookTestResult.error_message
      ]
    );
    
    logger.info("Webhook test recorded successfully", {
      component: "WebhookTester",
      requestId,
      success: true
    });
    
    res.status(200).json({
      success: true,
      message: "Webhook test received and recorded",
      requestId
    });
  } catch (error) {
    logger.error("Error processing webhook test", {
      component: "WebhookTester",
      requestId,
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      error: "Failed to process webhook test: " + error.message,
      requestId
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const requestId = req.id || ulid();
  
  logger.debug("Health check requested", {
    component: "HealthCheck",
    requestId,
    method: "GET",
    path: "/health",
    ip: req.ip
  });
  
  const config = stateManager.getConfigOwnRodit();
  const hasConfig = !!config;
  
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
    serverPort: SERVERPORT,
    apiProtocol: API_PROTOCOL,
    roditInitialized: hasConfig,
    requestId
  });
});

// Error handler
app.use((err, req, res, next) => {
  const requestId = req.id || ulid();
  
  logger.error("Unhandled error in request", {
    component: "ErrorHandler",
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    error: err.message,
    stack: err.stack
  });
  
  // Log metrics for unhandled errors
  logger.metric && logger.metric("unhandled_errors_total", 1, {
    component: "ErrorHandler",
    path: req.path,
    method: req.method,
    status: err.status || 500
  });
  
  res.status(err.status || 500).json({
    error: {
      message: err.message || "Internal Server Error",
      status: err.status || 500,
      requestId
    }
  });
});

// Start the server
const server = app.listen(SERVERPORT, () => {
  const serverContext = {
    component: "Server",
    port: SERVERPORT,
    protocol: API_PROTOCOL,
    startTime: new Date().toISOString()
  };
  
  logger.info(`Server listening on port ${SERVERPORT}`, serverContext);
  
  // Log metrics for server start
  logger.metric && logger.metric("server_starts_total", 1, {
    component: "Server",
    port: SERVERPORT
  });
});

// Handle graceful shutdowns
const gracefulShutdown = (signal) => {
  const shutdownContext = {
    component: "Server",
    signal,
    shutdownTime: new Date().toISOString()
  };
  
  logger.info(`${signal} signal received: closing HTTP server`, shutdownContext);
  
  server.close(async () => {
    logger.info("HTTP server closed", shutdownContext);
    
    // Close database connections
    try {
      if (crudaRouter.closeDatabase) {
        await crudaRouter.closeDatabase();
        logger.info("Database connections closed", {
          ...shutdownContext,
          component: "Database"
        });
      }
    } catch (error) {
      logger.error("Error closing database connections", {
        ...shutdownContext,
        component: "Database",
        error: error.message,
        stack: error.stack
      });
    }
    
    // Exit the process
    logger.info("Server shutdown complete", shutdownContext);
    process.exit(0);
  });
  
  // Force exit after timeout if graceful shutdown fails
  setTimeout(() => {
    logger.error("Forced shutdown after timeout", {
      ...shutdownContext,
      component: "Server",
      event: "forced_shutdown"
    });
    process.exit(1);
  }, 10000);
};

// Register signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error("Uncaught exception", {
    component: "Process",
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
  
  // Log metrics for uncaught exceptions
  logger.metric && logger.metric("uncaught_exceptions_total", 1, {
    component: "Process",
    errorType: err.name
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error("Unhandled promise rejection", {
    component: "Process",
    reason: reason.message || reason,
    stack: reason.stack,
    timestamp: new Date().toISOString()
  });
  
  // Log metrics for unhandled rejections
  logger.metric && logger.metric("unhandled_rejections_total", 1, {
    component: "Process",
    errorType: reason.name || "Unknown"
  });
});

module.exports = app;