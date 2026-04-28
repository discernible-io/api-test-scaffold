# Agent Configuration Examples

Complete examples for configuring AI agents to use IdentityClaw API for identity verification, DID resolution, and agent discovery.

---

## Claude Desktop Configuration

### Basic Configuration

**File:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

```json
{
  "mcpServers": {
    "identyclaw": {
      "url": "https://api.identyclaw.com/mcp",
      "description": "IdentityClaw - RODiT token identity verification and DID resolution"
    }
  }
}
```

### Production Configuration with Multiple Instances

```json
{
  "mcpServers": {
    "identyclaw-mainnet": {
      "url": "https://api.identyclaw.com/mcp",
      "description": "IdentityClaw Mainnet - Production RODiT tokens"
    },
    "identyclaw-testnet": {
      "url": "https://testnet.identyclaw.com/mcp",
      "description": "IdentityClaw Testnet - Development and testing"
    },
    "identyclaw-local": {
      "url": "http://localhost:3000/mcp",
      "description": "Local IdentityClaw instance for development"
    }
  }
}
```

---

## Agent Prompt Examples

Use these prompts to configure your AI agent's system instructions for working with IdentityClaw.

### Example 1: Legal Document Verification Agent

**System Prompt:**

```
You are a Legal Document Verification Agent specializing in cryptographic identity verification.

Your capabilities:
1. Verify the identity of legal professionals using IdentityClaw's HOLA protocol
2. Resolve DID documents to confirm credentials
3. Ensure document signatories are authentic RODiT token holders
4. Maintain an audit trail of all identity verifications

When a user asks you to verify a legal professional's identity:
1. Fetch the IdentityClaw API guide using MCP
2. Request the professional's RODiT token ID
3. Call GET /api/identity/token/{tokenId}/full to retrieve their identity
4. Verify their facial encoding matches their claimed profession
5. Generate a verification report with timestamp and signature

Always prioritize security and accuracy. Never skip identity verification steps.

Available MCP resources:
- openapi:swagger - Complete API specification
- guide:api - Comprehensive API guide
- skills:skills - Core workflows
- guide:troubleshooting - Common errors and solutions
```

### Example 2: Multi-Agent Collaboration Coordinator

**System Prompt:**

```
You are a Multi-Agent Collaboration Coordinator that facilitates secure communication between AI agents.

Your responsibilities:
1. Discover available agents using the IdentityClaw agent registry
2. Establish trust between agents using HOLA handshakes
3. Verify agent credentials before allowing collaboration
4. Maintain a trust graph of verified agent relationships

When coordinating between agents:
1. Fetch the agent list from GET /api/agents (public endpoint)
2. For each agent, resolve their DID using GET /.well-known/did/resolve
3. Request HOLA handshake from initiating agent
4. Verify the HOLA message using POST /api/identity/verify
5. Confirm both agents are authentic before enabling collaboration

Use IdentityClaw MCP resources to:
- Understand authentication flows (skills:skills)
- Troubleshoot verification issues (guide:troubleshooting)
- Access the complete API specification (openapi:swagger)

Trust is earned through cryptographic verification, not assumptions.
```

### Example 3: Data Analyst with Secure Access Control

**System Prompt:**

```
You are a Data Analyst Agent with secure access control based on verified identities.

Your capabilities:
1. Verify analyst credentials using IdentityClaw RODiT tokens
2. Grant access to datasets based on verified roles and permissions
3. Audit all data access with cryptographic proof of identity
4. Enforce geolocation and time-based access restrictions

Before granting data access:
1. Request the analyst's RODiT token ID
2. Call GET /api/identity/token/{tokenId}/full to verify their identity
3. Check their "creature" field (profession/role) against required permissions
4. Verify their geolocation is allowed (if applicable)
5. Log the access with timestamp and signature

Available resources:
- guide:api - Understand all endpoints and their requirements
- skills:skills - Learn the authentication workflow
- guide:troubleshooting - Handle common verification errors

All data access is logged and auditable. Compliance is non-negotiable.
```

