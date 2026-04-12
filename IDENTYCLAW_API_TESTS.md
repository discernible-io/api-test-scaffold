# IDENTYCLAW API Test Suite

This document describes the comprehensive test suite for the IDENTYCLAW API functionality and security.

## Test Module Location
`/home/icarus40/clienttestapi-rodit/src/test-modules/identyclaw-api.js`

## Test Coverage

### 1. Health Check Tests
**Test:** `testHealthEndpoint`
- **Endpoint:** `GET /health`
- **Auth Required:** No
- **Purpose:** Validates basic service availability
- **Validates:**
  - HTTP 200 response
  - Service is operational

### 2. Noncets Generation Tests
**Test:** `testNoncetsGeneration`
- **Endpoint:** `GET /api/noncets`
- **Auth Required:** Yes (Bearer token)
- **Purpose:** Validates noncets generation for Morse-compatible canonical messages
- **Validates:**
  - Response contains required fields: `noncets`, `noncets_hex`, `timestamp`, `requestId`
  - Noncets format matches pattern `:timestamp:hex:`
  - Noncets hex is uppercase hexadecimal (0-9A-F)
  - Proper timestamp format

### 3. Self-Identity Tests
**Test:** `testMeIdentity`
- **Endpoint:** `GET /api/me/identity`
- **Auth Required:** Yes (Bearer token)
- **Purpose:** Validates self-identification functionality
- **Validates:**
  - Response contains: `tokenId`, `identity`, `requestId`
  - TokenId format is 12 lowercase letters (facial encoding)
  - Identity object contains full token metadata
  - Parsed Distinguished Name attributes

### 4. Self-Face Description Tests
**Test:** `testMeFace`
- **Endpoint:** `GET /api/me/face`
- **Auth Required:** Yes (Bearer token)
- **Purpose:** Validates facial token_id encoding for authenticated user
- **Validates:**
  - Response contains: `tokenId`, `faceDescription`, `requestId`
  - FaceDescription has `checksumValid` boolean
  - FaceDescription has `categories` object with facial attributes
  - Checksum validation status

### 5. Peer Identity Lookup Tests
**Test:** `testIdentityTokenLookup`
- **Endpoint:** `GET /api/identity/token/{tokenId}`
- **Auth Required:** Yes (Bearer token)
- **Purpose:** Validates ability to look up peer identities
- **Validates:**
  - Successful lookup of token by ID
  - Response contains full identity information
  - Parsed userselected_dn metadata

### 6. Peer Face Description Tests
**Test:** `testIdentityFaceLookup`
- **Endpoint:** `GET /api/identity/face/{tokenId}`
- **Auth Required:** Yes (Bearer token)
- **Purpose:** Validates facial description lookup for peers
- **Validates:**
  - Response contains: `tokenId`, `faceDescription`, `requestId`
  - FaceDescription structure is valid
  - Categories are properly encoded

### 7. Identity Verification Tests
**Test:** `testIdentityVerify`
- **Endpoint:** `POST /api/identity/verify`
- **Auth Required:** Yes (Bearer token)
- **Purpose:** Validates peer hello verification with Ed25519 signatures
- **Validates:**
  - Proper error handling for invalid hello format
  - Returns 400 for malformed input
  - Verification logic is active

### 8. MCP Resources Tests
**Test:** `testMcpResources`
- **Endpoint:** `GET /api/mcp/resources`
- **Auth Required:** No
- **Purpose:** Validates MCP resource listing
- **Validates:**
  - HTTP 200 response
  - Resource list is returned
  - Pagination support (limit, cursor)

### 9. MCP Schema Tests
**Test:** `testMcpSchema`
- **Endpoint:** `GET /api/mcp/schema`
- **Auth Required:** No
- **Purpose:** Validates OpenAPI schema retrieval
- **Validates:**
  - HTTP 200 response
  - Schema contains requestId
  - OpenAPI document is returned

### 10. Well-Known Policy Tests
**Test:** `testWellKnownTermsOfService`
- **Endpoint:** `GET /.well-known/terms-of-service`
- **Auth Required:** No
- **Purpose:** Validates policy document retrieval
- **Validates:**
  - HTTP 200 response
  - Content-Type is text/markdown or text/html
  - Document is accessible

### 11. Authentication Security Tests
**Test:** `testAuthenticationRequired`
- **Endpoints Tested:**
  - `GET /api/noncets`
  - `GET /api/me/identity`
  - `GET /api/me/face`
  - `GET /api/metrics`
- **Auth Required:** Yes (Bearer token)
- **Purpose:** Validates that protected endpoints reject unauthenticated requests
- **Validates:**
  - All protected endpoints return 401 without authentication
  - Authorization header is required
  - Security is properly enforced

## API Endpoints NOT Covered (Require Additional Setup)

### DID Resolution Endpoints
- `GET /.well-known/did/rodit/{tokenId}` - Requires valid tokenId
- `GET /.well-known/did/resolve?did=...` - Requires DID string
- `GET /.well-known/did/web/token/{tokenId}` - Requires valid tokenId
- `GET /.well-known/did/web/token/{tokenId}/did.json` - Requires valid tokenId

### Client RODiT Minting
- `POST /api/signclient` - Requires complex payload with tamperproof values and minting fee

### Admin/Privileged Endpoints
- `GET /api/metrics/system` - Requires admin permissions
- `POST /api/metrics/reset` - Requires admin permissions
- `GET /api/metrics/debug` - Requires admin permissions
- `GET /api/sessions/list_all` - Requires admin permissions
- `POST /api/sessions/cleanup` - Requires admin permissions
- `POST /api/sessions/revoke` - Requires admin permissions

### Policy Documents
- `GET /.well-known/privacy-policy` - Similar to terms-of-service
- `GET /.well-known/data-retention` - Similar to terms-of-service

### Token DN Endpoint
- `GET /api/identity/token/{tokenId}/dn` - Requires valid tokenId

## Security Validations

The test suite validates:

1. **Authentication Enforcement**
   - Protected endpoints reject requests without Bearer tokens
   - 401 Unauthorized responses for missing authentication

2. **Input Validation**
   - Malformed requests return 400 Bad Request
   - Invalid hello format is properly rejected

3. **Response Structure**
   - All responses include requestId for tracing
   - Required fields are present
   - Data formats match specifications

4. **Token Format Validation**
   - TokenId format: 12 lowercase letters (facial encoding)
   - Noncets hex format: uppercase hexadecimal
   - Timestamp format: ISO-8601

## Running the Tests

The test suite is automatically included when running the full test suite:

```bash
npm start
```

Or enable specifically in `config/default.json`:

```json
{
  "API_DEFAULT_OPTIONS": {
    "ENABLED_TEST_SUITES": [
      "identyclawApi"
    ]
  }
}
```

## Test Results

Test results are logged with:
- Request correlation IDs
- Success/failure status
- Detailed error messages
- Response validation details

All tests follow the standard test framework patterns used throughout the test suite.
