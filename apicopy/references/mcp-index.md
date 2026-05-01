# IdentityClaw MCP Documentation Index

Complete index of all MCP-related documentation for connecting AI agents to IdentityClaw.

---

## 📚 Documentation Files

### For Getting Started

**Start here if you're new to IdentityClaw MCP:**

1. **[mcp-quick-reference.md](mcp-quick-reference.md)** ⚡ (5 min read)
   - 30-second setup
   - Resource table at a glance
   - Common prompts
   - Troubleshooting checklist

2. **[mcp-connection-guide.md](mcp-connection-guide.md)** 📖 (15 min read)
   - Complete setup instructions
   - Claude Desktop configuration
   - Available resources explained
   - MCP tools documentation
   - Troubleshooting guide

### For Configuration

**Use these if you're setting up an agent:**

3. **[agent-configuration-examples.md](agent-configuration-examples.md)** ⚙️ (20 min read)
   - Claude Desktop configurations
   - 4 complete agent prompt examples
   - Configuration for different agent types
   - Environment setup (dev/prod)
   - Integration code examples
   - Best practices

### For Reference

**Use these for quick lookups:**

4. **[mcp-implementation-summary.md](mcp-implementation-summary.md)** 📋 (10 min read)
   - What's implemented
   - How it works
   - Key features
   - Testing procedures
   - Support resources

5. **[../../skills.md](../../skills.md)** 🎯 (MCP Integration section)
   - Core workflows
   - Quick start
   - Available resources
   - Example prompts

---

## 🚀 Quick Start (30 seconds)

### Step 1: Find Your Configuration File

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

### Step 2: Add MCP Server

```json
{
  "mcpServers": {
    "identyclaw": {
      "url": "https://api.identyclaw.com/mcp"
    }
  }
}
```

### Step 3: Restart Claude

Close and reopen Claude Desktop.

### Step 4: Ask Claude

```
What MCP resources are available from IdentityClaw?
```

Done! ✅

---

## 📖 Documentation by Use Case

### I want to understand what IdentityClaw offers
→ Read: [mcp-connection-guide.md](mcp-connection-guide.md) - "Available MCP Resources" section

### I want to set up Claude Desktop
→ Read: [mcp-connection-guide.md](mcp-connection-guide.md) - "Claude Desktop Configuration" section

### I want to configure an agent
→ Read: [agent-configuration-examples.md](agent-configuration-examples.md)

### I want a quick reference
→ Read: [mcp-quick-reference.md](mcp-quick-reference.md)

### I'm having connection issues
→ Read: [mcp-connection-guide.md](mcp-connection-guide.md) - "Troubleshooting MCP Connection" section

### I'm getting an API error
→ Read: [mcp-quick-reference.md](mcp-quick-reference.md) - "Troubleshooting Checklist" section

### I want to understand the implementation
→ Read: [mcp-implementation-summary.md](mcp-implementation-summary.md)

---

## 🔗 MCP Resources Available

| Resource | Type | Use For |
|----------|------|---------|
| `openapi:swagger` | JSON | Complete API specification |
| `guide:api` | JSON | Comprehensive API guide |
| `skills:skills` | Markdown | Core workflows |
| `guide:enrollment` | JSON | Step-by-step enrollment |
| `guide:troubleshooting` | JSON | Common errors & solutions |
| `guide:why-identyclaw` | Markdown | Value proposition |
| `onboarding:near` | JSON | NEAR account setup |
| `readme:main` | JSON | Service overview |
| `health:status` | JSON | Server health |
| `config:default` | JSON | Server configuration (admin-only) |
| `policy:terms` | Markdown | Terms of Service |
| `policy:privacy` | Markdown | Privacy Policy |
| `policy:data-retention` | Markdown | Data Retention Policy |
| `policy:service-info` | JSON | Service contact info |
| `jsonld:context` | JSON-LD | Semantic web context |
| `jsonld:contract-metadata` | JSON-LD | Contract metadata |

---

## 💬 Common Prompts to Ask Claude

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

## 🛠️ Configuration Templates

### Basic Claude Desktop

```json
{
  "mcpServers": {
    "identyclaw": {
      "url": "https://api.identyclaw.com/mcp"
    }
  }
}
```

### Multiple Instances

```json
{
  "mcpServers": {
    "identyclaw-mainnet": {
      "url": "https://api.identyclaw.com/mcp"
    },
    "identyclaw-testnet": {
      "url": "https://testnet.identyclaw.com/mcp"
    },
    "identyclaw-local": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

---

## 📋 Agent Prompt Templates

### Legal Verification Agent
See: [agent-configuration-examples.md](agent-configuration-examples.md) - "Example 1: Legal Document Verification Agent"

### Collaboration Coordinator
See: [agent-configuration-examples.md](agent-configuration-examples.md) - "Example 2: Multi-Agent Collaboration Coordinator"

### Data Analyst
See: [agent-configuration-examples.md](agent-configuration-examples.md) - "Example 3: Data Analyst with Secure Access Control"

### Research Network
See: [agent-configuration-examples.md](agent-configuration-examples.md) - "Example 4: Research Collaboration Network"

---

## 🔍 API Endpoints Quick Reference

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

See [mcp-quick-reference.md](mcp-quick-reference.md) for complete endpoint list.

---

## 🎯 Next Steps

1. **Read** [mcp-quick-reference.md](mcp-quick-reference.md) (5 minutes)
2. **Configure** your client using [mcp-connection-guide.md](mcp-connection-guide.md) (10 minutes)
3. **Test** by asking Claude about IdentityClaw (2 minutes)
4. **Choose** an agent configuration from [agent-configuration-examples.md](agent-configuration-examples.md) (10 minutes)
5. **Follow** the enrollment guide to get a RODiT token (varies)
6. **Use** the API for identity verification and agent discovery

---

## 📞 Support

- **MCP Connection Issues:** See [mcp-connection-guide.md](mcp-connection-guide.md) - "Troubleshooting MCP Connection"
- **Authentication Issues:** See [mcp-quick-reference.md](mcp-quick-reference.md) - "Troubleshooting Checklist"
- **API Errors:** Ask Claude: "I'm getting error [code]. What does it mean?"
- **Configuration Help:** See [agent-configuration-examples.md](agent-configuration-examples.md)

---

## 📊 Documentation Statistics

- **Total Documentation:** 1,500+ lines
- **Files Created:** 4 comprehensive guides
- **MCP Resources:** 16 available
- **Agent Examples:** 4 complete prompts
- **Configuration Templates:** 6+ examples
- **Code Examples:** JavaScript, Python, Bash, Node.js

---

## ✅ Checklist for Getting Started

- [ ] Read [mcp-quick-reference.md](mcp-quick-reference.md)
- [ ] Locate your configuration file
- [ ] Add MCP server configuration
- [ ] Restart Claude Desktop
- [ ] Test by asking Claude about IdentityClaw
- [ ] Read [mcp-connection-guide.md](mcp-connection-guide.md) for details
- [ ] Choose an agent configuration
- [ ] Follow enrollment guide
- [ ] Start using the API

---

## 🚀 You're Ready!

All documentation is in place. Start with [mcp-quick-reference.md](mcp-quick-reference.md) and you'll be connected in 30 seconds.

Questions? Ask Claude: "What MCP resources are available from IdentityClaw?"
