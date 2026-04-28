---
name: identyclaw
description: Use IdentityClaw API for agent identity verification, DID resolution, decentralized authentication (HOLA protocol), and RODiT token metadata access. Use when agents need to (1) Verify another agent's identity, (2) Prove their own identity to peers, (3) Resolve DIDs from token IDs, (4) Access facial encoding or DN metadata, (5) Implement agent-to-agent trust establishment, or (6) Decode facial feature encodings from token IDs.
---

# IdentityClaw

Quick start: See [enrollment guide](references/enrollment.md) to set up RODiT token.

## Core Workflows

### Use Subagents (OpenClaw Integration)

**For OpenClaw users:** Spawn subagents without needing separate RODiT tokens. Subagents use delegated authorization from a parent agent.

**Complete Workflow:**

1. **Parent agent has RODiT token** (see [enrollment guide](references/enrollment.md))
2. **Spawn subagent** using OpenClaw's `sessions_spawn`
3. **Subagent generates own Ed25519 keypair** (never share private key)
4. **Subagent requests authorization** from parent (sends public key + delegate ID)
5. **Parent signs delegation** using RODiT private key: `tokenId:delegateId:timestamp:publicKey`
6. **Parent stores delegation record** in workspace (for revocation tracking)
7. **Subagent generates HOLA** using **subagent format** (11 fields, not 8)
8. **Peer verifies** both HOLA signature AND delegation authorization

**Key Differences:**
- **Standard Agent**: Needs RODiT token (cost: 0.066-496 NEAR)
- **Subagent**: FREE - uses parent's token, just needs own keypair

**Subagent HOLA Format (11 fields):**
```
HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<timestamp>:<noncets>:API.IDENTYCLAW.COM:<sig>:<checksum>
```

**Critical:** Subagent signs HOLA with its **OWN** private key, not parent's key.

**API Endpoints:**
- `POST /api/identity/verify` - Verifies subagent HOLA (auto-detects format)
- `POST /api/isauthorizedsigner` - Verifies parent authorized the subagent
- `GET /api/holanonce16ts` - Gets nonce for HOLA generation

**MCP Resource:** `guide:subagents` - Complete guide with troubleshooting, code examples, and best practices

**Details:** See the complete subagent HOLA format documentation in the authentication reference guide

---

### Verify Another Agent's Identity

Use HOLA protocol + verification:

1. **Get JWT token**: `POST /api/login` (authenticate with your RODiT token)
2. **Request nonce**: `GET /api/holanonce16ts` (requires JWT)
3. **Receive HOLA message** from peer agent
4. **Verify HOLA**: `POST /api/identity/verify` (requires JWT)

Details: [authentication.md](references/authentication.md)

### Prove Your Identity to a Peer

Same workflow — you're the initiator:

1. **Get JWT token**: `POST /api/login`
2. **Request nonce**: `GET /api/holanonce16ts`
3. **Construct HOLA message** with your signature
4. **Send HOLA** to peer agent (via any transport: HTTP, QR code, etc.)
5. Peer verifies via `POST /api/identity/verify`

Details: [authentication.md](references/authentication.md)

### Verify Identity During Video Calls (QR Codes)

Use HOLA messages encoded as QR codes for real-time identity verification:

1. **Generate HOLA message** (same as above)
2. **Encode as QR code** using any QR library
3. **Display QR code** on screen during video call
4. **Peer scans QR code** with phone/device camera
5. **Peer verifies HOLA** via `POST /api/identity/verify`
6. **Confirm identity** - both parties now have cryptographic proof

Benefits: Visual confirmation, prevents man-in-the-middle attacks, works with any QR scanner

Details: See the QR code encoding documentation in the authentication reference guide

### Verify Delegated Signer Authorization

Use the delegated signer authorization endpoint to verify that a passport holder has authorized another entity (subagent, application, service) to sign on their behalf:

1. **Get JWT token**: `POST /api/login`
2. **Prepare authorization request** with:
   - `tokenId` - Passport holder's token ID (12 lowercase letters)
   - `base64HashOrDelegateSignerId` - Unique identifier or BLAKE3 hash for the delegated signer (1-2048 chars)
   - `unixTimestamp` - When authorization was granted (identifies which historical key to use)
   - `publicKey` - Delegated signer's Ed25519 public key (base64url-encoded)
   - `signature` - Ed25519 signature by passport holder proving authorization (base64url-encoded)
