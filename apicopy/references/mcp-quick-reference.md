# MCP Quick Reference Card

Fast lookup for connecting to IdentityClaw MCP and using available resources.

---

## 30-Second Setup

### Claude Desktop

1. Open: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add:
```json
{
  "mcpServers": {
    "identyclaw": {
      "url": "https://api.identyclaw.com/mcp"
    }
  }
}
```
3. Restart Claude
4. Done! ✅

---

## MCP Resources at a Glance

| Resource URI | Type | Purpose |
|--------------|------|---------|
| `openapi:swagger` | JSON | Complete API specification |
| `guide:api` | JSON | Comprehensive API guide with examples |
| `skills:skills` | Markdown | Core workflows and quick reference |
| `guide:enrollment` | JSON | Step-by-step enrollment guide |
| `guide:troubleshooting` | JSON | Common errors and solutions |
| `guide:why-identyclaw` | Markdown | Value proposition and use cases |
| `onboarding:near` | JSON | NEAR account setup instructions |
| `readme:main` | JSON | Service overview |
| `health:status` | JSON | Server health and status |
| `config:default` | JSON | Server configuration |
| `policy:terms` | Markdown | Terms of Service |
| `policy:privacy` | Markdown | Privacy Policy |
| `policy:data-retention` | Markdown | Data Retention Policy |
| `policy:service-info` | JSON | Service contact information |
| `jsonld:context` | JSON-LD | RODiT JSON-LD context |
| `jsonld:contract-metadata` | JSON-LD | Smart contract metadata |
| `did:resolve:{tokenId}` | JSON | Resolve DID document by token ID |

---

## MCP Tools

### `list_resources`

List all available MCP resources.

**Parameters:**
- `limit` (optional) - Max results per page
- `cursor` (optional) - Pagination cursor

**Usage:**
```
Claude: What MCP resources are available?
```

### `get_resource`

Fetch a specific resource by URI.

**Parameters:**
- `uri` (required) - Resource URI (e.g., "openapi:swagger")

**Usage:**
```
Claude: Get the IdentityClaw API specification
```

---

## Direct HTTP Access

Access MCP resources without an MCP client using HTTP endpoints.

### List Resources

```bash
curl https://api.identyclaw.com/api/mcp/resources
```

### Fetch Resource by URI

```bash
# Use the URI as-is (no URL encoding needed)
curl https://api.identyclaw.com/api/mcp/resource/skills:skills
curl https://api.identyclaw.com/api/mcp/resource/openapi:swagger
curl https://api.identyclaw.com/api/mcp/resource/guide:enrollment
```

### Common HTTP Access Patterns

| Resource | HTTP Command |
|----------|--------------|
| Skills | `curl /api/mcp/resource/skills:skills` |
| OpenAPI | `curl /api/mcp/resource/openapi:swagger` |
| Enrollment Guide | `curl /api/mcp/resource/guide:enrollment` |
| Troubleshooting | `curl /api/mcp/resource/guide:troubleshooting` |
| NEAR Onboarding | `curl /api/mcp/resource/onboarding:near` |
| Terms of Service | `curl /api/mcp/resource/policy:terms` |
| JSON-LD Context | `curl /api/mcp/resource/jsonld:context` |
| DID Resolve | `curl /api/mcp/resource/did:resolve:{tokenId}` |

**Note:** Both MCP tools and HTTP endpoints access the same resources. Use MCP tools for AI agents, HTTP for direct access.

---

## Common Prompts

### Setup & Onboarding
```
"How do I get started with IdentityClaw?"
"Help me set up a NEAR account"
"What's required to mint a RODiT token?"
```

### Authentication
```
"How do I authenticate with IdentityClaw?"
"Explain the HOLA protocol"
"What's the difference between API login and HOLA?"
```

### Identity Verification
```
"How do I verify another agent's identity?"
"What's a HOLA message?"
"How do I prove my identity to a peer?"
```

### Troubleshooting
```
"I'm getting error 035. What does it mean?"
"Why is my login failing?"
"How do I fix signature verification errors?"
```

### API Reference
```
"What endpoints does IdentityClaw provide?"
"Show me the complete API specification"
"What's required to call /api/identity/verify?"
```

---

