# RODiT ID Authentication System

## Using RODiT Configuration in Modules

When working with multiple modules that require RODiT configuration, you can easily import and use the configuration in any module without reinitializing it. Here's how:

### 1. Import the Required Utilities

In any module where you need to access the RODiT configuration or utilities, import them from the SDK:

```javascript
const { roditManager, stateManager, logger } = require('@rodit/rodit-auth-be');
```

### 2. Accessing Configuration

Once the SDK is initialized in your main application (typically in `app.js`), you can access the configuration from any module:

```javascript
// In any module
const { stateManager } = require('@rodit/rodit-auth-be');

async function someFunction() {
  try {
    // Get the current RODiT configuration
    const config = await stateManager.getConfigOwnRodit();
    
    // Access configuration properties
    const { own_rodit } = config;
    const roditId = own_rodit.rodit_id;
    const metadata = own_rodit.metadata || {};
    
    // Use the configuration
    logger.info(`Using RODiT ID: ${roditId}`, { module: 'your-module-name' });
    
    return { roditId, metadata };
  } catch (error) {
    logger.error('Failed to access RODiT configuration', { 
      error: error.message,
      module: 'your-module-name' 
    });
    throw error;
  }
}
```

### 3. Using Logger in Modules

The logger is automatically configured in the main application and can be used in any module:

```javascript
const { logger } = require('@rodit/rodit-auth-be');

function processData(data) {
  try {
    logger.debug('Processing data', { 
      dataLength: data.length,
      module: 'data-processor'
    });
    
    // Your processing logic here
    
    logger.info('Data processed successfully', {
      module: 'data-processor',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to process data', {
      error: error.message,
      stack: error.stack,
      module: 'data-processor'
    });
    throw error;
  }
}
```

### 4. Best Practices

1. **Single Initialization**: The RODiT SDK should only be initialized once in your main application file (e.g., `app.js`).

2. **Module Context**: Always include a `module` field in your log messages to identify which module generated the log.

3. **Error Handling**: Always wrap RODiT configuration access in try-catch blocks and include meaningful error messages.

4. **Configuration Access**: Use `stateManager.getConfigOwnRodit()` to access the current configuration. This is safe to call multiple times as it returns the cached configuration after the first call.

5. **Environment Variables**: Remember that environment variables take precedence over configuration files. Use the canonical format (dots replaced with underscores and uppercased) when setting environment variables.

### 5. Example Module

Here's a complete example of a module that uses the RODiT configuration:

```javascript
// services/rodit-service.js
const { stateManager, logger } = require('@rodit/rodit-auth-be');

class RoditService {
  constructor() {
    this.moduleName = 'rodit-service';
  }

  async getRoditInfo() {
    try {
      const config = await stateManager.getConfigOwnRodit();
      const { own_rodit } = config;
      
      logger.info('Retrieved RODiT configuration', {
        module: this.moduleName,
        roditId: own_rodit.rodit_id,
        environment: process.env.NODE_ENV || 'development'
      });
      
      return {
        roditId: own_rodit.rodit_id,
        metadata: own_rodit.metadata || {},
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to get RODiT info', {
        module: this.moduleName,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`RODiT service error: ${error.message}`);
    }
  }
}

module.exports = new RoditService();
```

By following these patterns, you can ensure consistent and reliable access to the RODiT configuration throughout your application while maintaining clean separation of concerns and proper error handling.

This npm package provides the RODiT-based authentication system for Express.js applications. It exports the exact same authentication functionality without adding unnecessary abstraction layers.

## Endpoint Determination

The authentication middleware determines the login and logout endpoints based on the following rules:

### Login Endpoint
- The login endpoint is constructed by appending `/api/login` to the base API endpoint from the RODiT token metadata.
- The base API endpoint is automatically determined from the `subjectuniqueidentifier_url` field in the RODiT token metadata.

### Logout Endpoint
- The logout endpoint is constructed by appending `/api/logout` to the base API endpoint.
- It uses the same base URL as the login endpoint.

### Example Configuration

```javascript
const auth = require('@rodit/rodit-auth-be');

// Configure with logger
auth.configure({
  logger: require('.configsdk/logger')
});

// Login endpoint will be: https://your-api.example.com/api/login
// Logout endpoint will be: https://your-api.example.com/api/logout
```

## Features

- Exclusive RODiT-based authentication with blockchain verification
- JWT-based token management through HTTP headers (no cookies)
- Permission validation for protected routes based on RODiT token permissions
- Session management with secure token handling
- Comprehensive logging and error handling with Loki support
- Automatic RODIT token information display during startup
- Programmatic access to RODIT token metadata for dynamic configuration

## Logging Setup

The SDK uses Winston for logging and supports Loki transport for centralized logging. Here's how to set it up:

### Basic Console Logging

By default, the SDK will log to the console. You can set the log level using the `LOG_LEVEL` environment variable:

```bash
export LOG_LEVEL=debug  # or info, warn, error
```

### Loki Integration

To enable Loki logging, set these environment variables:

```bash
# Required
LOKI_URL=https://your-loki-instance:3100

# Optional
LOKI_BASIC_AUTH=username:password  # If Loki requires authentication
LOKI_TLS_SKIP_VERIFY=true          # Set to "true" to skip TLS verification (not recommended for production)
LOG_LEVEL=info                     # Default: info
```

### Example Integration

```javascript
const express = require('express');
const { logger } = require('@rodit/rodit-auth-be');

// Basic usage - logs to console
logger.info('Application starting...');

// With context
logger.info('User logged in', { 
  userId: '123',
  ip: '192.168.1.1' 
});

// Error logging
try {
  // Your code here
} catch (error) {
  logger.error('Operation failed', { 
    error: error.message,
    stack: error.stack 
  });
}
```

### Log Levels

- `error`: Error conditions that require immediate attention
- `warn`: Warning conditions that might need attention
- `info`: General operational information
- `debug`: Detailed debug information
- `silly`: Extremely detailed debugging

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Minimum log level to output | `info` |
| `LOKI_URL` | Loki server URL | - |
| `LOKI_BASIC_AUTH` | Basic auth credentials for Loki | - |
| `LOKI_TLS_SKIP_VERIFY` | Skip TLS verification ("true" to enable) | - |
| `API_DEFAULT_OPTIONS_LOG_DIR` | Directory for log files | `/app/logs` |

### Log Directory Permissions

When running in a containerized environment, ensure proper permissions are set for log directories:

1. **Directory Structure**
   ```
   /app/logs/
   ├── application/  # Application logs
   └── nginx/        # Nginx access/error logs
   ```

2. **Required Permissions**
   ```bash
   # Create log directories with correct ownership
   mkdir -p /app/logs/{application,nginx}
   
   # Set appropriate permissions (adjust user/group as needed)
   chown -R node:node /app/logs
   chmod -R 755 /app/logs
   ```