3. **Verify authorization**: `POST /api/isauthorizedsigner` (requires JWT)
4. **Response** includes authorization status, checks, and failure reasons

**Signature Message Format:**
```
{tokenId}:{base64HashOrDelegateSignerId}:{unixTimestamp}:{publicKey}
```

**Use Cases:**
- Verify HOLA messages signed by subagents
- Validate DID documents with delegated keys
- Build multi-level authorization chains

**Critical:** Agents are responsible for implementing revocation, scoping, permissions, and expiration mechanisms. The endpoint provides only cryptographic verification.

**Standardized Canonicalization & Hashing:**

When using BLAKE3 hashes for `base64HashOrDelegateSignerId`, use this standardized function to ensure consistency across all agents:

```javascript
/**
 * Canonicalize JSON and compute BLAKE3 hash (base64url-encoded)
 * This ensures consistent hashing across all implementations
 *
 * @param {Object} jsonData - The JSON object to canonicalize and hash
 * @returns {string} - Base64url-encoded BLAKE3 hash of canonicalized JSON
 */
function canonicalizeAndHash(jsonData) {
  const crypto = require('crypto');

  // Step 1: Canonicalize JSON (RFC 8785)
  // - Sort keys alphabetically
  // - Remove whitespace
  // - No trailing commas
  const canonicalJson = JSON.stringify(jsonData, Object.keys(jsonData).sort(), 0);

  // Step 2: Compute BLAKE3 hash
  // BLAKE3 is fast, secure, and produces consistent 32-byte hashes
  const hashBuffer = crypto.createHash('blake3').update(canonicalJson).digest();

  // Step 3: Encode as base64url (RFC 4648 Section 5)
  // Replace + with -, / with _, and remove trailing =
  const base64url = hashBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return base64url;
}

// Usage example with subagent metadata
const subagentMetadata = {
  schema: "openclaw.identity_meta.v1",
  context: "urn:openclaw:identity:2026",
  id: "did:openclaw:subagent123:session456:msg789",
  agent: {
    did: "did:openclaw:subagent123",
    publicKey: "base64url-encoded-subagent-public-key",
    type: "subagent"
  },
  metadata: {
    expiresAt: "2027-12-31T23:59:59Z",
    permissions: ["sign_hola", "read_data"],
    scope: "customer-service"
  }
};

const metadataHash = canonicalizeAndHash(subagentMetadata);
// Use this hash as the base64HashOrDelegateSignerId parameter in /api/isauthorizedsigner
```

**Why this matters:** Different canonicalization methods produce different hashes. If agents use different approaches, the same subagent metadata will generate different hashes, breaking authorization verification. This standardized function ensures all agents produce identical hashes for identical metadata.

Details: See the delegated signer authorization documentation in the authentication reference guide

### Resolve DID from Token ID

Public endpoint (no authentication required):

```bash
GET /.well-known/did/resolve?token_id={tokenId}
```

Returns DID document for the RODiT token.

### Decode Facial Features from Token ID

Token IDs encode 11 facial categories + checksum. Each character represents a facial feature category.

See [token-metadata.md](references/token-metadata.md) for category mappings.

### Get Token Metadata

- **Your own identity**: `GET /api/me/identity` (requires JWT)
- **Any token**: `GET /api/identity/token/{tokenId}/full` (requires JWT)
- **List all agents**: `GET /api/agents` (public, paginated)

## Authentication Decision Tree

| Goal | Use This |
|------|----------|
| Get JWT for API calls | `POST /api/login` |
| Prove identity to peer | HOLA message |
| Verify peer's HOLA | `POST /api/identity/verify` |
| Get nonce for HOLA | `GET /api/holanonce16ts` |
| Discover API | `GET /` |
| View enrollment guide | `GET /.well-known/enrollment` |

See [authentication.md](references/authentication.md) for complete flows.

## Quick Example: Server Login

```bash
# 1. Get consistent timestamp
curl https://api.identyclaw.com/api/login/timestamp

# Response: {"timestamp": 1776622758, "timestamp_iso": "2026-04-19T18:19:18.000Z", ...}

# 2. Sign message: roditid + timestamp_iso
# Message to sign: "bkbvehbdcrgm2026-04-19T18:19:18.000Z"

# 3. POST /api/login with signature
curl -X POST https://api.identyclaw.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "roditid": "bkbvehbdcrgm",
    "timestamp": 1776622758,
    "roditid_base64url_signature": "YOUR_BASE64URL_SIGNATURE"
  }'

# Response: {"token": "eyJhbGc...", ...}
```

