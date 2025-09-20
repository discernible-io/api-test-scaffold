/**
 * Model Context Protocol (MCP) Routes
 * 
 * This file defines routes that implement the Model Context Protocol (MCP) interface,
 * allowing AI models to access structured data from the application.
 */

const express = require('express');
const router = express.Router();
const { ulid } = require('ulid');
const { RoditClient } = require('@rodit/rodit-auth-be');

// Create SDK client instance to access all functionality
const sdkClient = new RoditClient();
const logger = sdkClient.getLogger();
const authenticate_apicall = (req, res, next) => sdkClient.authenticateApiCall(req, res, next);
// Note: mcpService may need to be accessed through a different method if available

;
const { createLogContext, logErrorWithMetrics } = logger;

/**
 * @swagger
 * /api/mcp/resources:
 *   get:
 *     summary: List available MCP resources
 *     description: Returns a list of resources available through the MCP interface
 *     tags: [MCP]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum number of resources to return
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor for pagination
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available resources with pagination info
 *       401:
 *         description: Unauthorized
 */
router.get('/resources', async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'MCPRoutes',
    method: 'listResources',
    endpoint: '/api/mcp/resources',
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip,
    limit: req.query.limit,
    hasCursor: !!req.query.cursor
  });
  
  logger.debugWithContext('Processing MCP resources list request', baseContext);
  
  try {
    // Extract pagination parameters from query
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      cursor: req.query.cursor
    };
    
    // Get resources with pagination
    const result = await mcpService.listAvailableResources(req, options);
    
    const duration = Date.now() - startTime;
    logger.infoWithContext('MCP resources listed successfully', {
      ...baseContext,
      resourceCount: result.resources?.length || 0,
      hasNextCursor: !!result.nextCursor,
      duration
    });
    
    // Add metric for successful operation
    logger.metric('mcp_operations', duration, {
      operation: 'listResources',
      result: 'success'
    });
    
    res.json({
      ...result,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      'Error listing MCP resources',
      {
        ...baseContext,
        duration
      },
      error,
      'mcp_error',
      {
        operation: 'listResources',
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: 'Failed to list resources',
      message: error.message,
      requestId
    });
  }
});

/**
 * @swagger
 * /api/mcp/resource/{uri}:
 *   get:
 *     summary: Get a specific MCP resource
 *     description: Returns the content of a specific resource
 *     tags: [MCP]
 *     parameters:
 *       - in: path
 *         name: uri
 *         schema:
 *           type: string
 *         required: true
 *         description: URI of the resource to retrieve
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Resource content
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Resource not found
 */
router.get('/resource/:uri(*)', authenticate_apicall, async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();
  const uri = req.params.uri;
  
  const baseContext = createLogContext({
    requestId,
    component: 'MCPRoutes',
    method: 'getResource',
    endpoint: '/api/mcp/resource/:uri',
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip,
    resourceUri: uri
  });
  
  logger.debugWithContext('Processing MCP resource request', baseContext);
  
  try {
    const resource = await mcpService.getResource(uri, req);
    
    if (!resource) {
      logger.warnWithContext('MCP resource not found', {
        ...baseContext,
        status: 404
      });
      
      return res.status(404).json({
        error: 'Resource not found',
        uri,
        requestId
      });
    }
    
    const duration = Date.now() - startTime;
    logger.infoWithContext('MCP resource retrieved successfully', {
      ...baseContext,
      resourceType: resource.type || 'unknown',
      resourceSize: JSON.stringify(resource).length,
      duration
    });
    
    // Add metric for successful operation
    logger.metric('mcp_operations', duration, {
      operation: 'getResource',
      resourceUri: uri,
      result: 'success'
    });
    
    res.json({
      ...resource,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorContext = {
      ...baseContext,
      duration,
      errorMessage: error.message
    };
    
    if (error.message.includes('Unauthorized')) {
      logger.warnWithContext('Unauthorized access to MCP resource', errorContext);
      
      // Add metric for unauthorized access
      logger.metric('mcp_operations', duration, {
        operation: 'getResource',
        resourceUri: uri,
        result: 'unauthorized'
      });
      
      return res.status(401).json({
        error: 'Unauthorized access to resource',
        message: error.message,
        requestId
      });
    }
    
    if (error.message.includes('Unknown') || error.message.includes('not found')) {
      logger.warnWithContext('MCP resource not found', errorContext);
      
      // Add metric for not found
      logger.metric('mcp_operations', duration, {
        operation: 'getResource',
        resourceUri: uri,
        result: 'not_found'
      });
      
      return res.status(404).json({
        error: 'Resource not found',
        message: error.message,
        requestId
      });
    }
    
    logErrorWithMetrics(
      'Error retrieving MCP resource',
      errorContext,
      error,
      'mcp_error',
      {
        operation: 'getResource',
        resourceUri: uri,
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: 'Failed to retrieve resource',
      message: error.message,
      requestId
    });
  }
});

/**
 * @swagger
 * /api/mcp/schema:
 *   get:
 *     summary: Get MCP schema
 *     description: Returns the schema for the MCP interface
 *     tags: [MCP]
 *     responses:
 *       200:
 *         description: MCP schema
 */
router.get('/schema', async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'MCPRoutes',
    method: 'getSchema',
    endpoint: '/api/mcp/schema',
    httpMethod: req.method,
    userId: req.user?.id,
    ip: req.ip
  });
  
  logger.debugWithContext('Processing MCP schema request', baseContext);
  
  try {
    // Reuse the schema resource to avoid duplication
    const schema = await mcpService.getSchemaResource(req);
    
    const duration = Date.now() - startTime;
    logger.infoWithContext('MCP schema retrieved successfully', {
      ...baseContext,
      schemaSize: JSON.stringify(schema).length,
      duration
    });
    
    // Add metric for successful operation
    logger.metric('mcp_operations', duration, {
      operation: 'getSchema',
      result: 'success'
    });
    
    res.json({
      ...schema,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      'Error retrieving MCP schema',
      {
        ...baseContext,
        duration
      },
      error,
      'mcp_error',
      {
        operation: 'getSchema',
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: 'Failed to retrieve schema',
      message: error.message,
      requestId
    });
  }
});

module.exports = router;