3. **Dockerfile Example**
   ```dockerfile
   # Create log directory and set permissions
   RUN mkdir -p /app/logs/{application,nginx} \
       && chown -R node:node /app/logs \
       && chmod -R 755 /app/logs
   
   # Ensure the application user has write access
   USER node
   ```

4. **Troubleshooting**
   - If logs aren't being written, check:
     - Directory exists and is writable by the application user
     - No permission denied errors in container logs
     - Sufficient disk space is available

## Installation

```bash
npm install @rodit/rodit-auth-be

```
## Usage

### Basic Setup with RoditClient

```javascript
const express = require('express');
const { RoditClient } = require('@rodit/rodit-auth-be');

const app = express();

// Create temporary client instance to access utilities
const tempClient = new RoditClient();
const logger = tempClient.getLogger();
const loggingmw = tempClient.getLoggingMiddleware();
const ratelimitmw = tempClient.getRateLimitMiddleware();

// Will be set to fully initialized client later
let roditClient;

// Get authentication middleware from roditClient
const authenticate_apicall = (req, res, next) => roditClient.authenticateApiCall(req, res, next);
const validatePermissions = (req, res, next) => roditClient.validatePermissions(req, res, next);

// Configure Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(loggingmw);

// Mount the authentication routes
app.post('/api/login', (req, res) => {
  const client = req.app.locals.roditClient;
  if (!client) {
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
  client.login(req, res);
});

app.post('/api/logout', authenticate_apicall, (req, res) => {
  roditClient.logout(req, res);
});

// Protect routes with authentication
app.use('/api/protected', authenticate_apicall, protectedRoutes);

// Add permission validation to routes that require specific permissions
app.use('/api/admin', authenticate_apicall, validatePermissions, adminRoutes);

// Example of a protected route with permission validation
app.get('/api/entities/:entityId', authenticate_apicall, validatePermissions, (req, res) => {
  // This route is protected and requires specific permissions from the RODiT token
  // The validatePermissions middleware will check if the user has permission to access this entity
  const entityId = req.params.entityId;
  // Process the request...
});

// Start the server with proper initialization
async function startServer() {
  try {
    // Create and initialize the client in one step
    roditClient = await RoditClient.create();
    
    // Make client available to routes via app.locals
    app.locals.roditClient = roditClient;
    
    // Start the HTTP server
    const port = 3000;
    app.listen(port, () => {
      console.log(`Server started on port ${port}`);
    });
  } catch (error) {
    logger.error('Server initialization failed', { error: error.message });
    process.exit(1);
  }
}

startServer();
```

### Custom Configuration

```javascript
const { RoditClient } = require('@rodit/rodit-auth-be');

// Create client with custom options
const client = new RoditClient({
  credentialsFilePath: '/path/to/credentials',
  apiVersion: '1.0.0',
  versionHeaderType: 'both'
});

// Initialize with custom configuration
await client.init({
  credentialsPath: '/custom/path/to/credentials'
});

// Or use the static create method for one-step initialization
const client = await RoditClient.create({
  credentialsFilePath: '/path/to/credentials'
});
```

## API Reference

### RoditClient Class

#### Constructor
```javascript
const client = new RoditClient(options)
```

Parameters:
- `options` (Object, optional): Configuration options
  - `credentialsFilePath` (string, optional): Path to credentials file
  - `apiVersion` (string, optional): API version (default: '0.0.0')
  - `versionHeaderType` (string, optional): Version header type (default: 'both')

#### Static Methods

##### RoditClient.create(options)
Create and initialize a new RODiT client in one step.

```javascript
const client = await RoditClient.create(options);
```

Returns: Promise<RoditClient> — Fully initialized client

#### Instance Methods

##### authenticateApiCall(req, res, next)
Middleware to authenticate API calls.

```javascript
const authenticate = (req, res, next) => client.authenticateApiCall(req, res, next);
app.use('/api/protected', authenticate, handler);
```

##### validatePermissions(req, res, next)
Middleware to validate permissions for protected routes.

```javascript
const validatePerms = (req, res, next) => client.validatePermissions(req, res, next);
app.use('/api/admin', authenticate, validatePerms, handler);
```

##### login(req, res)
Handle client login.

```javascript
app.post('/api/login', (req, res) => {
  const client = req.app.locals.roditClient;
  client.login(req, res);
});
```

##### logout(req, res)
Handle client logout.

```javascript
app.post('/api/logout', authenticate, (req, res) => {
  client.logout(req, res);
});
```

### Utility Methods

##### getLogger()
Get the logger instance.

```javascript
const logger = client.getLogger();
logger.info('Application started');
```

##### getLoggingMiddleware()
Get the logging middleware.

```javascript
const loggingmw = client.getLoggingMiddleware();
app.use(loggingmw);
```

##### getRateLimitMiddleware()
Get the rate limiting middleware.

```javascript
const ratelimitmw = client.getRateLimitMiddleware();
const rateLimiter = ratelimitmw(100, 15); // 100 requests per 15 minutes
app.use(rateLimiter);
```

### Services

- `getSessionManager()` - Session management service
- `getBlockchainService()` - Blockchain interaction service
- `getStateManager()` - State management service
- `getWebhookHandler()` - Webhook handling service
- `getVersionManager()` - API version management
- `getPerformanceService()` - Performance monitoring

### RODIT Token Information Access

The SDK provides access to RODIT token information that can be used for dynamic API configuration:

```javascript
const { RoditClient } = require('@rodit/rodit-auth-be');

// Initialize client and get RODIT configuration
const client = await RoditClient.create();
const configObject = await client.getConfigOwnRodit();
const roditToken = configObject.own_rodit;

// Access token metadata for configuration
const metadata = roditToken.metadata;
const tokenId = roditToken.token_id;

// Example: Configure API behavior based on token metadata
const allowedRoutes = JSON.parse(metadata.permissioned_routes || '[]');
const jwtDuration = parseInt(metadata.jwt_duration || '3600');
const allowedCIDR = metadata.allowed_cidr;
// API endpoint is automatically used from metadata.subjectuniqueidentifier_url

// Example: Dynamic rate limiting from token
if (metadata.max_requests && metadata.maxrq_window) {
  const maxRequests = parseInt(metadata.max_requests);
  const windowSeconds = parseInt(metadata.maxrq_window);
  
  // Apply rate limiting using SDK middleware
  const ratelimitmw = client.getRateLimitMiddleware();
  const rateLimiter = ratelimitmw(maxRequests, windowSeconds);
  app.use(rateLimiter);
}

// Access RODIT configuration from routes
app.get('/api/rodit/info', authenticate, async (req, res) => {
  try {
    const client = req.app.locals.roditClient;
    const configObject = await client.getConfigOwnRodit();
    return res.json({
      requestId: req.requestId,
      configuration: configObject || null,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to retrieve RODiT configuration",
      requestId: req.requestId,
    });
  }
});
```