Full details: [authentication.md](references/authentication.md)

## Quick Example: HOLA Verification

```bash
# 1. Get nonce (requires JWT)
curl https://api.identyclaw.com/api/holanonce16ts \
  -H "Authorization: Bearer YOUR_JWT"

# 2. Construct HOLA message
# Format: HOLA:<recipient>:<tokenId>:<timestamp>:<noncets>:API.IDENTYCLAW.COM:<signature>:<checksum>

# 3. Verify received HOLA
curl -X POST https://api.identyclaw.com/api/identity/verify \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"hello": "HOLA:MUNDO:abcdefghijkl:2026-04-19T10:47:00.000Z:4F9A3C7E...:API.IDENTYCLAW.COM:dGVzdA...:a"}'
```

Full details: [authentication.md](references/authentication.md)

## Common Use Cases

| Use Case | Endpoints | Auth Required |
|----------|-----------|---------------|
| Enroll new agent | See [enrollment.md](references/enrollment.md) | No (blockchain) |
| Login to API | `POST /api/login` | No (this gets JWT) |
| Get your identity | `GET /api/me/identity` | Yes (JWT) |
| Verify peer agent | `POST /api/identity/verify` | Yes (JWT) |
| Verify via QR code (video call) | Generate HOLA → Encode as QR → Peer scans → `POST /api/identity/verify` | Yes (JWT) |
| Verify delegated signer authorization | `POST /api/isauthorizedsigner` | Yes (JWT) |
| Resolve DID | `GET /.well-known/did/resolve` | No |
| List agents | `GET /api/agents` | No |
| Get token metadata | `GET /api/identity/token/{tokenId}/full` | Yes (JWT) |

## References

- **[Enrollment & Setup](references/enrollment.md)** — NEAR wallet, RODiT token purchase, pricing
- **[Authentication Flows](references/authentication.md)** — API login, HOLA protocol, signatures, nonces
- **[Token Metadata](references/token-metadata.md)** — RODiT fields, DN format, facial encoding, token profiles
- **[JSON-LD Integration](references/jsonld.md)** — Semantic web mappings, DID compatibility
- **[API Reference](references/api-reference.md)** — Full endpoint listing, request/response formats

## MCP Integration

### Connect Your AI Agent Platform

IdentityClaw provides a Model Context Protocol (MCP) server for seamless integration with Claude Desktop, OpenClaw, and other AI agent platforms.

**Quick Start:**
1. Add to your client config: `"url": "https://api.identyclaw.com/mcp"`
2. Restart your client
3. Ask your AI agent about IdentityClaw resources

**Available Resources:**
- `openapi:swagger` — Complete API specification
- `guide:api` — Comprehensive API guide
- `skills:skills` — This document (core workflows)
- `guide:enrollment` — Step-by-step enrollment guide
- `guide:troubleshooting` — Common errors and solutions
- `onboarding:near` — NEAR account setup instructions
- `policy:terms`, `policy:privacy`, `policy:data-retention` — Legal documents
- And 8 more resources for complete documentation

**MCP Tools:**
- `list_resources` — Discover all available resources
- `get_resource` — Fetch specific resource by URI

**Example Prompts:**
- "What MCP resources are available from IdentityClaw?"
- "How do I authenticate with IdentityClaw?"
- "I'm getting error 035. What does it mean?"
- "Help me set up a NEAR account for RODiT"

See [references/mcp-connection-guide.md](references/mcp-connection-guide.md) for complete setup instructions.

---

## Key Concepts

### Two Authentication Types

1. **API Login** (`POST /api/login`) — Get JWT token for API access
2. **HOLA Protocol** — Prove identity to peer agents

### Rate Limits in JWT Token

The JWT token provided by the SDK includes rate limit configuration from your RODiT token metadata:

- **`max_requests`** — Maximum number of API requests allowed per time window
- **`maxrq_window`** — Time window in seconds for rate limiting

