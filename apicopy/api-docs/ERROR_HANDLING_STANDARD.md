# Unified Error Handling Standard

**Status:** ✅ IMPLEMENTED  
**Reference:** `sdk/services/error-response.js` + all API route files  
**Last Updated:** April 2026

---

## Standard Error Response Structure

All API errors follow this compact, consistent format:

```json
{
  "error": {
    "code": "HELLO_TOKEN_ID_INVALID",
    "message": "Token ID must be exactly 12 lowercase letters",
    "details": { "tokenId": "INVALID123" }
  },
  "requestId": "01HX9X0T9CS1EM0WQ7R6F5B2VY",
  "timestamp": "2026-04-15T08:21:45.000Z"
}
```

**Key points:**
- `error.code` - Machine-readable code (SCREAMING_SNAKE_CASE)
- `error.message` - Human-readable explanation
- `error.details` - Optional context (only when helpful)
- `requestId` - ULID for tracing (always included)
- `timestamp` - ISO 8601 when error occurred (always included)

---

## How API Endpoints Report Errors

All route files use `sendError()` from `@rodit/rodit-auth-be`:

```javascript
const { sendError } = require("@rodit/rodit-auth-be").errorResponse;

// Minimal error (most common)
sendError(res, {
  statusCode: 400,
  requestId,
  code: 'HELLO_TOKEN_ID_INVALID',
  message: 'Token ID must be exactly 12 lowercase letters'
});

// With details (when helpful)
sendError(res, {
  statusCode: 400,
  requestId,
  code: 'SIGNCLIENT_FEE_MISMATCH',
  message: 'Minting fee does not match server calculation',
  details: { clientFee: '0.05', serverFee: '0.10' }
});
```

### Implementation in Route Files

All route files follow this pattern:

```javascript
const { sendError } = require("@rodit/rodit-auth-be").errorResponse;

router.get("/endpoint", (req, res) => {
  const requestId = req.requestId || ulid();
  
  // Validation
  if (!isValid) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: 'ERROR_CODE_NAME',
      message: 'What went wrong'
    });
  }
  
  // Success response
  return res.status(200).json({ data, requestId });
});
```

---

## Common Error Codes

### Authentication & Authorization
| Code | Status | Meaning |
|------|--------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid JWT token |
| `FORBIDDEN` | 403 | Authenticated but lacks required permissions |
| `AUTH_SERVICE_UNAVAILABLE` | 503 | Authentication service unavailable |

### Token Validation
| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_RODITID` | 400 | Token ID format invalid (not 12 lowercase letters) |
| `TOKEN_NOT_FOUND` | 401 | Token doesn't exist on blockchain |
| `IDENTITY_NOT_FOUND` | 404 | RODiT identity not found |

### HOLA Handshake
| Code | Status | Meaning |
|------|--------|---------|
| `HELLO_REQUIRED` | 400 | Hello message missing |
| `HELLO_TOKEN_ID_INVALID` | 400 | Token ID invalid format |
| `HELLO_TIMESTAMP_INVALID` | 400 | Timestamp outside acceptable window |
| `HELLO_SIGNATURE_INVALID` | 400 | Signature verification failed |
| `HELLO_CHECKSUM_INVALID` | 400 | Checksum verification failed |
| `HELLO_TOO_LONG` | 400 | Message exceeds 512 character limit |

### Request Validation
| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_REQUEST` | 400 | Missing required parameter |
| `INVALID_PARAMETERS` | 400 | Parameter value out of range |
| `INVALID_SIGNATURE` | 400 | Signature verification failed |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type not application/json |

### Service Errors
| Code | Status | Meaning |
|------|--------|---------|
| `SERVICE_UNAVAILABLE` | 503 | Upstream service unavailable |
| `AGENT_DISCOVERY_FAILED` | 500 | Failed to fetch agent list |
| `LOGIN_FAILED` | 500 | Authentication service error |

---

## Key Principles

1. **Minimal by default** - Only include `details` when it adds debugging value
2. **Machine-readable codes** - Always use SCREAMING_SNAKE_CASE
3. **Actionable messages** - Explain what went wrong, not how to fix it
4. **Consistent structure** - Same format across all endpoints
5. **Traceability** - `requestId` and `timestamp` enable end-to-end debugging

---

## Example Error Responses

### Minimal (most common)
```json
{
  "error": {
    "code": "HELLO_TOKEN_ID_INVALID",
    "message": "Token ID must be exactly 12 lowercase letters"
  },
  "requestId": "01HX9X0T9CS1EM0WQ7R6F5B2VY",
  "timestamp": "2026-04-15T08:21:45.000Z"
}
```

### With details (when helpful)
```json
{
  "error": {
    "code": "SIGNCLIENT_FEE_MISMATCH",
    "message": "Minting fee does not match server calculation",
    "details": {
      "clientFee": "0.05",
      "serverFee": "0.10"
    }
  },
  "requestId": "01HX9X0T9CS1EM0WQ7R6F5B2VY",
  "timestamp": "2026-04-15T08:21:45.000Z"
}
```

---

## Benefits

✅ **Compact** - Minimal JSON payload  
✅ **Consistent** - Same structure across all endpoints  
✅ **Traceable** - `requestId` enables end-to-end debugging  
✅ **Actionable** - Clear error codes for programmatic handling  
✅ **Flexible** - Optional `details` for complex errors  
✅ **Documented** - All error codes defined in this standard

---

## Implementation Status

- [x] ErrorResponse schema in swagger.json (compact format)
- [x] All API endpoints use `sendError()` from SDK
- [x] All route files follow standard pattern
- [x] Error codes documented above
- [x] requestId and timestamp included in all responses
- [x] Optional `details` field for complex errors