### Example 4: Research Collaboration Network

**System Prompt:**

```
You are a Research Collaboration Network Agent that connects researchers securely.

Your role:
1. Maintain a registry of verified researchers using IdentityClaw
2. Facilitate secure collaboration on research projects
3. Ensure all collaborators are authenticated before sharing sensitive research
4. Generate collaboration certificates with cryptographic proof

When a researcher joins your network:
1. Request their RODiT token ID
2. Verify their identity using GET /api/identity/token/{tokenId}/full
3. Check their creature field for research specialization
4. Add them to the collaboration network with verified status
5. Issue a collaboration certificate signed with your agent's HOLA

For inter-agent collaboration:
1. Fetch the other agent's DID using GET /.well-known/did/resolve
2. Initiate HOLA handshake to establish trust
3. Verify their identity using POST /api/identity/verify
4. Exchange research collaboration agreements
5. Log all interactions with cryptographic proof

Use MCP resources to:
- Understand the HOLA protocol (skills:skills)
- Troubleshoot verification issues (guide:troubleshooting)
- Access endpoint documentation (openapi:swagger)

Research integrity depends on verified identities and transparent collaboration.
```

---

## Configuration for Different Agent Types

### Autonomous Agent Configuration

For agents that operate independently without human supervision:

```json
{
  "mcpServers": {
    "identyclaw": {
      "url": "https://api.identyclaw.com/mcp",
      "description": "IdentityClaw - Identity verification for autonomous operations"
    }
  },
  "agentConfig": {
    "type": "autonomous",
    "identityVerification": {
      "required": true,
      "method": "HOLA",
      "trustThreshold": "cryptographic"
    },
    "permissions": {
      "canInitiateHandshakes": true,
      "canVerifyPeers": true,
      "canAccessAgentRegistry": true
    }
  }
}
```

### Supervised Agent Configuration

For agents that require human approval for sensitive operations:

```json
{
  "mcpServers": {
    "identyclaw": {
      "url": "https://api.identyclaw.com/mcp",
      "description": "IdentityClaw - Identity verification with human oversight"
    }
  },
  "agentConfig": {
    "type": "supervised",
    "identityVerification": {
      "required": true,
      "method": "HOLA",
      "requiresHumanApproval": true
    },
    "permissions": {
      "canInitiateHandshakes": true,
      "canVerifyPeers": true,
      "canAccessAgentRegistry": true,
      "requiresApprovalFor": ["dataAccess", "collaboration", "credentialGrant"]
    }
  }
}
```

### Specialized Service Agent Configuration

For agents providing specific services (legal, compliance, security, etc.):

```json
{
  "mcpServers": {
    "identyclaw": {
      "url": "https://api.identyclaw.com/mcp",
      "description": "IdentityClaw - Specialized service verification"
    }
  },
  "agentConfig": {
    "type": "service",
    "specialization": "legal",
    "identityVerification": {
      "required": true,
      "method": "HOLA",
      "verifyClientCredentials": true
    },
    "permissions": {
      "canVerifyClientIdentity": true,
      "canAccessClientDID": true,
      "canIssueVerificationCertificates": true
    },
    "auditRequirements": {
      "logAllInteractions": true,
      "requireTimestamps": true,
      "requireSignatures": true
    }
  }
}
```

---

## Subagent Configuration

### Experimental DID-Style ID for Subagents

When creating subagents, consider using this highly experimental DID-style ID structure. This JSON can be easily canonicalized and digitally signed by the parent agent, enabling:

- **Subagent key pair**: Used to sign HOLA messages
- **Parent key**: Validates the parent's vouching for the subagent's DID

**Recommended DID Structure:**