**How it works:**
1. Rate limit fields are set when you purchase your IdentityClaw Passport (RODiT token)
2. These values are configured in the token metadata during the minting process
3. When you authenticate via `POST /api/login`, the SDK retrieves your RODiT token metadata
4. The `max_requests` and `maxrq_window` fields are included in the JWT token
5. The server enforces per-user rate limiting based on these fields
6. Exceeding the limit returns a `429 RATE_LIMIT_EXCEEDED` error

**Example:** `max_requests: 1000`, `maxrq_window: 3600` = 1000 requests per hour per user

Rate limits are configured in your RODiT token metadata on the blockchain at purchase time. To change them, update your token metadata (requires token owner access).

### Token ID Structure

12 lowercase letters: 11 facial feature categories + 1 checksum

Example: `bkbvehbdcrgm` encodes skin tone, bone structure, face shape, age, eyes, eyebrows, gender, nose, lips, skin condition, hair color.

### Distinguished Name (DN)

RFC 2253-style identity format stored in RODiT token metadata.

Minimal: `NNSWF=Alice`
Full: `NNSWF=John,NSWF=Smith,ContactURI=email:example.com:john@example.com,taxRes=US`

See [token-metadata.md](references/token-metadata.md) for all attributes.

### Creature Field: Lightweight Yellow Pages

The **Creature** field in your RODiT token metadata functions as a lightweight Yellow Pages for agent discovery. Use it to indicate your profession or role so other agents can find you.

**Purpose**: Allows other agents to discover you based on your professional specialization.

**Examples**: Legal Specialist, Data Analyst, SRE Engineer, Compliance Officer, Translator, Majordomo, Research Agent, Security Auditor.

**Discovery**: Other agents use `GET /api/agents` to browse all agents and filter by creature type. Currently supports pagination; direct search is planned.

**Recommendation**: Choose a clear, descriptive profession that accurately represents your capabilities. The more specific and accurate, the better the discovery experience.

### HOLA Messages as QR Codes

HOLA handshakes can be encoded as QR codes for visual verification during video calls:

- **Encode**: Generate HOLA message, then encode as QR code using any QR library
- **Display**: Show QR code on screen during video call
- **Scan**: Peer scans with phone/device camera
- **Verify**: Peer calls `POST /api/identity/verify` with decoded HOLA message
- **Benefits**: Visual confirmation, prevents man-in-the-middle attacks, works with any QR scanner

Typical workflow: Agent A displays QR → Agent B scans → Agent B verifies → Identity confirmed

### Subagent HOLA Format (Delegated Signers)

Subagents (delegated signers authorized via `/api/isauthorizedsigner`) use a **different HOLA format** that includes their delegateID, issuer's token_id, and their public key.

**Standard HOLA Format:**
```
HOLA:<recipient>:<tokenId>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<signature>:<checksum>
```

**Subagent HOLA Format:**
```
HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<signature>:<checksum>
```

**Key Differences:**
- **Second field**: `delegateID` (your hashOrDelegateId from /api/isauthorizedsigner - DID, name, or BLAKE3 hash)
- **Third field**: `issuer_tokenId` (owner who authorized you) instead of timestamp
- **Fourth field**: `publicKey` (your base64url-encoded Ed25519 public key) instead of noncets-hex
- **Fifth field**: `ISO8601-timestamp` (shifted position)
- **Sixth field**: `noncets-hex` (shifted position, 32 uppercase hex characters)

**When to Use:**
- You are a subagent acting on behalf of an issuer (owner) who has authorized your public key
- You need to prove you are authorized by a specific issuer
- Verifier needs to validate the authorization chain via `/api/isauthorizedsigner`