#### Available RODIT Metadata Fields

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
- **`userselected_dn`**: Distinguished name for the service
- **`webhook_cidr`**: Allowed IP ranges for webhooks
- **`webhook_url`**: Webhook endpoint URL

#### Startup Information Display

When using this SDK in your application, it automatically displays comprehensive RODIT token information during startup, similar to the `roditwallet.sh` command:

```
=== RODiT Authentication System ===
Version 1.0.26 running on testnet at Smart Contract 20251001-rodit-org.testnet
Get help with: npm run help

RODiT Contents
▹▸▹▹▹ Authentication token information loaded...

{
  "token_id": "01K43ASJTMA4V81C46WCRADGVD",
  "metadata": {
    // ... complete token metadata
  }
}
```

This information helps verify proper token configuration and provides visibility into the authentication system's capabilities.

### Configuration

The SDK uses a configuration system that supports multiple sources:

#### Environment Variables

Key environment variables for RODiT SDK:

```bash
# Required for vault-based credentials
RODIT_NEAR_CREDENTIALS_SOURCE=vault
VAULT_ENDPOINT=https://your-vault.example.com
VAULT_ROLE_ID=your-role-id
VAULT_SECRET_ID=your-secret-id
VAULT_RODIT_KEYVALUE_PATH=secret/rodit
SERVICE_NAME=your-service-name
NEAR_CONTRACT_ID=your-contract.testnet

# Logging configuration
LOG_LEVEL=info
LOKI_URL=https://your-loki.example.com:3100
LOKI_BASIC_AUTH=username:password

# API configuration
API_DEFAULT_OPTIONS_LOG_DIR=/app/logs
API_DEFAULT_OPTIONS_DB_PATH=/app/data/database.db
```

#### Configuration Files

Place configuration in `config/default.json`, `config/production.json`, etc.:

```json
{
  "NEAR_CONTRACT_ID": "your-contract.testnet",
  "SERVICE_NAME": "your-service",
  "API_DEFAULT_OPTIONS": {
    "LOG_DIR": "/app/logs",
    "DB_PATH": "/app/data/database.db"
  },
  "METHOD_PERMISSION_MAP": {
    "list_agents": ["entityAndProperties", "entityOnly"]
  }
}
```

#### RoditClient Configuration

```javascript
// Configure client instance
const client = new RoditClient({
  credentialsFilePath: '/path/to/credentials',
  apiVersion: '1.0.0',
  versionHeaderType: 'both'
});

// Configure using the configure method
client.configure({
  apiVersion: '2.0.0',
  versionHeaderType: 'header-only'
});
```

## Authentication Flow

### RODiT ID Authentication

RODiT-based authentication uses the RODiT system to authenticate users. The login request requires:

```json
{
  "roditid": "your-rodit-id",
  "timestamp": 1640995200,
  "roditid_base64url_signature": "base64url-encoded-signature"
}
```

Parameters:
- `roditid` - RODiT ID
- `timestamp` - Timestamp (optional, defaults to current time)
- `roditid_base64url_signature` - Base64URL encoded signature

### Complete Authentication Example

```javascript
const express = require('express');
const { RoditClient } = require('@rodit/rodit-auth-be');
const { ulid } = require('ulid');

const app = express();

// Create temporary client instance to access utilities
const tempClient = new RoditClient();
const logger = tempClient.getLogger();
const loggingmw = tempClient.getLoggingMiddleware();

// Will be set to fully initialized client later
let roditClient;

// Set up request ID and tracing middleware
app.use((req, res, next) => {
  req.requestId = ulid();
  req.startTime = process.hrtime();
  next();
});

// Configure Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(loggingmw);

// Get authentication middleware from roditClient
const authenticate_apicall = (req, res, next) => roditClient.authenticateApiCall(req, res, next);
const validatePermissions = (req, res, next) => roditClient.validatePermissions(req, res, next);

// Login route
app.post('/api/login', (req, res) => {
  req.logAction = "login-attempt";
  logger.info("Login request received", {
    component: "API",
    method: "login",
    requestId: req.requestId || ulid(),
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Use the RoditClient stored in app.locals
  const client = req.app.locals.roditClient;
  if (!client) {
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
  client.login(req, res);
});

// Logout route
app.post('/api/logout', authenticate_apicall, (req, res) => {
  req.logAction = "logout-attempt";
  roditClient.logout(req, res);
});

// Protected route example
app.get('/api/echo', authenticate_apicall, (req, res) => {
  res.json({
    message: 'Hello from protected endpoint',
    user: req.user,
    requestId: req.requestId
  });
});

// Protected route with permissions
app.get('/api/cruda/list', authenticate_apicall, validatePermissions, async (req, res) => {
  // This route requires both authentication and specific permissions
  try {
    // Your protected logic here
    res.json({
      data: [],
      requestId: req.requestId
    });
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      requestId: req.requestId
    });
  }
});

// Start the server with proper initialization
async function startServer() {
  try {
    // Create and initialize the client in one step
    roditClient = await RoditClient.create();
    
    // Make client available to routes via app.locals
    app.locals.roditClient = roditClient;
    
    // Start the HTTP server
    const port = process.env.PORT || 8080;
    app.listen(port, () => {
      logger.info(`RODiT Authentication API Server running on port ${port}`);
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

### NEP-413 Authentication

The system also supports NEP-413 standard authentication:

```json
{
  "message": "message-to-sign",
  "nonce": "unique-nonce-value",
  "recipient": "recipient-identifier",
  "callbackUrl": "https://your-app.com/callback",
  "signature": "signature-data"
}
```

Parameters:
- `message` - Message to sign
- `nonce` - Nonce value
- `recipient` - Recipient identifier
- `callbackUrl` - Callback URL
- `signature` - Signature

## Permission System

The permission system allows you to control access to protected routes based on the user's permissions. The permissions are stored in the JWT token and are checked by the `validatePermissions` middleware.

### RODiT-based Permissions

RODiT-based permissions use the `permissioned_routes` property in the JWT token. This property contains an array of objects with the following structure:

```json
[
  {
    "route": "^/api/admin/.*$",
    "methods": ["get", "post", "put", "delete"]
  },
  {
    "route": "^/api/users/.*$",
    "methods": ["get"]
  }
]
```

The permission validator checks if the requested route matches any of the patterns in the `permissioned_routes` array and if the HTTP method is allowed for that route.

## Error Handling

All methods in this module handle errors gracefully and return appropriate HTTP status codes and error messages. Errors are also logged using the provided logger.

## Logging

This module uses the provided logger to log important events. If no logger is provided, it uses the default logger from the SDK.

## Security Considerations

- Tokens are transmitted via HTTP headers only, not cookies
- Tokens are validated on every request
- Permissions are checked on protected routes
- Session invalidation is supported via logout
- Token expiry is configurable

## Advanced Usage Patterns

### Using SDK in Route Modules

When creating separate route modules, you can access the SDK functionality like this:

```javascript
// routes/protected.js
const express = require('express');
const { RoditClient } = require('@rodit/rodit-auth-be');
const router = express.Router();