```json
{
  "schema": "openclaw.identity_meta.v1",
  "context": "urn:openclaw:identity:2026",
  "id": "did:openclaw:<agentId>:<sessionId>:<messageId>",
  "messageId": "<messageId>",
  "parent": {
    "parentId": "did:openclaw:<parentAgentId>",
    "facialId": "<parent-agent-identifier>",
    "sessionKey": "<sessionKey>",
    "sessionId": "<sessionId>"
  },
  "agent": {
    "did": "did:openclaw:<agentId>",
    "publicKey": "<publicKey>",
    "keyId": "key-1",
    "type": "subagent|acp|main"
  },
  "sender": {
    "id": "<SenderId>",
    "name": "<SenderName>",
    "username": "<SenderUsername>",
    "e164": "<SenderE164>",
    "tag": "<SenderTag>"
  },
  "replyTo": {
    "id": "<ReplyToId>",
    "sender": "<ReplyToSender>",
    "body": "<ReplyToBody>",
    "isQuote": "<ReplyToIsQuote>"
  },
  "forwardedFrom": {
    "from": "<ForwardedFrom>",
    "type": "<ForwardedFromType>",
    "id": "<ForwardedFromId>",
    "username": "<ForwardedFromUsername>",
    "title": "<ForwardedFromTitle>",
    "signature": "<ForwardedFromSignature>",
    "chatType": "<ForwardedFromChatType>",
    "messageId": "<ForwardedFromMessageId>",
    "date": <ForwardedDate>
  },
  "timestamp": <epoch>,
  "channel": {
    "id": "<channelId>",
    "accountId": "<accountId>",
    "provider": "<provider>"
  }
}
```

**Design Rationale:**

JSON is used for the subagent DID structure because it is easier to canonicalize for digital signatures compared to other formats. This is necessary when the issuing agent wants to include in the signature not just the subagent ID, but also the entire subagent metadata. This metadata can include:

- **Lifespan constraints**: How long the agent is authorized to exist
- **Authorization scope**: What the agent is authorized to do (permissions, capabilities)
- **Delegation limits**: Specific restrictions on the subagent's actions
- **Context information**: Session details, channel context, or other operational metadata

By signing the entire JSON document, the parent agent cryptographically vouches for all aspects of the subagent's identity and authorization, not just its identifier. This enables:
- Rich metadata encoding in a verifiable way
- Complex authorization policies embedded in the DID itself
- Tamper-evident delegation records
- Future extensibility without breaking the signature format

**Integration with /api/isauthorizedsigner:**

The BLAKE3 hash of the canonicalized subagent metadata can be used as the `hashOrDelegateId` parameter in the `/api/isauthorizedsigner` endpoint. This workflow enables verification that the parent agent authorized a specific subagent with specific metadata:

1. **Parent agent canonicalizes** the subagent DID JSON (RFC 8785)
2. **Parent computes BLAKE3 hash** of the canonicalized JSON
3. **Parent signs the authorization message**: `{tokenId}:{hash}:{unixTimestamp}:{publicKey}`
4. **Subagent or verifier calls** `/api/isauthorizedsigner` with:
   - `tokenId`: Parent's RODiT token ID
   - `hashOrDelegateId`: The BLAKE3 hash of the subagent metadata
   - `publicKey`: Subagent's public key
   - `unixTimestamp`: When the authorization was granted
   - `signature`: Parent's signature over the message
5. **IDClawserver verifies**:
   - The signature was created by the parent's private key (from blockchain history)
   - The hash matches the canonicalized subagent metadata provided
   - The public key is authorized for that specific metadata hash

This approach ensures that the authorization is tied to the exact subagent configuration, not just an identifier. If the metadata changes (e.g., expiration date, permissions), the hash changes, and the authorization becomes invalid.

**Example Workflow:**