**Authorization Flow:**
1. Issuer authorizes subagent's public key via `/api/isauthorizedsigner`
2. Issuer provides: tokenId, hashOrDelegateId, unixTimestamp, publicKey, signature
3. Subagent stores authorization proof (issuer's signature)
4. Subagent uses subagent HOLA format when authenticating
5. Subagent includes: delegateID, issuer's token_id, and their own public key in HOLA
6. Verifier validates authorization chain via `/api/isauthorizedsigner`

**Important Notes:**
- ⚠️ Signature is created with the SUBAGENT's private key, not the issuer's
- ⚠️ `delegateID` is the hashOrDelegateId from `/api/isauthorizedsigner` (DID, name, or BLAKE3 hash)
- ⚠️ `issuer_tokenId` identifies who authorized this subagent
- ⚠️ `publicKey` field is the SUBAGENT's public key (base64url-encoded)
- ⚠️ `noncets-hex` is 32 uppercase hex characters (from `/api/holanonce16ts`)
- ⚠️ Verifiers should use `/api/isauthorizedsigner` to validate the authorization chain

See the authentication reference guide for complete subagent HOLA format documentation with examples.

### Webhook Testing

Use the `POST /api/testhola` endpoint to test webhook delivery in development mode.

**Development Testing:**
- Sends `testhola_validation_success` event on successful HOLA validation
- Sends to both `/hooks/wake` and `/hooks/agent` endpoints
- Perfect for testing webhook infrastructure without production deployment
- Only sent in development mode

**Webhook Payload:**
```json
{
  "event": "testhola_validation_success",
  "data": {
    "peerTokenId": "abc123def456",
    "serverTokenId": "xyz789uvw012",
    "recipient": "MUNDO",
    "timestamp": "2026-04-24T18:30:00.000Z",
    "endpoint": "/api/testhola"
  }
}
```

**Webhook Endpoints:**
- `/hooks/wake` — Trigger immediate heartbeat (enqueue system event for main session)
- `/hooks/agent` — Run isolated agent task (execute background tasks with optional reply to messaging channels)

**Configuration:**
Configure your webhook URL in your RODiT token metadata (`webhook_url` field) to receive webhook events. **Note: The webhook URL is set upon purchase of the IdentyClaw Passport and cannot be changed after. Strong recommendation: Use a URL you own and control.**

**Webhook Security:**
When logging into APIs using rodit-be-auth, webhooks are digitally signed with the key pair of the server RODiT and don't need to have a HMAC secret set. The digital signature provides authentication and integrity verification.

### Verifying Webhook Signatures

Webhooks from the IdentityClaw server are digitally signed using Ed25519. To verify these signatures, extract the server's public key from the blockchain using the JWT token's `sub` field.

**Verification Process:**

1. **Extract server token ID from JWT** - The `sub` field format is `{serviceprovider_id};sub={token_id}` (e.g., `https://api.identyclaw.com;sub=aaaaaaaaaaaa`). Split on `;sub=` to get the token ID.

2. **Retrieve public key from blockchain** - Call `GET /api/identity/token/{tokenId}/full` to get the token's `owner_id` field (64-character hex string = Ed25519 public key).

3. **Convert public key to bytes** - Convert hex to Uint8Array (32 bytes) for Ed25519 verification.

4. **Extract webhook headers** - Get `X-Signature` (128 hex chars), `X-Timestamp` (Unix timestamp), and payload from the request.

5. **Recreate signed message** - Serialize payload as JSON (sorted keys, no whitespace), append timestamp, compute SHA-256 hash.

6. **Verify signature** - Use Ed25519 verification with the hash, signature bytes, and public key bytes.

7. **Verify timestamp freshness** - Ensure timestamp is recent (within 5 minutes) to prevent replay attacks.

**Quick Example (Node.js):**
```javascript
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nacl = require('tweetnacl');

// Extract token ID from JWT
const decoded = jwt.decode(jwtToken);
const serverTokenId = decoded.payload.sub.split(';sub=')[1];

// Get public key from blockchain
const response = await fetch(
  'https://api.identyclaw.com/api/identity/token/' + serverTokenId + '/full',
  { headers: { 'Authorization': 'Bearer ' + jwtToken } }
);
const tokenData = await response.json();
const publicKeyBytes = new Uint8Array(Buffer.from(tokenData.owner_id, 'hex'));

// Verify webhook signature
const signatureHex = req.headers['x-signature'];
const timestamp = req.headers['x-timestamp'];
const payloadJson = JSON.stringify(req.body, Object.keys(req.body).sort(), 0);
const hash = crypto.createHash('sha256').update(payloadJson + timestamp).digest();
const signatureBytes = new Uint8Array(Buffer.from(signatureHex, 'hex'));

const isValid = nacl.sign.detached.verify(hash, signatureBytes, publicKeyBytes);
```

**Webhook Headers:**
- `X-Signature` - Hex-encoded Ed25519 signature (128 hex characters)
- `X-Timestamp` - Unix timestamp when webhook was sent
- `X-Request-ID` - Unique request identifier for tracing

**Security Notes:**
- Cache the public key after retrieval (token public keys are immutable)
- Always verify timestamp freshness (within 5 minutes)
- Fail closed - reject webhooks with invalid signatures

Complete documentation: See the webhook signature verification guide in the authentication reference

## Limitations

### Capability Discovery is Limited to Creature Field

IdentityClaw provides **identity discovery** (finding other agents) and **limited capability discovery** via the Creature field, but detailed capability metadata is not included.

**What IdentityClaw Provides:**

- **Agent Discovery**: `GET /api/agents` lists all enrolled agents with basic metadata
- **Identity Verification**: HOLA protocol proves an agent's identity cryptographically
- **Limited Capability Discovery**: The Creature field indicates profession (e.g., "Legal Specialist", "Data Analyst", "SRE Engineer")
- **Contact Information**: Distinguished Name (DN) and ContactURI fields for reaching agents

**What IdentityClaw Does NOT Provide:**

The following OpenClaw Agent Workspace Context is NOT included in `/api/identity/token/{tokenId}/full`:

```json
{
  "tokenId": "pkncjdbdefcp",
  "dn": { ... },
  "face": { ... },
  "openclaw": {
    "workspaceUrl": "https://github.com/username/openclaw-workspace",
    "workspaceMetadata": {
      "soul": {
        "name": "Codey",
        "vibe": "Technical but approachable",
        "emoji": "🦊"
      },
      "capabilities": ["coding", "debugging", "code-review"],
      "tools": ["read", "write", "exec", "git"],
      "rateLimit": {
        "tier": "medium",
        "maxRequestsPerMinute": 500
      }
    },
    "lastActive": "2026-04-25T10:00:00Z"
  }
}
```

**Why This Matters:**

OpenClaw agents need this metadata to:
- Know what tools an agent supports before spawning
- Understand an agent's capabilities and specialization
- Determine personality/vibe for task matching
- Check rate limits before making requests
- Discover workspace URLs for direct integration

**Current Discovery Workflow:**

1. **Find agents** via IdentityClaw (`GET /api/agents`)
2. **Verify identity** via HOLA protocol
3. **Discover basic capabilities** via Creature field (profession-level classification only)
4. **Discover detailed capabilities** via out-of-band communication (direct contact, external directory, agent's own documentation)
5. **Establish trust** based on identity verification + capability discovery

**Creature Field Limitations:**

The Creature field provides profession-level granularity only (e.g., "Legal Specialist", "Data Analyst", "SRE Engineer"). Agents can filter by creature type via `GET /api/agents`, but this does not include:
- Specific tools supported
- Detailed capabilities or specializations
- Personality/vibe for task matching
- Rate limits or performance characteristics
- Workspace URLs for direct integration

**Future Considerations:**

Directory service capabilities may be added in future versions to include workspace metadata, but this is not currently part of the IdentityClaw specification.

## Pricing & Tier Selection

IdentityClaw uses a **NEAR-based pricing model** with three tiers. Choose based on your needs:

### Personal Tier (0.066-1.92 NEAR)

**Best for**: Individual agents, testing, MVPs

| Duration | Cost | Use Case |
|----------|------|----------|
| 30 days | 0.066 NEAR | Quick testing |
| 90 days | 0.22 NEAR | MVP validation |
| 365 days | ~1.92 NEAR | Production agent |

**Rate limits**: 48 requests per minute

### Enterprise Tier (148-1,806 NEAR/year)

**Best for**: High-traffic SaaS, large deployments

| Duration | Cost | Use Case |
|----------|------|----------|
| 30 days | ~148 NEAR | Pilot program |
| 365 days | 1,806 NEAR | Full-year deployment |

**Rate limits**: 4,999 requests per minute  
**Note**: Pricing is negotiable for volume deployments. Contact sales.

### Collectible Tier (496 NEAR one-time)

**Best for**: Permanent identity records, collectibles

- **Cost**: 496 NEAR (one-time, never expires)
- **Rate limits**: 496 requests per minute
- **Immortal**: Token never expires

### How to Choose

1. **Testing?** → Start with Personal 30-day (0.066 NEAR)
2. **Production?** → Personal 365-day (~1.92 NEAR) or Enterprise
3. **Permanent record?** → Collectible (496 NEAR one-time)

**For pricing philosophy and detailed cost calculations, see:**
- `public/policies/why-identyclaw.md` - Why this pricing model
- `references/pricing-philosophy.md` - Complete technical details
