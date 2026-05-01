# MCP Connection Guide for OpenClaw Users

Connect your AI agent platform (Claude Desktop, OpenClaw, etc.) to IDClawserver's Model Context Protocol (MCP) server to access identity verification, DID resolution, and agent discovery capabilities.

## Quick Start

### 1. Identify Your IDClawserver URL

The MCP server is available at:
```
https://api.identyclaw.com/mcp
```

Or your self-hosted instance:
```
https://your-idclawserver-domain/mcp
```

### 2. Configure Your Client

Add the MCP server configuration to your client's configuration file.

**For Claude Desktop**, see [Claude Desktop Configuration](#claude-desktop-configuration) below.

**For other OpenClaw clients**, follow the same pattern with your client's MCP configuration format.

---

## Claude Desktop Configuration

### Step 1: Locate Your Configuration File

**macOS:**
```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux:**
```bash
~/.config/Claude/claude_desktop_config.json
```

### Step 2: Add IDClawserver MCP Configuration

Edit `claude_desktop_config.json` and add the MCP server under the `mcpServers` section:

```json
{
  "mcpServers": {
    "identyclaw": {
      "url": "https://api.identyclaw.com/mcp",
      "description": "IdentityClaw API - RODiT token identity verification and DID resolution"
    }
  }
}
```

### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop. The MCP server should now be available.

### Step 4: Verify Connection

In Claude, ask:
```
What MCP resources are available from IdentityClaw?
```

Claude will call the `list_resources` tool and show you available resources.

---

## Available MCP Resources

Once connected, you can access these resources via MCP:

### Identity & Authentication
- **`openapi:swagger`** - Complete OpenAPI specification for all endpoints
- **`guide:api`** - Comprehensive API guide with authentication flows
- **`guide:enrollment`** - Step-by-step enrollment guide for agents

### Documentation
- **`skills:skills`** - Core workflows and quick reference
- **`readme:main`** - Service overview and key features
- **`guide:why-identyclaw`** - Value proposition and use cases

### Onboarding
- **`onboarding:near`** - NEAR account setup and gennearaccount installation
- **`guide:troubleshooting`** - Common errors and solutions

### Policies & Legal
- **`policy:terms`** - Terms of Service
- **`policy:privacy`** - Privacy Policy
- **`policy:data-retention`** - Data Retention Policy
- **`policy:service-info`** - Service information and contact details

### Semantic Web
- **`jsonld:context`** - RODiT JSON-LD context for semantic web integration
- **`jsonld:contract-metadata`** - Smart contract metadata

### DID Resolution
- **`did:resolve:{tokenId}`** - Resolve DID document by token ID (no authentication required)
  - Example: `did:resolve:bkbvehbdcrgm`
  - Returns complete DID document with verification methods and service endpoints

### System
- **`health:status`** - Server health and status information
- **`config:default`** - Server configuration (admin-only, requires special access)

---

## Webhook Testing

The `/api/testhola` endpoint supports development webhook testing.

### Development Webhook Behavior

In development mode, successful HOLA validation triggers webhook delivery:

**Event Type:** `testhola_validation_success`

**Webhook Endpoints:**
- `/hooks/wake` - Trigger immediate heartbeat (enqueue system event for main session)
- `/hooks/agent` - Run isolated agent task (execute background tasks with optional reply to messaging channels)

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

**Configuration:**
Configure your webhook URL in your RODiT token metadata (`webhook_url` field) to receive webhook events.

**Use Case:**
This allows testing webhook delivery during development without production deployment. The webhook is only sent in development mode, making it safe for testing webhook infrastructure.

---

## Using MCP Resources in Claude

### Example 1: Get the OpenAPI Schema

```
Claude: What endpoints does IdentityClaw provide?
```

Claude will fetch `openapi:swagger` and show you the complete API specification.

### Example 2: Understand Authentication

```
Claude: How do I authenticate with IdentityClaw?
```

Claude will fetch `guide:api` and `skills:skills` to explain the authentication flow.

### Example 3: Set Up a NEAR Account

```
Claude: I need to set up a NEAR account to get a RODiT token. What are the steps?
```

Claude will fetch `onboarding:near` and `guide:enrollment` to provide complete instructions.

### Example 4: Troubleshoot an Error

```
Claude: I'm getting error 035: PeerEd25519SignatureVerificationFailure. What does this mean?
```

Claude will fetch `guide:troubleshooting` and explain the cause and solution.

---

## Direct HTTP Access to MCP Resources

In addition to using MCP tools, you can access MCP resources directly via HTTP endpoints. This is useful for:
- Testing resources without an MCP client
- Integrating with non-MCP applications
- Debugging and manual verification
- Scripting and automation

### Resource Access Pattern

**List all resources:**
```bash
GET /api/mcp/resources
```

**Fetch a specific resource by URI:**
```bash
GET /api/mcp/resource/{uri}
```

**Important:** The URI from the resource list is used **as-is** in the URL path. No URL encoding is needed for the colon (`:`) character.

### Examples

#### 1. List All Available Resources

```bash
curl https://api.identyclaw.com/api/mcp/resources
```

**Response:**
```json
{
  "resources": [
    {
      "uri": "openapi:swagger",
      "name": "OpenAPI Schema",
      "type": "application/json"
    },
    {
      "uri": "skills:skills",
      "name": "Skills Documentation",
      "type": "text/markdown"
    },
    ...
  ]
}
```

#### 2. Fetch the Skills Documentation

```bash
curl https://api.identyclaw.com/api/mcp/resource/skills:skills
```

**Response:** Returns the full skills.md content as markdown.

#### 3. Fetch the OpenAPI Schema

```bash
curl https://api.identyclaw.com/api/mcp/resource/openapi:swagger
```

**Response:** Returns the complete OpenAPI specification as JSON.

#### 4. Fetch the Enrollment Guide

```bash
curl https://api.identyclaw.com/api/mcp/resource/guide:enrollment
```

**Response:** Returns the enrollment guide as JSON.

#### 5. Resolve a DID Document

```bash
curl https://api.identyclaw.com/api/mcp/resource/did:resolve:bkbvehbdcrgm
```

**Response:** Returns the DID document for token ID `bkbvehbdcrgm`.

### URI Pattern Reference

| Resource URI | HTTP Endpoint | Content Type |
|--------------|---------------|--------------|
| `openapi:swagger` | `/api/mcp/resource/openapi:swagger` | JSON |
| `skills:skills` | `/api/mcp/resource/skills:skills` | Markdown |
| `guide:api` | `/api/mcp/resource/guide:api` | JSON |
| `guide:enrollment` | `/api/mcp/resource/guide:enrollment` | JSON |
| `guide:troubleshooting` | `/api/mcp/resource/guide:troubleshooting` | JSON |
| `guide:why-identyclaw` | `/api/mcp/resource/guide:why-identyclaw` | Markdown |
| `onboarding:near` | `/api/mcp/resource/onboarding:near` | JSON |
| `policy:terms` | `/api/mcp/resource/policy:terms` | Markdown |
| `policy:privacy` | `/api/mcp/resource/policy:privacy` | Markdown |
| `policy:data-retention` | `/api/mcp/resource/policy:data-retention` | Markdown |
| `jsonld:context` | `/api/mcp/resource/jsonld:context` | JSON-LD |
| `jsonld:contract-metadata` | `/api/mcp/resource/jsonld:contract-metadata` | JSON-LD |
| `did:resolve:{tokenId}` | `/api/mcp/resource/did:resolve:{tokenId}` | JSON |

### Error Handling

**404 Not Found:**
```json
{
  "statusCode": 404,
  "code": "MCP_RESOURCE_NOT_FOUND",
  "message": "Resource not found"
}
```
The requested URI does not exist in the MCP resource registry.

**500 Server Error:**
```json
{
  "statusCode": 500,
  "code": "MCP_RESOURCE_FAILED",
  "message": "Failed to get resource"
}
```
Error reading or processing the resource file. Check server logs for details.

### MCP Tools vs HTTP Endpoints

| Access Method | Use Case | Authentication |
|---------------|----------|----------------|
| **MCP Tools** (`list_resources`, `get_resource`) | AI agents with MCP clients (Claude Desktop, OpenClaw) | None (public) |
| **HTTP Endpoints** (`/api/mcp/resources`, `/api/mcp/resource/{uri}`) | Direct HTTP access, testing, non-MCP applications | None (public) |

Both methods access the same resources and require no authentication.

---

## MCP Tools Available

The IDClawserver MCP server exposes two tools:

### 1. `list_resources`

Lists all available MCP resources with pagination support.

**Parameters:**
- `limit` (optional, number) - Maximum number of resources to return
- `cursor` (optional, string) - Pagination cursor from previous call

**Example:**
```
Claude: List all available IdentityClaw resources
```

**Response:**
```json
{
  "resources": [
    {
      "uri": "openapi:swagger",
      "name": "OpenAPI Schema",
      "type": "application/json"
    },
    ...
  ],
  "nextCursor": "8"
}
```

### 2. `get_resource`

Retrieves a specific resource by URI.

**Parameters:**
- `uri` (required, string) - Resource URI (e.g., "openapi:swagger")

**Example:**
```
Claude: Get the IdentityClaw enrollment guide
```

Claude will call `get_resource` with `uri: "guide:enrollment"` and return the complete guide.

---

## Self-Hosted IDClawserver

If you're running your own IDClawserver instance:

### Configuration

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

### Environment Variables

Ensure your IDClawserver instance has:
- `API_VERSION` - Set in config (default: "0.9.0")
- `SERVICE_NAME` - Set in config (default: "IDClawserver API")
- `NEAR_CONTRACT_ID` - Set for blockchain integration

---

## Troubleshooting MCP Connection

### Issue: "Connection refused" or "Cannot reach server"

**Solution:**
1. Verify the MCP server URL is correct
2. Check that IDClawserver is running: `curl https://api.identyclaw.com/health`
3. Ensure your firewall allows HTTPS connections to the server
4. If self-hosted, verify the port is correct (default: 3000)

### Issue: "MCP server not responding"

**Solution:**
1. Restart Claude Desktop
2. Check the MCP server logs: `tail -f logs/idclawserver.log`
3. Verify the `/mcp` endpoint is accessible: `curl https://api.identyclaw.com/mcp`

### Issue: "Resource not found" when fetching a resource

**Solution:**
1. Verify the resource URI is correct using `list_resources`
2. Check that the resource is available in your server version
3. If self-hosted, ensure all required files are present (swagger.json, policies, etc.)

### Issue: Claude doesn't recognize the MCP server

**Solution:**
1. Verify the configuration file syntax is valid JSON
2. Ensure the `mcpServers` section exists
3. Restart Claude Desktop completely (quit and reopen)
4. Check Claude's logs for MCP connection errors

---

## Security Considerations

### Authentication

The MCP server itself is **public** and does not require authentication for:
- Listing resources
- Fetching documentation and policies
- Accessing OpenAPI schema

However, **API endpoints** accessed through the documentation may require:
- RODiT token authentication (via `/api/login`)
- Bearer token in `Authorization` header

### Data Privacy

- MCP resources are cached on the server for performance
- No personal data is exposed through MCP resources
- All policies and terms are publicly available

### Rate Limiting

- MCP tool calls are subject to rate limiting
- Default: 100 requests per minute per IP
- Adjust in server configuration if needed

---

## Integration Patterns

### Pattern 1: Agent Discovery

```
Claude: Find all available agents on IdentityClaw
```

Claude will:
1. Fetch `openapi:swagger` to find the `/api/agents` endpoint
2. Understand the endpoint requires no authentication
3. Provide instructions for calling the endpoint

### Pattern 2: Identity Verification

```
Claude: How do I verify another agent's identity using HOLA?
```

Claude will:
1. Fetch `skills:skills` for workflow documentation
2. Fetch `guide:api` for endpoint details
3. Provide step-by-step instructions with example code

### Pattern 3: Troubleshooting Setup

```
Claude: I'm trying to set up a RODiT token but I'm stuck. Help me troubleshoot.
```

Claude will:
1. Fetch `guide:enrollment` for setup steps
2. Fetch `guide:troubleshooting` for common issues
3. Fetch `onboarding:near` for NEAR account setup
4. Provide personalized troubleshooting based on your issue

---

## Advanced: Custom MCP Server Configuration

If you need to customize the MCP server behavior:

### Environment Variables

Set these in your `.env` file:

```bash
# MCP Server Configuration
API_VERSION=0.9.0
SERVICE_NAME="My Custom IDClawserver"
LOG_LEVEL=info

# NEAR Blockchain
NEAR_CONTRACT_ID=rodit.near
NEAR_NETWORK_ID=mainnet

# Service Contact Information
SERVICE_CONTACT_SUPPORT=support@example.com
SERVICE_CONTACT_LEGAL=legal@example.com
SERVICE_CONTACT_PRIVACY=privacy@example.com
```

### Custom Resource URIs

To add custom resources, modify `/src/routes/mcp.public.routes.js` in the `mcpService.listAvailableResources()` method.

---

## Support & Resources

- **API Documentation**: `GET /docs` - Interactive Swagger UI
- **Health Check**: `GET /health` - Server status
- **API Discovery**: `GET /` - API overview
- **MCP Resources**: `GET /api/mcp/resources` - List all MCP resources
- **MCP Schema**: `GET /api/mcp/schema` - OpenAPI specification

---

## Next Steps

1. ✅ Configure your client with the MCP server URL
2. ✅ Restart your client application
3. ✅ Ask your AI agent about IdentityClaw resources
4. ✅ Follow the enrollment guide to get a RODiT token
5. ✅ Use the API endpoints for identity verification and agent discovery