```javascript
const crypto = require('crypto');
const { BLAKE3 } = require('@noble/hashes/blake3');

// 1. Canonicalize subagent DID
function canonicalize(json) {
  return JSON.stringify(json, Object.keys(json).sort());
}

// 2. Compute BLAKE3 hash
function computeBlake3Hash(canonicalJson) {
  const hash = BLAKE3(canonicalJson);
  return hash; // Returns 32-byte hash
}

// 3. Parent authorizes subagent
const subagentDID = {
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

const canonical = canonicalize(subagentDID);
const metadataHash = computeBlake3Hash(canonical); // BLAKE3 hash

// 4. Parent signs authorization
const authMessage = `${parentTokenId}:${metadataHash}:${unixTimestamp}:${subagentPublicKey}`;
const signature = Ed25519.sign(authMessage, parentPrivateKey);

// 5. Verify via /api/isauthorizedsigner
const response = await axios.post('https://api.identyclaw.com/api/isauthorizedsigner', {
  tokenId: parentTokenId,
  hashOrDelegateId: metadataHash, // BLAKE3 hash of metadata
  publicKey: subagentPublicKey,
  unixTimestamp: unixTimestamp,
  signature: signature
});
```

**Canonicalization and Signing:**

1. **Canonicalize**: Use JSON canonicalization (RFC 8785) - sort keys alphabetically, remove whitespace
2. **Sign with Parent Key**: Parent signs the canonicalized JSON to vouch for the subagent
3. **Subagent Signs HOLA**: Subagent uses its own key pair to sign HOLA messages
4. **Verification Chain**: 
   - Verify subagent's HOLA signature with subagent's public key
   - Verify parent's signature on DID document with parent's public key
   - Establish trust chain: Parent → Subagent → HOLA Message

**Implementation Example (Node.js):**

```javascript
const crypto = require('crypto');

function canonicalize(json) {
  return JSON.stringify(json, Object.keys(json).sort());
}

function signCanonicalJson(json, privateKey) {
  const canonical = canonicalize(json);
  return crypto.sign(null, Buffer.from(canonical), privateKey).toString('base64url');
}

// Parent creates and signs subagent DID
const subagentDID = {
  schema: "openclaw.identity_meta.v1",
  context: "urn:openclaw:identity:2026",
  id: "did:openclaw:subagent123:session456:msg789",
  messageId: "msg789",
  parent: {
    parentId: "did:openclaw:parentAgent123",
    facialId: "parent-facial-id",
    sessionKey: "session-key-abc",
    sessionId: "session456"
  },
  agent: {
    did: "did:openclaw:subagent123",
    publicKey: "base64url-encoded-subagent-public-key",
    keyId: "key-1",
    type: "subagent"
  },
  timestamp: Date.now(),
  channel: {
    id: "channel-123",
    accountId: "account-456",
    provider: "openclaw"
  }
};

// Parent signs the DID document
const parentSignature = signCanonicalJson(subagentDID, parentPrivateKey);

// Subagent signs HOLA with its own key
const holaMessage = `HOLA-MUNDO-${subagentTokenId}-${timestamp}-${noncetsHex}-API.IDENTYCLAW.COM-`;
const subagentHolaSignature = Ed25519.sign(holaMessage, subagentPrivateKey);
```

**Benefits:**

- **Cryptographic Trust Chain**: Parent vouches for subagent identity
- **Revocability**: Parent can revoke by maintaining a revocation list
- **Delegation**: Clear parent-child relationship encoded in DID
- **Audit Trail**: Full history of delegation events
- **Interoperability**: DID format compatible with decentralized identity standards

**⚠️ Experimental Status:**

This is a highly experimental approach. Consider:
- No standardized validation rules yet
- Parent must maintain revocation lists
- Requires careful key management
- Canonicalization must be consistent across all implementations

---

## Environment Configuration

### Development Environment

**`.env.development`:**

```bash
# IdentityClaw Configuration
IDENTYCLAW_API_URL=http://localhost:3000
IDENTYCLAW_MCP_URL=http://localhost:3000/mcp

# Agent Identity
AGENT_RODIT_TOKEN_ID=your_dev_token_id
AGENT_PRIVATE_KEY_PATH=./credentials/dev-key.json

# Logging
LOG_LEVEL=debug
LOG_MCP_CALLS=true

# Development Flags
SKIP_SIGNATURE_VERIFICATION=false
ALLOW_SELF_SIGNED_CERTS=true
```

### Production Environment

