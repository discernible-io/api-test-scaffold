# Discernible ID Authentication System

This npm package provides the RODiT-based authentication system for Express.js applications. It exports the exact same authentication functionality without adding unnecessary abstraction layers.

## Features

- Exclusive RODiT-based authentication with blockchain verification
- JWT-based token management through HTTP headers (no cookies)
- Permission validation for protected routes based on RODiT token permissions
- Session management with secure token handling
- Comprehensive logging and error handling
- Automatic RODIT token information display during startup
- Programmatic access to RODIT token metadata for dynamic configuration

## Installation

```bash
npm install @rodit/rodit-auth-be

```
## Usage

### Basic Setup

```javascript
const express = require('express');
const app = express();
const auth = require('@rodit/rodit-auth-be');

// Configure authentication with default options
auth.configure({
  logger: require('./config/logger')
});

// Mount the authentication routes
app.post('/api/login', auth.login);
app.post('/api/logout', auth.authenticate, auth.logout);

// Protect routes with authentication
app.use('/api/protected', auth.authenticate, protectedRoutes);

// Add permission validation to routes that require specific permissions
app.use('/api/admin', auth.authenticate, auth.validatePermissions, adminRoutes);

// Example of a protected route with permission validation
app.get('/api/entities/:entityId', auth.authenticate, auth.validatePermissions, (req, res) => {
  // This route is protected and requires specific permissions from the RODiT token
  // The validatePermissions middleware will check if the user has permission to access this entity
  const entityId = req.params.entityId;
  // Process the request...
});

app.listen(3000, () => {
  console.log('Server started on port 3000');
});
```

### Custom Configuration

```javascript
const auth = require('@rodit/rodit-auth-be');

// Configure authentication with custom options
auth.configure({
  // Use a custom logger
  logger: myCustomLogger,
  
  // Set token expiry time to 1 hour (in seconds)
  tokenExpiry: 3600,
  
  // Customize header names
  headerName: 'X-Auth-Token',
  tokenPrefix: '',
  newTokenHeader: 'X-New-Token',
  
  // Customize user property name on request object
  userProperty: 'currentUser'
});
```

## API Reference

### Core Middleware Functions

- `authenticate(req, res, next)` - Middleware to authenticate API calls
- `validatePermissions(req, res, next)` - Middleware to validate permissions for protected routes

### Authentication Handlers

- `login(req, res)` - Handle client login
- `logout(req, res)` - Handle client logout
- `loginWithNEP413(req, res)` - Handle client login with NEP-413 standard

### Token Functions

- `validateToken(token)` - Validate a JWT token
- `generateToken(payload, options)` - Generate a JWT token

### Services

- `sessionManager` - Session management service
- `blockchainService` - Blockchain interaction service
- `stateManager` - State management service

### RODIT Token Information Access

The SDK provides access to RODIT token information that can be used for dynamic API configuration:

```javascript
const { stateManager } = require('@rodit/rodit-auth-be');

// Get complete RODIT configuration during or after initialization
const configObject = await stateManager.getConfigOwnRodit();
const roditToken = configObject.own_rodit;

// Access token metadata for configuration
const metadata = roditToken.metadata;
const tokenId = roditToken.token_id;

// Example: Configure API behavior based on token metadata
const allowedRoutes = JSON.parse(metadata.permissioned_routes);
const jwtDuration = parseInt(metadata.jwt_duration);
const allowedCIDR = metadata.allowed_cidr;
const apiEndpoint = metadata.subjectuniqueidentifier_url;

// Example: Dynamic rate limiting from token
if (metadata.max_requests && metadata.maxrq_window) {
  const maxRequests = parseInt(metadata.max_requests);
  const windowSeconds = parseInt(metadata.maxrq_window);
  // Apply rate limiting configuration
}
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

- `configure(config)` - Configure the authentication system

#### Configuration Options

- `logger` - Logger instance (optional, will use default if not provided)
- `tokenExpiry` - JWT token expiry time in seconds (default: 3600)
- `headerName` - Name of the header to use for the token (default: 'Authorization')
- `tokenPrefix` - Prefix to use for the token in the header (default: 'Bearer ')
- `newTokenHeader` - Name of the header to use for the new token (default: 'New-Token')
- `userProperty` - Name of the property to attach the user object to on the request (default: 'user')

## Discernible ID Authentication

RODiT-based authentication uses the RODiT system to authenticate users. It requires the following parameters in the login request:

- `roditid` - RODiT ID
- `timestamp` - Timestamp (optional, defaults to current time)
- `roditid_base64url_signature` - Signature

The system also supports NEP-413 standard authentication with the `loginWithNEP413` function, which requires:

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

## Backward Compatibility

For backward compatibility, the package also exports the original function names:

- `authenticate_apicall` - Original name for `authenticate`
- `login_client` - Original name for `login`
- `logout_client` - Original name for `logout`
- `login_client_withnep413` - Original name for `loginWithNEP413`

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
  - `apiEndpoint` (string, optional): API endpoint

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

##### getRoditMetadata()

Get the token metadata.

```javascript
const metadata = client.getRoditMetadata();
```

Returns: Object — Token metadata

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

The SDK wrapper at `sdk/services/config.js` provides safe fallbacks for several keys so the SDK can run in development without external configuration:

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
- Although `NEAR_CONTRACT_ID` has a testing default in `sdk/services/config.js`, you should always provide it explicitly via one of the options above in production deployments.

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

##### getRoditMetadata()

Get the token metadata.

```javascript
const metadata = roditManager.getRoditMetadata();
```

Returns: Object — Token metadata

---

### Configuration

Configuration management functionality.

#### Configuration System (Consolidated)

The SDK provides a configuration wrapper that behaves like the `config` package while offering safe defaults and a security-first fallback strategy. This allows applications to run with minimal setup in development, while ensuring production deployments explicitly provide sensitive settings.

##### Architecture

- Wrapper module: `sdk/services/config.js`
- Responsibilities:
  - Load the host application's `config` package if present
  - Provide fallback defaults for many non-sensitive keys
  - Exclude sensitive keys from defaults so they must be provided by the host
  - Preserve the standard `config` API (`get`, `has`), including nested keys

##### Source Priority (highest to lowest)

1. Host App Config (`config` package, env, NODE_CONFIG)
2. SDK Fallback Defaults (`sdk/config/default.json` baked-in)
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
const config = require('./services/config');

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
const config = require('./services/config');
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
- Confirm you import `sdk/services/config` (not `config` directly) when using the wrapper from within the SDK
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
const metadata = client.getRoditMetadata();
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

##### authenticate(options)

Middleware to authenticate requests.

```javascript
app.use(authenticationmw.authenticate(options));
```

Parameters:
- `options` (Object, optional): Authentication options
  - `required` (boolean, optional): Whether authentication is required

Returns: Function — Express middleware

#### filestore-credentials.js

File-based credential storage.

##### loadCredentials(filePath)

Load credentials from a file.

```javascript
const credentials = filestoreCredentials.loadCredentials(filePath);
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