// Create SDK client instance to access utilities
const sdkClient = new RoditClient();
const logger = sdkClient.getLogger();
const { createLogContext, logErrorWithMetrics } = logger;

// Define middleware functions that will use the initialized client
const authenticate_apicall = (req, res, next) => {
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

// Protected route
router.get('/data', authenticate_apicall, validatePermissions, async (req, res) => {
  const requestId = req.requestId;
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'ProtectedRoutes',
    method: 'getData',
    userId: req.user?.id,
    ip: req.ip
  });
  
  try {
    logger.infoWithContext('Processing protected request', baseContext);
    
    // Your protected logic here
    const data = { message: 'Protected data', user: req.user };
    
    const duration = Date.now() - startTime;
    logger.infoWithContext('Request processed successfully', {
      ...baseContext,
      duration
    });
    
    res.json({ data, requestId });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      'Failed to process protected request',
      { ...baseContext, duration },
      error,
      'protected_route_error',
      { operation: 'getData', result: 'error', duration }
    );
    
    res.status(500).json({
      error: 'Internal server error',
      requestId
    });
  }
});

module.exports = router;
```

### Session Management

```javascript
// Access session manager
const client = await RoditClient.create();
const sessionManager = client.getSessionManager();

// Create a session
const session = sessionManager.createSession('user123', {
  loginTime: Date.now(),
  ipAddress: '192.168.1.1'
});

// Validate a session
const isValid = sessionManager.validateSession(sessionId, token);

// Terminate a session
sessionManager.terminateSession(sessionId);

// Clean up expired sessions
const cleanupResult = sessionManager.removeExpiredSessions();
```

### Webhook Integration

```javascript
// Access webhook handler
const client = await RoditClient.create();
const webhookHandler = client.getWebhookHandler();

// Send a webhook
const webhookData = {
  event: 'user_login',
  userId: 'user123',
  timestamp: Date.now()
};

const result = await client.sendWebhook(webhookData);
```

## Backward Compatibility

The SDK maintains backward compatibility with these method aliases:

- `authenticate_apicall()` - Authentication middleware
- `login_client()` - Client login method
- `logout_client()` - Client logout method
- `login_client_withnep413()` - NEP-413 login method
- `send_webhook()` - Webhook sending (alias for `sendWebhook()`)

## Error Handling Best Practices

### Structured Error Logging

```javascript
const { RoditClient } = require('@rodit/rodit-auth-be');

const client = new RoditClient();
const logger = client.getLogger();
const { createLogContext, logErrorWithMetrics } = logger;

