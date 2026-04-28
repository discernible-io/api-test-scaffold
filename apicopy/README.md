# IDClawserver API

API for AI agent identities backed by RODiT tokens on NEAR, including facial token_id encoding.

**Version:** 0.9.0

## Quick Start

- **[Enrollment & Setup](references/enrollment.md)** — NEAR wallet, RODiT token purchase, pricing
- **[Authentication Flows](references/authentication.md)** — API login, HOLA protocol, signatures, nonces
- **[Token Metadata](references/token-metadata.md)** — RODiT fields, DN format, facial encoding
- **[JSON-LD Integration](references/jsonld.md)** — Semantic web mappings, DID compatibility
- **[API Reference](references/api-reference.md)** — Full endpoint listing, error codes

## Documentation

- **Interactive Docs**: `GET /docs` - Swagger UI
- **OpenAPI Spec**: `GET /openapi.json` - Standard OpenAPI 3.0
- **Enrollment Guide**: `GET /.well-known/enrollment` - Complete enrollment guide
- **API Discovery**: `GET /` - API overview with endpoint listing

---

## Endpoints

| Method | Path | Summary | Auth |
| ------ | ---- | ------- | ---- |
| GET | `/` | API discovery endpoint with enrollment information | none |
| GET | `/.well-known/data-retention` | Data Retention Policy | none |
| GET | `/.well-known/did/resolve` | Resolve DID string | Bearer |
| GET | `/.well-known/did/rodit/{tokenId}` | Resolve did:rodit DID document | Bearer |
| GET | `/.well-known/did/web/token/{tokenId}` | Resolve did:web DID document | Bearer |
| GET | `/.well-known/did/web/token/{tokenId}/did.json` | Resolve did:web JSON DID document | Bearer |
| GET | `/.well-known/enrollment` | Enrollment information and guidance | none |
| GET | `/.well-known/privacy-policy` | Privacy Policy | none |
| GET | `/.well-known/terms-of-service` | Terms of Service | none |
| GET | `/.well-known/why-identyclaw` | Why IdentityClaw - Value Proposition | none |
| GET | `/api/agents` | List RODiT token holders with facial descriptions | none |
| GET | `/api/holanonce16ts` | Get a concatenation-ready timestamp+noncets fragment for HOLA handshake | Bearer |
| GET | `/api/identity/token/{tokenId}/full` | Get full identity with DN and facial encoding | Bearer |
| POST | `/api/identity/verify` | Verify a peer's hello using Ed25519 and a Morse-compatible canonical message | Bearer |
| POST | `/api/login` | RODiT client login to obtain a JWT access token | none |
| GET | `/api/login/timestamp` | Get timestamp and nonce for AI agent login | none |
| POST | `/api/logout` | RODiT client logout to invalidate the current session | Bearer |
| GET | `/api/mcp/resource/{uri}` | Retrieve a specific MCP resource by URI | none |
| GET | `/api/mcp/resources` | List available MCP resources (including OpenAPI schema) | none |
| GET | `/api/mcp/schema` | Return the OpenAPI schema used by this server | none |
| GET | `/api/me/identity` | Get authenticated agent's own DN and facial description | Bearer |
| GET | `/api/metrics` | Get current performance metrics for this IDClawserver instance | Bearer |
| GET | `/api/metrics/debug` | Debug endpoint for metrics subsystem (admin only) | Bearer |
| POST | `/api/metrics/reset` | Reset performance metrics counters (admin only) | Bearer |
| GET | `/api/metrics/system` | Get system resource metrics (CPU, memory, etc.) | Bearer |
| POST | `/api/sessions/cleanup` | Cleanup expired sessions (admin) | Bearer |
| GET | `/api/sessions/list_all` | List all active sessions (admin) | Bearer |
| POST | `/api/sessions/revoke` | Revoke a specific session (admin) | Bearer |
| POST | `/api/signclient` | Request minting of a client RODiT via SignPortal | none |
| POST | `/api/testhola` | Test HOLA message validation and respond with server HOLA | Bearer |
| GET | `/api/v1/openapi.json` | Versioned OpenAPI specification | none |
| GET | `/docs` | HTML documentation interface | none |
| GET | `/health` | Health check | none |
| GET | `/openapi.json` | OpenAPI specification | none |
| GET | `/swagger.json` | Return the raw OpenAPI schema (this document) | none |

