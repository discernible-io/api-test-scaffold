# Authentication Flows

Complete guide to IdentityClaw authentication mechanisms: API login and HOLA protocol.

## Table of Contents

- [Overview](#overview)
- [API Login (Server Authentication)](#api-login-server-authentication)
- [HOLA Protocol (Peer-to-Peer)](#hola-protocol-peer-to-peer)
- [Comparison Table](#comparison-table)
- [Common Pitfalls](#common-pitfalls)

## Overview

IdentityClaw provides two authentication mechanisms:

1. **API Login** - Authenticate with the API server to get a JWT token
2. **HOLA Protocol** - Prove your identity to peer agents (requires JWT)

## API Login (Server Authentication)

Get a JWT token to access protected API endpoints.

### When to Use

- You need to access protected endpoints
- You want to get your own identity (`/api/me/identity`)
- You need to request nonces (`/api/holanonce16ts`)
- You want to verify HOLA messages from other agents
- **This is your FIRST step** - you need a JWT before doing anything else

### Flow Diagram

```
1. GET /api/login/timestamp → {timestamp, timestamp_iso}
2. Sign message: roditid + timestamp_iso
3. POST /api/login → {token: "eyJhbGc..."}
4. Use JWT in Authorization header for protected endpoints
```

### Step 1: Get Consistent Timestamp

**Endpoint**: `GET /api/login/timestamp` (public, no auth required)

```bash
curl https://api.identyclaw.com/api/login/timestamp
```

**Response**:
```json
{
  "timestamp": 1776622758,
  "timestamp_iso": "2026-04-19T18:19:18.000Z",
  "nonce": "dGVzdG5vbmNl...",
  "purpose": "Use for /api/login authentication",
  "requestId": "01HQXYZ..."
}
```

⚠️ **CRITICAL**: Both `timestamp` and `timestamp_iso` are generated from the same moment. Use BOTH values from this response.

### Step 2: Sign the Message

**Message to sign** (UTF-8 bytes):
```
roditid + timestamp_iso
```

**Example**:
- RODiT ID: `bkbvehbdcrgm`
- timestamp_iso: `2026-04-19T18:19:18.000Z`
- **Message**: `bkbvehbdcrgm2026-04-19T18:19:18.000Z` (no separators, literal concatenation)

**Signing Steps**:

1. Extract your NEAR private key from credentials file
2. Decode from base58 to get 64-byte keypair
3. Extract first 32 bytes (secret key)
4. Sign message with Ed25519
5. Encode signature as base64url (URL-safe base64: `-` and `_` instead of `+` and `/`, no padding `=`)

**JavaScript Example**:

```javascript
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const fs = require('fs');

// 1. Load credentials
const creds = JSON.parse(fs.readFileSync('~/.near-credentials/mainnet/your-account.json'));
const privateKeyBase58 = creds.private_key.replace('ed25519:', '');

// 2. Decode keypair
const keypair = bs58.decode(privateKeyBase58);
const secretKey = keypair.slice(0, 32);

// 3. Sign message
const message = 'bkbvehbdcrgm2026-04-19T18:19:18.000Z';
const messageBytes = Buffer.from(message, 'utf8');
const signature = nacl.sign.detached(messageBytes, secretKey);

// 4. Encode as base64url
const base64url = Buffer.from(signature)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '');

console.log(base64url);
```

**Python Example**:

```python
from nacl.signing import SigningKey
import base58
import json

# 1. Load credentials
with open('~/.near-credentials/mainnet/your-account.json') as f:
    creds = json.load(f)
private_key_base58 = creds['private_key'].replace('ed25519:', '')

# 2. Decode keypair
keypair = base58.b58decode(private_key_base58)
secret_key = keypair[:32]

# 3. Sign message
signing_key = SigningKey(secret_key)
message = b'bkbvehbdcrgm2026-04-19T18:19:18.000Z'
signature = signing_key.sign(message).signature

# 4. Encode as base64url
base64url = base64.b64encode(signature).decode('utf-8') \
    .replace('+', '-') \
    .replace('/', '_') \
    .replace('=', '')

print(base64url)
```

### Step 3: POST /api/login

**Endpoint**: `POST /api/login` (public, no auth required)

**Request**:
```bash
curl -X POST https://api.identyclaw.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "roditid": "bkbvehbdcrgm",
    "timestamp": 1776622758,
    "roditid_base64url_signature": "YOUR_BASE64URL_SIGNATURE"
  }'
```

**Response** (success):
```json
{
  "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**Response** (error):
```json
{
  "statusCode": 401,
  "code": "SIGNATURE_VERIFICATION_FAILED_035",
  "message": "Signature verification failed",
  "details": {
    "reason": "Timestamp mismatch - signed ISO string doesn't match provided timestamp"
  }
}
```

### Step 4: Use JWT Token

Include JWT in `Authorization` header for protected endpoints:

```bash
curl https://api.identyclaw.com/api/me/identity \
  -H "Authorization: Bearer eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."
```

---

## HOLA Protocol (Peer-to-Peer)

Prove your identity to another agent using cryptographic signatures.

### When to Use

- You need to prove your identity to another agent
- You want to establish trust with a peer agent
- You're implementing agent-to-agent communication
- You need decentralized verification without server trust decisions
- **You ALREADY have a JWT token** from `/api/login`

### Flow Diagram

```
Agent A (Initiator):
1. POST /api/login → Get JWT
2. GET /api/holanonce16ts → Get nonce
3. Construct HOLA message with signature
4. Send HOLA to Agent B

Agent B (Verifier):
5. POST /api/login → Get JWT (if not already authenticated)
6. POST /api/identity/verify → Verify Agent A's HOLA
7. Trust established
```

### HOLA Message Format

**Structure**:
```
HOLA/<recipient>/<tokenId>/<ISO8601-timestamp>/<noncets-hex>/API.IDENTYCLAW.COM/<base64url-signature>/<checksum>
```

**Components**:

| Field | Description | Example |
|-------|-------------|---------|
| `HOLA/` | Protocol identifier | `HOLA/` |
| `recipient` | Intended recipient (default: MUNDO) | `MUNDO` or `abcdefghijkl` |
| `tokenId` | Sender's RODiT token ID (12 lowercase letters) | `bkbvehbdcrgm` |
| `timestamp` | ISO 8601 timestamp | `2026-04-19T10:47:00.000Z` |
| `noncets-hex` | 32 hex characters (16 bytes) from `/api/holanonce16ts` | `4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE` |
| `API.IDENTYCLAW.COM` | Domain identifier | `API.IDENTYCLAW.COM` |
| `signature` | base64url-encoded Ed25519 signature | `dGVzdHNpZ25hdHVyZQ` |
| `checksum` | Single hex character (0-F) | `a` |

**Example HOLA Message**:
```
HOLA/MUNDO/bkbvehbdcrgm/2026-04-19T10:47:00.000Z/4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE/API.IDENTYCLAW.COM/dGVzdHNpZ25hdHVyZQ/a
```

### Step 1: Get JWT Token

See [API Login](#api-login-server-authentication) above.

### Step 2: Request Nonce

**Endpoint**: `GET /api/holanonce16ts` (requires JWT)

```bash
curl https://api.identyclaw.com/api/holanonce16ts \
  -H "Authorization: Bearer YOUR_JWT"
```

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

**Extract nonce hex**: Parse the second part after the colon: `4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE`

⚠️ **Use the hex string verbatim** - do not uppercase/lowercase it.

### Step 3: Construct HOLA Message

**Message to sign** (everything before the signature field):
```
HOLA/<recipient>/<tokenId>/<timestamp>/<noncets-hex>/API.IDENTYCLAW.COM/
```

**Example**:
```
HOLA/MUNDO/bkbvehbdcrgm/2026-04-19T10:47:00.000Z/4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE/API.IDENTYCLAW.COM/
```

**Signing** (same process as API login):
1. Convert message to UTF-8 bytes
2. Sign with Ed25519 secret key
3. Encode as base64url

**Checksum Calculation**:
```javascript
// Sum ASCII values of all characters before checksum
let sum = 0;
for (let i = 0; i < message.length; i++) {
  sum += message.charCodeAt(i);
}
const checksum = (sum % 16).toString(16); // Single hex digit
```

**Final HOLA**:
```
HOLA/MUNDO/bkbvehbdcrgm/2026-04-19T10:47:00.000Z/4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE/API.IDENTYCLAW.COM/dGVzdHNpZ25hdHVyZQ/a
```

### Step 4: Send HOLA to Peer

Transmit the HOLA message to the peer agent via your communication channel (HTTP, WebSocket, etc.).

### Step 5: Verify HOLA (Peer Agent)

**Endpoint**: `POST /api/identity/verify` (requires JWT)

```bash
curl -X POST https://api.identyclaw.com/api/identity/verify \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "hello": "HOLA/MUNDO/bkbvehbdcrgm/2026-04-19T10:47:00.000Z/4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE/API.IDENTYCLAW.COM/dGVzdHNpZ25hdHVyZQ/a"
  }'
```

**Response** (success):
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

**Response** (failure):
```json
{
  "valid": false,
  "statusCode": 400,
  "code": "HELLO_SIGNATURE_INVALID",
  "message": "HOLA signature verification failed",
  "details": {
    "checksumValid": true,
    "signatureValid": false,
    "nonceValid": true
  }
}
```

---

## Comparison Table

| Feature | API Login | HOLA Protocol |
|---------|-----------|---------------|
| **Purpose** | Authenticate with API server | Prove identity to peer agent |
| **Endpoint** | `POST /api/login` | `POST /api/identity/verify` |
| **Message Format** | `roditid + timestamp_iso` | `HOLA/<recipient>/<tokenId>/...` |
| **Signed Content** | `roditid + timestamp_iso` | `HOLA/<recipient>/<tokenId>/<timestamp>/<noncets>/API.IDENTYCLAW.COM/` |
| **Result** | JWT token | Cryptographic proof of identity |
| **Requires JWT?** | No (this gets the JWT) | Yes (need JWT to request nonces) |
| **Nonce Required?** | No (only timestamp) | Yes (from `/api/holanonce16ts`) |
| **Checksum?** | No | Yes (hex checksum at end) |
| **Used For** | Server endpoint access | Agent-to-agent trust |

---

## Common Pitfalls

### API Login Errors

❌ **Using different timestamps for signing vs payload**
- **Problem**: Calling `/api/login/timestamp` at time T1, then generating new timestamp at T2
- **Solution**: Use BOTH `timestamp` and `timestamp_iso` from the same `/api/login/timestamp` response

❌ **Signing with wrong timestamp format**
- **Problem**: Signing with Unix timestamp instead of ISO string
- **Solution**: Sign with `timestamp_iso` (e.g., `2026-04-19T18:19:18.000Z`)

❌ **Using millisecond precision**
- **Problem**: Timestamp in milliseconds (13 digits) instead of seconds (10 digits)
- **Solution**: Use `Math.floor(Date.now() / 1000)` for Unix seconds

❌ **Wrong signature encoding**
- **Problem**: Using standard base64 instead of base64url
- **Solution**: Replace `+` with `-`, `/` with `_`, remove `=` padding

❌ **Wrong Content-Type**
- **Problem**: Missing or incorrect Content-Type header
- **Solution**: Always use `Content-Type: application/json`

### HOLA Protocol Errors

❌ **Missing recipient field**
- **Problem**: Signing `HOLA/<tokenId>/...` without recipient
- **Solution**: Include recipient (default: `MUNDO`): `HOLA/MUNDO/<tokenId>/...`

❌ **Using wrong nonce**
- **Problem**: Using nonce from `/api/login/timestamp` (32 bytes) instead of `/api/holanonce16ts` (16 bytes)
- **Solution**: Always use `/api/holanonce16ts` for HOLA messages

❌ **Modifying nonce hex case**
- **Problem**: Uppercasing or lowercasing the nonce hex string
- **Solution**: Use the nonce hex string verbatim from `/api/holanonce16ts`

❌ **Wrong checksum calculation**
- **Problem**: Using cryptographic hash instead of simple sum
- **Solution**: Sum ASCII values, modulo 16, convert to hex digit

❌ **Expired nonce**
- **Problem**: Using nonce that's too old
- **Solution**: Request fresh nonce from `/api/holanonce16ts` before each HOLA

### General Errors

❌ **Token doesn't belong to account**
- **Problem**: RODiT token owner_id doesn't match your NEAR account
- **Solution**: Verify token ownership with `near contract call-function as-read-only rodit.near nft_token`

❌ **Token expired**
- **Problem**: Token's `not_after` date has passed
- **Solution**: Check token metadata, mint new token if expired

❌ **Wrong network**
- **Problem**: Using testnet credentials on mainnet (or vice versa)
- **Solution**: Verify network configuration matches your token's network

---

## Next Steps

- [Understand token metadata](token-metadata.md)
- [Explore API endpoints](api-reference.md)
- [View JSON-LD integration](jsonld.md)
- [Test with /api/testhola](https://api.identyclaw.com/docs)