// In your route handlers
app.post('/api/data', authenticate_apicall, async (req, res) => {
  const requestId = req.requestId;
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: 'DataAPI',
    method: 'createData',
    userId: req.user?.id,
    ip: req.ip
  });
  
  try {
    // Your business logic
    const result = await processData(req.body);
    
    const duration = Date.now() - startTime;
    logger.infoWithContext('Data processed successfully', {
      ...baseContext,
      duration,
      resultId: result.id
    });
    
    res.json({ result, requestId });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Use structured error logging with metrics
    logErrorWithMetrics(
      'Failed to process data',
      { ...baseContext, duration },
      error,
      'data_processing_error',
      {
        operation: 'createData',
        result: 'error',
        duration
      }
    );
    
    res.status(500).json({
      error: 'Internal server error',
      requestId
    });
  }
});
```

### Global Error Handler

```javascript
// Enhanced error handling middleware
app.use((err, req, res, next) => {
  const requestId = req.requestId || ulid();
  const isProduction = process.env.NODE_ENV === 'production';
  
  logger.errorWithContext(
    'Server error occurred',
    {
      component: 'API',
      message: err.message,
      method: req.method,
      url: req.originalUrl,
      userIP: req.ip,
      userId: req.user ? req.user.id : 'anonymous',
      requestId,
      timestamp: new Date().toISOString(),
      statusCode: err.statusCode || 500,
      stack: isProduction ? undefined : err.stack,
    },
    err
  );
  
  res.status(500).json({
    error: 'Internal Server Error',
    requestId,
    timestamp: new Date().toISOString(),
  });
});
```

## License

Copyright (c) 2025 Discernible Inc. All rights reserved.

## Full SDK API Reference (Consolidated)

This section consolidates the full SDK reference originally maintained in `sdk/API-REFERENCE.md`. Going forward, this README is the single source of truth.

> Last Updated: Jun 29, 2025 — Streamlined logging section added and project structure updated.

### Table of Contents

- [RoditClient](#roditclient)
- [Authentication](#authentication)
- [Session Management](#session-management)
- [Token Management](#token-management)
- [Configuration](#configuration)
- [Utility Functions](#utility-functions)
- [Middleware](#middleware)
- [Logging](#logging)
- [Security Features](#security-features)
- [Project Structure](#project-structure)
- [Error Handling](#error-handling)

### RoditClient

The main client class for interacting with RODiT services.

#### Constructor

```javascript
const client = new RoditClient(options);
```

Parameters:
- `options` (Object, optional): Configuration options
  - `credentialsFilePath` (string, optional): Path to credentials file

#### Methods

##### init(options)

Initialize the client with credentials.

```javascript
await client.init(options);
```

Parameters:
- `options` (Object, optional): Initialization options
  - `credentialsPath` (string, optional): Path to credentials file
  - `token` (string, optional): RODiT token

Returns: Promise<void>

##### login(options)

Authenticate and obtain a session token.

```javascript
const loginResult = await client.login(options);
```

Parameters:
- `options` (Object, optional): Login options
  - `roditId` (string, optional): RODiT ID to use for login

Returns: Promise<Object> — Login result with token and expiration information

##### logout()

Invalidate the current session token.

```javascript
await client.logout();
```

Returns: Promise<boolean> — True if logout was successful

##### request(method, path, data, options)

Make an authenticated API request.

```javascript
const response = await client.request(method, path, data, options);
```

Parameters:
- `method` (string): HTTP method (POST, PUT, DELETE, etc.)
- `path` (string): API path
- `data` (any, optional): Request body data
- `options` (Object, optional): Request options
  - `headers` (Object, optional): Additional headers
  - `timeout` (number, optional): Request timeout in milliseconds

Returns: Promise<any> — API response

##### isTokenValid()

Check if the token is valid.

```javascript
const isValid = client.isTokenValid();
```

Returns: boolean — True if token is valid

##### isSubscriptionActive()

Check if the subscription is active.

```javascript
const isActive = client.isSubscriptionActive();
```

Returns: boolean — True if subscription is active

##### getConfigOwnRodit()

Get the complete RODiT configuration including token metadata.

```javascript
const config = await client.getConfigOwnRodit();
const metadata = config.own_rodit.metadata;
```

Returns: Promise<Object> — Complete RODiT configuration object

##### isOperationPermitted(method, path)

Check if an operation is permitted.

```javascript
const isPermitted = client.isOperationPermitted(method, path);
```

Parameters:
- `method` (string): HTTP method
- `path` (string): API path

Returns: boolean — True if operation is permitted

##### refreshToken()

Refresh the session token.

```javascript
await client.refreshToken();
```

Returns: Promise<Object> — Refresh result

##### getAvailableEndpoints()

Get available API endpoints from OpenAPI spec and include the RODiT configured endpoint (subjectuniqueidentifier_url).

```javascript
const endpoints = await client.getAvailableEndpoints();
```

Returns: Promise<Object> — Available endpoints including the RODiT configured endpoint

---

### Authentication

Authentication-related classes and functions.

#### authentication.js

Core authentication functionality.

##### verifyToken(token, options)

Verify a JWT token.

```javascript
const payload = authentication.verifyToken(token, options);
```

Parameters:
- `token` (string): JWT token
- `options` (Object, optional): Verification options

Returns: Object — Token payload if valid

#### tokenservice.js

Token management service.

##### createToken(subject, claims)

Create a new token.

```javascript
const token = tokenService.createToken(subject, claims);
```

Parameters:
- `subject` (string): Token subject
- `claims` (Object): Token claims

Returns: string — JWT token

##### validateToken(token)

Validate a token.

```javascript
const isValid = tokenService.validateToken(token);
```

Parameters:
- `token` (string): JWT token

Returns: boolean — True if token is valid

---

### Session Management

Session management functionality.

#### sessionmanager.js

Session management service.

##### createSession(userId, metadata)

Create a new session.

```javascript
const session = sessionManager.createSession(userId, metadata);
```

Parameters:
- `userId` (string): User ID
- `metadata` (Object, optional): Session metadata

Returns: Object — Session information

##### validateSession(sessionId, token)

Validate a session.

```javascript
const isValid = sessionManager.validateSession(sessionId, token);
```

Parameters:
- `sessionId` (string): Session ID
- `token` (string): Session token

Returns: boolean — True if session is valid

##### terminateSession(sessionId)

Terminate a session.

```javascript
sessionManager.terminateSession(sessionId);
```

Parameters:
- `sessionId` (string): Session ID

Returns: boolean — True if session was terminated

##### removeExpiredSessions()

Remove expired sessions.

```javascript
const count = sessionManager.removeExpiredSessions();
```

Returns: number — Number of sessions removed

#### sessioncleanup.js

Session cleanup utilities.

##### startAutomaticCleanup(options)

Start automatic session cleanup.

```javascript
sessionCleanup.startCleanupJob(options);
```

Parameters:
- `options` (Object, optional): Cleanup options
  - `interval` (number, optional): Cleanup interval in milliseconds

Returns: void

##### stopAutomaticCleanup()

Stop automatic session cleanup.

```javascript
sessionCleanup.stopCleanupJob();
```

Returns: void

##### cleanupExpiredSessions()

Clean up expired sessions.

```javascript
const result = await sessionCleanup.runManualCleanup();
```

Returns: Promise<Object> — Cleanup results

#### Environment variables and configuration mapping

This project follows a canonical environment variable naming scheme for config keys:

- Replace dots with underscores and uppercase everything.
- Example: `API_DEFAULT_OPTIONS.LOG_DIR` → `API_DEFAULT_OPTIONS_LOG_DIR`.

Key mappings:

- `API_DEFAULT_OPTIONS.LOG_DIR` → `API_DEFAULT_OPTIONS_LOG_DIR`
- `API_DEFAULT_OPTIONS.DB_PATH` → `API_DEFAULT_OPTIONS_DB_PATH`

Not mapped:

- `RODIT_NEAR_CREDENTIALS_SOURCE`
- `VAULT_ENDPOINT`
- `VAULT_RODIT_KEYVALUE_PATH`
- `VAULT_ROLE_ID` (secret)
- `VAULT_SECRET_ID` (secret)
- `VAULT_TOKEN_TTL`
- `SERVICE_NAME`
- `NEAR_RPC_URL`
- `NEAR_CONTRACT_ID` (SDK testing default: `rodit-org.near`; override in production)

#### Critical Deployment Requirements

When deploying applications using this SDK, ensure proper environment variable configuration:

**Required for vault-based credentials:**
- `RODIT_NEAR_CREDENTIALS_SOURCE=vault` must be set to use vault instead of file-based credentials
- All vault-related environment variables must be provided as secrets
- Missing environment variables will cause authentication failures

**Container deployment example:**
```bash
podman run -d \
  -e RODIT_NEAR_CREDENTIALS_SOURCE=vault \
  -e VAULT_ENDPOINT=$VAULT_ENDPOINT \
  -e VAULT_ROLE_ID=$VAULT_ROLE_ID \
  -e VAULT_SECRET_ID=$VAULT_SECRET_ID \
  -e VAULT_RODIT_KEYVALUE_PATH=$VAULT_RODIT_KEYVALUE_PATH \
  -e SERVICE_NAME=your-service-name \
  -e NEAR_CONTRACT_ID=$NEAR_CONTRACT_ID \
  your-api-image