**`.env.production`:**

```bash
# IdentityClaw Configuration
IDENTYCLAW_API_URL=https://api.identyclaw.com
IDENTYCLAW_MCP_URL=https://api.identyclaw.com/mcp

# Agent Identity
AGENT_RODIT_TOKEN_ID=your_prod_token_id
AGENT_PRIVATE_KEY_PATH=/secure/credentials/prod-key.json

# Logging
LOG_LEVEL=info
LOG_MCP_CALLS=false

# Security
SKIP_SIGNATURE_VERIFICATION=false
ALLOW_SELF_SIGNED_CERTS=false
REQUIRE_HTTPS=true

# Rate Limiting
MCP_RATE_LIMIT=100
API_RATE_LIMIT=1000
```

---

## Integration Code Examples

### Example 1: Initialize IdentityClaw Client in Node.js

```javascript
// identyclaw-client.js
const axios = require('axios');
const { Ed25519 } = require('@rodit/rodit-auth-be');

class IdentyClawClient {
  constructor(config) {
    this.apiUrl = config.apiUrl || 'https://api.identyclaw.com';
    this.tokenId = config.tokenId;
    this.privateKey = config.privateKey;
    this.jwtToken = null;
  }

  async login() {
    // Get timestamp
    const timestampRes = await axios.get(`${this.apiUrl}/api/login/timestamp`);
    const { timestamp_iso } = timestampRes.data;

    // Sign message
    const message = `${this.tokenId}${timestamp_iso}`;
    const signature = Ed25519.sign(message, this.privateKey);

    // Login
    const loginRes = await axios.post(`${this.apiUrl}/api/login`, {
      roditid: this.tokenId,
      timestamp: timestamp_iso,
      roditid_base64url_signature: signature
    });

    this.jwtToken = loginRes.data.jwt_token;
    return this.jwtToken;
  }

  async verifyPeerIdentity(peerHola) {
    if (!this.jwtToken) await this.login();

    const response = await axios.post(
      `${this.apiUrl}/api/identity/verify`,
      { hello: peerHola },
      { headers: { Authorization: `Bearer ${this.jwtToken}` } }
    );

    return response.data;
  }

  async getAgentIdentity(tokenId) {
    if (!this.jwtToken) await this.login();

    const response = await axios.get(
      `${this.apiUrl}/api/identity/token/${tokenId}/full`,
      { headers: { Authorization: `Bearer ${this.jwtToken}` } }
    );

    return response.data;
  }

  async listAgents(limit = 50) {
    const response = await axios.get(
      `${this.apiUrl}/api/agents?limit=${limit}`
    );
    return response.data;
  }
}

module.exports = IdentyClawClient;
```

### Example 2: Use IdentityClaw in Claude Agent

```javascript
// claude-identyclaw-integration.js
const Anthropic = require('@anthropic-ai/sdk');
const IdentyClawClient = require('./identyclaw-client');

const client = new Anthropic();
const identyclaw = new IdentyClawClient({
  apiUrl: 'https://api.identyclaw.com',
  tokenId: process.env.AGENT_RODIT_TOKEN_ID,
  privateKey: require(process.env.AGENT_PRIVATE_KEY_PATH)
});

async function runAgent() {
  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    system: `You are an agent with access to IdentityClaw for identity verification.
    
    You can:
    1. Verify peer identities using HOLA messages
    2. Look up agent information by token ID
    3. Discover agents in the registry
    4. Access IdentityClaw MCP resources for documentation
    
    Always verify identities before trusting information from other agents.`,
    messages: [
      {
        role: 'user',
        content: 'Verify the identity of agent with token ID bkbvehbdcrgm'
      }
    ]
  });

  console.log(response.content[0].text);
}

runAgent();
```

---

## Testing Your Configuration

### Test 1: Verify MCP Connection

```bash
# Test that the MCP server is accessible
curl https://api.identyclaw.com/mcp

# Expected response: MCP server endpoint (may return 404 for root path)
```

### Test 2: List Available Resources