## API Endpoints Quick Ref

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/login` | No | Get JWT token |
| GET | `/api/login/timestamp` | No | Get timestamp for signing |
| GET | `/api/holanonce16ts` | JWT | Get nonce for HOLA |
| POST | `/api/identity/verify` | JWT | Verify HOLA message |
| GET | `/api/me/identity` | JWT | Get your identity |
| GET | `/api/identity/token/{id}/full` | JWT | Get agent identity |
| GET | `/api/agents` | No | List all agents |
| GET | `/.well-known/did/resolve` | No | Resolve DID |
| POST | `/api/testhola` | JWT | Test HOLA validation |

---

## Configuration Files

### Claude Desktop (macOS)
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

### Claude Desktop (Windows)
```
%APPDATA%\Claude\claude_desktop_config.json
```

### Claude Desktop (Linux)
```
~/.config/Claude/claude_desktop_config.json
```

---

## Environment Variables

```bash
# IdentityClaw URLs
IDENTYCLAW_API_URL=https://api.identyclaw.com
IDENTYCLAW_MCP_URL=https://api.identyclaw.com/mcp

# Agent Identity
AGENT_RODIT_TOKEN_ID=your_token_id
AGENT_PRIVATE_KEY_PATH=./credentials/key.json

# Logging
LOG_LEVEL=info
```

---

## Troubleshooting Checklist

### MCP Connection Issues
- [ ] URL is correct: `https://api.identyclaw.com/mcp`
- [ ] Client is restarted after config change
- [ ] Configuration JSON is valid
- [ ] Internet connection is working
- [ ] Firewall allows HTTPS connections

### Authentication Issues
- [ ] RODiT token ID is correct (12 lowercase letters)
- [ ] Private key file exists and is readable
- [ ] NEAR account is funded
- [ ] Token hasn't expired

### HOLA Verification Issues
- [ ] HOLA format is correct: `HOLA-<recipient>-<tokenId>-<timestamp>-<noncets>-API.IDENTYCLAW.COM-<signature>-<checksum>`
- [ ] Timestamp is recent (within 5 minutes)
- [ ] Noncets are from `/api/holanonce16ts`
- [ ] Signature is base64url encoded
- [ ] Checksum is correct (simple sum % 16)

---

## Resource Discovery Flow

```
User asks Claude a question about IdentityClaw
    ↓
Claude calls list_resources tool
    ↓
Claude sees available resources
    ↓
Claude calls get_resource for relevant resources
    ↓
Claude synthesizes answer from resources
    ↓
User gets comprehensive, accurate answer
```

---

## Example: Verify an Agent's Identity

**User:** "Verify the identity of agent bkbvehbdcrgm"

**Claude's Process:**
1. Calls `list_resources` to see available endpoints
2. Calls `get_resource("guide:api")` to understand `/api/identity/token/{id}/full`
3. Calls `get_resource("skills:skills")` to understand HOLA verification
4. Explains the process to the user
5. Provides step-by-step instructions

---

## Example: Troubleshoot an Error

**User:** "I'm getting error 035: PeerEd25519SignatureVerificationFailure"

**Claude's Process:**
1. Calls `get_resource("guide:troubleshooting")`
2. Finds error 035 in the troubleshooting guide
3. Explains the cause: timestamp mismatch or wrong keypair size
4. Provides solutions: verify timestamp, check keypair, re-sign message
5. Suggests testing with `/api/testhola` endpoint

---

## Self-Hosted Configuration

For your own IDClawserver instance:

```json
{
  "mcpServers": {
    "identyclaw-local": {
      "url": "http://localhost:3000/mcp",
      "description": "Local IdentityClaw instance"
    }
  }
}
```

---

## Rate Limits

- **MCP Calls:** 100 requests/minute per IP
- **API Calls:** 1000 requests/minute per JWT
- **Login:** 10 attempts/minute per IP

---

## Support Resources

- **MCP Guide:** [MCP_CONNECTION_GUIDE.md](MCP_CONNECTION_GUIDE.md)
- **Agent Examples:** [AGENT_CONFIGURATION_EXAMPLES.md](AGENT_CONFIGURATION_EXAMPLES.md)
- **API Reference:** `GET /docs` (Swagger UI)
- **Health Check:** `GET /health`
- **MCP Resources:** `GET /api/mcp/resources`

---

## Key Takeaways

✅ **MCP is the easiest way** to integrate IdentityClaw with AI agents  
✅ **16 resources available** covering all aspects of the API  
✅ **No authentication required** for MCP resource access  
✅ **Claude can fetch documentation** automatically  
✅ **Works with any OpenClaw client** supporting MCP  

---

## Next Steps

1. Add MCP server to your client config
2. Restart your client
3. Ask your AI agent about IdentityClaw
4. Follow the enrollment guide to get a RODiT token
5. Use the API for identity verification and agent discovery
