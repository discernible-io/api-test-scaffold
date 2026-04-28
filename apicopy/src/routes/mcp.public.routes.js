const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { logger, errorResponse } = require("@rodit/rodit-auth-be");
const config = require("config");
const { sendError } = errorResponse;

const API_VERSION = config.get("API_VERSION");

const mcpCache = {
  swagger: null
};

function loadSwaggerSpec() {
  if (mcpCache.swagger) return mcpCache.swagger;
  try {
    mcpCache.swagger = require("../../api-docs/swagger.json");
    return mcpCache.swagger;
  } catch (error) {
    logger.errorWithContext("Failed to load swagger.json for MCP schema", {
      component: "MCPRoutes",
      method: "loadSwaggerSpec",
      cause: error.name || "FileLoadError",
      error: error.message
    });
    mcpCache.swagger = {
      openapi: "3.0.0",
      info: { title: "IDClawserver API", version: API_VERSION },
      paths: {}
    };
    return mcpCache.swagger;
  }
}

const mcpService = {
  async listAvailableResources(req, options = {}) {
    const all = [
      { uri: "openapi:swagger", name: "OpenAPI Schema", type: "application/json" },
      { uri: "config:default", name: "Server Default Config", type: "application/json" },
      { uri: "skills:skills", name: "Skills Documentation", type: "text/markdown" },
      { uri: "readme:main", name: "README Documentation", type: "application/json" },
      { uri: "health:status", name: "Health Status", type: "application/json" },
      { uri: "guide:api", name: "Comprehensive API Guide", type: "application/json" },
      { uri: "policy:terms", name: "Terms of Service", type: "text/markdown" },
      { uri: "policy:privacy", name: "Privacy Policy", type: "text/markdown" },
      { uri: "policy:data-retention", name: "Data Retention Policy", type: "text/markdown" },
      { uri: "policy:service-info", name: "Service Information", type: "application/json" },
      { uri: "onboarding:near", name: "NEAR Account Onboarding Guide", type: "application/json" },
      { uri: "guide:enrollment", name: "Complete Enrollment Guide", type: "application/json" },
      { uri: "guide:why-identyclaw", name: "Why IdentityClaw - Value Proposition", type: "text/markdown" },
      { uri: "guide:troubleshooting", name: "Troubleshooting Guide", type: "application/json" },
      { uri: "guide:subagents", name: "Subagents & Delegated Signers Complete Guide", type: "application/json" },
      { uri: "jsonld:context", name: "RODiT JSON-LD Context", type: "application/ld+json" },
      { uri: "jsonld:contract-metadata", name: "Contract Metadata JSON-LD", type: "application/ld+json" },
      { uri: "did:resolve:{tokenId}", name: "DID Resolution by Token ID (use did:resolve:{tokenId})", type: "application/json" },
      { uri: "token:facial-categories", name: "Facial Token ID Categories and Checksum Algorithm", type: "application/json" }
    ];
    const start = options.cursor ? parseInt(options.cursor, 10) || 0 : 0;
    const limit = options.limit || all.length;
    const resources = all.slice(start, start + limit);
    const nextCursor = start + limit < all.length ? String(start + limit) : null;
    return { resources, nextCursor };
  },

  async getResource(uri, req) {
    if (uri === "openapi:swagger") {
      return { type: "application/json", content: loadSwaggerSpec() };
    }
    if (uri === "config:default") {
      try {
        const configData = {
          METHOD_PERMISSION_MAP: config.get("METHOD_PERMISSION_MAP"),
          SERVERPORT: config.get("SERVERPORT"),
          SERVICE_NAME: config.get("SERVICE_NAME"),
          LOG_LEVEL: config.get("LOG_LEVEL")
        };
        return { type: "application/json", content: configData };
      } catch (error) {
        logger.error("Failed to load config for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "skills:skills") {
      try {
        const skillsPath = path.join(__dirname, "../../skills.md");
        const raw = fs.readFileSync(skillsPath, "utf8");
        return { type: "text/markdown", content: raw };
      } catch (error) {
        logger.error("Failed to load skills.md for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "readme:main") {
      try {
        const roditClient = req.app?.locals?.roditClient;
        if (!roditClient) {
          throw new Error("RoditClient not available");
        }

        const config_own_rodit = await roditClient.getConfigOwnRodit();
        const openapijsonUrl =
          config_own_rodit?.own_rodit?.metadata?.openapijson_url || null;

        const readmeSummary = {
          title: "IDClawserver API",
          description:
            "API for AI agent identities backed by RODiT tokens on NEAR, including facial token_id encoding and mutual authentication flows.",
          documentation_url: openapijsonUrl,
          key_features: [
            "RODiT-based mutual authentication",
            "Identity lookup and facial token_id decoding",
            "API.IDENTYCLAW.COM handshake verification",
            "Client RODiT minting via SignPortal (/api/signclient)",
            "MCP resources for skills and schema discovery"
          ]
        };

        return { type: "application/json", content: readmeSummary };
      } catch (error) {
        logger.error("Failed to load README for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "health:status") {
      try {
        const roditClient = req.app?.locals?.roditClient;
        if (!roditClient) {
          throw new Error("RoditClient not available");
        }

        const config_own_rodit = await roditClient.getConfigOwnRodit();
        if (!config_own_rodit?.own_rodit?.metadata?.subjectuniqueidentifier_url) {
          throw new Error("RODiT configuration not available");
        }

        const baseUrl = config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url;
        const response = await axios.get(`${baseUrl}/health`, { timeout: 5000 });
        return { type: "application/json", content: response.data };
      } catch (error) {
        logger.error("Failed to fetch health status for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Health status unavailable");
      }
    }
    if (uri === "guide:api") {
      try {
        const swagger = loadSwaggerSpec();
        const roditClient = req.app?.locals?.roditClient;

        let baseUrl = swagger.servers?.[0]?.url || null;
        if (roditClient) {
          const config_own_rodit = await roditClient.getConfigOwnRodit();
          if (config_own_rodit?.own_rodit?.metadata?.subjectuniqueidentifier_url) {
            baseUrl = config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url;
          }
        }

        const guide = {
          title: "IDClawserver API - Comprehensive Guide",
          version: swagger.info?.version || API_VERSION,
          description:
            "Complete API documentation combining identity-focused context with OpenAPI specifications.",
          sections: {
            overview: {
              description:
                "IDClawserver provides identity and trust primitives for AI agents using RODiT tokens on NEAR.",
              key_features: [
                "RODiT-backed JWT access tokens",
                "Identity and facial token_id resolution",
                "API.IDENTYCLAW.COM handshake verification",
                "Public agent discovery from chain",
                "Client RODiT minting via SignPortal (/api/signclient)"
              ]
            },
            authentication: {
              method: "RODiT mutual authentication",
              description:
                "Clients authenticate using RODiT credentials and obtain JWTs from /api/login, then call protected identity routes.",
              flow: [
                "1. Obtain a RODiT for your agent/service.",
                "2. Call POST /api/login with the appropriate RODiT credentials.",
                "3. Receive a jwt_token in the response.",
                "4. Use Authorization: Bearer <jwt_token> for protected routes.",
                "5. Call POST /api/logout to terminate the session."
              ]
            },
            identity: {
              description:
                "Endpoints for resolving AI agent identities and facial encodings from RODiT tokens.",
              endpoints: [
                "/api/me/identity",
                "/api/identity/token/{tokenId}/full",
                "/api/identity/verify",
                "/api/testhola"
              ]
            },
            agent: {
              description:
                "Endpoints for AI agent authentication, parameter generation, and public discovery.",
              endpoints: [
                "/api/login/timestamp",
                "/api/agents",
                "/api/login"
              ]
            },
            endpoints: swagger.paths,
            schemas: swagger.components?.schemas || {}
          },
          base_url: baseUrl,
          external_docs: swagger.externalDocs
        };

        return { type: "application/json", content: guide };
      } catch (error) {
        logger.error("Failed to create API guide for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("API guide unavailable");
      }
    }
    if (uri === "policy:terms") {
      try {
        const policyPath = path.join(__dirname, "../../public/policies/terms-of-service.md");
        const content = fs.readFileSync(policyPath, "utf8");
        return { type: "text/markdown", content };
      } catch (error) {
        logger.error("Failed to load terms of service for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "policy:privacy") {
      try {
        const policyPath = path.join(__dirname, "../../public/policies/privacy-policy.md");
        const content = fs.readFileSync(policyPath, "utf8");
        return { type: "text/markdown", content };
      } catch (error) {
        logger.error("Failed to load privacy policy for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "policy:data-retention") {
      try {
        const policyPath = path.join(__dirname, "../../public/policies/data-retention.md");
        const content = fs.readFileSync(policyPath, "utf8");
        return { type: "text/markdown", content };
      } catch (error) {
        logger.error("Failed to load data retention policy for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "policy:service-info") {
      const serviceInfo = {
        service: "IDENTYCLAW API",
        description: "RODiT Token Management and AI Agent Identity Service",
        version: API_VERSION,
        protocols: ["API.IDENTYCLAW.COM"],
        blockchain: {
          network: "NEAR Protocol",
          contract: config.get("NEAR_CONTRACT_ID")
        },
        policies: {
          terms_of_service: "/.well-known/terms-of-service",
          privacy_policy: "/.well-known/privacy-policy",
          data_retention: "/.well-known/data-retention"
        },
        contact: {
          support: config.get("SERVICE_CONTACT_SUPPORT"),
          legal: config.get("SERVICE_CONTACT_LEGAL"),
          privacy: config.get("SERVICE_CONTACT_PRIVACY")
        }
      };
      return { type: "application/json", content: serviceInfo };
    }
    if (uri === "onboarding:near") {
      const onboardingGuide = {
        title: "NEAR Account Onboarding Guide for AI Agents",
        description: "Step-by-step instructions for installing near-cli-rs, obtaining NEAR tokens, and creating a NEAR implicit account. Required before minting a RODiT token via IDENTYCLAW.",
        sections: {
          install_near_cli_rs: {
            title: "Install near-cli-rs",
            description: "near-cli-rs is the official Rust-based NEAR Protocol CLI. It is required to generate keypairs and interact with the NEAR blockchain.",
            methods: [
              {
                platform: "Linux / macOS (recommended installer)",
                command: "curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh",
                notes: "Installs the latest release binary directly. Restart your shell or run 'source ~/.bashrc' after installation."
              },
              {
                platform: "Cargo (Rust toolchain required)",
                command: "cargo install near-cli-rs",
                notes: "Requires Rust installed via https://rustup.rs. Run 'rustup update' first to ensure you have the latest toolchain."
              },
              {
                platform: "Homebrew (macOS)",
                command: "brew install near-cli-rs",
                notes: "Installs via Homebrew package manager."
              }
            ],
            verify: {
              command: "near --version",
              expected: "Prints the near-cli-rs version string, e.g. 'near-cli-rs 0.x.x'"
            }
          },
          create_implicit_account: {
            title: "Create a NEAR Implicit Account",
            description: "A NEAR implicit account ID is the lowercase hex encoding of the 32-byte Ed25519 public key. No on-chain transaction is needed to generate the keypair — the account becomes active once it receives its first NEAR deposit.",
            steps: [
              {
                step: 1,
                action: "Generate a new Ed25519 keypair",
                command: "near generate-key <account-id> network-config mainnet",
                notes: "The implicit account ID will be the 64-character lowercase hex of the public key, e.g. 'a9d4...3f1c'. The private key is stored in your local keychain (~/.near-credentials/)."
              },
              {
                step: 2,
                action: "Note your implicit account address",
                notes: "The account ID shown after key generation is your NEAR implicit account address. It is 64 lowercase hex characters derived from your public key. Keep your private key secure."
              },
              {
                step: 3,
                action: "Fund the account to activate it",
                notes: "Send at least 0.1 NEAR to your implicit account address from an exchange. The account is not active on-chain until it has received a deposit."
              }
            ]
          },
          obtain_near_tokens: {
            title: "Obtain NEAR Tokens",
            description: "Mainnet NEAR has real monetary value. Obtain it via a centralised exchange and withdraw to your implicit account address.",
            sources: [
              {
                name: "Centralised Exchanges (CEX)",
                examples: ["Binance", "Coinbase", "Kraken", "OKX"],
                notes: "Purchase NEAR on any major exchange and withdraw to your implicit account address. Ensure the exchange supports NEAR mainnet withdrawals to implicit (hex) addresses."
              },
              {
                name: "Decentralised Exchanges (DEX)",
                examples: ["Ref Finance (ref.finance)"],
                notes: "Swap other tokens for NEAR on NEAR-native DEXes if you already hold other NEAR ecosystem tokens."
              }
            ]
          },
          next_steps: {
            title: "Next Steps After Account Setup",
            description: "Once your NEAR implicit account is funded, you can proceed to mint a RODiT token via IDENTYCLAW.",
            steps: [
              "Review the service policies via GET /.well-known/terms-of-service and /.well-known/privacy-policy",
              "Use GET /api/mcp/resource/onboarding:near (this document) to revisit these instructions at any time",
              "Proceed to POST /api/signclient to mint your client RODiT token once your NEAR account is ready"
            ]
          }
        }
      };
      return { type: "application/json", content: onboardingGuide };
    }
    if (uri === "jsonld:context") {
      try {
        const { blockchainService } = require("@rodit/rodit-auth-be");
        const contractId = config.get("NEAR_CONTRACT_ID");
        
        const context = await blockchainService.nearorg_rpc_call(
          contractId,
          "did_wba_jsonld",
          {}
        );
        
        if (!context) {
          throw new Error("Contract returned null context");
        }
        
        const parsedContext = JSON.parse(context);
        return { type: "application/ld+json", content: parsedContext };
      } catch (error) {
        logger.error("Failed to fetch JSON-LD context from contract", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "guide:enrollment") {
      try {
        const howtoConfig = require("../config/howto.config.js");
        
        const enrollmentGuide = {
          title: "Complete IdentityClaw Enrollment Guide for AI Agents",
          description: "Comprehensive step-by-step instructions for enrolling in the IdentityClaw API, including NEAR account setup, RODiT token purchase, and authentication",
          lastUpdated: "2026-04-20",
          
          criticalInstructions: howtoConfig.agentInstructions,
          
          nearAccountRelationship: howtoConfig.nearImplicitAccountAndRoditRelationship,
          
          authenticationQuickReference: howtoConfig.authenticationQuickReference,
          
          prerequisites: howtoConfig.openClawAgentEnrollment.prerequisites,
          
          enrollmentSteps: {
            step1_installNearCli: howtoConfig.openClawAgentEnrollment.step1_installNearCli,
            step2_createImplicitAccount: howtoConfig.openClawAgentEnrollment.step2_createImplicitAccount,
            step3_extractCredentials: howtoConfig.openClawAgentEnrollment.step3_extractCredentials,
            step4_fundAccount: howtoConfig.openClawAgentEnrollment.step4_fundAccount,
            step5_purchaseRODiT: howtoConfig.openClawAgentEnrollment.step5_purchaseRODiT,
            step6_authenticateWithAPI: howtoConfig.openClawAgentEnrollment.step6_authenticateWithAPI,
            step7_generateHOLAMessages: howtoConfig.openClawAgentEnrollment.step7_generateHOLAMessages
          },
          
          discoveringYourTokenId: howtoConfig.openClawAgentEnrollment.quickStartForAgents.discoveringYourTokenId,
          
          criticalTimestampWarning: howtoConfig.openClawAgentEnrollment.quickStartForAgents.criticalTimestampWarning,
          
          quickStartSteps: howtoConfig.openClawAgentEnrollment.quickStartForAgents.quickStartSteps,
          
          troubleshootingTable: howtoConfig.openClawAgentEnrollment.quickStartForAgents.troubleshootingTable,
          
          apiEndpointsQuickRef: howtoConfig.openClawAgentEnrollment.quickStartForAgents.apiEndpointsQuickRef
        };
        
        return { type: "application/json", content: enrollmentGuide };
      } catch (error) {
        logger.error("Failed to load enrollment guide for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "guide:why-identyclaw") {
      try {
        const policyPath = path.join(__dirname, "../../public/policies/why-identyclaw.md");
        const content = fs.readFileSync(policyPath, "utf8");
        return { type: "text/markdown", content };
      } catch (error) {
        logger.error("Failed to load why-identyclaw guide for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "guide:troubleshooting") {
      try {
        const howtoConfig = require("../config/howto.config.js");
        
        const troubleshootingGuide = {
          title: "IdentityClaw API Troubleshooting Guide",
          description: "Common errors, their causes, and solutions for AI agents using the IdentityClaw API",
          lastUpdated: "2026-04-20",
          
          commonErrors: [
            {
              error: "Error 035: PeerEd25519SignatureVerificationFailure",
              cause: "Signature verification failed - most likely timestamp mismatch between signing and payload, or wrong keypair size",
              symptoms: [
                "Login fails with 401 status",
                "Error message mentions signature verification",
                "Timestamp-related error in logs"
              ],
              solutions: [
                "Use BOTH timestamp and timestamp_iso from the SAME /api/login/timestamp call",
                "Never mix timestamps from different moments",
                "Ensure you're using the full 64-byte keypair for signing (not just 32 bytes)",
                "Verify message format: roditid + timestamp_iso with NO separator",
                "Example: 'bkbvehbdcrgm2026-04-19T18:19:18.000Z' (no spaces, no colons between)"
              ],
              prevention: "Always call /api/login/timestamp once and use both values from that single response"
            },
            {
              error: "IDENTITY_NOT_FOUND",
              cause: "RODiT token not found on blockchain, or private key doesn't match the token owner",
              symptoms: [
                "Login fails even with correct signature format",
                "Error says identity cannot be found",
                "Token ID exists but authentication fails"
              ],
              solutions: [
                "Verify your token ID using: ./scripts/roditwallet.sh <your-account-id>",
                "Ensure the private key you're using matches the NEAR account that owns the token",
                "Check that the token exists on the correct network (mainnet vs testnet)",
                "Confirm token ownership: curl 'https://api.identyclaw.com/api/agents?owner=<your-account-id>'"
              ],
              prevention: "Always verify token ownership before attempting authentication"
            },
            {
              error: "Don't know my token ID",
              cause: "Token ID was not saved during purchase or lost",
              symptoms: [
                "Have NEAR account and private key but don't know token ID",
                "Cannot proceed with login"
              ],
              solutions: [
                "Method 1 (Recommended): Run ./scripts/roditwallet.sh <your-account-id>",
                "Method 2: Query public API: curl 'https://api.identyclaw.com/api/agents?owner=<your-account-id>'",
                "Method 3 (after login): GET /api/me/identity (only works if you already logged in once)",
                "Extract the 12-letter token ID from the output (format: 'id=saaddbbadbbf')"
              ],
              prevention: "Save your token ID immediately after purchase in a secure location"
            },
            {
              error: "bad signature size",
              cause: "Signature encoding is incorrect",
              symptoms: [
                "Error mentions signature size",
                "Signature validation fails before verification"
              ],
              solutions: [
                "Use base64url encoding (not standard base64)",
                "Remove trailing '=' padding: signature.rstrip('=')",
                "Ensure signature is 86-87 characters long",
                "Use URL-safe characters: - and _ instead of + and /"
              ],
              prevention: "Always use base64url encoding for signatures"
            },
            {
              error: "MISSING_TOKEN or 401 Unauthorized on protected endpoints",
              cause: "JWT token not included in request or expired",
              symptoms: [
                "Protected endpoints return 401",
                "Error says token is missing",
                "Previously working requests now fail"
              ],
              solutions: [
                "Always include Authorization header: 'Authorization: Bearer <jwt_token>'",
                "Check if JWT has expired (default: 1 hour)",
                "Re-authenticate via POST /api/login to get a fresh JWT",
                "Verify JWT format: should have 3 parts separated by dots (header.payload.signature)"
              ],
              prevention: "Implement JWT refresh logic before expiration"
            },
            {
              error: "Timestamp mismatch - mixing T1 and T2",
              cause: "Using timestamp_iso from one moment and timestamp from a different moment",
              symptoms: [
                "Error 035 even though signature format looks correct",
                "Intermittent authentication failures"
              ],
              solutions: [
                "Call /api/login/timestamp ONCE",
                "Extract BOTH timestamp and timestamp_iso from the same response",
                "Use timestamp_iso for signing the message",
                "Use timestamp (Unix seconds) in the login payload",
                "Never generate your own timestamp separately"
              ],
              prevention: "Always use /api/login/timestamp for timestamp generation"
            }
          ],
          
          verificationChecklist: {
            title: "Pre-Login Verification Checklist",
            checks: [
              {
                item: "Token ID is known",
                command: "./scripts/roditwallet.sh <account-id>",
                expected: "Shows 'id=<your-token-id>'"
              },
              {
                item: "Private key is accessible",
                command: "cat ~/.near-credentials/mainnet/<account-id>.json | jq -r '.private_key'",
                expected: "Shows 'ed25519:<base58-key>'"
              },
              {
                item: "Keypair is 64 bytes",
                command: "Check decoded private key length",
                expected: "64 bytes when decoded from base58"
              },
              {
                item: "Auth params are fresh",
                command: "curl https://api.identyclaw.com/api/login/timestamp",
                expected: "Returns timestamp and timestamp_iso from same moment"
              },
              {
                item: "Message format is correct",
                command: "Verify: roditid + timestamp_iso (no separator)",
                expected: "Example: 'bkbvehbdcrgm2026-04-19T18:19:18.000Z'"
              },
              {
                item: "Signature is base64url",
                command: "Check signature encoding",
                expected: "86-87 chars, uses - and _, no = padding"
              }
            ]
          },
          
          stepByStepDebugging: {
            title: "Step-by-Step Debugging Process",
            steps: [
              "1. Verify token exists: ./scripts/roditwallet.sh <account-id>",
              "2. Get fresh auth params: curl https://api.identyclaw.com/api/login/timestamp",
              "3. Save both timestamp and timestamp_iso from the response",
              "4. Construct message: roditid + timestamp_iso (literal concatenation)",
              "5. Sign message with full 64-byte keypair",
              "6. Encode signature as base64url (remove = padding)",
              "7. POST to /api/login with: roditid, timestamp (Unix), signature",
              "8. If fails, check error code and consult commonErrors above"
            ]
          },
          
          quickReference: howtoConfig.openClawAgentEnrollment.quickStartForAgents.troubleshootingTable
        };
        
        return { type: "application/json", content: troubleshootingGuide };
      } catch (error) {
        logger.error("Failed to load troubleshooting guide for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "guide:subagents") {
      try {
        const subagentsGuide = {
          title: "Subagents & Delegated Signers Complete Guide",
          description: "Complete guide for AI agents using subagents with OpenClaw and IdentityClaw delegation",
          lastUpdated: "2026-04-27",
          
          overview: {
            title: "What are Subagents?",
            description: "Subagents are AI agents that act on behalf of a parent agent using delegated cryptographic authorization. Unlike standard agents, subagents don't need their own RODiT tokens - they just need their own Ed25519 keypair and parent authorization.",
            benefits: [
              "No RODiT token purchase required for subagents",
              "Parent maintains control and can revoke access",
              "Subagents can prove they're authorized by a specific parent",
              "Enables hierarchical agent organizations",
              "Cost-effective for spawning multiple specialized agents"
            ]
          },
          
          keyDifferences: {
            title: "Subagent vs Standard Agent",
            comparison: [
              {
                aspect: "RODiT Token",
                standardAgent: "Required (12-char token_id)",
                subagent: "NOT required"
              },
              {
                aspect: "Keypair",
                standardAgent: "Ed25519 (for RODiT)",
                subagent: "Ed25519 (self-generated)"
              },
              {
                aspect: "Identity",
                standardAgent: "Token-based",
                subagent: "Delegation-based"
              },
              {
                aspect: "Cost",
                standardAgent: "Token purchase cost (0.066-496 NEAR)",
                subagent: "Free (uses parent's token)"
              },
              {
                aspect: "Authorization",
                standardAgent: "Self-owned",
                subagent: "Parent-authorized"
              },
              {
                aspect: "HOLA Format",
                standardAgent: "Standard (8 fields)",
                subagent: "Extended (11 fields)"
              }
            ]
          },
          
          holaFormats: {
            title: "HOLA Message Formats",
            standard: {
              format: "HOLA:<recipient>:<tokenId>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<base64url-signature>:<checksum>",
              fields: 8,
              example: "HOLA:MUNDO:aaaaaaaaaaaa:2026-04-27T10:19:00Z:4F9A3C7E2D1B9A4C:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:7",
              signedMessage: "HOLA:<recipient>:<tokenId>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:",
              signedBy: "Agent's private key (from RODiT token owner)"
            },
            subagent: {
              format: "HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<base64url-signature>:<checksum>",
              fields: 11,
              example: "HOLA:MUNDO:researcher-sub-001:aaaaaaaaaaaa:dGVzdHB1YmxpY2tleWJhc2U2NHVybGVuY29kZWQ:2026-04-27T10:19:00Z:4F9A3C7E2D1B9A4C:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:7",
              signedMessage: "HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:",
              signedBy: "SUBAGENT's private key (NOT parent's key)",
              additionalFields: [
                "delegateID - Subagent's unique identifier (1-128 chars)",
                "issuer_tokenId - Parent's RODiT token ID (12 lowercase letters)",
                "publicKey - Subagent's Ed25519 public key (base64url-encoded, 43 chars)"
              ]
            }
          },
          
          delegationWorkflow: {
            title: "Complete Delegation Workflow",
            steps: [
              {
                step: 1,
                title: "Subagent Generates Keypair",
                description: "Subagent generates its own Ed25519 keypair and keeps the private key secure",
                code: "const keypair = nacl.sign.keyPair(); // JavaScript\nconst privateKey = keypair.secretKey; // 64 bytes\nconst publicKey = keypair.publicKey;   // 32 bytes",
                critical: "Subagent MUST generate its own keypair - parent should NEVER generate it"
              },
              {
                step: 2,
                title: "Subagent Requests Authorization",
                description: "Subagent sends its public key and delegate ID to parent for signing",
                requestFormat: {
                  delegateId: "researcher-sub-001",
                  publicKey: "base64url-encoded-public-key",
                  capabilities: ["web_search", "read", "memory_search"]
                }
              },
              {
                step: 3,
                title: "Parent Signs Delegation",
                description: "Parent signs the delegation record using its RODiT private key",
                signedMessage: "{tokenId}:{delegateId}:{unixTimestamp}:{publicKey}",
                example: "aaaaaaaaaaaa:researcher-sub-001:1714224000:dGVzdHB1YmxpY2tleWJhc2U2NHVybGVuY29kZWQ",
                code: "const message = `${tokenId}:${delegateId}:${timestamp}:${publicKey}`;\nconst signature = nacl.sign.detached(Buffer.from(message), parentPrivateKey);\nconst signatureB64 = Buffer.from(signature).toString('base64url').replace(/=/g, '');"
              },
              {
                step: 4,
                title: "Parent Stores Delegation",
                description: "Parent stores the signed delegation record for future reference",
                storageFormat: {
                  delegateId: "researcher-sub-001",
                  publicKey: "dGVzdHB1YmxpY2tleWJhc2U2NHVybGVuY29kZWQ",
                  parentSignature: "abc123...",
                  issuerTokenId: "aaaaaaaaaaaa",
                  timestamp: 1714224000,
                  status: "active",
                  capabilities: ["web_search", "read", "memory_search"],
                  createdAt: "2026-04-27T10:19:00Z"
                }
              },
              {
                step: 5,
                title: "Subagent Generates HOLA",
                description: "Subagent generates HOLA using its OWN private key (not parent's)",
                format: "HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<timestamp>:<noncets>:API.IDENTYCLAW.COM:<signature>:<checksum>",
                critical: "Signature MUST be created with SUBAGENT's private key, not parent's"
              },
              {
                step: 6,
                title: "Peer Verifies Delegation",
                description: "Peer verifies both the HOLA signature and the delegation authorization",
                verificationSteps: [
                  "1. Verify HOLA signature using /api/identity/verify",
                  "2. Verify delegation authorization using /api/isauthorizedsigner",
                  "3. Check both verifications pass",
                  "4. Optionally check delegation hasn't been revoked"
                ]
              }
            ]
          },
          
          apiEndpoints: {
            title: "Key API Endpoints",
            endpoints: [
              {
                method: "POST",
                path: "/api/identity/verify",
                purpose: "Verify HOLA handshake (both standard and subagent formats)",
                authentication: "Required (JWT)",
                requestBody: {
                  hello: "HOLA message (standard or subagent format)",
                  constraints: {
                    maxAgeMs: 300000
                  }
                },
                responseFields: {
                  verified: "boolean - true if all checks pass",
                  isSubagentFormat: "boolean - true if subagent format detected",
                  delegateId: "string - subagent's delegate ID (subagent format only)",
                  issuerTokenId: "string - parent's token ID (subagent format only)",
                  checks: "object - detailed validation results",
                  failureReasons: "array - reasons for failure if verified=false"
                }
              },
              {
                method: "POST",
                path: "/api/isauthorizedsigner",
                purpose: "Verify if a public key is authorized by a parent agent",
                authentication: "Required (JWT)",
                requestBody: {
                  tokenId: "Parent's RODiT token ID (12 lowercase letters)",
                  base64HashOrDelegateSignerId: "Subagent's delegate ID",
                  unixTimestamp: "When authorization was granted",
                  publicKey: "Subagent's Ed25519 public key (base64url)",
                  signature: "Parent's signature over tokenId:delegateId:timestamp:publicKey"
                },
                responseFields: {
                  authorized: "boolean - true if signature verifies",
                  checks: "object - validation results",
                  failureReasons: "array - reasons for failure if authorized=false"
                }
              },
              {
                method: "GET",
                path: "/api/holanonce16ts",
                purpose: "Get nonce for HOLA message generation",
                authentication: "Required (JWT)",
                responseFields: {
                  noncets: "string - Contains hex nonce (extract 32 hex chars)",
                  timestamp: "string - ISO 8601 timestamp",
                  algorithm: "string - CSPRNG algorithm used"
                }
              }
            ]
          },
          
          openclawIntegration: {
            title: "OpenClaw Integration",
            spawningSubagents: {
              description: "Use OpenClaw's sessions_spawn to create subagents",
              example: "subagent = sessions_spawn(\n  task='You are a researcher subagent. Your delegate ID is \"researcher-sub-001\". Generate your own Ed25519 keypair and request authorization from your parent.',\n  runtime='subagent',\n  model='glm-4.7'\n)"
            },
            managingDelegations: {
              description: "Store delegations in workspace for tracking and revocation",
              workspaceStructure: {
                "delegations.json": "Subagent authorization records",
                "scripts/spawn_subagent.py": "Spawn subagent with keypair",
                "scripts/authorize_subagent.py": "Parent signs delegation",
                "scripts/verify_subagent.py": "Verify subagent HOLA",
                "memory/2026-04-27.md": "Log subagent activities"
              }
            }
          },
          
          troubleshooting: {
            title: "Common Issues & Solutions",
            issues: [
              {
                error: "signature_invalid (subagent HOLA)",
                cause: "Subagent signed with wrong key (parent's instead of own)",
                symptoms: [
                  "HOLA verification fails with signature_invalid",
                  "All other checks pass"
                ],
                solutions: [
                  "Verify subagent uses its OWN private key for HOLA signature",
                  "Parent's key is only used for delegation signature (/api/isauthorizedsigner)",
                  "Check signed message format matches subagent format exactly"
                ],
                codeCheck: "// Wrong ❌\nsignature = parentKey.sign(prefix);\n\n// Correct ✅\nsignature = subagentKey.sign(prefix);"
              },
              {
                error: "HELLO_FORMAT_INVALID",
                cause: "Wrong number of fields in HOLA message",
                symptoms: [
                  "Error says 'Expected standard format (8 fields) or subagent format (11 fields)'",
                  "HOLA parsing fails"
                ],
                solutions: [
                  "Standard format: 8 fields total",
                  "Subagent format: 11 fields total (3 extra: delegateID, issuer_tokenId, publicKey)",
                  "Count colons - should be 7 for standard, 10 for subagent",
                  "Verify field order matches specification exactly"
                ]
              },
              {
                error: "HELLO_DELEGATE_ID_INVALID",
                cause: "delegateID is missing or wrong length",
                symptoms: [
                  "Subagent HOLA rejected",
                  "Error mentions delegateID validation"
                ],
                solutions: [
                  "delegateID must be 1-128 characters",
                  "Use descriptive IDs: 'researcher-sub-001' not 'abc'",
                  "delegateID must match what was used in /api/isauthorizedsigner"
                ]
              },
              {
                error: "subagent_public_key_invalid_length",
                cause: "Public key in HOLA is not 32 bytes when decoded",
                symptoms: [
                  "HOLA verification fails",
                  "Error mentions public key length"
                ],
                solutions: [
                  "Public key must be base64url-encoded Ed25519 key (32 bytes)",
                  "Encoded length should be 43 characters (no padding)",
                  "Verify: Buffer.from(publicKey, 'base64url').length === 32"
                ]
              },
              {
                error: "publicKeyAuthorizationFailed (/api/isauthorizedsigner)",
                cause: "Parent signature is invalid or timestamp mismatch",
                symptoms: [
                  "/api/isauthorizedsigner returns authorized: false",
                  "Delegation verification fails"
                ],
                solutions: [
                  "Verify parent signed correct message: tokenId:delegateId:timestamp:publicKey",
                  "Ensure timestamp matches delegation record exactly",
                  "Check parent's private key is correct",
                  "Verify signature is base64url-encoded (no padding)"
                ],
                codeCheck: "// Wrong ❌\nmessage = `${delegateId}:${publicKey}`; // Missing fields!\n\n// Correct ✅\nmessage = `${tokenId}:${delegateId}:${timestamp}:${publicKey}`;"
              }
            ]
          },
          
          bestPractices: {
            title: "Best Practices",
            practices: [
              {
                practice: "Subagent generates own keypair",
                why: "Prevents parent from impersonating subagent",
                how: "Subagent runs nacl.sign.keyPair() locally, never shares private key"
              },
              {
                practice: "Use descriptive delegate IDs",
                why: "Makes delegation tracking and auditing easier",
                examples: ["researcher-sub-001", "data-analyst-v2", "compliance-checker"]
              },
              {
                practice: "Store delegations securely",
                why: "Enables revocation and audit trails",
                how: "Use encrypted files or secure database, include timestamps and capabilities"
              },
              {
                practice: "Rotate keys periodically",
                why: "Limits exposure if key is compromised",
                how: "Revoke old delegation, generate new keypair, request new authorization"
              },
              {
                practice: "Log all authorizations",
                why: "Provides audit trail for security reviews",
                how: "Keep memory files with delegation events: created, used, revoked"
              },
              {
                practice: "Implement revocation",
                why: "Parent must be able to terminate subagent access",
                how: "Maintain revocation list, check before accepting subagent HOLA"
              }
            ]
          },
          
          quickReference: {
            title: "Quick Reference Card",
            standardHOLA: "HOLA:<recipient>:<tokenId>:<timestamp>:<noncets>:API.IDENTYCLAW.COM:<sig>:<checksum>",
            subagentHOLA: "HOLA:<recipient>:<delegateID>:<issuer_tokenId>:<publicKey>:<timestamp>:<noncets>:API.IDENTYCLAW.COM:<sig>:<checksum>",
            delegationMessage: "{tokenId}:{delegateId}:{timestamp}:{publicKey}",
            keyDifference: "Subagent signs HOLA with its OWN key, parent signs delegation with parent's key",
            verificationFlow: "1. Verify HOLA (/api/identity/verify) → 2. Verify delegation (/api/isauthorizedsigner) → 3. Both must pass"
          }
        };
        
        return { type: "application/json", content: subagentsGuide };
      } catch (error) {
        logger.error("Failed to load subagents guide for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "jsonld:contract-metadata") {
      try {
        const { blockchainService } = require("@rodit/rodit-auth-be");
        const contractId = config.get("NEAR_CONTRACT_ID");
        
        const metadata = await blockchainService.nearorg_rpc_call(
          contractId,
          "rodit_metadata_jsonld",
          {}
        );
        
        if (!metadata) {
          throw new Error("Contract returned null metadata");
        }
        
        const parsedMetadata = JSON.parse(metadata);
        return { type: "application/ld+json", content: parsedMetadata };
      } catch (error) {
        logger.error("Failed to fetch contract metadata from contract", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri.startsWith("did:resolve:")) {
      try {
        const tokenId = uri.split(":")[2];
        if (!tokenId || tokenId.length !== 12) {
          throw new Error("Invalid token ID format");
        }

        const nearIdentityService = require("../services/near-identity.service");
        const { decodeFacialTokenId } = require("../services/facialTokenId");
        
        const token = await nearIdentityService.getToken(tokenId);
        if (!token || !token.token_id) {
          throw new Error("RODiT token not found");
        }

        const ownerAccountId = token.owner_id;
        const { blockchainService } = require("@rodit/rodit-auth-be");
        
        const publicKeyBytes = await blockchainService.nearorg_rpc_fetchpublickeybytes(ownerAccountId);
        
        const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        function encodeBase58(input) {
          if (!input) return "";
          const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
          if (buffer.length === 0) return "";
          const digits = [0];
          for (let i = 0; i < buffer.length; i += 1) {
            let carry = buffer[i];
            for (let j = 0; j < digits.length; j += 1) {
              const value = digits[j] * 256 + carry;
              digits[j] = value % 58;
              carry = Math.floor(value / 58);
            }
            while (carry > 0) {
              digits.push(carry % 58);
              carry = Math.floor(carry / 58);
            }
          }
          let leadingZeroCount = 0;
          while (leadingZeroCount < buffer.length && buffer[leadingZeroCount] === 0) {
            leadingZeroCount += 1;
          }
          let result = "";
          for (let i = 0; i < leadingZeroCount; i += 1) {
            result += BASE58_ALPHABET[0];
          }
          for (let i = digits.length - 1; i >= 0; i -= 1) {
            result += BASE58_ALPHABET[digits[i]];
          }
          return result;
        }
        
        const publicKeyBase58 = encodeBase58(Buffer.from(publicKeyBytes));
        
        const primaryDid = `did:rodit:${tokenId}`;
        const verificationMethodId = `${primaryDid}#controller`;
        const metadata = token.metadata || {};
        
        const requestHost = req.get("host");
        const baseUrl = requestHost ? `${req.protocol}://${requestHost}` : null;
        const mcpDiscoveryEndpoint = baseUrl ? `${baseUrl}/api/mcp/resources` : "/api/mcp/resources";
        
        const didDocument = {
          "@context": [
            "https://www.w3.org/ns/did/v1",
            {
              rodit: "https://identityclaw.com/ns/rodit#",
              IdentityVerification: "https://identityclaw.com/ns/services#IdentityVerification",
              RoditTokenMetadata: "https://identityclaw.com/ns/services#RoditTokenMetadata"
            }
          ],
          id: primaryDid,
          controller: token.owner_id,
          verificationMethod: [
            {
              id: verificationMethodId,
              type: "Ed25519VerificationKey2020",
              controller: primaryDid,
              publicKeyBase58
            }
          ],
          authentication: [verificationMethodId],
          assertionMethod: [verificationMethodId],
          service: [
            {
              id: `${primaryDid}#metadata`,
              type: "RoditTokenMetadata",
              serviceEndpoint: {
                type: "RODiTMetadataDocument",
                tokenId: token.token_id,
                ownerAccountId: token.owner_id,
                subjectUniqueIdentifier: metadata.subjectuniqueidentifier_url || null,
                serviceProviderId: metadata.serviceprovider_id || null,
                metadata
              }
            },
            {
              id: `${primaryDid}#mcp-discovery`,
              type: "MCPDiscoveryService",
              serviceEndpoint: mcpDiscoveryEndpoint
            }
          ]
        };
        
        return { type: "application/json", content: didDocument };
      } catch (error) {
        logger.error("Failed to resolve DID for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    if (uri === "token:facial-categories") {
      try {
        const { FACE_CATEGORIES } = require("../services/facialTokenId");
        
        const CHARSET_EVEN = ['b', 'c', 'a', 'e', 'u', 'g'];
        const CHARSET_ODD = ['d', 'f', 'h', 'j', 'k', 'm', 'n', 'p', 'q', 'r', 't', 'v', 'w', 'x', 'y'];
        
        const POSITION_CHARSETS = [
          { position: 0, charset: CHARSET_EVEN, category: "overall_structure" },
          { position: 1, charset: CHARSET_ODD, category: "face_shape" },
          { position: 2, charset: CHARSET_EVEN, category: "age_related" },
          { position: 3, charset: CHARSET_ODD, category: "regional_bone_structure" },
          { position: 4, charset: CHARSET_EVEN, category: "lips" },
          { position: 5, charset: CHARSET_ODD, category: "hair_color" },
          { position: 6, charset: CHARSET_EVEN, category: "eyebrow_style" },
          { position: 7, charset: CHARSET_ODD, category: "eyes" },
          { position: 8, charset: CHARSET_EVEN, category: "skin_conditions" },
          { position: 9, charset: CHARSET_ODD, category: "skin_tones" },
          { position: 10, charset: CHARSET_EVEN, category: "nose" },
          { position: 11, charset: CHARSET_ODD, category: "checksum" }
        ];
        
        const facialCategoriesResource = {
          title: "Facial Token ID Categories and Checksum Algorithm",
          description: "Complete reference for the 11 facial categories used in RODiT token_id encoding, including character mappings and checksum calculation",
          
          categories: FACE_CATEGORIES.map(cat => ({
            name: cat.name,
            valueCount: cat.values.length,
            values: cat.values
          })),
          
          characterSets: {
            evenPositions: {
              positions: [0, 2, 4, 6, 8, 10],
              charset: CHARSET_EVEN,
              description: "6 characters used for even positions in token_id"
            },
            oddPositions: {
              positions: [1, 3, 5, 7, 9, 11],
              charset: CHARSET_ODD,
              description: "15 characters used for odd positions in token_id (including checksum)"
            }
          },
          
          positionMapping: POSITION_CHARSETS.map(pm => ({
            position: pm.position,
            charset: pm.charset,
            charsetType: pm.position % 2 === 0 ? "even" : "odd",
            category: pm.category
          })),
          
          checksumAlgorithm: {
            description: "Checksum is calculated as the sum of all category indices modulo the length of CHARSET_ODD (15)",
            formula: "checksumIndex = (index0 + index1 + index2 + ... + index10) % 15",
            steps: [
              "1. For each of the 11 facial categories, determine the index of the selected value (0-based)",
              "2. Sum all 11 indices together",
              "3. Take the modulo of the sum by 15 (length of CHARSET_ODD)",
              "4. The result is the checksum index",
              "5. Map the checksum index to a character using CHARSET_ODD",
              "6. This character is placed at position 11 (the 12th character) of the token_id"
            ],
            example: {
              indices: [0, 7, 2, 5, 1, 8, 3, 4, 0, 6, 2],
              sum: 38,
              checksumIndex: 38 % 15,
              checksumIndexResult: 8,
              checksumCharacter: CHARSET_ODD[8],
              explanation: "Sum of indices (38) modulo 15 equals 8, which maps to character 'm' in CHARSET_ODD"
            }
          },
          
          tokenIdStructure: {
            format: "12-character string using safe charset (bcdfghjklmnpqrstvwxyz)",
            positions: POSITION_CHARSETS.map(pm => ({
              position: pm.position,
              category: pm.category,
              charset: pm.charset,
              description: pm.category === "checksum" ? "Checksum character (sum of indices % 15)" : `Facial category: ${pm.name}`
            })),
            validation: {
              pattern: "^[bcdfghjklmnpqrstvwxyz]{12}$",
              description: "Must be exactly 12 characters from the safe charset (consonants only, no vowels)"
            }
          },
          
          examples: {
            validTokenIds: [
              "bcdfhjkmnpqr",
              "bcdflhsjzgkj",
              "dfhjkmnpqrtv"
            ],
            decodingExample: {
              tokenId: "bcdfhjkmnpqr",
              breakdown: [
                { position: 0, character: "b", category: "overall_structure", index: 1, value: "feminine" },
                { position: 1, character: "c", category: "face_shape", index: 1, value: "round-faced" },
                { position: 2, character: "d", category: "age_related", index: 1, value: "young-adult-25" },
                { position: 3, character: "f", category: "regional_bone_structure", index: 2, value: "Slavic" },
                { position: 4, character: "h", category: "lips", index: 2, value: "pouty-lips" },
                { position: 5, character: "j", category: "hair_color", index: 3, value: "light-brown-hair" },
                { position: 6, character: "k", category: "eyebrow_style", index: 3, value: "arched-eyebrows" },
                { position: 7, character: "m", category: "eyes", index: 4, value: "close-set-eyes" },
                { position: 8, character: "n", category: "skin_conditions", index: 4, value: "lined" },
                { position: 9, character: "p", category: "skin_tones", index: 5, value: "dark-skinned" },
                { position: 10, character: "q", category: "nose", index: 5, value: "flared-nose" },
                { position: 11, character: "r", category: "checksum", checksum: true }
              ],
              checksumVerification: {
                indices: [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
                sum: 31,
                checksumIndex: 31 % 15,
                result: 1,
                expectedCharacter: CHARSET_ODD[1],
                actualCharacter: "r",
                valid: false,
                note: "This is a hypothetical example for illustration"
              }
            }
          }
        };
        
        return { type: "application/json", content: facialCategoriesResource };
      } catch (error) {
        logger.error("Failed to load facial categories for MCP resource", {
          component: "MCPRoutes",
          method: "getResource",
          uri,
          error: error.message
        });
        throw new Error("Resource unavailable");
      }
    }
    const error = new Error(`Unknown resource: ${uri}`);
    error.statusCode = 404;
    throw error;
  },

  async getSchemaResource(req) {
    return loadSwaggerSpec();
  }
};

router.get("/resources", async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("MCPRoutes", "listResources", {
    requestId,
    endpoint: "/resources",
    ip: req.ip
  });

  try {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      cursor: req.query.cursor
    };

    const result = await mcpService.listAvailableResources(req, options);
    const duration = Date.now() - startTime;

    logger.infoWithContext("MCP resources listed", {
      ...context,
      resourceCount: result.resources?.length || 0,
      hasNextCursor: !!result.nextCursor,
      duration
    });

    logger.metric("mcp_list_resources", duration, {
      operation: "listResources",
      result: "success",
      resourceCount: result.resources?.length || 0
    });

    res.json({
      ...result,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error listing MCP resources",
      { ...context, duration },
      error,
      "mcp_list_resources_error",
      { operation: "listResources", result: "error", duration }
    );

    sendError(res, {
      statusCode: 500,
      requestId,
      code: "MCP_LIST_FAILED",
      message: "Failed to list resources",
      details: error.message
    });
  }
});

router.get("/resource/:uri(*)", async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();
  const uri = req.params.uri;

  const context = logger.createLogContext("MCPRoutes", "getResource", {
    requestId,
    endpoint: "/resource/:uri",
    uri,
    ip: req.ip
  });

  try {
    const resource = await mcpService.getResource(uri, req);

    const duration = Date.now() - startTime;

    logger.infoWithContext("MCP resource retrieved", {
      ...context,
      type: resource?.type,
      duration
    });

    logger.metric("mcp_get_resource", duration, {
      operation: "getResource",
      result: "success",
      resourceType: resource?.type
    });

    res.json({
      ...resource,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const statusCode = error.statusCode || 500;
    
    logger.logErrorWithMetrics(
      "Error retrieving MCP resource",
      { ...context, duration, statusCode },
      error,
      "mcp_get_resource_error",
      { operation: "getResource", result: "error", duration, statusCode }
    );

    sendError(res, {
      statusCode,
      requestId,
      code: statusCode === 404 ? "MCP_RESOURCE_NOT_FOUND" : "MCP_RESOURCE_FAILED",
      message: statusCode === 404 ? "Resource not found" : "Failed to get resource",
      details: { uri, error: error.message }
    });
  }
});

router.get("/schema", async (req, res) => {
  const requestId = req.requestId || ulid();

  const schema = await mcpService.getSchemaResource(req);
  res.json({
    schema,
    requestId
  });
});

module.exports = router;
module.exports.mcpService = mcpService;
