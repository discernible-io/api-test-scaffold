# API Reference

Complete endpoint listing for IdentityClaw API.

## Table of Contents

- [Public Endpoints](#public-endpoints)
- [Protected Endpoints](#protected-endpoints)
- [Privileged Endpoints](#privileged-endpoints)
- [DID Resolution](#did-resolution)
- [MCP Resources](#mcp-resources)
- [Policy Documents](#policy-documents)

## Public Endpoints

No authentication required.

### Discovery

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API overview with enrollment URL and endpoint listing |
| `/health` | GET | Health check endpoint |
| `/.well-known/enrollment` | GET | Complete enrollment guide with pricing and steps |
| `/docs` | GET | Interactive HTML documentation with Swagger UI |
| `/openapi.json` | GET | OpenAPI 3.0 specification |
| `/swagger.json` | GET | OpenAPI 3.0 specification (alias) |
| `/api/v1/openapi.json` | GET | Versioned OpenAPI specification |

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/login/timestamp` | GET | Get consistent timestamp for login (32-byte nonce) |
| `/api/login` | POST | Authenticate with RODiT token, get JWT |

**Request** (`POST /api/login`):
```json
{
  "roditid": "bkbvehbdcrgm",
  "timestamp": 1776622758,
  "roditid_base64url_signature": "YOUR_BASE64URL_SIGNATURE"
}
```

**Response**:
```json
{
  "token": "eyJhbGc...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

### Agent Discovery

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents` | GET | List all RODiT token holders (paginated) |

**Query Parameters**:
- `limit` (default: 50, max: 100)
- `offset` (default: 0)
- `creature` (filter by profession)

**Response**:
```json
{
  "agents": [
    {
      "token_id": "bkbvehbdcrgm",
      "owner_id": "abc123...def.near",
      "userselected_dn": "NNSWF=Alice,Creature=Legal Specialist",
      "facial_description": "pale-skinned Nordic oval-faced..."
    }
  ],
  "total": 1234,
  "limit": 50,
  "offset": 0
}
```

### Client Token Signing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/signclient` | POST | Request server to sign client token metadata |

**Note**: Cannot request privileged operations (metrics, system, reset, debug, etc.)

---

## Protected Endpoints

Require JWT authentication via `Authorization: Bearer <token>` header.

### Identity

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/me/identity` | GET | Get your own identity information |
| `/api/identity/token/{tokenId}/full` | GET | Get any token's metadata |
| `/api/identity/verify` | POST | Verify HOLA message from peer agent |

**Request** (`POST /api/identity/verify`):
```json
{
  "hello": "HOLA/MUNDO/bkbvehbdcrgm/2026-04-19T10:47:00.000Z/4F9A3C7E.../API.IDENTYCLAW.COM/dGVzdA.../a"
}
```

**Response**:
```json
{
  "valid": true,
  "tokenId": "bkbvehbdcrgm",
  "recipient": "MUNDO",
  "timestamp": "2026-04-19T10:47:00.000Z",
  "ageMs": 1234,
  "checksumValid": true,
  "signatureValid": true,
  "nonceValid": true,
  "tokenExists": true
}
```

### Nonces

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/holanonce16ts` | GET | Get nonce for HOLA message (16-byte nonce) |

**Response**:
```json
{
  "noncets": "2026-04-19T10:47:00.000Z:4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE",
  "timestamp": "2026-04-19T10:47:00.000Z",
  "length": 16,
  "algorithm": "random",
  "requestId": "01HQXYZ..."
}
```

### Session Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/logout` | POST | Logout and invalidate JWT token |

---

## Privileged Endpoints

Require JWT authentication AND specific permissions in RODiT token's `permissioned_routes`.

### Metrics

| Endpoint | Method | Description | Permission Required |
|----------|--------|-------------|---------------------|
| `/api/metrics` | GET | Get performance metrics (admin only) | `metrics` |
| `/api/metrics/system` | GET | Get system metrics (admin only) | `system` |
| `/api/metrics/reset` | POST | Reset metrics | `reset` |
| `/api/metrics/debug` | GET | Get debug information | `debug` |

### Sessions

| Endpoint | Method | Description | Permission Required |
|----------|--------|-------------|---------------------|
| `/api/sessions/list_all` | GET | List all active sessions | `list_all` |
| `/api/sessions/cleanup` | POST | Cleanup expired sessions | `cleanup` |
| `/api/sessions/revoke` | POST | Revoke specific session | `revoke` |

### Testing

| Endpoint | Method | Description | Permission Required |
|----------|--------|-------------|---------------------|
| `/api/testhola` | POST | Test HOLA message generation | `testhola` |

**Request**:
```json
{
  "recipient": "MUNDO"
}
```

**Response**:
```json
{
  "hello": "HOLA/MUNDO/bkbvehbdcrgm/2026-04-19T10:47:00.000Z/4F9A3C7E.../API.IDENTYCLAW.COM/dGVzdA.../a",
  "components": {
    "recipient": "MUNDO",
    "tokenId": "bkbvehbdcrgm",
    "timestamp": "2026-04-19T10:47:00.000Z",
    "noncetsHex": "4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE",
    "signature": "dGVzdA...",
    "checksum": "a"
  }
}
```

---

## DID Resolution

Public endpoints for DID resolution.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/did/rodit/{tokenId}` | GET | Get DID document for RODiT token |
| `/.well-known/did/resolve` | GET | Resolve DID from token ID (query param) |
| `/.well-known/did/web/token/{tokenId}` | GET | Get DID:web document |
| `/.well-known/did/web/token/{tokenId}/did.json` | GET | Get DID:web JSON document |

**Example** (`GET /.well-known/did/resolve?token_id=bkbvehbdcrgm`):
```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://rodit.org/context/v1"
  ],
  "id": "did:wba:rodit.near:bkbvehbdcrgm",
  "controller": "did:wba:rodit.near:bkbvehbdcrgm",
  "verificationMethod": [
    {
      "id": "did:wba:rodit.near:bkbvehbdcrgm#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:wba:rodit.near:bkbvehbdcrgm",
      "publicKeyMultibase": "z6Mk..."
    }
  ],
  "authentication": [
    "did:wba:rodit.near:bkbvehbdcrgm#key-1"
  ]
}
```

---

## MCP Resources

Machine-readable capabilities for AI agent discovery.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mcp/resources` | GET | List all available MCP resources |
| `/api/mcp/resource/{uri}` | GET | Get specific MCP resource |
| `/api/mcp/schema` | GET | Get MCP schema definition |

**Available Resources**:
- `jsonld:context` - JSON-LD context for semantic mappings
- `jsonld:contract-metadata` - Contract metadata as JSON-LD
- `howto:enrollment` - Enrollment guide
- `howto:authentication` - Authentication flows
- `howto:hola-protocol` - HOLA protocol specification

---

## Policy Documents

Public policy documents.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/terms-of-service` | GET | Terms of Service |
| `/.well-known/privacy-policy` | GET | Privacy Policy |
| `/.well-known/data-retention` | GET | Data Retention Policy |
| `/.well-known/why-identyclaw` | GET | Why IdentityClaw (use cases) |

---

## Rate Limiting

All endpoints are subject to rate limiting based on your RODiT token's `max_requests` and `maxrq_window` settings.

**Headers**:
- `X-RateLimit-Limit` - Maximum requests allowed
- `X-RateLimit-Remaining` - Requests remaining in current window
- `X-RateLimit-Reset` - Unix timestamp when limit resets

**Response** (rate limit exceeded):
```json
{
  "statusCode": 429,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded",
  "details": {
    "limit": 1000,
    "window": 3600,
    "resetAt": "2026-04-19T11:47:00.000Z"
  }
}
```

---

## Error Codes

Common error codes across all endpoints:

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid JWT token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_SERVER_ERROR` | 500 | Server error |

### Authentication Errors

| Code | Status | Description |
|------|--------|-------------|
| `SIGNATURE_VERIFICATION_FAILED_035` | 401 | Signature verification failed |
| `TOKEN_EXPIRED` | 401 | RODiT token expired |
| `TOKEN_NOT_FOUND` | 404 | RODiT token not found |
| `INVALID_TOKEN_ID` | 400 | Invalid token ID format |

### HOLA Errors

| Code | Status | Description |
|------|--------|-------------|
| `HELLO_REQUIRED` | 400 | HOLA message required |
| `HELLO_FIELDS_MISSING` | 400 | Missing HOLA fields |
| `HELLO_TOKEN_ID_INVALID` | 400 | Invalid token ID in HOLA |
| `HELLO_TIMESTAMP_INVALID` | 400 | Invalid timestamp format |
| `HELLO_NONCETS_INVALID` | 400 | Invalid nonce format |
| `HELLO_PROTOCOL_UNRECOGNIZED` | 400 | Wrong domain identifier |
| `HELLO_CHECKSUM_INVALID` | 400 | Checksum validation failed |
| `HELLO_SIGNATURE_INVALID` | 400 | Signature verification failed |
| `HELLO_TOO_LONG` | 400 | HOLA message exceeds 512 chars |

---

## Versioning

API version is specified via headers:

**Request Headers**:
- `X-API-Version: 1.0` (optional, defaults to latest)

**Response Headers**:
- `X-API-Version: 1.0` (current version)

---

## Next Steps

- [Learn authentication flows](authentication.md)
- [Understand token metadata](token-metadata.md)
- [View JSON-LD integration](jsonld.md)
- [Return to main guide](../skills.md)
- [Interactive API docs](https://api.identyclaw.com/docs)
