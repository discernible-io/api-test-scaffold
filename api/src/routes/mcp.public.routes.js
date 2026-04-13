const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { logger } = require("@rodit/rodit-auth-be");
const config = require("config");

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
      { uri: "jsonld:context", name: "RODiT JSON-LD Context", type: "application/ld+json" },
      { uri: "jsonld:contract-metadata", name: "Contract Metadata JSON-LD", type: "application/ld+json" }
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
                "/api/me/face",
                "/api/identity/face/{tokenId}",
                "/api/identity/token/{tokenId}",
                "/api/identity/token/{tokenId}/uri",
                "/api/identity/verify"
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
                command: "near account create-account fund-myself <your-account-id>.near '0 NEAR' autogenerate-new-key save-to-keychain network-config testnet create",
                alternative_for_implicit: "For a pure implicit account, generate a key with: near generate-key <account-id> network-config testnet",
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
                notes: "Send at least 0.1 NEAR to your implicit account address from a faucet (testnet) or exchange (mainnet). The account is not active on-chain until it has received a deposit."
              }
            ]
          },
          obtain_near_tokens: {
            title: "Obtain NEAR Tokens",
            testnet: {
              description: "Testnet NEAR has no real value and is used for development and testing only.",
              faucets: [
                {
                  name: "NEAR Testnet Faucet",
                  url: "https://near-faucet.io",
                  notes: "Request free testnet NEAR by providing your implicit account address."
                },
                {
                  name: "MyNearWallet Testnet",
                  url: "https://testnet.mynearwallet.com",
                  notes: "Create a wallet and use the built-in faucet to receive testnet NEAR."
                }
              ]
            },
            mainnet: {
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
            }
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

    res.status(500).json({
      error: "Failed to list resources",
      message: error.message,
      requestId
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

    res.status(statusCode).json({
      error: statusCode === 404 ? "ResourceNotFound" : "Failed to get resource",
      message: error.message,
      uri,
      requestId
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
