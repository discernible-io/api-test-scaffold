# RODiT Authentication SDK

A comprehensive Node.js SDK for implementing RODiT-based mutual authentication, authorization, self-configuration, and logging in Express.js applications.

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Mutual Authentication](#mutual-authentication)
- [Authorization & Permissions](#authorization--permissions)
- [Self-Configuration](#self-configuration)
- [Logging & Monitoring](#logging--monitoring)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Quick Start

### Installation

```bash
npm install @rodit/rodit-auth-be
```

### Basic Server Setup

```javascript
const express = require('express');
const { RoditClient, logger, loggingmw, config } = require('@rodit/rodit-auth-be');
const { ulid } = require('ulid');

const app = express();
let roditClient;

// Configure Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(loggingmw);

// Request context middleware
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || ulid();
  req.startTime = Date.now();
  next();
});

// Authentication routes
app.post('/login', (req, res, next) => {
  req.logAction = "login-attempt";
  next();
}, roditClient.authenticate, (req, res) => {
  res.json({
    success: true,
    message: "Authentication successful",
    user: { id: req.user?.id },
    requestId: req.requestId
  });
});

app.post('/logout', roditClient.authenticate, (req, res) => {
  roditClient.logoutClient(req, res);
});

// Protected routes
app.use('/api/protected', roditClient.authenticate, protectedRoutes);

// Server startup with SDK initialization
async function startServer() {
  try {
    // Initialize RODiT client
    roditClient = await RoditClient.create('portal');
    
    // Store client in app.locals for route access
    app.locals.roditClient = roditClient;
    
    const port = config.get('SERVERPORT');
    app.listen(port, () => {
      logger.info(`RODiT Authentication Server running on port ${port}`);
    });
  } catch (error) {
    logger.error('Server initialization failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

startServer();
```

## Core Concepts

### The RoditClient Pattern

The SDK centers around the `RoditClient` class, which provides a unified interface for all RODiT operations:

- **Single Initialization**: Create once with `RoditClient.create()`
- **Shared Instance**: Store in `app.locals` for access across routes
- **Self-Configuring**: Automatically loads configuration from vault or files
- **Encapsulated**: All SDK functionality accessed through the client instance

### App.locals Pattern

Following the successful clienttestapi-rodit implementation, store the initialized client in `app.locals`:

```javascript
// In main app.js
app.locals.roditClient = await RoditClient.create('portal');

// In route modules
const authenticate = (req, res, next) => {
  const client = req.app.locals.roditClient;
  return client.authenticateApiCall(req, res, next);
};
```

## Mutual Authentication

### RODiT-Based Authentication

RODiT provides cryptographic mutual authentication using blockchain-verified identities:

```javascript
// Authentication request format
{
  "roditid": "your-rodit-id",
  "timestamp": 1640995200,
  "roditid_base64url_signature": "base64url-encoded-signature"
}
```

### Implementation in Routes

```javascript
// Protected route with authentication
app.get('/api/data', roditClient.authenticate, (req, res) => {
  // req.user contains authenticated user information
  res.json({
    message: 'Authenticated data',
    user: req.user,
    requestId: req.requestId
  });
});
```

### Authentication Flow

1. Client sends RODiT and cryptographic signature
2. SDK verifies signature against blockchain records
3. JWT token issued for session management
4. Subsequent requests use JWT for performance
5. Token refresh handled automatically

## Authorization & Permissions

### Route-Based Permissions

Configure permissions in your RODiT token metadata:

```json
{
  "permissioned_routes": {
    "/api/admin": ["GET", "POST", "PUT", "DELETE"],
    "/api/users": ["GET", "POST"],
    "/api/public": ["GET"]
  }
}
```

### Permission Validation Middleware

```javascript
// Apply both authentication and permission validation
app.use('/api/admin', 
  roditClient.authenticate,
  roditClient.authorize,
  adminRoutes
);

// In route handlers
app.get('/api/sensitive-data', 
  roditClient.authenticate,
  roditClient.authorize,
  (req, res) => {
    // Only accessible if user has permission for GET /api/sensitive-data
    res.json({ data: 'sensitive information' });
  }
);
```

### Dynamic Permission Checking

```javascript
// Check permissions programmatically
const hasPermission = roditClient.isOperationPermitted('POST', '/api/admin/users');
if (hasPermission) {
  // Proceed with operation
}
```

## Self-Configuration

### Automatic Configuration Loading

The SDK automatically configures itself from multiple sources:

1. **Vault Credentials** (Production)
2. **File-based Credentials** (Development)
3. **Environment Variables**
4. **Configuration Files**
5. **SDK Defaults** (Fallback)

### Vault-Based Configuration

```bash
# Environment variables for vault
export RODIT_NEAR_CREDENTIALS_SOURCE=vault
export VAULT_ENDPOINT=https://vault.example.com
export VAULT_ROLE_ID=your-role-id
export VAULT_SECRET_ID=your-secret-id
export VAULT_RODIT_KEYVALUE_PATH=secret/rodit
export SERVICE_NAME=your-service-name
export NEAR_CONTRACT_ID=your-contract.testnet
```

### Accessing Configuration

```javascript
// Get complete RODiT configuration
const configObject = await roditClient.getConfigOwnRodit();
const metadata = configObject.own_rodit.metadata;

// Access specific configuration values
const jwtDuration = metadata.jwt_duration;
const allowedRoutes = JSON.parse(metadata.permissioned_routes || '{}');
const apiEndpoint = metadata.subjectuniqueidentifier_url;

// Use SDK config wrapper for application settings
const { config } = require('@rodit/rodit-auth-be');
const serverPort = config.get('SERVERPORT');
const logLevel = config.get('LOG_LEVEL', 'info');
```

### Dynamic Rate Limiting

```javascript
// Configure rate limiting from RODiT token
const configObject = await roditClient.getConfigOwnRodit();
const metadata = configObject.own_rodit.metadata;

if (metadata.max_requests && metadata.maxrq_window) {
  const maxRequests = parseInt(metadata.max_requests);
  const windowSeconds = parseInt(metadata.maxrq_window);
  
  const rateLimiter = roditClient.getRateLimitMiddleware();
  app.use(rateLimiter(maxRequests, windowSeconds));
}
```

## Logging & Monitoring

### Structured Logging

The SDK provides comprehensive structured logging:

```javascript
const { logger } = require('@rodit/rodit-auth-be');

// Basic logging
logger.info('Operation completed', {
  component: 'UserService',
  operation: 'createUser',
  userId: '123',
  duration: 150
});

// Context-aware logging
logger.infoWithContext('Request processed', {
  component: 'API',
  method: 'POST',
  path: '/api/users',
  requestId: req.requestId,
  userId: req.user?.id,
  duration: Date.now() - req.startTime
});

// Error logging with metrics
logger.errorWithContext('Operation failed', {
  component: 'UserService',
  operation: 'createUser',
  requestId: req.requestId,
  error: error.message,
  stack: error.stack
}, error);
```

### Loki Integration

Configure centralized logging with Grafana Loki:

```bash
# Environment variables
export LOKI_URL=https://loki.example.com:3100
export LOKI_BASIC_AUTH=username:password
export LOKI_TLS_SKIP_VERIFY=true  # Only for testing
export LOG_LEVEL=info
```

```javascript
// Custom logger injection for advanced scenarios
const winston = require('winston');
const LokiTransport = require('winston-loki');

const customLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new LokiTransport({
      host: process.env.LOKI_URL,
      basicAuth: process.env.LOKI_BASIC_AUTH,
      labels: { app: 'my-service', component: 'rodit-sdk' },
      json: true,
      batching: true
    })
  ]
});

logger.setLogger(customLogger);
```

### Performance Monitoring

```javascript
// Request performance tracking
app.use((req, res, next) => {
  req.startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    
    logger.metric('request_duration_ms', duration, {
      method: req.method,
      path: req.path,
      status: res.statusCode
    });
    
    logger.debugWithContext('Request completed', {
      component: 'API',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      requestId: req.requestId
    });
  });
  
  next();
});
```

## Advanced Usage

### Route Module Pattern

Create reusable route modules that access the shared RoditClient:

```javascript
// routes/protected.js
const express = require('express');
const { logger } = require('@rodit/rodit-auth-be');
const router = express.Router();

// Middleware that uses the shared client
const authenticate = (req, res, next) => {
  const client = req.app.locals.roditClient;
  if (!client) {
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
  return client.authenticateApiCall(req, res, next);
};

const validatePermissions = (req, res, next) => {
  const client = req.app.locals.roditClient;
  if (!client) {
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
  return client.validatePermissions(req, res, next);
};

// Protected route with full authentication and authorization
router.get('/data', authenticate, validatePermissions, async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Your business logic here
    const data = await processUserData(req.user.id);
    
    logger.infoWithContext('Data retrieved successfully', {
      component: 'ProtectedRoutes',
      method: 'getData',
      userId: req.user.id,
      requestId: req.requestId,
      duration: Date.now() - startTime
    });
    
    res.json({ data, requestId: req.requestId });
  } catch (error) {
    logger.errorWithContext('Failed to retrieve data', {
      component: 'ProtectedRoutes',
      method: 'getData',
      userId: req.user.id,
      requestId: req.requestId,
      duration: Date.now() - startTime,
      error: error.message
    }, error);
    
    res.status(500).json({
      error: 'Internal server error',
      requestId: req.requestId
    });
  }
});

module.exports = router;
```

### Custom Signer Classes

For specialized signing operations, create classes that use the shared RoditClient:

```javascript
// services/DocumentSigner.js
class DocumentSigner {
  constructor(roditClient) {
    this.roditClient = roditClient;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Get configuration from the shared client
    const configObject = await this.roditClient.getConfigOwnRodit();
    this.metadata = configObject.own_rodit.metadata;
    
    // Get credentials through the client's manager
    const credentials = await this.roditClient.getRoditManager().getCredentials('portal');
    this.signingKey = credentials.signing_bytes_key;
    
    this.initialized = true;
    logger.info('DocumentSigner initialized successfully');
  }

  async signDocument(document) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Signing logic using this.signingKey
    const signature = this.createSignature(document);
    return signature;
  }
}

// Usage in routes
router.post('/sign-document', authenticate, async (req, res) => {
  try {
    // Get or create signer instance from app.locals
    if (!req.app.locals.documentSigner) {
      const roditClient = req.app.locals.roditClient;
      req.app.locals.documentSigner = new DocumentSigner(roditClient);
    }
    
    const signer = req.app.locals.documentSigner;
    const signature = await signer.signDocument(req.body.document);
    
    res.json({ signature, requestId: req.requestId });
  } catch (error) {
    logger.errorWithContext('Document signing failed', {
      component: 'DocumentSigner',
      requestId: req.requestId,
      error: error.message
    }, error);
    
    res.status(500).json({
      error: 'Document signing failed',
      requestId: req.requestId
    });
  }
});
```

### Session Management

```javascript
// Access session manager through the client
const sessionManager = roditClient.getSessionManager();

// Create custom session data
const session = sessionManager.createSession(userId, {
  loginTime: Date.now(),
  ipAddress: req.ip,
  userAgent: req.get('User-Agent')
});

// Validate sessions
const isValid = sessionManager.validateSession(sessionId, token);

// Clean up expired sessions
const cleanupResult = sessionManager.removeExpiredSessions();
logger.info(`Cleaned up ${cleanupResult} expired sessions`);
```

### Webhook Integration

```javascript
// Send webhooks through the client
const webhookData = {
  event: 'user_login',
  userId: req.user.id,
  timestamp: Date.now(),
  metadata: {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  }
};

try {
  const result = await roditClient.sendWebhook(webhookData);
  logger.info('Webhook sent successfully', { result });
} catch (error) {
  logger.error('Webhook failed', { error: error.message });
}
```

## API Reference

### RoditClient Class

The main client class for all RODiT operations.

#### Static Methods

##### RoditClient.create(role)

Create and initialize a RODiT client in one step.

```javascript
const client = await RoditClient.create('portal'); // or 'client'
```

**Parameters:**
- `role` (string): Client role - 'portal' for server applications, 'client' for client applications

**Returns:** Promise<RoditClient> - Fully initialized client instance

#### Instance Methods

##### authenticateApiCall(req, res, next)

Express middleware for authenticating API requests.

```javascript
app.use('/api/protected', roditClient.authenticate, handler);
```

##### validatePermissions(req, res, next)

Express middleware for validating route permissions.

```javascript
app.use('/api/admin', 
  roditClient.authenticate,
  roditClient.authorize,
  handler
);
```

##### logoutClient(req, res)

Handle client logout requests.

```javascript
app.post('/logout', roditClient.authenticate, (req, res) => {
  roditClient.logoutClient(req, res);
});
```

##### getConfigOwnRodit()

Get the complete RODiT configuration including token metadata.

```javascript
const configObject = await roditClient.getConfigOwnRodit();
const metadata = configObject.own_rodit.metadata;
```

**Returns:** Promise<Object> - Complete RODiT configuration object

##### isOperationPermitted(method, path)

Check if an operation is permitted based on token permissions.

```javascript
const hasPermission = roditClient.isOperationPermitted('POST', '/api/admin/users');
```

**Parameters:**
- `method` (string): HTTP method (GET, POST, PUT, DELETE, etc.)
- `path` (string): API path

**Returns:** boolean - True if operation is permitted

##### getStateManager()

Get the state manager instance.

```javascript
const stateManager = roditClient.getStateManager();
```

##### getRoditManager()

Get the RODiT manager instance.

```javascript
const roditManager = roditClient.getRoditManager();
```

##### getSessionManager()

Get the session manager instance.

```javascript
const sessionManager = roditClient.getSessionManager();
```

##### getLogger()

Get the logger instance.

```javascript
const logger = roditClient.getLogger();
```

##### getRateLimitMiddleware()

Get the rate limiting middleware factory.

```javascript
const rateLimiter = roditClient.getRateLimitMiddleware();
const middleware = rateLimiter(100, 900); // 100 requests per 15 minutes
```

##### sendWebhook(data)

Send a webhook with the provided data.

```javascript
const result = await roditClient.sendWebhook({
  event: 'user_action',
  data: { userId: '123', action: 'login' }
});
```

### Configuration System

#### Environment Variables

**Required for Vault-based credentials:**
```bash
export RODIT_NEAR_CREDENTIALS_SOURCE=vault
export VAULT_ENDPOINT=https://vault.example.com
export VAULT_ROLE_ID=your-role-id
export VAULT_SECRET_ID=your-secret-id
export VAULT_RODIT_KEYVALUE_PATH=secret/rodit
export SERVICE_NAME=your-service-name
export NEAR_CONTRACT_ID=your-contract.testnet
```

**Logging configuration:**
```bash
export LOG_LEVEL=info
export LOKI_URL=https://loki.example.com:3100
export LOKI_BASIC_AUTH=username:password
export LOKI_TLS_SKIP_VERIFY=true  # Only for testing
```

**Application configuration:**
```bash
export SERVERPORT=3000
export API_DEFAULT_OPTIONS_LOG_DIR=/app/logs
export API_DEFAULT_OPTIONS_DB_PATH=/app/data/database.db
```

#### Configuration Files

Place configuration in `config/default.json`, `config/production.json`, etc.:

```json
{
  "NEAR_CONTRACT_ID": "your-contract.testnet",
  "SERVICE_NAME": "your-service",
  "SERVERPORT": 3000,
  "API_DEFAULT_OPTIONS": {
    "LOG_DIR": "/app/logs",
    "DB_PATH": "/app/data/database.db"
  },
  "METHOD_PERMISSION_MAP": {
    "list_agents": ["entityAndProperties", "entityOnly"],
    "create_user": ["admin", "manager"]
  },
  "SECURITY_OPTIONS": {
    "SILENT_LOGIN_FAILURES": false,
    "JWT_DURATION": 3600
  }
}
```

### RODiT Token Metadata Fields

When you call `roditClient.getConfigOwnRodit()`, you get access to these metadata fields:

- **`token_id`**: Unique RODIT token identifier
- **`allowed_cidr`**: Permitted IP address ranges (CIDR format)
- **`allowed_iso3166list`**: Geographic restrictions (JSON string)
- **`jwt_duration`**: JWT token lifetime in seconds
- **`max_requests`**: Rate limit - maximum requests per window
- **`maxrq_window`**: Rate limit - time window in seconds
- **`not_before`/`not_after`**: Token validity period
- **`openapijson_url`**: OpenAPI specification URL
- **`permissioned_routes`**: Allowed API routes and methods (JSON string)
- **`serviceprovider_id`**: Blockchain contract and service provider info
- **`serviceprovider_signature`**: Cryptographic signature for verification
- **`subjectuniqueidentifier_url`**: Primary API service endpoint
- **`webhook_cidr`**: Allowed IP ranges for webhooks
- **`webhook_url`**: Webhook endpoint URL

## Best Practices

### 1. Single Client Initialization

Always initialize the RoditClient once in your main application file:

```javascript
// ✅ Good - Single initialization
async function startServer() {
  const roditClient = await RoditClient.create('portal');
  app.locals.roditClient = roditClient;
  // ... rest of server setup
}

// ❌ Bad - Multiple initializations
app.get('/route1', async (req, res) => {
  const client = await RoditClient.create('portal'); // Don't do this
});
```

### 2. Use App.locals for Shared Access

Store the client in `app.locals` for access across all routes:

```javascript
// ✅ Good - Shared instance
const authenticate = (req, res, next) => {
  const client = req.app.locals.roditClient;
  return client.authenticateApiCall(req, res, next);
};

// ❌ Bad - Direct SDK imports in routes
const { stateManager } = require('@rodit/rodit-auth-be');
const config = await stateManager.getConfigOwnRodit(); // Don't do this
```

### 3. Proper Error Handling

Always wrap SDK operations in try-catch blocks:

```javascript
// ✅ Good - Comprehensive error handling
app.get('/api/data', authenticate, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const data = await processData(req.user.id);
    
    logger.infoWithContext('Request successful', {
      component: 'API',
      method: 'getData',
      userId: req.user.id,
      requestId: req.requestId,
      duration: Date.now() - startTime
    });
    
    res.json({ data, requestId: req.requestId });
  } catch (error) {
    logger.errorWithContext('Request failed', {
      component: 'API',
      method: 'getData',
      userId: req.user.id,
      requestId: req.requestId,
      duration: Date.now() - startTime,
      error: error.message
    }, error);
    
    res.status(500).json({
      error: 'Internal server error',
      requestId: req.requestId
    });
  }
});
```

### 4. Structured Logging

Use consistent logging patterns with context:

```javascript
// ✅ Good - Structured logging with context
logger.infoWithContext('User action completed', {
  component: 'UserService',
  action: 'updateProfile',
  userId: user.id,
  requestId: req.requestId,
  duration: Date.now() - startTime,
  changes: Object.keys(updates)
});

// ❌ Bad - Unstructured logging
console.log('User updated profile'); // Don't do this
```

### 5. Environment-Specific Configuration

Use environment variables for sensitive and environment-specific values:

```javascript
// ✅ Good - Environment-aware configuration
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// Production should use vault credentials
if (isProduction && process.env.RODIT_NEAR_CREDENTIALS_SOURCE !== 'vault') {
  logger.warn('Production environment should use vault credentials');
}
```

### 6. Graceful Shutdown

Implement proper shutdown handling:

```javascript
// ✅ Good - Graceful shutdown
const shutdown = async (signal) => {
  logger.info('Shutting down gracefully', {
    component: 'AppLifecycle',
    signal: signal || 'unknown',
    time: new Date().toISOString()
  });
  
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

### 7. Request Context

Always include request context in operations:

```javascript
// ✅ Good - Request context tracking
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || ulid();
  req.startTime = Date.now();
  next();
});

// Include context in all operations
logger.infoWithContext('Processing request', {
  component: 'API',
  method: req.method,
  path: req.path,
  requestId: req.requestId,
  userId: req.user?.id
});
```

## Troubleshooting

### Common Issues

#### 1. Authentication Middleware Errors

**Problem:** `roditClient.authenticate_apicall is not a function`

**Solution:** Use the correct method name and binding:
```javascript
// ❌ Wrong (old pattern)
roditClient.authenticate_apicall

// ❌ Verbose (works but unnecessary)
roditClient.authenticateApiCall.bind(roditClient)

// ✅ Correct (clean and simple)
roditClient.authenticate
```

#### 2. Configuration Not Found

**Problem:** `Failed to initialize RODiT configuration`

**Solutions:**
- Ensure vault credentials are properly set
- Check `RODIT_NEAR_CREDENTIALS_SOURCE` environment variable
- Verify vault connectivity and permissions
- For development, ensure credentials file exists

#### 3. Missing App.locals Client

**Problem:** `RoditClient not available in app.locals`

**Solution:** Ensure client is stored during initialization:
```javascript
async function startServer() {
  const roditClient = await RoditClient.create('portal');
  app.locals.roditClient = roditClient; // Don't forget this line
}
```

#### 4. Permission Denied Errors

**Problem:** Routes return 403 Forbidden

**Solutions:**
- Check `permissioned_routes` in your RODiT token metadata
- Verify the route path matches the permission pattern
- Ensure HTTP method is allowed
- Use `roditClient.isOperationPermitted()` to debug

#### 5. Logging Issues

**Problem:** Logs not appearing in Loki

**Solutions:**
- Verify `LOKI_URL` and credentials
- Check network connectivity to Loki instance
- Ensure proper TLS configuration
- Test with console logging first

### Debug Mode

Enable debug logging for troubleshooting:

```bash
export LOG_LEVEL=debug
```

This will provide detailed information about:
- Authentication flows
- Configuration loading
- Permission checks
- Network requests
- Internal SDK operations

### Health Checks

Implement health check endpoints to verify SDK status:

```javascript
app.get('/health', async (req, res) => {
  try {
    const client = req.app.locals.roditClient;
    if (!client) {
      return res.status(503).json({ status: 'error', message: 'RoditClient not available' });
    }
    
    const configObject = await client.getConfigOwnRodit();
    const hasValidConfig = !!(configObject && configObject.own_rodit);
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      roditClient: !!client,
      configuration: hasValidConfig,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
```

### Support

For additional support:
1. Check the debug logs with `LOG_LEVEL=debug`
2. Verify your RODiT token configuration
3. Test with the health check endpoint
4. Review the authentication flow in the logs
5. Ensure all required environment variables are set

---

## License

Copyright (c) 2025 Discernible Inc. All rights reserved.