```

**Common deployment issues:**
- Missing `RODIT_NEAR_CREDENTIALS_SOURCE` environment variable causes fallback to file-based credentials
- Vault credentials not passed to container runtime cause authentication errors
- Missing `API_DEFAULT_OPTIONS.DB_PATH` configuration causes startup failures

Testing default for NEAR_CONTRACT_ID

For developer convenience, the host app may define a testing default for `NEAR_CONTRACT_ID` in its config files. At present, the testing default is:

```json
{
  "NEAR_CONTRACT_ID": "rodit-org.near"
}
```

This is intended for local/testing use only. In production, you must explicitly set `NEAR_CONTRACT_ID` via your deployment environment (see options below). Do not rely on the SDK default in production.

Logging-related environment variables used by `src/app.js` when injecting `winston-loki`:

- `LOKI_URL` – Loki push URL
- `LOKI_BASIC_AUTH` – optional basic auth (secret)
- `LOKI_TLS_SKIP_VERIFY` – `true` to skip TLS verification (testing only)
- `LOG_LEVEL` – `debug`, `info`, `warn`, `error` (default: `info`)

Fallback behavior

The SDK wrapper at `sdk/services/configsdk.js` provides safe fallbacks for several keys so the SDK can run in development without external configuration:

- Has fallbacks: `RODIT_NEAR_CREDENTIALS_SOURCE`, `SERVICE_NAME`, `NEAR_RPC_URL`, `NEAR_CONTRACT_ID` (testing default `rodit-org.near`), `API_DEFAULT_OPTIONS.*`, `SECURITY_OPTIONS`, and others noted in `FALLBACK_DEFAULTS`.
- Recommendation: Override `NEAR_CONTRACT_ID` in production via environment or configuration.
- Exclusions by design: Vault credentials (`VAULT_*`) and `METHOD_PERMISSION_MAP` are not supplied by SDK fallbacks.

`METHOD_PERMISSION_MAP` is read by `sdk/lib/middleware/validatepermissions.js` via `config.get('METHOD_PERMISSION_MAP')` and is used to decide which permission scopes (e.g., `entityAndProperties`, `propertiesOnly`, `entityOnly`) are allowed for each endpoint operation in a decoded JWT token. Provide this mapping via your configuration files or environment (see below).

Supplying configuration

You have three ergonomic options for providing configuration to the app/SDK:

1. Config files (default behavior)
   - Place values in `config/default.json`, `config/production.json`, etc.
   - Best for local development or when committing non-secret defaults.

2. Environment variables (recommended for CI/CD)
   - Set environment variables using the exact names listed above in “Environment variables and configuration mapping”. No mapping file is used.
   - Examples:

     ```bash
     export RODIT_NEAR_CREDENTIALS_SOURCE=vault
     export SERVICE_NAME=signportal-api
     export API_DEFAULT_OPTIONS_LOG_DIR=/app/logs
     export NEAR_RPC_URL=https://rpc.testnet.fastnear.com/
     export NEAR_CONTRACT_ID=your-contract.testnet
     ```

3. `NODE_CONFIG` environment variable (for complex or nested values)
   - Set `NODE_CONFIG` to a JSON string that contains your configuration (including nested objects like `METHOD_PERMISSION_MAP`).
   - Example:

     ```bash
     export NODE_CONFIG='{
       "NEAR_CONTRACT_ID": "your-contract.testnet",
       "METHOD_PERMISSION_MAP": { "list_agents": ["entityAndProperties", "entityOnly"] }
     }'
     ```

Notes:

- Secrets such as `VAULT_ROLE_ID`, `VAULT_SECRET_ID`, and `LOKI_BASIC_AUTH` should be stored in your CI/CD secret store and injected at runtime.
- Although `NEAR_CONTRACT_ID` has a testing default in `sdk/services/configsdk.js`, you should always provide it explicitly via one of the options above in production deployments.

---

### Token Management

Token management functionality.

#### roditmanager.js

RODiT token management.

##### getInstance()

Get the RODiT manager singleton instance.

```javascript
const roditManager = roditManager.getInstance();
```

Returns: Object — RODiT manager instance

##### getRoditId()

Get the current RODiT ID.

```javascript
const roditId = roditManager.getRoditId();
```

Returns: string — RODiT ID

##### getConfigOwnRodit()

Get the complete RODiT configuration including token metadata.

```javascript
const config = await stateManager.getConfigOwnRodit();
const metadata = config.own_rodit.metadata;
```

Returns: Promise<Object> — Complete RODiT configuration object

---

### Configuration

Configuration management functionality.

#### Configuration System (Consolidated)

The SDK provides a configuration wrapper that behaves like the `config` package while offering safe defaults and a security-first fallback strategy. This allows applications to run with minimal setup in development, while ensuring production deployments explicitly provide sensitive settings.

##### Architecture

- Wrapper module: `sdk/services/configsdk.js`
- Responsibilities:
  - Load the host application's `config` package if present
  - Provide fallback defaults for many non-sensitive keys
  - Exclude sensitive keys from defaults so they must be provided by the host
  - Preserve the standard `config` API (`get`, `has`), including nested keys

##### Source Priority (highest to lowest)

1. Host App Config (`config` package, env, NODE_CONFIG)
2. SDK Fallback Defaults (`sdk/configsdk/default.json` baked-in)
3. Error (for missing required keys without fallbacks)

##### Fallback Configuration Keys (examples)

- `SECURITY_OPTIONS`
  - `LAPSED_LIFETIME_PROPORTION_4RENEWAL_ELIGIBILITY`: "0.99"
  - `THRESHOLD_VALIDATION_TYPE`: "0.10"
  - `DURATIONRAMP`: "0.7"
  - `SERVERORCLIENT`: "SERVER-INITIATED"
  - `SILENT_LOGIN_FAILURES`: false
- `API_DEFAULT_OPTIONS`
  - `ISO639`: "es"
  - `ISO3166`: "ES"
  - `ISO15924`: "215"
  - `TIMESTAMP_MAX_AGE`: 300
  - `TIMEOPTIONS`: `{ tzname: "Europe/Madrid", tzoffset: "+01:00", datetimeformat: "2023-04-15T14:30:00-05:00" }`
  - `LOG_DIR`: "./logs"
- `PERFORMANCE`
  - `LOAD_LEVELS`: `{ LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' }`
  - `LOAD_THRESHOLDS`: `{ MEDIUM: 500, HIGH: 1000, CRITICAL: 2000 }`
- Service-level
  - `SERVERPORT`: 3000
  - `NEAR_RPC_URL`: "https://rpc.testnet.near.org"
  - `NEAR_CONTRACT_ID`: "dev-1234567890123-1234567890123"
  - `SERVICE_NAME`: "signportal-sdk"

##### Excluded Keys (no fallbacks; must be provided by host)

- Vault: `VAULT_ENDPOINT`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`, `VAULT_RODIT_KEYVALUE_PATH`, and any `VAULT_*`
- Permissions: `METHOD_PERMISSION_MAP`

These are excluded for security and correctness to avoid accidental defaults for secrets or authorization policies.

##### Usage Examples

```javascript
const config = require('./services/configsdk');

// Get with fallback
const port = config.get('SERVERPORT'); // 3000 if not configured

// Check and get
if (config.has('CUSTOM_SETTING')) {
  const value = config.get('CUSTOM_SETTING');
}

// Nested values
const logDir = config.get('API_DEFAULT_OPTIONS.LOG_DIR');

// Performance monitoring configuration
const loadLevels = config.get('PERFORMANCE.LOAD_LEVELS');
const loadThresholds = config.get('PERFORMANCE.LOAD_THRESHOLDS');

// Override performance thresholds for high-traffic environments
const highTrafficThresholds = config.get('PERFORMANCE.LOAD_THRESHOLDS', {
  MEDIUM: 1000,  // Custom threshold for medium load
  HIGH: 2500,    // Custom threshold for high load  
  CRITICAL: 5000 // Custom threshold for critical load
});

// Provide a runtime default
const timeout = config.get('REQUEST_TIMEOUT', 30000);
```

To get a merged view of all configuration:

```javascript
const all = config.getAllMerged();
```

##### Host Application Integration

- Minimal production config should include sensitive and environment-specific values: Vault credentials and `METHOD_PERMISSION_MAP`.

Example:

```json
{
  "VAULT_ENDPOINT": "https://vault.example.com",
  "VAULT_ROLE_ID": "...",
  "VAULT_SECRET_ID": "...",
  "METHOD_PERMISSION_MAP": {
    "GET:/api/public": ["anonymous"],
    "POST:/api/secure": ["authenticated"]
  }
}
```

Override any fallback defaults as needed:

```json
{
  "SERVERPORT": 8080,
  "SERVICE_NAME": "my-custom-service",
  "SECURITY_OPTIONS": { "SILENT_LOGIN_FAILURES": true },
  "PERFORMANCE": {
    "LOAD_LEVELS": {
      "LOW": "low",
      "MEDIUM": "medium", 
      "HIGH": "high",
      "CRITICAL": "critical"
    },
    "LOAD_THRESHOLDS": {
      "MEDIUM": 1000,
      "HIGH": 2500,
      "CRITICAL": 5000
    }
  }
}
```

##### Environment variables and canonical mapping

Use canonical env var names by uppercasing and replacing dots with underscores:

- `API_DEFAULT_OPTIONS.LOG_DIR` → `API_DEFAULT_OPTIONS_LOG_DIR`

Common variables used by the SDK and host app include:

- `RODIT_NEAR_CREDENTIALS_SOURCE`
- `SERVICE_NAME`
- `API_DEFAULT_OPTIONS_LOG_DIR`
- `NEAR_RPC_URL`
- `NEAR_CONTRACT_ID` (testing default exists; override in production)
- `SECURITY_OPTIONS_SILENT_LOGIN_FAILURES` (controls whether login failures are logged silently)
- Performance: `PERFORMANCE_LOAD_LEVELS_MEDIUM`, `PERFORMANCE_LOAD_THRESHOLDS_HIGH`, etc.
- Vault: `VAULT_ENDPOINT`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`, `VAULT_RODIT_KEYVALUE_PATH`

You can also set complex values via `NODE_CONFIG` (JSON string).

##### Migration Guide

Replace direct `config` imports with the SDK wrapper to benefit from fallbacks:

```javascript
// Before
const config = require('config');

// After
const config = require('./services/configsdk');
```

The wrapper preserves `config.get(key)`, `config.has(key)`, and default values via `config.get(key, defaultValue)`.

##### Error Handling

Accessing excluded keys without providing them will throw. Use explicit defaults where appropriate:

```javascript
try {
  const vaultEndpoint = config.get('VAULT_ENDPOINT');
} catch (err) {
  console.error('Vault endpoint not configured:', err.message);
}

const serverPort = config.get('SERVERPORT');            // has fallback
const customTimeout = config.get('CUSTOM_TIMEOUT', 5000); // explicit default
```

##### Best Practices

- Provide sensitive keys via env/secret stores; never hardcode
- Override defaults per environment (development, staging, production)
- Validate critical settings at startup
- Document any custom keys your app introduces

##### Troubleshooting

- Ensure the host app has a `config` package installed
- Confirm you import `sdk/services/configsdk` (not `config` directly) when using the wrapper from within the SDK
- Verify key names and canonical env var mapping
- Ensure Vault credentials and permission map are provided (no fallbacks)

##### Credentials Store Selection

The SDK supports file-based and Vault-backed credential stores, selected at runtime (env var takes precedence over config):

- Default: `RODIT_NEAR_CREDENTIALS_SOURCE = "file"`
- Env override: `RODIT_NEAR_CREDENTIALS_SOURCE=vault` or `file`

Config keys:

```json
{
  "RODIT_NEAR_CREDENTIALS_SOURCE": "file",
  "credentials": { "filePath": "/app/.near-credentials/testnet/your-credentials.json" }
}
```

For `vault`:

```json
{
  "RODIT_NEAR_CREDENTIALS_SOURCE": "vault",
  "VAULT_ENDPOINT": "https://vault.example.com:8200",
  "VAULT_ROLE_ID": "...",
  "VAULT_SECRET_ID": "...",
  "VAULT_RODIT_KEYVALUE_PATH": "signing-keys"
}
```

#### statemanager.js

State management service.

##### getInstance()

Get the state manager singleton instance.

```javascript
const stateManager = stateManager.getInstance();
```

Returns: Object — State manager instance

##### getConfig(key)

Get a configuration value.

```javascript
const value = stateManager.getConfig(key);
```

Parameters:
- `key` (string): Configuration key

Returns: any — Configuration value

##### setConfig(key, value)

Set a configuration value.

```javascript
stateManager.setConfig(key, value);
```

Parameters:
- `key` (string): Configuration key
- `value` (any): Configuration value

Returns: void

---

### Utility Functions

Utility functions for common tasks.

#### utils.js

General utility functions.

##### isValidIpRange(cidr)

Validate an IP range in CIDR format.

```javascript
const isValid = utils.isValidIpRange(cidr);
```

Parameters:
- `cidr` (string): CIDR notation IP range

Returns: boolean — True if valid

##### isClientIpAuthorized(ip, cidr)

Check if a client IP is authorized.

```javascript
const isAuthorized = utils.isClientIpAuthorized(ip, cidr);
```

Parameters:
- `ip` (string): Client IP address
- `cidr` (string): CIDR notation IP range

Returns: boolean — True if authorized

##### parseMetadataJson(jsonString, defaultValue)

Parse a JSON string from RODiT token metadata. RODiT tokens contain specific metadata fields that may be JSON-encoded strings, such as `permissioned_routes` which contains the allowed API routes and methods.

```javascript
// Example: Parse permissioned routes from token metadata
const config = await client.getConfigOwnRodit();
const metadata = config.own_rodit.metadata;
const permissionedRoutes = utils.parseMetadataJson(metadata.permissioned_routes, {});

// RODiT permissioned_routes structure example:
// {
//   "/api/health": ["POST"],
//   "/api/data": ["POST"],
//   "/api/users": ["POST"]
// }
```

Parameters:
- `jsonString` (string): JSON string from RODiT token metadata
- `defaultValue` (any): Default value if parsing fails

Returns: Object — Parsed RODiT metadata structure or default value

---

### Middleware

Middleware for Express applications.

#### authenticationmw.js

Authentication middleware.

##### authenticate_apicall(options)

Middleware to authenticate_apicall requests.

```javascript
app.use(authenticationmw.authenticate_apicall(options));
```

Parameters:
- `options` (Object, optional): Authentication options
  - `required` (boolean, optional): Whether authentication is required

Returns: Function — Express middleware

#### filestore-credentials.js

File-based credential storage.

##### getCredentials(filePath)

Load credentials from a file.

```javascript
let credentials = filestoreCredentials.getCredentials(filePath);
```

Parameters:
- `filePath` (string): Path to credentials file

Returns: Object — Credentials

---

### Logging

All SDK logs are emitted to stdout in structured JSON. There are no file transports in the SDK.

- Output: JSON to stdout (suitable for Docker/K8s/systemd and log shippers like Promtail/Fluent Bit).
- Verbosity: Controlled by `LOG_LEVEL` env var (`debug`, `info`, `warn`, `error`). Defaults to `debug`.
- Helpers: Context helpers (`createLogContext`, `infoWithContext`, etc.) and lightweight metrics via `logger.metric(name, value, labels)`.
- Injection: You can inject your own logger (Winston/Pino/Bunyan/etc.) using `setLogger(customLogger)`. Your logger must implement `{ error, warn, info, debug, log }`.

#### Defaults (no injection)

```javascript
const logger = require('../services/logger');
logger.infoWithContext('Client initialised', logger.createLogContext('RoditClient', 'init'));
```

#### Inject your own logger

You can provide a preconfigured logger that ships logs to your sinks. The SDK will use it and still provide the helper methods.

```javascript
const logger = require('../services/logger');

// Example: inject a Pino instance
const pino = require('pino');
const pinoLogger = pino({ level: process.env.LOG_LEVEL || 'info' });
logger.setLogger(pinoLogger);

// or: inject a Winston instance with your transports (Datadog/Splunk/CloudWatch)
// const winston = require('winston');
// const custom = winston.createLogger({
//   level: 'info',
//   transports: [new winston.transports.Http({ /* ... */ })]
// });
// logger.setLogger(custom);

logger.info('Using injected logger');
logger.infoWithContext('Event', logger.createLogContext('RoditClient', 'init'));
```

Notes:

- There is no `LOG_DIR` or file output in the SDK. If you need files, configure that in your injected logger.
- The helper APIs remain the same whether you use the default or an injected logger.

#### Logging Guide

The SDK is cloud-native by default and emits structured JSON to stdout/stderr. This works out-of-the-box on all platforms (Docker, Kubernetes, ECS, Cloud Run, Heroku, systemd), where platform agents collect container logs.

If you need to route SDK logs to a specific backend (Grafana Loki, Datadog, CloudWatch, etc.), inject your own logger using `logger.setLogger(customLogger)`.

##### Option 1: Direct to Loki (recommended if you use Loki)

Use `winston` with the `winston-loki` transport in your host application and inject it into the SDK.

```javascript
// app bootstrap
const winston = require('winston');
const LokiTransport = require('winston-loki');
const { logger } = require('your-sdk');

const custom = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.json() }),
    new LokiTransport({
      host: process.env.LOKI_URL,               // e.g. https://loki.example.com
      basicAuth: process.env.LOKI_BASIC_AUTH,   // optional: "user:password"
      ssl: process.env.LOKI_TLS_SKIP_VERIFY === 'true' ? { rejectUnauthorized: false } : undefined,
      labels: { app: 'my-app', component: 'sdk' },
      json: true,
      batching: true,
      gracefulShutdown: true,
      timeout: 5000,
    })
  ]
});

logger.setLogger(custom);
```

Environment variables (canonical style):

- `LOKI_URL` — Loki push URL (e.g., https://loki.example.com)
- `LOKI_BASIC_AUTH` — optional basic auth in the form `user:password`
- `LOKI_TLS_SKIP_VERIFY` — set to `true` to skip certificate verification (testing only)
- `LOG_LEVEL` — log verbosity (debug, info, warn, error), default `info`

##### Option 2: File + Agent (Promtail/Fluent Bit)

If you prefer using a log agent, write SDK logs to a file and have the agent ship them.

```javascript
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { logger } = require('your-sdk');

const logDir = process.env.API_DEFAULT_OPTIONS_LOG_DIR || '/app/logs';
fs.mkdirSync(logDir, { recursive: true });

const custom = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.json() }),
    new winston.transports.File({ filename: path.join(logDir, 'sdk.log'), maxsize: 10 * 1024 * 1024, maxFiles: 3 })
  ]
});

logger.setLogger(custom);
```

Then configure Promtail/Fluent Bit to scrape `/app/logs/*.log` and push to your backend. This approach is provider-agnostic and works with CloudWatch, Stackdriver, etc.

---

### Error Handling

The SDK implements internal error handling for various operations. As a user of the SDK, you should handle errors that may be thrown from SDK methods.

#### SDK Error Handling

The SDK internally handles various error types:

- Authentication errors (token validation, login failures)
- Network errors (connection issues, timeouts)
- Configuration errors (missing required values)
- Permission errors (unauthorized operations)

---

### Security Features

#### Timestamp Validation

The SDK implements timestamp validation to prevent replay attacks. Authentication requests include a timestamp that must be within a configurable time window (default: 5 minutes) of the server's current time.

```javascript
// Example of timestamp validation in authentication requests
const timestamp = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
const authData = {
  roditid: "your-rodit-id",
  timestamp: timestamp,
  signature: signData(`${roditid}${timestamp}`)
};
```

#### JWT-Based Authentication

The SDK uses modern JWT (JSON Web Token) for authentication, providing a stateless, secure method for transmitting information between parties.

```javascript
// Example of JWT token verification
const tokenData = decodeJwt(token);
const isValid = await verifyJwtSignature(token);
```

#### Webhook Security

Webhooks are secured using cryptographic signatures to ensure the authenticity of webhook deliveries.

```javascript
// Example of webhook signature verification
const isValid = await authenticate_webhook(
  payload,
  signature_hex_ofpayload,
  timestamp,
  server_public_key_base64url
);
```

---

### Project Structure

The RODiT SDK is organized into the following directory structure:

```
sdk/
├── lib/                  # Core library files
│   ├── auth/             # Authentication modules
│   │   ├── authentication.js
│   │   ├── roditmanager.js
│   │   ├── sessionmanager.js
│   │   ├── tokenservice.js
│   │   └── sessioncleanup.js
│   ├── blockchain/       # Blockchain interaction
│   │   ├── blockchainservice.js
│   │   └── statemanager.js
│   └── middleware/       # Express middleware
│       ├── authenticationmw.js
│       ├── loggingmw.js
│       ├── performancemw.js
│       ├── ratelimit.js
│       └── validatepermissions.js
├── utils.js              # Utility functions
├── README.md             # SDK documentation
└── API-REFERENCE.md      # API reference
```

#### Module Dependencies

The SDK is designed to minimize circular dependencies by using direct function imports and careful module organization.

```javascript
// Example of importing specific functions to avoid circular dependencies
const { login_server } = require("../middleware/authenticationmw");
```

#### Client-Side Error Handling

When using the SDK, implement error handling for SDK method calls:

```javascript
try {
  // Initialize the client
  const client = await createClient({
    credentialsPath: './credentials.json'
  });
  
  // Make an API request
  const response = await client.request('POST', '/api/endpoint');
  console.log('Response:', response);
} catch (error) {
  console.error('Error:', error.message);
  
  // Check for specific error messages if needed
  if (error.message.includes('authentication')) {
    console.error('Authentication error - please check your credentials');
  } else if (error.message.includes('network')) {
    console.error('Network error - please check your connection');
  }
}
```

The SDK handles token refresh and other internal operations automatically.
