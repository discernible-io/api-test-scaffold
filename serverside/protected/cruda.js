const express = require("express");
const router = express.Router();
const { RoditClient } = require("@rodit/rodit-auth-be");

// Create SDK client instance to access all functionality
const sdkClient = new RoditClient();
const webhook = sdkClient.getWebhookHandler();
const logger = sdkClient.getLogger();
const config = require("config");
const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");
const { ulid } = require("ulid"); // Adding ulid for request IDs
const { createLogContext, logErrorWithMetrics, debugWithContextIf } = logger;

const DB_PATH = config.get("API_DEFAULT_OPTIONS.DB_PATH");

// Database connection
let db;

// Initialize database and export a function that can be awaited by app.js
const initializeDatabase = async () => {
  const requestId = ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'CRUDARouter',
    method: 'initializeDatabase',
    dbPath: DB_PATH
  });
  
  logger.debugWithContext("Starting database initialization", baseContext);
  
  try {
    // Initialize SQLite database
    db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database,
    });

    // Create comments table if it doesn't exist
    await db.run(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment TEXT,
      content TEXT
    )`);

    // Create webhook_tests table for SDK webhook test recording
    await db.run(`CREATE TABLE IF NOT EXISTS webhook_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id TEXT,
      event_type TEXT,
      payload TEXT,
      success BOOLEAN,
      timestamp TEXT,
      error_message TEXT
    )`);

    // Expose DB globally for SDK to record webhook test results
    global.db = db;

    const duration = Date.now() - startTime;
    logger.infoWithContext("SQLite database initialized successfully", {
      ...baseContext,
      duration
    });

    // Add metric for successful operation
    logger.metric('database_operations', duration, {
      operation: 'initializeDatabase',
      result: 'success'
    });

    return db;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      "Error initializing SQLite database",
      {
        ...baseContext,
        duration
      },
      error,
      'database_error',
      {
        operation: 'initializeDatabase',
        result: 'error',
        duration
      }
    );
    throw error;
  }
};

// Expose the database connection for proper cleanup in app.js
const getDatabase = () => db;

// Forward function to use the SDK's webhook sender (includes logging and test tracking)
const logAndSendWebhook = async (event, data, isError = false, isTest = false, req = null) => {
  // Use the roditClient from app.locals instead of direct webhook import
  const roditClient = req?.app?.locals?.roditClient;
  if (!roditClient) {
    throw new Error('RoditClient not available in app.locals');
  }
  return await roditClient.send_webhook(event, data, isError, isTest, req);
};

// Initialize the database when this module is loaded
initializeDatabase()
  .then(() => {
    const requestId = ulid();
    logger.infoWithContext(
      "CRUDA Router database initialized successfully", 
      createLogContext({
        requestId,
        component: 'CRUDARouter',
        method: 'moduleInitialization',
        status: "ready"
      })
    );
  })
  .catch((error) => {
    const requestId = ulid();
    logErrorWithMetrics(
      "Failed to initialize database",
      createLogContext({
        requestId,
        component: 'CRUDARouter',
        method: 'moduleInitialization',
        status: "failed"
      }),
      error,
      'database_error',
      {
        operation: 'moduleInitialization',
        result: 'error'
      }
    );
    // Don't exit the process - let app.js handle errors
  });

// Middleware to check if the comment exists
const itemExists = async (req, res, next) => {
  const id = parseInt(req.body.id);
  const requestId = req.headers['x-request-id'] || ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'CRUDARouter',
    method: 'itemExists',
    endpoint: req.path,
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip,
    itemId: id,
    headers: Object.keys(req.headers)
  });
  
  // Use debugWithContextIf to only log in non-production environments
  debugWithContextIf(
    process.env.NODE_ENV !== "production", 
    "Checking if item exists", 
    baseContext
  );
  
  try {
    const comment = await db.get("SELECT * FROM comments WHERE id = ?", id);
    if (!comment) {
      const errorMessage = `Comment not found: ${id}`;
      const duration = Date.now() - startTime;
      
      // Use standard logger.warnWithContext since this is important in all environments
      logger.warnWithContext(
        "Comment not found", 
        {
          ...baseContext,
          status: "not_found",
          duration
        }
      );
      
      // Add metric for not found
      logger.metric('cruda_operations', duration, {
        operation: 'itemExists',
        result: 'not_found',
        itemId: id
      });
      
      // Determine if this is part of a test
      const isTest = req.headers['x-webhook-test'] === 'true';
      
      // Pass the request object to logAndSendWebhook
      await logAndSendWebhook("comment_not_found", { 
        id, 
        error: errorMessage,
        test_id: isTest ? requestId : undefined
      }, true, isTest, req);
      
      return res.status(404).json({ 
        error: errorMessage,
        requestId 
      });
    }
    
    const duration = Date.now() - startTime;
    
    logger.debugWithContext(
      "Comment found", 
      {
        ...baseContext,
        status: "found",
        commentTitle: comment.title,
        duration
      }
    );
    
    // Add metric for successful operation
    logger.metric('cruda_operations', duration, {
      operation: 'itemExists',
      result: 'success',
      itemId: id
    });
    
    req.comment = comment;
    req.requestId = requestId;
    req.startTime = startTime; // Track when the request started
    next();
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Use logErrorWithMetrics to standardize error logging and metrics
    logErrorWithMetrics(
      "Error checking if item exists", 
      {
        ...baseContext,
        duration
      },
      error,
      "cruda_error",
      { 
        operation: "itemExists", 
        result: "error",
        duration
      }
    );
    
    res.status(500).json({ 
      error: "Internal server error",
      requestId 
    });
  }
};

// CREATE - Add a new comment
router.post(
  "/create",
  (req, res, next) => {
    req.logAction = "create_item";
    req.requestId = req.headers['x-request-id'] || ulid();
    req.startTime = Date.now();
    req.isWebhookTest = req.headers['x-webhook-test'] === 'true';
    next();
  },
  async (req, res) => {
    const requestId = req.requestId;
    const startTime = req.startTime || Date.now();
    const routeStartTime = Date.now();
    const { title, content } = req.body;
    
    // Create context for create operation using the helper function
    const baseContext = createLogContext({
      requestId,
      component: 'CRUDARouter',
      method: 'createComment',
      endpoint: req.path,
      httpMethod: req.method,
      userId: req.user?.id,
      ip: req.ip,
      action: req.logAction,
      hasTitle: !!title,
      hasContent: !!content,
      isTest: req.isWebhookTest,
      headers: Object.keys(req.headers),
      bodyKeys: Object.keys(req.body || {}),
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    });
    
    logger.debugWithContext("Processing create comment request", baseContext);
    
    if (!title || !content) {
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      const errorMessage = "Invalid create request: missing title or content";
      
      logger.warnWithContext(
        "Invalid create request", 
        {
          ...baseContext,
          validation: "failed",
          missingTitle: !title,
          missingContent: !content,
          duration,
          routeDuration
        }
      );
      
      // Add metric for validation failure
      logger.metric('cruda_operations', duration, {
        operation: 'createComment',
        result: 'validation_error',
        statusCode: 400
      });
      
      // Pass the request object to logAndSendWebhook
      await logAndSendWebhook("create_comment_error", { 
        error: errorMessage,
        test_id: req.isWebhookTest ? requestId : undefined
      }, true, req.isWebhookTest, req);
      
      return res.status(400).json({ 
        error: errorMessage,
        requestId
      });
    }
    
    try {
      const result = await db.run(
        "INSERT INTO comments (title, content) VALUES (?, ?)",
        [title, content]
      );
      
      const newItem = {
        id: result.lastID,
        title,
        content,
        requestId
      };
      
      // Add test_id for webhook tracking if this is a test
      if (req.isWebhookTest) {
        newItem.test_id = requestId;
      }
      
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logger.infoWithContext(
        "Comment created successfully", 
        {
          ...baseContext,
          status: "success",
          commentId: result.lastID,
          titleLength: title.length,
          contentLength: content.length,
          duration,
          routeDuration
        }
      );
      
      // Add metric for successful operation
      logger.metric('cruda_operations', duration, {
        operation: 'createComment',
        result: 'success',
        titleLength: title.length,
        contentLength: content.length
      });
      
      // Send the webhook with additional test flag and pass the request object
      const webhookResult = await logAndSendWebhook("comment_created", newItem, false, req.isWebhookTest, req);
      
      const response = { ...newItem };
      
      // If this is a test, include webhook result info
      if (req.isWebhookTest) {
        response.webhook_result = {
          success: webhookResult.isValid,
          correlation_id: webhookResult.requestId,
          error: webhookResult.error ? webhookResult.error.message : null
        };
      }
      
      if (req.new_jwt_token) {
        response.new_jwt_token = req.new_jwt_token;
        logger.debugWithContext(
          "Added JWT token to response", 
          {
            ...baseContext,
            tokenAdded: true
          }
        );
      }
      
      res.status(201).json(response);
    } catch (error) {
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logErrorWithMetrics(
        "Error creating comment",
        {
          ...baseContext,
          duration,
          routeDuration
        },
        error,
        'cruda_error',
        {
          operation: 'createComment',
          result: 'error',
          duration
        }
      );
      
      res.status(500).json({ 
        error: "Internal server error",
        requestId
      });
    }
  }
);

// READ - Read all comments
router.post(
  "/list",
  (req, res, next) => {
    req.logAction = "read_all_items";
    req.requestId = req.headers['x-request-id'] || ulid();
    req.startTime = Date.now();
    req.isWebhookTest = req.headers['x-webhook-test'] === 'true';
    next();
  },
  async (req, res) => {
    const requestId = req.requestId;
    const startTime = req.startTime || Date.now();
    const routeStartTime = Date.now();
    
    // Create context for list operation
    const baseContext = createLogContext({
      requestId,
      component: 'CRUDARouter',
      method: 'listComments',
      endpoint: req.path,
      httpMethod: req.method,
      userId: req.user?.id,
      ip: req.ip,
      action: req.logAction,
      isTest: req.isWebhookTest,
      headers: Object.keys(req.headers),
      bodyKeys: Object.keys(req.body || {}),
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    });
    
    logger.debugWithContext("Processing list comments request", baseContext);
    
    try {
      const comments = await db.all("SELECT * FROM comments");
      const itemCount = comments.length;
      
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logger.infoWithContext(
        "Comments retrieved successfully", 
        {
          ...baseContext,
          status: "success",
          count: itemCount,
          duration,
          routeDuration
        }
      );
      
      // Add metric for successful operation
      logger.metric('cruda_operations', duration, {
        operation: 'listComments',
        result: 'success',
        count: itemCount
      });
      
      // Send webhook with test flag if needed and pass the request object
      const webhookPayload = { 
        count: itemCount,
        test_id: req.isWebhookTest ? requestId : undefined
      };
      
      const webhookResult = await logAndSendWebhook("comments_listed", webhookPayload, false, req.isWebhookTest, req);
      
      const response = { 
        comments,
        requestId 
      };
      
      // If this is a test, include webhook result info
      if (req.isWebhookTest) {
        response.webhook_result = {
          success: webhookResult.isValid,
          correlation_id: webhookResult.requestId,
          error: webhookResult.error ? webhookResult.error.message : null
        };
      }
      
      if (req.new_jwt_token) {
        response.new_jwt_token = req.new_jwt_token;
        logger.debugWithContext(
          "Added JWT token to response", 
          {
            ...baseContext,
            tokenAdded: true
          }
        );
      }
      
      res.json(response);
    } catch (error) {
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logErrorWithMetrics(
        "Error retrieving comments",
        {
          ...baseContext,
          duration,
          routeDuration
        },
        error,
        'cruda_error',
        {
          operation: 'listComments',
          result: 'error',
          duration
        }
      );
      
      res.status(500).json({ 
        error: "Internal server error",
        requestId 
      });
    }
  }
);

// READ - Read a specific comment
router.post(
  "/read",
  (req, res, next) => {
    req.requestId = req.headers['x-request-id'] || ulid();
    req.startTime = Date.now();
    req.isWebhookTest = req.headers['x-webhook-test'] === 'true';
    next();
  },
  itemExists,
  (req, res, next) => {
    req.logAction = "read_item";
    req.routeStartTime = Date.now(); // Track when route handler started after middleware
    next();
  },
  async (req, res) => {
    const requestId = req.requestId;
    const startTime = req.startTime || Date.now();
    const routeStartTime = req.routeStartTime || Date.now();
    
    // Create context for read operation
    const baseContext = createLogContext({
      requestId,
      component: 'CRUDARouter',
      method: 'readComment',
      endpoint: req.path,
      httpMethod: req.method,
      userId: req.user?.id,
      ip: req.ip,
      action: req.logAction,
      commentId: req.comment.id,
      isTest: req.isWebhookTest,
      headers: Object.keys(req.headers),
      bodyKeys: Object.keys(req.body || {}),
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    });
    
    logger.debugWithContext("Processing read comment request", baseContext);
    
    try {
      // Add test_id for webhook tracking if this is a test
      const commentData = { ...req.comment, requestId };
      if (req.isWebhookTest) {
        commentData.test_id = requestId;
      }
      
      // Send the webhook with test flag if needed and pass the request object
      const webhookResult = await logAndSendWebhook("comment_read", commentData, false, req.isWebhookTest, req);
      
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logger.infoWithContext(
        "Comment retrieved successfully", 
        {
          ...baseContext,
          status: "success",
          commentTitle: req.comment.title,
          webhookSent: webhookResult.isValid,
          duration,
          routeDuration
        }
      );
      
      // Add metric for successful operation
      logger.metric('cruda_operations', duration, {
        operation: 'readComment',
        result: 'success',
        commentId: req.comment.id
      });
      
      const response = { ...req.comment, requestId };
      
      // If this is a test, include webhook result info
      if (req.isWebhookTest) {
        response.webhook_result = {
          success: webhookResult.isValid,
          correlation_id: webhookResult.requestId,
          error: webhookResult.error ? webhookResult.error.message : null
        };
      }
      
      if (req.new_jwt_token) {
        response.new_jwt_token = req.new_jwt_token;
        logger.debugWithContext(
          "Added JWT token to response", 
          {
            ...baseContext,
            tokenAdded: true
          }
        );
      }
      
      res.json(response);
    } catch (error) {
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logErrorWithMetrics(
        "Error retrieving comment",
        {
          ...baseContext,
          duration,
          routeDuration
        },
        error,
        'cruda_error',
        {
          operation: 'readComment',
          result: 'error',
          duration
        }
      );
      
      res.status(500).json({ 
        error: "Internal server error",
        requestId 
      });
    }
  }
);

// UPDATE - Update a comment
router.post(
  "/update",
  (req, res, next) => {
    req.requestId = req.headers['x-request-id'] || ulid();
    req.startTime = Date.now();
    req.isWebhookTest = req.headers['x-webhook-test'] === 'true';
    next();
  },
  itemExists,
  (req, res, next) => {
    req.logAction = "update_item";
    req.routeStartTime = Date.now(); // Track when route handler started after middleware
    next();
  },
  async (req, res) => {
    const requestId = req.requestId;
    const startTime = req.startTime || Date.now();
    const routeStartTime = req.routeStartTime || Date.now();
    const { id, title, content } = req.body;
    const oldComment = { ...req.comment };
    
    // Create context for update operation
    const baseContext = createLogContext({
      requestId,
      component: 'CRUDARouter',
      method: 'updateComment',
      endpoint: req.path,
      httpMethod: req.method,
      userId: req.user?.id,
      ip: req.ip,
      action: req.logAction,
      commentId: id,
      titleUpdated: title !== undefined,
      contentUpdated: content !== undefined,
      isTest: req.isWebhookTest,
      headers: Object.keys(req.headers),
      bodyKeys: Object.keys(req.body || {}),
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    });
    
    logger.debugWithContext("Processing update comment request", baseContext);
    
    try {
      await db.run(
        "UPDATE comments SET title = COALESCE(?, title), content = COALESCE(?, content) WHERE id = ?",
        [title, content, id]
      );
      
      const updatedComment = await db.get(
        "SELECT * FROM comments WHERE id = ?",
        id
      );
      
      // Add test_id for webhook tracking if this is a test
      const webhookData = {
        id,
        old: oldComment,
        new: updatedComment,
        requestId
      };
      
      if (req.isWebhookTest) {
        webhookData.test_id = requestId;
      }
      
      // Send the webhook with test flag if needed and pass the request object
      const webhookResult = await logAndSendWebhook("comment_updated", webhookData, false, req.isWebhookTest, req);
      
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logger.infoWithContext(
        "Comment updated successfully", 
        {
          ...baseContext,
          status: "success",
          titleChanged: oldComment.title !== updatedComment.title,
          contentChanged: oldComment.content !== updatedComment.content,
          webhookSent: webhookResult.isValid,
          duration,
          routeDuration
        }
      );
      
      // Add metric for successful operation
      logger.metric('cruda_operations', duration, {
        operation: 'updateComment',
        result: 'success',
        commentId: id,
        titleChanged: oldComment.title !== updatedComment.title,
        contentChanged: oldComment.content !== updatedComment.content
      });
      
      const response = { ...updatedComment, requestId };
      
      // If this is a test, include webhook result info
      if (req.isWebhookTest) {
        response.webhook_result = {
          success: webhookResult.isValid,
          correlation_id: webhookResult.requestId,
          error: webhookResult.error ? webhookResult.error.message : null
        };
      }
      
      if (req.new_jwt_token) {
        response.new_jwt_token = req.new_jwt_token;
        logger.debugWithContext(
          "Added JWT token to response", 
          {
            ...baseContext,
            tokenAdded: true
          }
        );
      }
      
      res.json(response);
    } catch (error) {
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logErrorWithMetrics(
        "Error updating comment",
        {
          ...baseContext,
          duration,
          routeDuration
        },
        error,
        'cruda_error',
        {
          operation: 'updateComment',
          result: 'error',
          duration
        }
      );
      
      res.status(500).json({ 
        error: "Internal server error",
        requestId 
      });
    }
  }
);

// DESTROY - Destroy a comment
router.post(
  "/destroy",
  (req, res, next) => {
    req.requestId = req.headers['x-request-id'] || ulid();
    req.startTime = Date.now();
    req.isWebhookTest = req.headers['x-webhook-test'] === 'true';
    next();
  },
  itemExists,
  (req, res, next) => {
    req.logAction = "destroy_item";
    req.routeStartTime = Date.now(); // Track when route handler started after middleware
    next();
  },
  async (req, res) => {
    const requestId = req.requestId;
    const startTime = req.startTime || Date.now();
    const routeStartTime = req.routeStartTime || Date.now();
    const { id } = req.body;
    
    // Create context for destroy operation
    const baseContext = createLogContext({
      requestId,
      component: 'CRUDARouter',
      method: 'destroyComment',
      endpoint: req.path,
      httpMethod: req.method,
      userId: req.user?.id,
      ip: req.ip,
      action: req.logAction,
      commentId: id,
      isTest: req.isWebhookTest,
      headers: Object.keys(req.headers),
      bodyKeys: Object.keys(req.body || {}),
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    });
    
    logger.debugWithContext("Processing destroy comment request", baseContext);
    
    try {
      const deletedComment = { ...req.comment };
      await db.run("DELETE FROM comments WHERE id = ?", id);
      
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logger.infoWithContext(
        "Comment destroyed successfully", 
        {
          ...baseContext,
          status: "success",
          commentTitle: deletedComment.title,
          duration,
          routeDuration
        }
      );
      
      // Add metric for successful operation
      logger.metric('cruda_operations', duration, {
        operation: 'destroyComment',
        result: 'success',
        commentId: id
      });
      
      // Add test_id for webhook tracking if this is a test
      const webhookData = { ...deletedComment, requestId };
      if (req.isWebhookTest) {
        webhookData.test_id = requestId;
      }
      
      // Send the webhook with test flag if needed and pass the request object
      const webhookResult = await logAndSendWebhook("comment_destroyed", webhookData, false, req.isWebhookTest, req);
      
      const response = { 
        success: true,
        requestId
      };
      
      // If this is a test, include webhook result info
      if (req.isWebhookTest) {
        response.webhook_result = {
          success: webhookResult.isValid,
          correlation_id: webhookResult.requestId,
          error: webhookResult.error ? webhookResult.error.message : null
        };
      }
      
      if (req.new_jwt_token) {
        response.new_jwt_token = req.new_jwt_token;
        logger.debugWithContext(
          "Added JWT token to response", 
          {
            ...baseContext,
            tokenAdded: true
          }
        );
      }
      
      res.json(response);
    } catch (error) {
      const duration = Date.now() - startTime;
      const routeDuration = Date.now() - routeStartTime;
      
      logErrorWithMetrics(
        "Error destroying comment",
        {
          ...baseContext,
          duration,
          routeDuration
        },
        error,
        'cruda_error',
        {
          operation: 'destroyComment',
          result: 'error',
          duration
        }
      );
      
      res.status(500).json({ 
        error: "Internal server error",
        requestId 
      });
    }
  }
);

// Webhook endpoints removed as they are not needed for the authentication system

// Export functions to allow proper cleanup in app.js
router.closeDatabase = async () => {
  if (db) {
    try {
      await db.close();
      logger.infoWithContext("Database connection closed", {
        operation: "db_close",
        module: "cruda_router",
        status: "success"
      });
    } catch (error) {
      logger.errorWithContext(
        "Error closing database", 
        {
          operation: "db_close",
          module: "cruda_router",
          status: "failed"
        },
        error
      );
      throw error;
    }
  }
};

// Webhook test functions removed as they are not needed for the authentication system

// Export the database getter
router.getDatabase = getDatabase;

module.exports = router;