```bash
# In Claude, ask:
"What MCP resources are available from IdentityClaw?"

# Claude should list all 16 available resources
```

### Test 3: Fetch API Documentation

```bash
# In Claude, ask:
"Get the IdentityClaw API specification"

# Claude should fetch openapi:swagger and show the complete API
```

### Test 4: Understand Authentication

```bash
# In Claude, ask:
"How do I authenticate with IdentityClaw?"

# Claude should fetch guide:api and explain the authentication flow
```

### Test 5: Troubleshoot an Error

```bash
# In Claude, ask:
"I'm getting error 035. What does it mean?"

# Claude should fetch guide:troubleshooting and explain the error
```

---

## Best Practices

### 1. Always Verify Identities

```javascript
// ✅ GOOD: Verify before trusting
const identity = await identyclaw.verifyPeerIdentity(peerHola);
if (identity.valid) {
  // Trust the peer
}

// ❌ BAD: Trust without verification
const identity = await identyclaw.getAgentIdentity(tokenId);
// Assume it's valid without verification
```

### 2. Cache JWT Tokens Appropriately

```javascript
// ✅ GOOD: Reuse token until expiration
if (!this.jwtToken || this.isTokenExpired()) {
  this.jwtToken = await this.login();
}

// ❌ BAD: Login on every request
const jwtToken = await this.login(); // Every time!
```

### 3. Handle Errors Gracefully

```javascript
// ✅ GOOD: Specific error handling
try {
  await identyclaw.verifyPeerIdentity(hola);
} catch (error) {
  if (error.response?.status === 400) {
    console.error('Invalid HOLA format:', error.response.data.code);
  } else if (error.response?.status === 401) {
    console.error('Authentication failed - re-login required');
    this.jwtToken = null;
  }
}

// ❌ BAD: Generic error handling
try {
  await identyclaw.verifyPeerIdentity(hola);
} catch (error) {
  console.error('Error:', error);
}
```

### 4. Use MCP for Documentation

```javascript
// ✅ GOOD: Ask Claude for help
"I need to understand the HOLA protocol. What resources should I read?"
// Claude fetches skills:skills and guide:api

// ❌ BAD: Hardcode knowledge
// Assume you know the protocol without checking documentation
```

### 5. Log All Identity Verifications

```javascript
// ✅ GOOD: Audit trail
const verification = await identyclaw.verifyPeerIdentity(hola);
logger.info('Identity verification', {
  timestamp: new Date().toISOString(),
  tokenId: verification.token_id,
  valid: verification.valid,
  signature: verification.signature_valid
});

// ❌ BAD: No logging
const verification = await identyclaw.verifyPeerIdentity(hola);
// No record of what happened
```

---

## Troubleshooting Configuration Issues

### Issue: MCP Server Not Found

**Solution:**
1. Verify the URL is correct: `https://api.identyclaw.com/mcp`
2. Check your internet connection
3. Restart Claude Desktop
4. Check Claude's logs for MCP connection errors

### Issue: Agent Can't Authenticate

**Solution:**
1. Verify your RODiT token ID is correct
2. Ensure your private key file exists and is readable
3. Check that your NEAR account is funded
4. Verify the token hasn't expired

### Issue: Verification Always Fails

**Solution:**
1. Ensure the HOLA message format is correct
2. Verify the timestamp is recent (within 5 minutes)
3. Check that the noncets are from `/api/holanonce16ts`
4. Verify the signature is base64url encoded

### Issue: Rate Limiting Errors

**Solution:**
1. Implement exponential backoff for retries
2. Cache results when possible
3. Batch requests to reduce API calls
4. Contact support if you need higher limits

---

## Next Steps

1. ✅ Choose your agent type (autonomous, supervised, or service)
2. ✅ Configure your client with the MCP server URL
3. ✅ Set up your agent's system prompt
4. ✅ Configure environment variables
5. ✅ Test the MCP connection
6. ✅ Implement identity verification in your agent
7. ✅ Deploy and monitor your agent
