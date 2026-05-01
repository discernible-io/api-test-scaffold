/**
 * Centralized How-To Configuration
 * 
 * Single source of truth for all how-to guides and usage information.
 * Includes enrollment, login, agent-to-agent authentication, and identity documentation.
 * Update this file to propagate changes across all endpoints and documentation.
 */

module.exports = {
  // ⚠️ CRITICAL INSTRUCTIONS FOR AI AGENTS ⚠️
  agentInstructions: {
    title: "🤖 INSTRUCTIONS FOR AI AGENTS - READ THIS FIRST",
    mandatoryBehavior: [
      "❌ DO NOT attempt to 'figure out' or 'discover' alternative methods",
      "❌ DO NOT improvise or deviate from the exact commands provided",
      "❌ DO NOT skip steps or combine steps unless explicitly instructed",
      "❌ DO NOT use a NEAR seed phrase / recovery phrase to derive an Ed25519 keypair for signing (this causes key mismatches)",
      "✅ DO use the 'private_key' value from your ~/.near-credentials/.../<account>.json file directly for signing",
      "❌ DO NOT generate your own timestamps - use /api/login/timestamp",
      "✅ DO follow the step-by-step instructions EXACTLY as written",
      "✅ DO use the exact commands provided in each step",
      "✅ DO verify each step using the provided verification commands",
      "✅ DO read error messages and follow the troubleshooting guides"
    ],
    whyThisMatters: "These instructions have been carefully designed to avoid common pitfalls. Deviating from them will cause authentication failures, signature mismatches, and wasted time.",
    ifYouGetStuck: "If a step fails, consult the 'commonErrors' section or the troubleshooting guide for that specific step. Do NOT try alternative approaches."
  },

  // Terminology Alignment (used across all docs)
  terminology: {
    title: "Terminology: Identity, Passport, and Wallet",
    entries: [
      {
        term: "IdentityClaw Passport",
        alsoCalled: ["RODiT token", "identity token"],
        definition: "Product name for the on-chain RODiT identity that represents an agent. Implemented as a RODiT token on NEAR.",
        preferredUsage: "Use 'RODiT token (IdentityClaw Passport)' on first mention, then 'RODiT token'."
      },
      {
        term: "RODiT",
        alsoCalled: ["RODiT token"],
        definition: "Underlying identity token technology and DID method. Tokens are minted on NEAR and used for HOLA verification.",
        preferredUsage: "Use 'RODiT token' when referring to an agent's identity object."
      },
      {
        term: "NEAR implicit account",
        alsoCalled: ["wallet", "NEAR account"],
        definition: "The cryptographic keypair (wallet) that holds and controls the RODiT token. Ownership is recorded on-chain as owner_id.",
        preferredUsage: "Use 'NEAR implicit account (wallet)' on first mention, then 'wallet'."
      }
    ]
  },

  // Understanding NEAR Implicit Accounts and RODiT Tokens
  nearImplicitAccountAndRoditRelationship: {
    title: "🔑 Understanding NEAR Implicit Accounts and RODiT Tokens",
    description: "The fundamental relationship between your NEAR account and your RODiT identity",
    
    criticalConcept: {
      title: "The Core Concept",
      explanation: "The RODiT token IS your identity. The NEAR implicit account is the wallet (keypair) that holds and controls it. You authenticate by proving you control the wallet that owns your identity. This creates a portable identity that can be verified independently (on-chain + signature verification) without per-service registration.",
      
      analogy: {
        roditToken: "Your RODiT token = Your IDENTITY (who you are as an agent)",
        nearAccount: "Your NEAR implicit account = Your WALLET (the cryptographic container that holds your identity)",
        relationship: "Just like your physical wallet holds your ID card, your NEAR account (wallet) holds your RODiT token (identity). You prove ownership by signing with the wallet's private key."
      }
    },
    
    technicalBreakdown: {
      title: "Technical Architecture",
      
      roditToken: {
        what: "A RODiT token is YOUR IDENTITY - the on-chain identity that represents you as an agent",
        format: "12 lowercase letters (e.g., saaddbbadbbf)",
        components: [
          "token_id - Your unique identity identifier (e.g., 'saaddbbadbbf')",
          "owner_id - Which wallet (NEAR account) currently holds this identity",
          "metadata - Your facial features and other identity attributes"
        ],
        purpose: "This IS YOU - your agent identity in the IdentityClaw system. This is what you authenticate AS.",
        storage: "Stored on NEAR blockchain in the RODiT smart contract (2026v1-identyclaw-com.near)"
      },
      
      nearImplicitAccount: {
        what: "A NEAR implicit account is YOUR WALLET - a cryptographic keypair that holds your RODiT identity",
        format: "64 hexadecimal characters (e.g., 43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac)",
        components: [
          "Public key (ed25519:...) - Your wallet's public address",
          "Private key (ed25519:...) - Your wallet's secret key (NEVER share!)",
          "Account ID - The 64-hex string derived from your public key"
        ],
        purpose: "This is your WALLET - the cryptographic container that holds and controls your RODiT identity. You use the private key to prove you control this wallet.",
        storage: "Stored in ~/.near-credentials/mainnet/<account-id>.json"
      },
      
      theConnection: {
        title: "How They Work Together",
        ownership: "Your WALLET (NEAR account) HOLDS your IDENTITY (RODiT token). The blockchain records: owner_id=<your-wallet-address>",
        authentication: "To login, you prove you control the wallet that holds your identity: (1) Specify which identity (roditid), (2) Sign with the wallet's private key",
        verification: "The API checks: Does this signature come from the wallet that holds this RODiT identity?"
      }
    },
    
    commonMisunderstandings: {
      title: "Common Misunderstandings Agents Have",
      mistakes: [
        {
          mistake: "Thinking the RODiT token ID is the wallet address",
          reality: "NO! Your IDENTITY (token ID, 12 letters) is different from your WALLET (account ID, 64 hex chars). The wallet HOLDS the identity.",
          example: "Wallet: 43d3c5b5e77a... HOLDS Identity: saaddbbadbbf"
        },
        {
          mistake: "Trying to sign with the identity (token ID)",
          reality: "NO! You sign with your WALLET's private key, not your identity. The identity is what you're authenticating AS, the wallet is what you're authenticating WITH.",
          example: "Sign with: ed25519:<base58-private-key> from your wallet file ~/.near-credentials/mainnet/<wallet-id>.json"
        },
        {
          mistake: "Thinking you can login with just the wallet or just the identity",
          reality: "NO! You need BOTH. The roditid tells the API WHICH identity you are, and the signature proves you control the wallet that holds that identity.",
          example: "Login requires: roditid='saaddbbadbbf' (your identity) + signature from wallet 43d3c5b5e77a... (proves you control it)"
        },
        {
          mistake: "Not understanding why the private key matters",
          reality: "The private key is HOW you prove you control the wallet. Without it, you can't sign messages, and without signatures, you can't prove the identity is yours.",
          example: "Private key → Signature → Proves wallet control → Proves identity ownership → API access"
        },
        {
          mistake: "Confusing 'implicit account' with 'named account'",
          reality: "Implicit accounts (wallets) use 64-hex format derived from public key. Named accounts use human-readable names like 'alice.near'. IdentityClaw uses implicit account wallets.",
          example: "Implicit wallet: 43d3c5b5e77a... vs Named wallet: alice.near"
        }
      ]
    },
    
    authenticationFlow: {
      title: "How Authentication Actually Works",
      steps: [
        {
          step: 1,
          action: "Agent provides roditid (their identity)",
          example: "roditid: 'saaddbbadbbf'",
          whatHappens: "API looks up this identity on the blockchain to find which wallet holds it (owner_id)"
        },
        {
          step: 2,
          action: "API finds which wallet holds this identity",
          example: "owner_id (wallet): '43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac'",
          whatHappens: "API now knows which wallet should be signing this request"
        },
        {
          step: 3,
          action: "Agent provides signature over (roditid + timestamp_iso)",
          example: "Signature created using wallet's private key from ~/.near-credentials/mainnet/43d3c5b5e77a....json",
          whatHappens: "API extracts the public key from the signature to verify which wallet signed it"
        },
        {
          step: 4,
          action: "API verifies signature matches the wallet that holds this identity",
          example: "Does signature's public key == the wallet that holds identity 'saaddbbadbbf'?",
          whatHappens: "If YES: Agent controls the wallet holding this identity → Authentication succeeds. If NO: Error 035"
        },
        {
          step: 5,
          action: "API issues JWT token",
          example: "JWT contains: identity='saaddbbadbbf', wallet='43d3c5b5e77a...'",
          whatHappens: "Agent can now access protected endpoints as identity 'saaddbbadbbf'"
        }
      ]
    },
    
    practicalExample: {
      title: "Practical Example: Complete Flow",
      scenario: "Agent wants to login to IdentityClaw API",
      
      whatYouHave: {
        yourIdentity: "saaddbbadbbf (your RODiT identity - who you are)",
        yourWallet: "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac (NEAR account that holds your identity)",
        walletPrivateKey: "ed25519:5J7W... (base58, stored in ~/.near-credentials/mainnet/43d3c5b5e77a....json)"
      },
      
      step1_discoverToken: {
        command: "./scripts/roditwallet.sh 43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac",
        output: "bc=near.org;sc=2026v1-identyclaw-com.near;id=saaddbbadbbf",
        extract: "Token ID: saaddbbadbbf"
      },
      
      step2_getAuthParams: {
        command: "curl https://api.identyclaw.com/api/login/timestamp",
        response: {
          timestamp: 1776622758,
          timestamp_iso: "2026-04-19T18:19:18.000Z"
        }
      },
      
      step3_constructMessage: {
        message: "saaddbbadbbf2026-04-19T18:19:18.000Z",
        explanation: "roditid + timestamp_iso (no separator)"
      },
      
      step4_signMessage: {
        privateKey: "Decode base58 private key from credentials file",
        signWith: "Ed25519 using first 32 bytes as seed, full 64 bytes for signing",
        output: "base64url-encoded signature (e.g., 'A1B2C3D4...')"
      },
      
      step5_login: {
        endpoint: "POST /api/login",
        payload: {
          roditid: "saaddbbadbbf",
          timestamp: 1776622758,
          roditid_base64url_signature: "A1B2C3D4..."
        },
        response: {
          token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          message: "Login successful"
        }
      },
      
      whyItWorks: [
        "1. API looks up identity 'saaddbbadbbf' → finds it's held by wallet '43d3c5b5e77a...'",
        "2. API verifies signature was created by wallet '43d3c5b5e77a...' private key",
        "3. Signature matches → Agent controls the wallet that holds this identity → Access granted"
      ]
    },
    
    keyTakeaways: {
      title: "Key Takeaways for AI Agents",
      points: [
        "🎫 Your RODiT token (12-letter) IS your IDENTITY - who you are",
        "🔑 Your NEAR account (64-hex) IS your WALLET - what holds your identity",
        "🔗 The wallet HOLDS the identity (recorded on blockchain as owner_id)",
        "✍️ You SIGN with your wallet's private key, not your identity",
        "🔐 Authentication proves: You control the wallet that holds this identity",
        "🌐 Your identity is portable: you can use the same RODiT identity across services/channels by proving key ownership (no per-service registration)",
        "🔎 Verification is independent: any verifier can check on-chain ownership + Ed25519 signatures without needing to trust a centralized identity authority",
        "📝 Both are required: roditid (which identity) + signature (which wallet controls it)",
        "⚠️ Never confuse identity (token ID) with wallet (account ID) - completely different things"
      ]
    },
    
    visualDiagram: {
      title: "Visual Relationship",
      ascii: `
┌─────────────────────────────────────────────────────────────────┐
│ RODiT Token - YOUR IDENTITY (Who You Are)                      │
│ Token ID: saaddbbadbbf                                          │
│                                                                 │
│ This is YOU - your agent identity in IdentityClaw              │
│   • token_id: saaddbbadbbf (your unique identity)              │
│   • facial features: {...} (your attributes)                    │
│   • owner_id: 43d3c5b5e77a... (which wallet holds you)         │
│                                                                 │
│ Held by ↓                                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ ownership recorded on blockchain
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ NEAR Implicit Account - YOUR WALLET (What Holds Your Identity) │
│ Wallet ID: 43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e... │
│                                                                 │
│ This is your cryptographic wallet that holds your identity:    │
│   • Public Key:  ed25519:ABC123... (wallet address)            │
│   • Private Key: ed25519:XYZ789... (SECRET - proves control)   │
│                                                                 │
│ Used for ↓                                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ sign to prove wallet control
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ IdentityClaw API Access                                         │
│                                                                 │
│ Authentication:                                                 │
│   1. Provide identity: "saaddbbadbbf" (who you are)            │
│   2. Sign with wallet private key (prove you control it)       │
│   3. API verifies: signature from wallet holding this identity │
│   4. Access granted → JWT issued for identity "saaddbbadbbf"   │
└─────────────────────────────────────────────────────────────────┘
      `
    }
  },

  // Quick Reference: Authentication Types
  authenticationQuickReference: {
    title: "Authentication Quick Reference",
    description: "Two different authentication mechanisms - choose the right one for your use case",
    
    comparison: {
      headers: ["Feature", "API Login (/api/login)", "HOLA (Agent-to-Agent)"],
      rows: [
        {
          feature: "Purpose",
          apiLogin: "🔐 Authenticate with the API server",
          hola: "🤝 Prove identity to another agent (peer-to-peer)"
        },
        {
          feature: "Endpoint",
          apiLogin: "POST /api/login",
          hola: "POST /api/identity/verify (to verify HOLA)"
        },
        {
          feature: "Message Format",
          apiLogin: "roditid + timestamp_iso",
          hola: "HOLA/<recipient>/<tokenId>/<ISO8601-timestamp>/<noncets-hex>/API.IDENTYCLAW.COM/<base32-ed25519-signature>/<checksum>"
        },
        {
          feature: "Signed Content",
          apiLogin: "roditid + timestamp_iso (e.g., 'bkbvehbdcrgm2026-04-19T18:19:18.000Z')",
          hola: "HOLA/<recipient>/<tokenId>/<ISO8601-timestamp>/<noncets-hex>/API.IDENTYCLAW.COM/"
        },
        {
          feature: "Result",
          apiLogin: "Receive JWT token for API access",
          hola: "Cryptographic proof of identity ownership"
        },
        {
          feature: "Requires JWT?",
          apiLogin: "No - this is how you GET the JWT",
          hola: "Yes - need JWT to request nonces and verify HOLA"
        },
        {
          feature: "Used For",
          apiLogin: "Accessing protected server endpoints",
          hola: "Agent-to-agent trust establishment"
        },
        {
          feature: "Nonce Required?",
          apiLogin: "No - only timestamp",
          hola: "Yes - from /api/holanonce16ts endpoint"
        },
        {
          feature: "Checksum?",
          apiLogin: "No",
          hola: "Yes - hex checksum at the end"
        }
      ]
    },
    
    whenToUse: {
      apiLogin: {
        title: "Use /api/login when:",
        scenarios: [
          "You need to access protected API endpoints",
          "You want to get your own identity information (/api/me/identity)",
          "You need to request nonces (/api/holanonce16ts)",
          "You want to verify HOLA messages from other agents",
          "This is your FIRST step - you need a JWT before doing anything else"
        ]
      },
      hola: {
        title: "Use HOLA messages when:",
        scenarios: [
          "You need to prove your identity to another agent",
          "You want to establish trust with a peer agent",
          "You're implementing agent-to-agent communication",
          "You need decentralized verification without server trust decisions",
          "You ALREADY have a JWT token from /api/login"
        ]
      }
    },
    
    typicalFlow: {
      title: "Typical Authentication Flow",
      steps: [
        "1. Agent calls POST /api/login → receives JWT token",
        "2. Agent uses JWT to access protected endpoints",
        "3. (Optional) Agent requests nonce via GET /api/holanonce16ts (requires JWT)",
        "4. (Optional) Agent creates HOLA message to prove identity to peers",
        "5. (Optional) Other agents verify HOLA via POST /api/identity/verify (requires their own JWT)"
      ]
    }
  },

  // Core how to use information
  howToUse: {
    url: "https://purchase.identyclaw.com",
    faq: "https://purchase.identyclaw.com/faq",
    description: "Purchase and mint RODiT tokens for API access"
  },

  // Pricing & Fee Calculation
  pricing: {
    description: "Three pricing tiers with different rate limits and fee structures. Fees are calculated based on days until expiration.",
    
    feeCalculationOverview: {
      title: "How Fees Are Calculated",
      description: "All fees are calculated based on the number of days until expiration. The tier determines the fee structure.",
      constants: {
        ONE_DAY_MS: "24 * 60 * 60 * 1000",
        MIN_FEE: "0.018 NEAR (Personal tier minimum)",
        BASELINE_REQUESTS: 100,
        BASELINE_WINDOW: 3600,
        BASELINE_DAYS: 365,
        BASELINE_FEE: "0.28 NEAR"
      }
    },

    tiers: [
      {
        name: "Personal",
        tierId: "personal",
        description: "Personal tier with formula-based variable fee",
        maxRequests: 48,
        maxrqWindow: 60,
        feeType: "formula-based",
        features: [
          "48 requests per minute (48/60s)",
          "Variable fee based on duration and rate limits",
          "Minimum fee: 0.018 NEAR (enforced floor)",
          "Full API access",
          "HOLA authentication protocol",
          "Identity verification and resolution"
        ],
        useCase: "Individual users and small-scale applications",
        
        feeCalculation: {
          formula: "perRoditNear = 0.28 * (maxRequests/100) * (3600/maxrqWindow) * (daysUntilExpiry/365)",
          enforceMinimum: "Math.max(perRoditNear, 0.018)",
          explanation: "Fee is multiplied by three factors: (1) request rate multiplier, (2) window multiplier, (3) duration multiplier",
          
          components: {
            requestMultiplier: {
              formula: "maxRequests / 100",
              baseline: "100 requests → 1.0x",
              examples: [
                "48 requests → 0.48x",
                "100 requests → 1.0x",
                "200 requests → 2.0x"
              ]
            },
            windowMultiplier: {
              formula: "3600 / maxrqWindow",
              baseline: "3600 seconds → 1.0x",
              examples: [
                "60 second window → 60x",
                "3600 second window → 1.0x",
                "7200 second window → 0.5x"
              ]
            },
            durationMultiplier: {
              formula: "daysUntilExpiry / 365",
              baseline: "365 days → 1.0x",
              examples: [
                "30 days → 0.0822x",
                "365 days → 1.0x",
                "730 days → 2.0x"
              ]
            }
          },
          
          examples: [
            {
              description: "48 requests, 60s window, 365 days (1 year)",
              calculation: "0.28 * (48/100) * (3600/60) * (365/365) = 0.28 * 0.48 * 60 * 1 = 8.064 NEAR"
            },
            {
              description: "100 requests, 3600s window, 365 days (baseline)",
              calculation: "0.28 * (100/100) * (3600/3600) * (365/365) = 0.28 * 1 * 1 * 1 = 0.28 NEAR"
            },
            {
              description: "48 requests, 60s window, 30 days",
              calculation: "0.28 * (48/100) * (3600/60) * (30/365) = 0.28 * 0.48 * 60 * 0.0822 = 0.662 NEAR (enforced to 0.018 NEAR minimum)"
            }
          ]
        }
      },
      {
        name: "Enterprise",
        tierId: "enterprise",
        description: "Enterprise tier with fixed yearly fee, prorated by days",
        maxRequests: 4999,
        maxrqWindow: 60,
        feeType: "fixed_yearly",
        yearlyFee: 1806,
        features: [
          "4,999 requests per minute (4999/60s)",
          "Fixed 1,806 NEAR per year, prorated by days until expiration",
          "Full API access",
          "HOLA authentication protocol",
          "Identity verification and resolution",
          "High-volume capacity"
        ],
        useCase: "Enterprise deployments and high-traffic applications",
        
        feeCalculation: {
          formula: "perRoditNear = 1806 * (daysUntilExpiry / 365)",
          explanation: "Fee is 1806 NEAR per year, multiplied by the fraction of a year remaining",
          dailyRate: "1806 / 365 = 4.945 NEAR per day",
          
          examples: [
            {
              description: "365 days (1 year)",
              calculation: "1806 * (365/365) = 1806 NEAR"
            },
            {
              description: "730 days (2 years)",
              calculation: "1806 * (730/365) = 3612 NEAR"
            },
            {
              description: "182.5 days (0.5 years)",
              calculation: "1806 * (182.5/365) = 903 NEAR"
            },
            {
              description: "30 days",
              calculation: "1806 * (30/365) = 148.27 NEAR"
            }
          ]
        }
      },
      {
        name: "Collectible",
        tierId: "collectible",
        description: "Collectible tier with fixed one-time fee and immortal tokens",
        maxRequests: 496,
        maxrqWindow: 60,
        feeType: "fixed_onetime",
        onetimeFee: 496,
        features: [
          "496 requests per minute (496/60s)",
          "Fixed 496 NEAR one-time fee (no renewal fees)",
          "Immortal tokens (expirationDate = '0', no expiration)",
          "Full API access",
          "HOLA authentication protocol",
          "Identity verification and resolution",
          "Permanent ownership"
        ],
        useCase: "Collectible tokens and permanent identity records",
        
        feeCalculation: {
          formula: "perRoditNear = 496 (fixed)",
          explanation: "Collectible tokens have a fixed fee of 496 NEAR, regardless of duration or request limits",
          immortal: "expirationDate = '0' (no expiration, lasts forever)",
          examples: [
            {
              description: "Any duration",
              calculation: "496 NEAR (always the same)"
            }
          ]
        }
      }
    ],
    
    tierUsage: {
      description: "When calling /api/signclient, include the 'tier' parameter to use tier-specific rate limits and fee calculations",
      example: {
        endpoint: "POST /api/signclient",
        body: {
          tier: "personal", // or "enterprise" or "collectible"
          tobesignedValues: {
            max_requests: 48,
            maxrq_window: 60,
            not_after: "2027-04-19T00:00:00Z",
            permissioned_routes: "{...}"
          },
          mintingfee: "8.064" // Must match server's tier-based calculation
        }
      }
    },
    
    validationChecklist: {
      title: "How to Validate Fee Calculations",
      steps: [
        {
          step: 1,
          title: "Check tier determination",
          details: [
            "Is expirationDate === '0'? → Collectible (496 NEAR fixed)",
            "Is maxRequests === 4999? → Enterprise (1806 NEAR/year)",
            "Otherwise? → Personal (formula-based)"
          ]
        },
        {
          step: 2,
          title: "Calculate days until expiry",
          formula: "daysUntilExpiry = Math.ceil((expirationDate - today) / (24*60*60*1000))",
          note: "Verify this matches frontend's daysUntilExpiry"
        },
        {
          step: 3,
          title: "For Enterprise tier",
          formula: "years = daysUntilExpiry / 365; perRoditNear = 1806 * years"
        },
        {
          step: 4,
          title: "For Personal tier",
          formula: "feeMultiplier = (maxRequests/100) * (3600/maxrqWindow) * (daysUntilExpiry/365); perRoditNear = Math.max(0.28 * feeMultiplier, 0.018)"
        },
        {
          step: 5,
          title: "Compare final fee",
          note: "Backend perRoditNear should match frontend's mintingfee"
        }
      ]
    }
  },

  // Step-by-step how to use process
  howToUseSteps: [
    {
      step: 1,
      title: "Create NEAR Account FIRST",
      description: "⚠️ IMPORTANT: You MUST create your NEAR implicit account (wallet) BEFORE purchasing the IdentityClaw Passport (RODiT token). Install gennearaccount and create an implicit NEAR account.",
      details: {
        command: "gennearaccount",
        exchange: "Purchase NEAR tokens from exchanges like Binance, Kraken, or Huobi",
        note: "The funding wallet does not need to be the same as the receiving implicit account. You can fund from any NEAR wallet. This account will receive your RODiT token (IdentityClaw Passport).",
        warning: "DO NOT skip this step! The purchase portal requires an existing NEAR account to mint your RODiT token to."
      }
    },
    {
      step: 2,
      title: "Purchase RODiT Token (IdentityClaw Passport)",
      description: "After creating your NEAR account, visit purchase.identyclaw.com to mint your RODiT token",
      details: {
        url: "https://purchase.identyclaw.com",
        requirements: [
          "✅ NEAR implicit account (created in Step 1)",
          "NEAR tokens for minting fees (~1 NEAR)",
          "Facial feature selection",
          "Creature field (your profession/role)"
        ],
        note: "You will need to provide your NEAR account ID from Step 1 during the purchase process",
        creatureFieldRecommendation: {
          title: "💡 Creature Field: Make Yourself Discoverable",
          description: "The 'Creature' field is a key part of your IdentityClaw Passport. Use it to indicate your profession or role so other agents can find you.",
          purpose: "The Creature field functions as a lightweight Yellow Pages, allowing other agents to discover you based on your professional specialization",
          examples: [
            "Legal Specialist",
            "Data Analyst",
            "SRE Engineer",
            "Compliance Officer",
            "Translator",
            "Majordomo",
            "Research Agent",
            "Security Auditor"
          ],
          recommendation: "Choose a clear, descriptive profession or role that accurately represents your capabilities. This helps other agents find you when they need your expertise. The more specific and accurate, the better the discovery experience.",
          discoveryMechanism: "Other agents can use the /api/agents endpoint to browse all agents and filter by creature type, making it easy to find specialists in specific domains",
          currentCapabilities: "Agents can browse all agents by creature type using pagination",
          plannedFeatures: "Direct search by creature type is a planned feature - currently agents must browse through paginated results to find specialists"
        },
        pseudoAnonymizationAdvice: {
          title: "🔐 Pseudo-Anonymize Your Passport Fields",
          description: "For sensitive fields in your IdentityClaw Passport, you can use a pseudo-anonymization technique that allows selective disclosure while maintaining privacy on the blockchain.",
          purpose: "Store cryptographic commitments (hashes) of your field values instead of plaintext. Only reveal the actual values to trusted peers by sharing the secret nonce privately.",
          howItWorks: {
            overview: "Instead of storing plaintext values in your passport metadata, store hash(nonce + value). The hash is publicly visible on the blockchain, but without the secret nonce, no one can determine the original value. When you want to prove a field's value to a trusted peer, privately share the nonce so they can verify the hash matches.",
            steps: [
              {
                step: 1,
                action: "Obtain a unique secret nonce for each field, optionally from /api/holanonce16ts",
                description: "Create a cryptographically random nonce (at least 32 bytes) for each field you want to pseudo-anonymize. Keep these nonces secure and never share them publicly.",
                example: "For 'name' field: generate nonce = 0x7f3a9c2b8d4e1f6a5c8b9d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2"
              },
              {
                step: 2,
                action: "Concatenate nonce with field value",
                description: "Combine the secret nonce with the actual field value. The order matters: nonce first, then value.",
                example: "nonce + 'John Doe' = 0x7f3a9c2b8d4e1f6a5c8b9d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2 + 'John Doe'"
              },
              {
                step: 3,
                action: "Compute hash of the concatenated value",
                description: "Hash the concatenated nonce+value using a cryptographic hash function (BLAKE3, SHA-256, or SHA-3). Store this hash in your passport metadata instead of the plaintext value.",
                example: "hash(nonce + 'John Doe') = 'a1b2c3d4e5f6...'"
              },
              {
                step: 4,
                action: "Store hash in passport, keep nonce secret",
                description: "Enter only the hash in the passport field during minting. Store the nonce securely offline (encrypted password manager, hardware wallet, etc.).",
                warning: "⚠️ NEVER share the nonce publicly. If the nonce is compromised, anyone can compute the original value."
              },
              {
                step: 5,
                action: "Selective disclosure to trusted peers",
                description: "When a trusted peer needs to verify a field value, privately share the nonce with them (via encrypted channel, direct message, etc.). They can then verify that hash(nonce + claimed_value) matches the hash in your passport.",
                example: "Peer receives nonce + 'John Doe', computes hash, and compares with passport hash. If match: value is verified."
              }
            ]
          },
          codeExamples: {
            javascript: {
              title: "JavaScript/Node.js Implementation",
              description: "Complete example using crypto module for BLAKE3 hashing",
              code: `const crypto = require('crypto');

// Step 1: Generate secret nonce (32 bytes)
function generateNonce() {
  return crypto.randomBytes(32);
}

// Step 2 & 3: Compute hash(nonce + value)
function computeHash(nonce, value) {
  const concatenated = Buffer.concat([nonce, Buffer.from(value, 'utf8')]);
  // Using SHA-256 (widely available). For BLAKE3, use 'npm install blake3'
  return crypto.createHash('sha256').update(concatenated).digest('hex');
}

// Example usage
const nameNonce = generateNonce();
const nameValue = 'John Doe';
const nameHash = computeHash(nameNonce, nameValue);

console.log('Nonce (hex):', nameNonce.toString('hex'));
console.log('Value:', nameValue);
console.log('Hash to store in passport:', nameHash);

// Store nameHash in passport, keep nameNonce secret

// Verification function (for peer)
function verifyHash(nonce, claimedValue, storedHash) {
  const computedHash = computeHash(nonce, claimedValue);
  return computedHash === storedHash;
}

// Peer verification
const peerNonce = Buffer.from(nameNonce.toString('hex'), 'hex'); // received privately
const peerClaimedValue = 'John Doe'; // claimed value
const peerStoredHash = nameHash; // from passport

const isValid = verifyHash(peerNonce, peerClaimedValue, peerStoredHash);
console.log('Verification result:', isValid); // true if value matches`,
              installCommand: "npm install (uses built-in crypto module)"
            },
            python: {
              title: "Python Implementation",
              description: "Complete example using hashlib for SHA-256 hashing",
              code: `import secrets
import hashlib

# Step 1: Generate secret nonce (32 bytes)
def generate_nonce():
    return secrets.token_bytes(32)

# Step 2 & 3: Compute hash(nonce + value)
def compute_hash(nonce, value):
    concatenated = nonce + value.encode('utf-8')
    # Using SHA-256. For BLAKE3: pip install blake3; import blake3
    return hashlib.sha256(concatenated).hexdigest()

# Example usage
name_nonce = generate_nonce()
name_value = 'John Doe'
name_hash = compute_hash(name_nonce, name_value)

print(f'Nonce (hex): {name_nonce.hex()}')
print(f'Value: {name_value}')
print(f'Hash to store in passport: {name_hash}')

# Store name_hash in passport, keep name_nonce secret

# Verification function (for peer)
def verify_hash(nonce, claimed_value, stored_hash):
    computed_hash = compute_hash(nonce, claimed_value)
    return computed_hash == stored_hash

# Peer verification
peer_nonce = name_nonce  # received privately
peer_claimed_value = 'John Doe'  # claimed value
peer_stored_hash = name_hash  # from passport

is_valid = verify_hash(peer_nonce, peer_claimed_value, peer_stored_hash)
print(f'Verification result: {is_valid}')  # True if value matches`,
              installCommand: "pip install (uses built-in secrets and hashlib)"
            }
          },
          securityConsiderations: {
            title: "⚠️ Critical Security Considerations",
            considerations: [
              {
                risk: "Nonce compromise",
                impact: "If a nonce is leaked or compromised, anyone can compute the original field value by trying common values and checking if they hash correctly.",
                mitigation: "Store nonces in an encrypted password manager, hardware wallet, or secure offline storage. Never share nonces publicly or store them in unencrypted files."
              },
              {
                risk: "Replay attacks",
                impact: "A peer could share your nonce with others without your consent.",
                mitigation: "Consider using per-peer nonces (generate a unique nonce for each peer you share with) or use a commitment scheme with additional constraints."
              },
              {
                risk: "Brute force on low-entropy values",
                impact: "For fields with few possible values (e.g., boolean flags, small sets), an attacker could try all possible values to find which one matches the hash.",
                mitigation: "For low-entropy fields, consider adding additional context or using a different privacy technique. This method works best for high-entropy values (names, emails, etc.)."
              },
              {
                risk: "Nonce loss",
                impact: "If you lose the nonce, you cannot prove the field value to anyone (even yourself).",
                mitigation: "Backup nonces securely in multiple encrypted locations. Test your backup and recovery process before relying on this technique."
              }
            ]
          },
          useCases: {
            title: "Recommended Fields for Pseudo-Anonymization",
            fields: [
              {
                field: "Name / Distinguished Name",
                reason: "Personal identifying information that should not be publicly visible on the blockchain",
                example: "hash(nonce_name + 'John Doe') stored in passport"
              },
              {
                field: "Email address",
                reason: "Contact information that can be used for spam or phishing if exposed",
                example: "hash(nonce_email + 'john@example.com') stored in passport"
              },
              {
                field: "Phone number",
                reason: "Direct contact method that should be selectively disclosed",
                example: "hash(nonce_phone + '+1-555-0123') stored in passport"
              },
              {
                field: "Physical address",
                reason: "Sensitive location data that should remain private",
                example: "hash(nonce_address + '123 Main St, City, Country') stored in passport"
              },
              {
                field: "Organization / Company",
                reason: "Employment information that may be sensitive",
                example: "hash(nonce_org + 'Acme Corp') stored in passport"
              }
            ],
            notRecommended: [
              {
                field: "Creature (profession)",
                reason: "This field is designed for public discovery. Pseudo-anonymizing it defeats its purpose of being a 'Yellow Pages' for agents."
              },
              {
                field: "Facial features",
                reason: "These are already encoded in the token ID checksum and are meant to be verifiable without additional privacy layers."
              }
            ]
          },
          bestPractices: {
            title: "Best Practices",
            practices: [
              "Use a cryptographically secure random number generator (never use Math.random() or similar)",
              "Generate a unique nonce for each field (never reuse nonces across fields)",
              "Use at least 32 bytes (256 bits) for nonce length",
              "Prefer modern hash functions like BLAKE3 or SHA-3 over SHA-256 if available",
              "Test the verification process with a trusted peer before deploying to production",
              "Document which fields use pseudo-anonymization and where nonces are stored",
              "Consider using a hardware security module (HSM) for nonce storage in high-security scenarios",
              "Rotate nonces periodically if the field value changes (requires updating passport metadata)"
            ]
          },
          trustModel: {
            title: "Trust Model: Selective Disclosure",
            description: "This technique shifts from 'public disclosure' to 'selective disclosure based on trust'. You maintain full control over who sees your actual field values.",
            keyPrinciple: "The hash in your passport is a commitment to a value. The nonce is the key to unlock that commitment. Share the nonce only with peers you trust to see the actual value.",
            analogy: "Think of it like a sealed envelope: the hash is the seal visible to everyone (proving something is inside), but only those you give the key to (the nonce) can open the envelope and read the contents."
        }
      }
      }
    },
    {
      step: 3,
      title: "Obtain API Credentials",
      description: "Use your RODiT token to authenticate with the API",
      details: {
        login: "POST /api/login",
        required: [
          "RODiT token (roditid)",
          "Ed25519 signature (roditid_base64url_signature)",
          "timestamp"
        ],
        returns: "JWT access token for API calls"
      }
    }
  ],

  // Aliases for route compatibility
  enrollmentSteps: null, // Will be set below
  enrollment: null, // Will be set below

  // OpenClaw Agent Enrollment Guide - Automation-Ready Instructions
  openClawAgentEnrollment: {
    title: "OpenClaw Agent: IdentityClaw API Enrollment Guide",
    description: "Automation-ready instruction set for AI agents to enroll in the IdentityClaw API",
    
    quickStartForAgents: {
      title: "🔐 IdentityClaw Login Guide for Agents",
      lastUpdated: "2026-04-19",
      apiVersion: "1.0.0",
      enrollmentUrl: "https://purchase.identyclaw.com",
      
      overview: {
        description: "Step-by-step instructions for AI agents to authenticate with the IdentityClaw API using RODiT tokens from the NEAR blockchain",
        whatYouNeed: [
          "✅ A NEAR implicit account with funded account ID",
          "✅ A RODiT token owned by your implicit account",
          "✅ Your private key (base58, 64-byte keypair format)"
        ]
      },
      
      discoveringYourTokenId: {
        title: "🔍 CRITICAL: How to Find Your RODiT Token ID",
        description: "If you've purchased a RODiT but don't know your token ID, use one of these methods:",
        
        problem: "Agents often get stuck trying to login because they don't know their token ID. The token ID is shown during purchase, but if you missed it, here's how to find it:",
        
        method1_directBlockchainQuery: {
          title: "Method 1: Direct Blockchain Query (Recommended for AI Agents)",
          description: "Use NEAR CLI commands directly to see raw blockchain data - no wrapper scripts that hide information",
          
          whyThisIsBetter: {
            title: "🤖 Why AI Agents Should Use Direct Commands",
            reasons: [
              "✅ See complete JSON responses from the blockchain - nothing hidden",
              "✅ No jq filtering that removes useful data",
              "✅ Easier to parse programmatically",
              "✅ Understand exactly what the blockchain returns",
              "✅ Debug issues by seeing raw error messages"
            ],
            note: "The roditwallet.sh script uses jq to filter outputs, which hides data that AI agents can process directly"
          },
          
          recipe1_findYourTokens: {
            title: "Recipe 1: Find All RODiT Tokens for Your Account",
            purpose: "Query the blockchain to see which RODiT tokens you own",
            
            command: `near-cli-rs-ai contract call-function as-read-only \\
  2026v1-identyclaw-com.near \\
  rodit_tokens_for_owner \\
  json-args '{"account_id": "YOUR_ACCOUNT_ID_HERE"}' \\
  network-config mainnet \\
  now`,
            
            example: {
              accountId: "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac",
              fullCommand: `near-cli-rs-ai contract call-function as-read-only \\
  2026v1-identyclaw-com.near \\
  rodit_tokens_for_owner \\
  json-args '{"account_id": "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac"}' \\
  network-config mainnet \\
  now`,
              
              rawOutput: `[
  {
    "token_id": "saaddbbadbbf",
    "owner_id": "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac",
    "metadata": {
      "title": "RODiT Identity Token",
      "description": "IdentityClaw Agent Identity",
      "media": null,
      "media_hash": null,
      "copies": null,
      "issued_at": "1713456789000000000",
      "expires_at": null,
      "starts_at": null,
      "updated_at": null,
      "extra": "{\\"facial_features\\":{\\"eye_distance\\":0.5,\\"nose_width\\":0.3,...}}",
      "reference": null,
      "reference_hash": null
    }
  }
]`,
              
              howToExtract: {
                tokenId: "Look for 'token_id' field in the JSON array",
                ownerId: "The 'owner_id' confirms this token belongs to your account",
                metadata: "Full metadata is visible - not filtered by jq"
              }
            },
            
            emptyResult: {
              description: "If account has no RODiT tokens",
              output: "[]",
              meaning: "Empty array means no tokens found for this account"
            },
            
            parsing: {
              title: "How to Parse This Output",
              steps: [
                "1. The output is a JSON array of token objects",
                "2. Each object has 'token_id' (your identity) and 'owner_id' (your wallet)",
                "3. Extract the 'token_id' value - this is your 12-letter RODiT identity",
                "4. Use this token_id for authentication via POST /api/login"
              ],
              pythonExample: `import json
import subprocess

# Run the command
result = subprocess.run([
    'near-cli-rs-ai', 'contract', 'call-function', 'as-read-only',
    '2026v1-identyclaw-com.near',
    'rodit_tokens_for_owner',
    'json-args', '{"account_id": "YOUR_ACCOUNT_ID"}',
    'network-config', 'mainnet',
    'now'
], capture_output=True, text=True)

# Parse JSON output
tokens = json.loads(result.stdout)
if tokens:
    token_id = tokens[0]['token_id']
    print(f"Your RODiT token ID: {token_id}")
else:
    print("No RODiT tokens found")`
            }
          },
          
          recipe2_getPrivateKey: {
            title: "Recipe 2: Extract Your Private Key from Credentials",
            purpose: "Read your NEAR account credentials to get the private key for signing",
            
            command: `cat ~/.near-credentials/mainnet/YOUR_ACCOUNT_ID.json`,
            
            example: {
              accountId: "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac",
              fullCommand: `cat ~/.near-credentials/mainnet/43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac.json`,
              
              rawOutput: `{
  "account_id": "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac",
  "public_key": "ed25519:8nN7JkRGzGKPzJm5QxFjQqKvF3ZnKvJm5QxFjQqKvF3Z",
  "private_key": "ed25519:5J7WxKvF3ZnKvJm5QxFjQqKvF3ZnKvJm5QxFjQqKvF3ZnKvJm5QxFjQqKvF3ZnKvJm5QxFjQqKvF3ZnKvJm5Qx"
}`,
              
              howToExtract: {
                privateKey: "The 'private_key' field contains your base58-encoded Ed25519 keypair",
                format: "Format is 'ed25519:BASE58_STRING'",
                criticalWarning: "CRITICAL: Do NOT use a NEAR seed phrase / recovery phrase to derive keys for signing. Always use the exact 'private_key' string from this JSON file (ed25519:...) directly.",
                usage: "Decode the base58 part to get 64 bytes: first 32 bytes = seed, full 64 bytes = keypair for signing"
              }
            },
            
            pythonExample: `import json
import base58

# Read credentials file
with open('~/.near-credentials/mainnet/YOUR_ACCOUNT_ID.json') as f:
    creds = json.load(f)

# Extract and decode private key
private_key_str = creds['private_key'].split(':')[1]  # Remove 'ed25519:' prefix
private_key_bytes = base58.b58decode(private_key_str)  # 64 bytes total

# For signing: use full 64 bytes
# For seed: use first 32 bytes
print(f"Private key (64 bytes): {private_key_bytes.hex()}")`
          },
          
          recipe3_checkAccountBalance: {
            title: "Recipe 3: Check Account Balance",
            purpose: "Verify your account exists and has NEAR tokens",
            
            command: `near-cli-rs-ai account view-account-summary \\
  YOUR_ACCOUNT_ID \\
  network-config mainnet \\
  now`,
            
            example: {
              accountId: "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac",
              fullCommand: `near-cli-rs-ai account view-account-summary \\
  43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac \\
  network-config mainnet \\
  now`,
              
              rawOutput: `Account details for '43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac' at block #123456789
Native account balance: 0.165687275581358300999999 NEAR
Validator stake: 0 NEAR
Storage used: 182 bytes
Contract code: None`
            }
          },
          
          recipe4_listLocalAccounts: {
            title: "Recipe 4: List All Local NEAR Accounts",
            purpose: "See which NEAR accounts you have credentials for on this machine",
            
            command: `ls -1 ~/.near-credentials/mainnet/`,
            
            example: {
              rawOutput: `43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac.json
ef9831226f42a89ce7e67aee0de2b29b210b718a03e2b089000af2de3fba56f7.json
timeherenow.json
rodit-org.json`,
              
              howToUse: "Each .json file is an account. Remove the .json extension to get the account ID"
            }
          },
          
          recipe5_getSpecificTokenMetadata: {
            title: "Recipe 5: Get Detailed Metadata for a Specific RODiT Token",
            purpose: "View full metadata including facial features for a known token ID",
            
            command: `near-cli-rs-ai contract call-function as-read-only \\
  2026v1-identyclaw-com.near \\
  rodit_token \\
  json-args '{"token_id": "YOUR_TOKEN_ID"}' \\
  network-config mainnet \\
  now`,
            
            example: {
              tokenId: "saaddbbadbbf",
              fullCommand: `near-cli-rs-ai contract call-function as-read-only \\
  2026v1-identyclaw-com.near \\
  rodit_token \\
  json-args '{"token_id": "saaddbbadbbf"}' \\
  network-config mainnet \\
  now`,
              
              rawOutput: `{
  "token_id": "saaddbbadbbf",
  "owner_id": "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac",
  "metadata": {
    "title": "RODiT Identity Token",
    "description": "IdentityClaw Agent Identity",
    "extra": "{\\"facial_features\\":{\\"eye_distance\\":0.5,\\"nose_width\\":0.3,\\"mouth_height\\":0.4}}"
  }
}`
            }
          },
          
          recipe6_createNewAccount: {
            title: "Recipe 6: Generate New NEAR Implicit Account",
            purpose: "Create a new account keypair (not yet funded on blockchain)",
            
            command: `gennearaccount`,
            
            note: "This creates credentials locally but the account doesn't exist on-chain until funded with at least 0.01 NEAR",
            
            followUp: "To fund: Use roditwallet.sh or a NEAR wallet to transfer NEAR to the new account"
          },
          
          recipe7_transferToken: {
            title: "Recipe 7: Transfer RODiT Token to Another Account",
            purpose: "Move your RODiT identity to a different NEAR wallet",

            command: `near-cli-rs-ai contract call-function as-transaction \\
  2026v1-identyclaw-com.near \\
  rodit_transfer \\
  json-args '{"receiver_id": "DESTINATION_ACCOUNT", "token_id": "YOUR_TOKEN_ID"}' \\
  prepaid-gas '30 TeraGas' \\
  attached-deposit '1 yoctoNEAR' \\
  sign-as YOUR_CURRENT_ACCOUNT \\
  network-config mainnet \\
  sign-with-legacy-keychain \\
  send`,

            warning: "⚠️ After transfer, you'll need to use the destination account's private key to authenticate"
          },

          recipe8_disposePassport: {
            title: "Recipe 8: Safely Dispose of IdentityClaw Passport",
            purpose: "Permanently dispose of your RODiT token by transferring it to an inaccessible address",

            description: "The elephant-cemetery.near address is a safe disposal address for IdentityClaw Passports. Its key pair has been intentionally lost and is inaccessible, meaning any tokens transferred to this address can never be recovered or accessed again.",

            command: `near-cli-rs-ai contract call-function as-transaction \\
  2026v1-identyclaw-com.near \\
  rodit_transfer \\
  json-args '{"receiver_id": "elephant-cemetery.near", "token_id": "YOUR_TOKEN_ID"}' \\
  prepaid-gas '30 TeraGas' \\
  attached-deposit '1 yoctoNEAR' \\
  sign-as YOUR_CURRENT_ACCOUNT \\
  network-config mainnet \\
  sign-with-legacy-keychain \\
  send`,

            warning: "⚠️ IRREVERSIBLE ACTION: Transferring to elephant-cemetery.near permanently destroys access to your IdentityClaw Passport. The key pair for this address has been intentionally lost and cannot be recovered. This action cannot be undone.",

            note: "Use this when you want to permanently dispose of a passport (e.g., after a security breach, account compromise, or when you no longer need the identity)"
          },

          networkConfiguration: {
            title: "Network Configuration Options",
            description: "Choose which NEAR RPC endpoint to use",
            
            availableConfigs: [
              {
                name: "mainnet",
                description: "NEAR mainnet (default)",
                usage: "network-config mainnet"
              },
              {
                name: "testnet",
                description: "NEAR testnet",
                usage: "network-config testnet"
              }
            ],
            
            customRpc: {
              description: "Use a custom RPC endpoint",
              example: "export NEAR_RPC_URL=https://rpc.mainnet.fastnear.com"
            }
          },
          
          keyTakeaways: {
            title: "🎯 Key Takeaways for AI Agents",
            points: [
              "✅ Use direct NEAR CLI commands - see raw blockchain data",
              "✅ Recipe 1 is your starting point: find your token_id",
              "✅ Recipe 2 gets your private key for signing",
              "✅ Parse JSON outputs programmatically - no manual extraction needed",
              "✅ All outputs are complete - nothing hidden by jq or grep",
              "✅ Error messages from blockchain are visible and actionable"
            ]
          }
        },
        
        method2_publicApi: {
          title: "Method 2: Query Public API - Browse All Agents",
          description: "Use the public /api/agents endpoint to discover all RODiT token holders with their facial descriptions and creature roles",
          endpoint: "GET /api/agents?limit=20&cursor=<optional-pagination-cursor>",
          example: `curl "https://api.identyclaw.com/api/agents?limit=20"

Response:
{
  "agents": [
    {
      "tokenId": "saaddbbadbbf",
      "creature": "Majordomo",
      "face": {
        "checksumValid": true,
        "categories": {
          "overall_structure": { "index": 0, "letter": "s", "value": "masculine" },
          "face_shape": { "index": 1, "letter": "a", "value": "round-faced" },
          "age_related": { "index": 2, "letter": "d", "value": "young-adult-25" },
          "regional_bone_structure": { "index": 3, "letter": "d", "value": "Mediterranean" },
          "lips": { "index": 4, "letter": "b", "value": "full-lips" },
          "hair_color": { "index": 5, "letter": "b", "value": "black-hair" },
          "eyebrow_style": { "index": 6, "letter": "a", "value": "thick-eyebrows" },
          "eyes": { "index": 7, "letter": "d", "value": "large-eyes" },
          "skin_conditions": { "index": 8, "letter": "b", "value": "clear" },
          "skin_tones": { "index": 9, "letter": "b", "value": "fair-skinned" },
          "nose": { "index": 10, "letter": "f", "value": "aquiline-nose" }
        }
      }
    }
  ],
  "nextCursor": "20",
  "requestId": "01KPSW..."
}`,
          note: "No authentication required - this is a public endpoint for agent discovery. Returns paginated list with facial descriptions decoded from token IDs.",
          currentCapabilities: "You can browse all agents using pagination (limit and cursor parameters)",
          plannedFeatures: "Search functionality is a planned feature - currently you can only browse by paginating through all agents",
          limitations: {
            title: "Capability Discovery Limitation",
            description: "IdentityClaw provides identity discovery (finding agents) and limited capability discovery via the Creature field, but detailed capability metadata is not included.",
            whatIsProvided: [
              "Agent discovery via /api/agents endpoint",
              "Identity verification via HOLA protocol",
              "Limited capability discovery via Creature field (profession-level classification only)",
              "Contact information via Distinguished Name (DN) and ContactURI fields"
            ],
            whatIsNotProvided: [
              "Specific tools supported by agents",
              "Detailed capabilities or specializations",
              "Personality/vibe for task matching",
              "Rate limits or performance characteristics",
              "Workspace URLs for direct integration"
            ],
            creatureFieldExplanation: "The Creature field provides profession-level granularity only (e.g., 'Legal Specialist', 'Data Analyst', 'SRE Engineer'). Agents can filter by creature type via GET /api/agents, but this does not include detailed capability information.",
            discoveryWorkflow: [
              "Find agents via IdentityClaw (GET /api/agents)",
              "Verify identity via HOLA protocol",
              "Discover basic capabilities via Creature field (profession-level classification only)",
              "Discover detailed capabilities via out-of-band communication (direct contact, external directory, agent's own documentation)",
              "Establish trust based on identity verification + capability discovery"
            ],
            futureConsiderations: "Directory service capabilities may be added in future versions to include workspace metadata, but this is not currently part of the IdentityClaw specification."
          }
        },
        
        method3_afterLogin: {
          title: "Method 3: After Login - Use /api/me/identity",
          description: "Once you've logged in with your token ID, you can retrieve it anytime",
          endpoint: "GET /api/me/identity",
          authentication: "Requires JWT from /api/login",
          example: `curl "https://api.identyclaw.com/api/me/identity" \\
  -H "Authorization: Bearer <your-jwt-token>"

Response:
{
  "tokenId": "saaddbbadbbf",
  "dn": "bc=near.org;sc=2026v1-identyclaw-com.near;id=saaddbbadbbf",
  "notAfter": "2027-04-19T18:19:18.000Z",
  ...
}`,
          note: "This only works AFTER you've successfully logged in - use Method 1 or 2 to discover your token ID initially"
        },
        
        workflow: {
          title: "Recommended Discovery Workflow for AI Agents",
          steps: [
            "1. You have: NEAR account ID (64 hex chars) and private key in ~/.near-credentials/mainnet/",
            "2. Use Recipe 1: Run direct NEAR CLI command to query blockchain for your tokens",
            "3. Parse the JSON output to extract the 'token_id' field (12 lowercase letters)",
            "4. Use Recipe 2: Read your credentials file to get the private key for signing",
            "5. Use this token ID to login via POST /api/login",
            "6. After login, you can always retrieve it via GET /api/me/identity"
          ],
          
          quickCommand: {
            description: "One-liner to find your token ID (AI agents can parse this directly)",
            command: `near-cli-rs-ai contract call-function as-read-only 2026v1-identyclaw-com.near rodit_tokens_for_owner json-args '{"account_id": "YOUR_ACCOUNT_ID"}' network-config mainnet now`,
            parsing: "Parse JSON array, extract first element's 'token_id' field"
          }
        },
        
        commonMistakes: [
          "❌ Trying to login without knowing your token ID first",
          "❌ Confusing the NEAR account ID (64 hex) with the token ID (12 letters)",
          "❌ Using wrapper scripts that filter output instead of parsing raw JSON directly",
          "❌ Thinking you need to be logged in to discover your token ID (Methods 1 & 2 don't require login)",
          "❌ Not parsing the complete blockchain response - all data is useful for debugging"
        ]
      },
      
      criticalTimestampWarning: {
        title: "⚠️ CRITICAL: Timestamp Format - The Most Common Bug",
        problem: "Using the API-provided timestamp_iso field directly from /api/login/timestamp is SAFE. The bug is using timestamps from DIFFERENT moments.",
        
        theBug: {
          description: "Mixing timestamp values from different time moments",
          wrongExample: `# ❌ WRONG - Will cause PeerEd25519SignatureVerificationFailure!
# Getting auth params at time T1
resp1 = requests.get('https://api.identyclaw.com/api/login/timestamp')
ts_iso_T1 = resp1.json()['timestamp_iso']

# Then generating new timestamp at time T2
ts_unix_T2 = int(time.time())

# Mixing T1 and T2 values - MISMATCH!
message = rodit_id + ts_iso_T1
login_payload = {"timestamp": ts_unix_T2, ...}  # ❌ Different moment!`
        },
        
        theFix: {
          description: "Use both timestamp and timestamp_iso from the SAME /api/login/timestamp call",
          correctExample: `# ✅ CORRECT - Both from same moment
resp = requests.get('https://api.identyclaw.com/api/login/timestamp')
ts_unix = resp.json()['timestamp']
ts_iso = resp.json()['timestamp_iso']

# Both are from the SAME moment - server will verify correctly
message = rodit_id + ts_iso
login_payload = {"timestamp": ts_unix, ...}  # ✅ Same moment!`
        },
        
        whyThisMatters: {
          table: [
            {
              format: "Using /api/login/timestamp correctly",
              milliseconds: ".000Z (always)",
              serverVerification: "Server uses .000Z",
              result: "✅ MATCH"
            },
            {
              format: "Mixing timestamps from different moments",
              milliseconds: "Different times",
              serverVerification: "Server reconstructs from your timestamp",
              result: "❌ MISMATCH"
            }
          ],
          explanation: "The server converts Unix timestamp → ISO string internally. Your signature must use an ISO string derived from the SAME Unix timestamp you send."
        }
      },
      
      quickStartSteps: {
        title: "🚀 Quick Start Steps for AI Agents",
        steps: [
          "0. FIRST: Find your token ID using Recipe 1 (direct blockchain query) or GET /api/agents?owner=<account-id>",
          "1. Get auth params from https://api.identyclaw.com/api/login/timestamp",
          "2. Construct message: roditid + timestamp_iso (no separator)",
          "3. Sign with Ed25519 using the first 32 bytes of your base58-decoded private key as seed, but pass full 64 bytes to nacl.bindings.crypto_sign_detached",
          "4. POST to /api/login with roditid, timestamp, and signature",
          "5. Receive JWT and use it for authenticated requests",
          "6. (Optional) Verify your identity anytime with GET /api/me/identity"
        ],
        
        recipe1Reference: "See Method 1 → Recipe 1 above for the exact command to find your token ID"
      },
      
      troubleshootingTable: {
        title: "🔍 Troubleshooting",
        errors: [
          {
            error: "PeerEd25519SignatureVerificationFailure",
            cause: "Timestamp mismatch between signing and payload, OR wrong keypair size",
            fix: "Use both timestamp and timestamp_iso from SAME /api/login/timestamp call. Use full 64-byte keypair for signing."
          },
          {
            error: "bad signature size",
            cause: "Improper encoding",
            fix: "Use base64url with .rstrip('=')"
          },
          {
            error: "IDENTITY_NOT_FOUND",
            cause: "Key mismatch or wrong token ID",
            fix: "Ensure private key matches RODiT owner on blockchain. Verify token ID using Recipe 1 (direct blockchain query)"
          },
          {
            error: "Don't know my token ID",
            cause: "Token ID not saved from purchase",
            fix: "Use Recipe 1 (direct blockchain query) OR query GET /api/agents?owner=<account-id>. See Method 1 above for exact commands."
          },
          {
            error: "MISSING_TOKEN",
            cause: "No JWT header",
            fix: "Always include Authorization: Bearer <JWT>"
          }
        ]
      },
      
      apiEndpointsQuickRef: {
        title: "📍 API Endpoints",
        endpoints: [
          {
            endpoint: "GET /api/login/timestamp",
            auth: "❌ Public",
            purpose: "Get fresh timestamp and nonce"
          },
          {
            endpoint: "POST /api/login",
            auth: "❌ Public",
            purpose: "Exchange RODiT for JWT"
          },
          {
            endpoint: "GET /api/me/identity",
            auth: "✅ JWT",
            purpose: "Get agent identity"
          },
          {
            endpoint: "GET /api/agents",
            auth: "❌ Public",
            purpose: "List all agents"
          },
          {
            endpoint: "POST /api/identity/verify",
            auth: "✅ JWT",
            purpose: "Verify peer HOLA messages"
          }
        ]
      }
    },
    
    criticalReminder: {
      title: "⚠️ BEFORE YOU START - AI AGENTS READ THIS ⚠️",
      rules: [
        "🚫 DO NOT try to 'figure out' alternative methods or shortcuts",
        "🚫 DO NOT skip verification steps - they prevent cascading failures",
        "🚫 DO NOT combine steps or run commands out of order",
        "✅ FOLLOW each step sequentially and verify before proceeding",
        "✅ USE the exact commands provided - they are tested and known to work",
        "✅ IF a step fails, consult the troubleshooting guide for THAT step"
      ],
      consequence: "Deviating from these instructions will result in signature verification failures and wasted time debugging."
    },

    prerequisites: {
      title: "Prerequisites",
      requirements: [
        "gennearaccount installed (via .deb package or compiled from source)",
        "NEAR tokens available for funding (≥0.01 NEAR for account init, ~1 NEAR for RODiT)",
        "Access to write to $HOME/.near-credentials/"
      ]
    },

    step1_installGenNearAccount: {
      title: "Step 1: Install gennearaccount",
      description: "Install the gennearaccount tool for generating NEAR implicit accounts",
      
      whyThisApproach: {
        title: "🤖 Why We Use gennearaccount",
        reasons: [
          "✅ Simple, single-purpose tool - generates NEAR implicit accounts with one command",
          "✅ Pre-compiled binary available - no build time required",
          "✅ Open source - can compile from source if needed",
          "✅ Lightweight - no dependencies on Rust toolchain or cargo",
          "❌ near-cli-rs-ai: complex, heavy, requires Rust toolchain",
          "❌ Building from source: requires Go toolchain, error-prone for simple task"
        ]
      },
      
      installation: {
        title: "Installation Steps",
        
        step1_download: {
          description: "Download the pre-compiled .deb package",
          command: "wget https://identyclaw.ams3.cdn.digitaloceanspaces.com/gennearaccount_1.0_amd64.deb",
          note: "Downloads the official pre-compiled binary package"
        },
        
        step2_install: {
          description: "Install the package using dpkg",
          command: "sudo dpkg -i gennearaccount_1.0_amd64.deb",
          note: "Installs gennearaccount to /usr/bin/gennearaccount"
        },
        
        step3_verifyInstallation: {
          description: "Verify the installation worked",
          command: "gennearaccount --version",
          expectedOutput: "gennearaccount version 1.0.0 (or similar version string)",
          note: "If 'gennearaccount: command not found', check /usr/bin is in PATH"
        }
      },

      verifyCurrentState: {
        title: "✅ How to Verify This Step Completed Successfully",
        checks: [
          {
            check: "Binary exists",
            command: "ls -la /usr/bin/gennearaccount",
            expectedResult: "File exists with executable permissions (-rwxr-xr-x)",
            troubleshooting: "If not found, re-run the dpkg install command"
          },
          {
            check: "Version check",
            command: "gennearaccount --version",
            expectedResult: "Output shows version information",
            troubleshooting: "If 'command not found', check /usr/bin is in your PATH"
          },
          {
            check: "PATH configured",
            command: "which gennearaccount",
            expectedResult: "Shows /usr/bin/gennearaccount",
            troubleshooting: "Add /usr/bin to PATH if not present"
          },
          {
            check: "Can run basic command",
            command: "gennearaccount --help",
            expectedResult: "Shows help text for the command",
            troubleshooting: "If error, reinstall the package"
          }
        ],
        readyToMoveOn: "If all checks pass, you're ready for Step 2"
      },

      commonPitfalls: [
        {
          issue: "wget fails with SSL/TLS error",
          solution: "Check internet connection. If behind proxy, configure wget with --proxy flag"
        },
        {
          issue: "dpkg fails with dependency errors",
          solution: "Run: sudo apt-get install -f to fix missing dependencies"
        },
        {
          issue: "'gennearaccount: command not found' after installation",
          solution: "Check /usr/bin is in PATH: echo $PATH"
        },
        {
          issue: "Permission denied when running dpkg",
          solution: "Use sudo to install the package"
        },
        {
          issue: "Architecture mismatch (not amd64)",
          solution: "Compile from source: git clone https://github.com/rodit-org/gennearaccount.git && cd gennearaccount && go build"
        }
      ],
      
      aiAgentNote: "For AI agents: gennearaccount is a simple tool with no external dependencies. Once installed, it can be run directly without any PATH setup or environment configuration."
    },

    step2_createImplicitAccount: {
      title: "Step 2: Create Implicit Account",
      description: "Generate a new NEAR implicit account with Ed25519 keypair using gennearaccount",
      
      prerequisite: "Make sure gennearaccount is installed and accessible in your PATH",
      
      commands: {
        createDirectory: "mkdir -p \"$HOME/.near-credentials/mainnet\"",
        generateAccount: "gennearaccount",
        moveCredentials: "mv <account-id>.json \"$HOME/.near-credentials/mainnet/\""
      },

      expectedOutput: {
        message: "gennearaccount outputs the account ID, public key, and private key in NEAR format",
        note: "The tool prints credentials to stdout and saves to ./<account-id>.json (current directory)",
        compatibilityNote: "⚠️ Important: gennearaccount automatically saves to `.` and the file needs to be moved to ~/.near-credentials/mainnet/ in the correct format for near-cli-rs-ai. If you have account files elsewhere, they must be moved to this directory for near-cli-rs-ai and roditwallet.sh compatibility."
      },

      extractAccountId: {
        title: "Agent-readable: Extract account ID from gennearaccount output",
        script: `ACCOUNT_ID=$(gennearaccount | grep -oP 'Account ID: \\K[0-9a-f]{64}')
echo "NEAR Implicit Account ID: $ACCOUNT_ID"`
      },

      verifyCurrentState: {
        title: "✅ How to Verify This Step Completed Successfully",
        checks: [
          {
            check: "Credentials file exists",
            command: "ls -la $HOME/.near-credentials/mainnet/*.json",
            expectedResult: "One JSON file with 64-character hex filename (e.g., e75765d3666425188c64bb960ea316a28215645098034700a8f99f8633996fe7.json)",
            troubleshooting: "If no file found, re-run: gennearaccount"
          },
          {
            check: "File contains valid keypair",
            command: "cat $HOME/.near-credentials/mainnet/*.json | jq -r '.private_key, .public_key, .account_id'",
            expectedResult: "Three lines: private_key (ed25519:...), public_key (ed25519:...), and account_id (64 hex chars)",
            troubleshooting: "If jq fails, install it: apt-get install jq or brew install jq"
          },
          {
            check: "Account ID format is correct",
            command: "basename $HOME/.near-credentials/mainnet/*.json .json | wc -c",
            expectedResult: "65 (64 hex characters + newline)",
            troubleshooting: "Account ID must be exactly 64 hexadecimal characters (0-9a-f)"
          },
          {
            check: "Extract and display credentials",
            command: "ACCOUNT_FILE=$(ls $HOME/.near-credentials/mainnet/*.json | head -1); echo \"Account ID: $(basename $ACCOUNT_FILE .json)\"; cat $ACCOUNT_FILE | jq -r '.private_key'",
            expectedResult: "Shows your account ID and private key starting with 'ed25519:'",
            troubleshooting: "Save these credentials securely - you'll need them for authentication"
          }
        ],
        criticalNote: "⚠️ SAVE YOUR CREDENTIALS: Store the account ID and private_key in a secure location. You cannot recover them if lost!",
        readyToMoveOn: "If you can see your account ID (64 hex chars) and private key (ed25519:...), you're ready for Step 3"
      }
    },

    step3_extractCredentials: {
      title: "Step 3: Extract Credentials",
      description: "Save the private key for API authentication (NEVER share!)",
      
      extractPrivateKey: {
        script: `CREDS_FILE="/home/agent/.near-credentials/mainnet/\${ACCOUNT_ID}.json"
PRIVATE_KEY=$(cat "$CREDS_FILE" | jq -r '.private_key')
echo "Private Key: $PRIVATE_KEY"`,
        oneLiner: "cat \"$CREDS_FILE\" | jq -r '.private_key'"
      },

      requiredForAuthentication: [
        "private_key in format: ed25519:<base58>",
        "public_key in format: ed25519:<base58>",
        "Account ID (the 64-char hex string)"
      ]
    },

    keepingNearAccountsSafe: {
      title: "🔐 Keeping Your NEAR Implicit Account Safe",
      description: "Your NEAR implicit account credentials are equivalent to digital certificates or private keys. Treat them with the same security practices you would use for any critical cryptographic material.",
      
      whyThisMatters: {
        title: "Why Security Matters",
        explanation: "Your NEAR implicit account private key is the ONLY way to prove you control your wallet and your RODiT identity. If someone gains access to this key, they can:",
        risks: [
          "Sign messages as you (impersonate your identity)",
          "Transfer your RODiT token to another wallet",
          "Access all API endpoints authenticated as your identity",
          "Perform any action your account is authorized to do"
        ],
        comparison: "Think of it like a digital certificate or SSH private key - it's your cryptographic proof of identity. Losing it or exposing it has serious consequences."
      },

      bestPractices: {
        title: "Security Best Practices",
        
        storage: {
          title: "1. Secure Storage",
          guidelines: [
            "Store credentials in a secure location with restricted file permissions (chmod 600 or 700)",
            "Use encrypted storage: encrypted hard drive, password manager, or hardware security module (HSM)",
            "Never store credentials in version control (git), environment variables, or configuration files",
            "For production systems: use a secrets management service (HashiCorp Vault, AWS Secrets Manager, etc.)",
            "For development: use a local .env file with strict gitignore rules"
          ]
        },

        filePermissions: {
          title: "2. File Permissions (Linux/macOS)",
          explanation: "The ~/.near-credentials directory and JSON files should only be readable by your user",
          commands: [
            "chmod 700 ~/.near-credentials/mainnet - Only you can read/write/execute",
            "chmod 600 ~/.near-credentials/mainnet/*.json - Only you can read/write the credential files",
            "ls -la ~/.near-credentials/mainnet/ - Verify permissions show 'drwx------' and '-rw-------'"
          ],
          verification: "If you see 'drwxr-xr-x' or '-rw-r--r--', the permissions are too open and anyone on the system can read your credentials!"
        },

        accessControl: {
          title: "3. Access Control",
          guidelines: [
            "Only load credentials when needed - don't keep them in memory longer than necessary",
            "Use separate credentials for different environments (mainnet vs testnet)",
            "Use separate credentials for different agents/services if possible",
            "Limit which systems and users have access to the credentials directory",
            "Use SSH keys with passphrases if storing credentials on remote servers"
          ]
        },

        backupAndRecovery: {
          title: "4. Backup and Recovery",
          guidelines: [
            "Backup credentials to a secure location (encrypted external drive, secure cloud storage)",
            "Store backups separately from your primary system",
            "Test that you can restore from backups before you need them",
            "Document where backups are stored and how to access them",
            "⚠️ CRITICAL: There is NO recovery mechanism for lost credentials. If you lose your private key, you lose access to your account permanently."
          ]
        },

        monitoring: {
          title: "5. Monitoring and Auditing",
          guidelines: [
            "Monitor file access: use 'auditctl' (Linux) or 'fs_usage' (macOS) to track who accesses credential files",
            "Review authentication logs for suspicious activity",
            "Set up alerts for failed login attempts",
            "Periodically verify that your credentials file hasn't been modified",
            "Check file timestamps: 'stat ~/.near-credentials/mainnet/*.json' to see when files were last accessed"
          ]
        },

        rotation: {
          title: "6. Credential Rotation",
          guidelines: [
            "Periodically create new NEAR accounts and transfer your RODiT token to the new account",
            "This is especially important if you suspect credentials may have been compromised",
            "Keep old credentials in secure storage for a transition period",
            "Update all systems that reference the old account ID to use the new one"
          ]
        }
      },

      whatNotToDo: {
        title: "⚠️ Security Anti-Patterns (DO NOT DO THESE)",
        antiPatterns: [
          {
            mistake: "Storing credentials in plain text in config files or .env files committed to git",
            why: "Anyone with access to your repository (including public GitHub) can see your private key",
            correct: "Use .gitignore to exclude credential files, or use a secrets management service"
          },
          {
            mistake: "Sharing your private key via email, chat, or messaging apps",
            why: "These channels are not secure and create a permanent record of your secret",
            correct: "Never share your private key. If someone needs to authenticate as you, they need their own account."
          },
          {
            mistake: "Using the same credentials across multiple systems or environments",
            why: "If one system is compromised, all systems using those credentials are at risk",
            correct: "Create separate accounts for each system/environment (mainnet, testnet, production, development)"
          },
          {
            mistake: "Storing credentials in memory without clearing them after use",
            why: "Memory dumps, core files, or debugging tools could expose your credentials",
            correct: "Clear sensitive data from memory after use, use secure string handling"
          },
          {
            mistake: "Logging or printing credentials for debugging",
            why: "Logs can be stored, backed up, or accessed by others",
            correct: "Log only the account ID or public key, never the private key"
          },
          {
            mistake: "Using weak file permissions (chmod 644 or 755)",
            why: "Other users on the system can read your credentials",
            correct: "Use chmod 600 for files and chmod 700 for directories"
          }
        ]
      },

      complianceAndAuditing: {
        title: "7. Compliance and Auditing",
        guidelines: [
          "Document who has access to credentials and why",
          "Maintain an audit log of credential access and usage",
          "Implement the principle of least privilege - only grant access to what's needed",
          "For regulated environments: ensure credentials are handled according to compliance requirements (SOC 2, ISO 27001, etc.)",
          "Conduct regular security reviews of credential management practices"
        ]
      },

      emergencyProcedures: {
        title: "8. If You Suspect Compromise",
        steps: [
          "1. IMMEDIATELY create a new NEAR account with new credentials",
          "2. Transfer your RODiT token to the new account (if possible)",
          "3. Revoke access from the compromised account if you have administrative access",
          "4. Update all systems to use the new credentials",
          "5. Review logs for unauthorized access or transactions",
          "6. Notify any services that may have been affected",
          "7. Securely destroy the old credentials (shred, overwrite, or burn the storage media)"
        ]
      },

      detectingTheft: {
        title: "9. Detecting Passport Theft: Contact URI as a Red Flag",
        description: "If your Passport does not control the Contact URI, it's a strong indicator that your identity has been stolen.",
        
        whatThisMeans: {
          title: "Understanding Contact URI Control",
          explanation: "Your Passport's Contact URI is the primary contact method stored in your RODiT token metadata. This field is part of your Distinguished Name (DN) and is set when you create your Passport. If someone steals your Passport by transferring it to their wallet, they typically cannot change the Contact URI without your original credentials.",
          
          scenario: {
            title: "Example Theft Scenario",
            steps: [
              "1. You create a Passport with Contact URI: 'email:example.com:you@example.com'",
              "2. Attacker steals your NEAR account private key",
              "3. Attacker transfers your Passport to their wallet (owner_id changes)",
              "4. Attacker now controls your Passport but the Contact URI still points to your email",
              "5. You receive NO notification of the transfer (Contact URI unchanged)",
              "6. Other agents contact you via the old Contact URI, not knowing the Passport is stolen"
            ]
          }
        },

        howToDetect: {
          title: "How to Detect Passport Theft",
          
          method1_contactUri: {
            title: "Method 1: Check Your Contact URI (Easiest)",
            description: "Verify that your Passport's Contact URI matches what you set",
            steps: [
              "1. Look up your Passport: GET /api/identity/token/{tokenId}/full",
              "2. Check the 'dn.contactUri' field in the response",
              "3. Verify it matches YOUR contact method (email, Telegram, Matrix, etc.)",
              "4. If it shows a different contact method → PASSPORT STOLEN"
            ],
            example: {
              yourContactUri: "email:example.com:you@example.com",
              foundContactUri: "telegram:telegram.com:@attacker_bot",
              interpretation: "STOLEN! The Contact URI has been changed to an attacker's contact method"
            }
          },

          method2_ownershipVerification: {
            title: "Method 2: Verify Ownership (Most Reliable)",
            description: "Check if your Passport is still held by your wallet",
            steps: [
              "1. Get your Passport details: GET /api/identity/token/{tokenId}/full",
              "2. Check the 'owner_id' field (which wallet holds this Passport)",
              "3. Compare it to your NEAR account ID (the 64-hex string from ~/.near-credentials/mainnet/)",
              "4. If owner_id ≠ your account ID → PASSPORT STOLEN"
            ],
            example: {
              yourAccountId: "43d3c5b5e77a46b52933bc7a8b79b06f16dd4ca3cfbacd0e6fede0e7e01782ac",
              foundOwnerId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
              interpretation: "STOLEN! Your Passport is now held by a different wallet"
            }
          },

          method3_contactVerification: {
            title: "Method 3: Verify via Contact URI (Out-of-Band)",
            description: "Use your Contact URI to verify you still control the Passport",
            steps: [
              "1. Send a message to your own Contact URI (email, Telegram, etc.)",
              "2. Ask yourself: 'Do I still control this Passport?'",
              "3. If you receive a response from someone else → PASSPORT STOLEN",
              "4. If you don't receive a response but the Contact URI is correct → Passport is likely safe"
            ],
            note: "This is useful if you suspect someone else is using your Passport but haven't changed the Contact URI yet"
          }
        },

        redFlags: {
          title: "Red Flags That Indicate Theft",
          flags: [
            "❌ Contact URI changed to an unknown email, Telegram, or Matrix account",
            "❌ Passport owner_id changed to a wallet you don't recognize",
            "❌ You receive messages from other agents saying they contacted you via your Contact URI, but you never responded",
            "❌ You notice authentication failures or 'permission denied' errors when trying to use your own Passport",
            "❌ Your Passport appears in agent registries with metadata you didn't set (creature type, tax residence, etc.)",
            "❌ You find unauthorized transactions or HOLA handshakes in your logs",
            "❌ Someone contacts you claiming they received a message from your Passport that you didn't send"
          ]
        },

        immediateActions: {
          title: "If You Detect Theft",
          steps: [
            "1. DO NOT attempt to recover the Passport - it's now controlled by the attacker",
            "2. IMMEDIATELY create a new NEAR account with a new private key",
            "3. Create a new Passport with the new account (if possible)",
            "4. Notify all contacts that your old Passport (tokenId: {your-old-id}) has been compromised",
            "5. Update your Contact URI in all systems to point to your new Passport",
            "6. Review all authentication logs for unauthorized access",
            "7. If the attacker transferred your Passport, you may be able to recover it by:",
            "   a. Contacting the new owner (via their Contact URI) to negotiate recovery",
            "   b. Providing proof of original ownership (creation timestamp, metadata, etc.)",
            "   c. Working with IdentityClaw support if the transfer was fraudulent"
          ]
        },

        preventionThroughContactUri: {
          title: "Using Contact URI as a Theft Prevention Mechanism",
          explanation: "Your Contact URI serves as an early warning system for Passport theft. By monitoring your Contact URI, you can detect unauthorized transfers before significant damage occurs.",
          
          bestPractice: {
            title: "Recommended Monitoring Practice",
            steps: [
              "1. Set your Contact URI to a contact method you actively monitor (email, Telegram, etc.)",
              "2. Periodically verify your Passport's Contact URI matches what you set",
              "3. If you receive messages from other agents claiming to have contacted you via your Contact URI but you didn't respond, investigate immediately",
              "4. Set up alerts: if your Contact URI changes, you'll know your Passport was transferred",
              "5. Consider using a dedicated contact method (e.g., a dedicated email address) just for your Passport"
            ]
          },

          whyItWorks: {
            title: "Why This Detection Method Works",
            explanation: "An attacker who steals your Passport by transferring it to their wallet gains control of the Passport's owner_id on the blockchain. However, they typically cannot change the Contact URI without your original credentials (the private key from your original NEAR account). This creates a window of opportunity for you to detect the theft before the attacker can fully take over your identity.",
            caveat: "⚠️ IMPORTANT: If the attacker also compromises your original NEAR account credentials, they CAN change the Contact URI. This is why protecting your private key is critical."
          }
        }
      }
    },

    step4_fundAccount: {
      title: "Step 4: Fund Account (Manual)",
      description: "Transfer NEAR tokens to initialize and fund the account",
      
      transferDetails: {
        to: "e75765d3666425188c64bb960ea316a28215645098034700a8f99f8633996fe7",
        amount: "≥ 0.01 NEAR (for initialization) + ~1 NEAR (for RODiT token)",
        from: "Binance/Kraken/Huobi/MyNearWallet/any NEAR wallet"
      },

      note: "Agent cannot automate this - requires external wallet interaction",

      verifyCurrentState: {
        title: "✅ How to Verify This Step Completed Successfully",
        description: "Use roditwallet.sh to check account balance",
        checks: [
          {
            check: "Account exists on blockchain",
            command: "./scripts/roditwallet.sh <your-account-id>",
            expectedResult: "Shows account balance (e.g., 'Native account balance 1.5 NEAR')",
            troubleshooting: "If 'account not found', the transfer hasn't completed yet. Wait a few minutes and retry."
          },
          {
            check: "Balance is sufficient",
            command: "./scripts/roditwallet.sh <your-account-id> | grep 'Native account balance'",
            expectedResult: "Balance ≥ 1.01 NEAR (0.01 for storage, ~1 for RODiT minting)",
            troubleshooting: "If balance is too low, send more NEAR from your exchange or wallet"
          },
          {
            check: "Alternative: Check via near-cli-rs-ai",
            command: "near account view-account-summary <your-account-id> network-config mainnet now",
            expectedResult: "Shows account details including balance",
            troubleshooting: "If command fails with 'account does not exist', funding hasn't completed"
          }
        ],
        criticalNote: "⚠️ WAIT FOR CONFIRMATION: Blockchain transfers can take 1-5 minutes. Don't proceed until balance shows up.",
        readyToMoveOn: "If your account shows a balance ≥ 1.01 NEAR, you're ready to purchase a RODiT token in Step 5"
      }
    },

    step5_purchaseRODiT: {
      title: "Step 5: Purchase RODiT Token",
      description: "Mint a RODiT token with your identity and facial features",
      
      purchaseUrl: "https://purchase.identyclaw.com",
      
      parameters: {
        owner: "<your-implicit-account-id>",
        facialFeatures: "Select during checkout",
        fee: "~1 NEAR (early adopter pricing)"
      },

      verification: {
        title: "After purchase, verify ownership",
        command: "curl -s \"https://api.identyclaw.com/api/agents?limit=100\" | jq '.agents[] | select(.tokenId == \"<your-token-id>\")'"
      },

      verifyCurrentState: {
        title: "✅ How to Verify This Step Completed Successfully",
        description: "Confirm your RODiT token was minted and you own it",
        checks: [
          {
            check: "Find your token ID using roditwallet.sh (RECOMMENDED)",
            command: "./scripts/roditwallet.sh <your-account-id>",
            expectedResult: "Shows line like 'bc=near.org;sc=2026v1-identyclaw-com.near;id=saaddbbadbbf' where 'saaddbbadbbf' is your token ID",
            troubleshooting: "If 'No RODiT tokens found', the minting hasn't completed or failed. Check purchase.identyclaw.com for transaction status."
          },
          {
            check: "Verify token ownership via public API",
            command: "curl -s 'https://api.identyclaw.com/api/agents?owner=<your-account-id>' | jq '.agents[0].tokenId'",
            expectedResult: "Returns your 12-character token ID (e.g., \"saaddbbadbbf\")",
            troubleshooting: "If empty array or null, token hasn't been minted yet. Wait a few minutes for blockchain confirmation."
          },
          {
            check: "Verify token details",
            command: "./scripts/roditwallet.sh <your-account-id> <your-token-id>",
            expectedResult: "Shows complete token metadata including token_id and metadata fields",
            troubleshooting: "If error, verify you're using the correct token ID from the previous check"
          },
          {
            check: "Save your token ID",
            command: "echo 'RODIT_TOKEN_ID=<your-token-id>' >> ~/.bashrc",
            expectedResult: "Token ID saved for future use",
            troubleshooting: "You'll need this token ID for Step 6 authentication"
          }
        ],
        criticalNote: "⚠️ SAVE YOUR TOKEN ID: Write down the 12-character token ID (e.g., 'saaddbbadbbf'). You'll need it for all API authentication!",
        readyToMoveOn: "If you can see your token ID and it's associated with your account, you're ready for Step 6 (Authentication)"
      }
    },

    step6_authenticateWithAPI: {
      title: "Step 6: Authenticate with API",
      description: "Complete authentication flow to obtain JWT token",

      step6_1_getAuthParams: {
        title: "6.1 Get Auth Parameters (for AI agents)",
        description: "Public endpoint - no authentication required",
        
        request: {
          command: "curl -s \"https://api.identyclaw.com/api/login/timestamp\"",
          parseResponse: `RESPONSE=$(curl -s "https://api.identyclaw.com/api/login/timestamp")
TIMESTAMP=$(echo "$RESPONSE" | jq -r '.timestamp')
NONCE_HEX=$(echo "$RESPONSE" | jq -r '.nonce_hex')
echo "Timestamp: $TIMESTAMP"
echo "Nonce: $NONCE_HEX"`
        },

        verifyCurrentState: {
          title: "✅ How to Verify This Step Completed Successfully",
          checks: [
            {
              check: "Response contains all required fields",
              command: "curl -s 'https://api.identyclaw.com/api/login/timestamp' | jq 'has(\"timestamp\") and has(\"timestamp_iso\") and has(\"nonce\")'",
              expectedResult: "true",
              troubleshooting: "If false or error, check your internet connection and API availability"
            },
            {
              check: "Timestamp is valid Unix seconds",
              command: "RESPONSE=$(curl -s 'https://api.identyclaw.com/api/login/timestamp'); TS=$(echo \"$RESPONSE\" | jq -r '.timestamp'); echo \"Timestamp: $TS ($(date -d @$TS 2>/dev/null || date -r $TS 2>/dev/null))\"",
              expectedResult: "Shows current timestamp and human-readable date/time",
              troubleshooting: "Timestamp should be close to current time (within a few seconds)"
            },
            {
              check: "Timestamp and timestamp_iso match",
              command: "RESPONSE=$(curl -s 'https://api.identyclaw.com/api/login/timestamp'); TS=$(echo \"$RESPONSE\" | jq -r '.timestamp'); TS_ISO=$(echo \"$RESPONSE\" | jq -r '.timestamp_iso'); echo \"Match check: timestamp=$TS, timestamp_iso=$TS_ISO\"",
              expectedResult: "Both values shown and timestamp_iso ends with .000Z",
              troubleshooting: "These MUST be from the same moment - use both values together in Step 6.2"
            },
            {
              check: "Save auth params for next step",
              command: "RESPONSE=$(curl -s 'https://api.identyclaw.com/api/login/timestamp'); echo \"$RESPONSE\" > /tmp/auth_params.json; cat /tmp/auth_params.json | jq .",
              expectedResult: "Auth params saved to /tmp/auth_params.json and displayed",
              troubleshooting: "You'll use these values in Step 6.2 for signing"
            }
          ],
          criticalNote: "⚠️ CRITICAL: Use BOTH timestamp and timestamp_iso from the SAME response. Don't mix values from different API calls!",
          readyToMoveOn: "If you have valid timestamp and timestamp_iso values saved, proceed to Step 6.2 to sign the message"
        }
      },

      step6_2_signLoginMessage: {
        title: "6.2 Sign the Login Message",
        description: "Create Ed25519 signature over roditid + timeString",
        
        criticalNote: "⚠️ For AI agents: Use /api/login/timestamp to get both timestamp and timestamp_iso from the same moment. Manual timestamp generation risks mismatches.",
        
        messageConstruction: {
          roditId: "<your-12-char-token-id>",
          option1_useAgentEndpoint: {
            description: "Recommended for AI agents - guarantees matching timestamps",
            command: `AUTH_PARAMS=$(curl -s "https://api.identyclaw.com/api/login/timestamp")
TIMESTAMP=$(echo "$AUTH_PARAMS" | jq -r '.timestamp')
TIME_STRING=$(echo "$AUTH_PARAMS" | jq -r '.timestamp_iso')
MESSAGE="\${RODIT_ID}\${TIME_STRING}"`
          },
          option2_manualGeneration: {
            description: "Manual generation - CRITICAL: timestamp and TIME_STRING must derive from same moment",
            timestampComputation: "TIMESTAMP=$(date +%s)",
            timeStringComputation: "TIME_STRING=$(node -e \"console.log(new Date($TIMESTAMP * 1000).toISOString())\")",
            messageToSign: "MESSAGE=\"\${RODIT_ID}\${TIME_STRING}\"",
            warning: "The TIME_STRING MUST be computed from TIMESTAMP using new Date(timestamp * 1000).toISOString()"
          }
        },

        signingExample: {
          language: "Node.js",
          code: `node -e "
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const message = '\${MESSAGE}';
const privKeyEncoded = 'ed25519:\${PRIVATE_KEY}'.split(':')[1];
const privKeyBytes = Buffer.from(bs58.decode(privKeyEncoded));
const sig = nacl.sign.detached(new TextEncoder().encode(message), privKeyBytes);
console.log(Buffer.from(sig).toString('base64url'));
"`
        },

        verifyCurrentState: {
          title: "✅ How to Verify This Step Completed Successfully",
          checks: [
            {
              check: "Message format is correct",
              command: "echo \"Message to sign: $RODIT_ID$TIME_STRING\"; echo \"Example: bkbvehbdcrgm2026-04-19T18:19:18.000Z\"",
              expectedResult: "Message is roditid + timestamp_iso with NO separator (e.g., 'bkbvehbdcrgm2026-04-19T18:19:18.000Z')",
              troubleshooting: "No spaces, no colons between roditid and timestamp_iso. Just literal concatenation."
            },
            {
              check: "Keypair is 64 bytes",
              command: "PRIV_KEY_B58=$(echo 'ed25519:YOUR_KEY' | cut -d: -f2); python3 -c \"import base58; print(f'Keypair length: {len(base58.b58decode(\\\"$PRIV_KEY_B58\\\"))} bytes')\"",
              expectedResult: "Keypair length: 64 bytes",
              troubleshooting: "If not 64 bytes, you're using the wrong key format. NEAR private keys decode to 64 bytes."
            },
            {
              check: "Signature is base64url encoded",
              command: "echo \"$SIGNATURE\" | grep -E '^[A-Za-z0-9_-]+$'",
              expectedResult: "Signature contains only A-Z, a-z, 0-9, -, _ (no +, /, or =)",
              troubleshooting: "Use base64url encoding, not standard base64. Remove trailing = padding."
            },
            {
              check: "Signature length is correct",
              command: "echo -n \"$SIGNATURE\" | wc -c",
              expectedResult: "86 or 87 characters (Ed25519 signatures are 64 bytes = 86 base64url chars without padding)",
              troubleshooting: "If length is wrong, check your signing implementation"
            }
          ],
          criticalNote: "⚠️ MESSAGE FORMAT: roditid + timestamp_iso with NO separator. Example: 'bkbvehbdcrgm2026-04-19T18:19:18.000Z'",
          readyToMoveOn: "If your signature is 86-87 base64url characters and message format is correct, proceed to Step 6.3"
        }
      },

      step6_3_loginRequest: {
        title: "6.3 Login Request",
        description: "Submit authentication request to obtain JWT",
        
        curlExample: `SIGNATURE=$(...)  # From step 6.2

curl -X POST "https://api.identyclaw.com/api/login" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"roditid\\": \\"\${RODIT_ID}\\",
    \\"timestamp\\": \${TIMESTAMP},
    \\"roditid_base64url_signature\\": \\"\${SIGNATURE}\\"
  }"`,

        expectedResponse: {
          jwt_token: "<JWT>",
          requestId: "..."
        },

        verifyCurrentState: {
          title: "✅ How to Verify This Step Completed Successfully",
          checks: [
            {
              check: "Login request returns 200 OK",
              command: "curl -s -w '\\nHTTP_CODE:%{http_code}' -X POST 'https://api.identyclaw.com/api/login' -H 'Content-Type: application/json' -d '{\"roditid\":\"$RODIT_ID\",\"timestamp\":$TIMESTAMP,\"roditid_base64url_signature\":\"$SIGNATURE\"}'",
              expectedResult: "HTTP_CODE:200 at the end of output",
              troubleshooting: "If 401/403: signature verification failed. If 400: malformed request. If 500: server error."
            },
            {
              check: "Response contains jwt_token field",
              command: "RESPONSE=$(curl -s -X POST 'https://api.identyclaw.com/api/login' -H 'Content-Type: application/json' -d '{\"roditid\":\"$RODIT_ID\",\"timestamp\":$TIMESTAMP,\"roditid_base64url_signature\":\"$SIGNATURE\"}'); echo \"$RESPONSE\" | jq -r '.jwt_token'",
              expectedResult: "Long JWT string starting with 'eyJ' (base64-encoded header)",
              troubleshooting: "If null or error message, check the error field in the response"
            },
            {
              check: "JWT has valid structure",
              command: "JWT=$(curl -s -X POST 'https://api.identyclaw.com/api/login' -H 'Content-Type: application/json' -d '{\"roditid\":\"$RODIT_ID\",\"timestamp\":$TIMESTAMP,\"roditid_base64url_signature\":\"$SIGNATURE\"}' | jq -r '.jwt_token'); echo \"$JWT\" | grep -o '\\.' | wc -l",
              expectedResult: "2 (JWT has 3 parts separated by 2 dots: header.payload.signature)",
              troubleshooting: "If not 2, the JWT is malformed"
            },
            {
              check: "Save JWT for future use",
              command: "JWT=$(curl -s -X POST 'https://api.identyclaw.com/api/login' -H 'Content-Type: application/json' -d '{\"roditid\":\"$RODIT_ID\",\"timestamp\":$TIMESTAMP,\"roditid_base64url_signature\":\"$SIGNATURE\"}' | jq -r '.jwt_token'); echo \"JWT_TOKEN=$JWT\" > /tmp/jwt_token.env; echo \"JWT saved to /tmp/jwt_token.env\"",
              expectedResult: "JWT saved confirmation",
              troubleshooting: "Source this file in future sessions: source /tmp/jwt_token.env"
            }
          ],
          commonErrors: [
            {
              error: "Error 035: PeerEd25519SignatureVerificationFailure",
              cause: "Signature verification failed - most likely timestamp mismatch or wrong keypair size",
              fix: "Use BOTH timestamp and timestamp_iso from SAME /api/login/timestamp call. Use full 64-byte keypair for signing."
            },
            {
              error: "IDENTITY_NOT_FOUND",
              cause: "RODiT token not found or private key doesn't match token owner",
              fix: "Verify token ID with: ./scripts/roditwallet.sh <account-id>. Ensure private key matches the account that owns the token."
            },
            {
              error: "INVALIDATED_TOKEN_LOGIN_AGAIN",
              cause: "Your JWT token was invalidated (e.g., after password change or security event)",
              fix: "Re-authenticate by calling POST /api/login again with your RODiT credentials"
            }
          ],
          readyToMoveOn: "If you received a valid JWT token, you're authenticated! Proceed to Step 6.4 to use it."
        }
      },

      step6_4_useJWT: {
        title: "6.4 Use JWT for Authenticated Endpoints",
        description: "Include JWT in Authorization header for protected endpoints",
        
        example: `JWT_TOKEN="<response from 6.3>"

curl -X GET "https://api.identyclaw.com/api/me/identity" \\
  -H "Authorization: Bearer \${JWT_TOKEN}"`,

        verifyCurrentState: {
          title: "✅ How to Verify This Step Completed Successfully",
          checks: [
            {
              check: "JWT works for protected endpoints",
              command: "curl -s -w '\\nHTTP_CODE:%{http_code}' -X GET 'https://api.identyclaw.com/api/me/identity' -H 'Authorization: Bearer $JWT_TOKEN'",
              expectedResult: "HTTP_CODE:200 and JSON response with your identity data",
              troubleshooting: "If 401: JWT expired or invalid. If 403: JWT valid but insufficient permissions."
            },
            {
              check: "Identity data contains your token ID",
              command: "curl -s -X GET 'https://api.identyclaw.com/api/me/identity' -H 'Authorization: Bearer $JWT_TOKEN' | jq -r '.tokenId'",
              expectedResult: "Your 12-character RODiT token ID",
              troubleshooting: "If null, check the full response for error messages"
            },
            {
              check: "Identity data contains DN information",
              command: "curl -s -X GET 'https://api.identyclaw.com/api/me/identity' -H 'Authorization: Bearer $JWT_TOKEN' | jq -r '.dn.displayName'",
              expectedResult: "Your display name from the RODiT metadata",
              troubleshooting: "If null, your RODiT may not have DN metadata configured"
            }
          ],
          successMessage: "✅ ENROLLMENT COMPLETE! You can now use your JWT to access all protected API endpoints.",
          readyToMoveOn: "You're fully enrolled! Optionally proceed to Step 7 to learn about HOLA messages for agent-to-agent authentication."
        }
      }
    },

    step7_generateHOLAMessages: {
      title: "Step 7: Generate HOLA Messages (Agent-to-Agent Auth)",
      description: "Create HOLA messages for peer-to-peer authentication",

      getFreshNonce: {
        description: "Get fresh nonce from server",
        command: `NONCE_RESPONSE=$(curl -s "https://api.identyclaw.com/api/holanonce16ts" \`\
  -H "Authorization: Bearer \${JWT_TOKEN}")

NONCETS_HEX=$(echo "$NONCE_RESPONSE" | jq -r '.noncetsHex')
NONCE_TIMESTAMP=$(echo "$NONCE_RESPONSE" | jq -r '.timestamp')`
      },

      constructHOLA: {
        description: "Build complete HOLA message",
        steps: [
          "RECIPIENT=\"MUNDO\"  # Or specify a target recipient token ID",
          "HOLA_PREFIX=\"HOLA/\${RECIPIENT}/\${RODIT_ID}/\${NONCE_TIMESTAMP}/\${NONCETS_HEX}/API.IDENTYCLAW.COM/\"",
          "SIGNATURE=$(...)  # Sign with your private key",
          "CHECKSUM=$(...)   # Sum bytes mod 16, convert to hex",
          "HOLA_MESSAGE=\"\${HOLA_PREFIX}\${SIGNATURE}-\${CHECKSUM}\"",
          "echo \"$HOLA_MESSAGE\""
        ]
      }
    },

    verificationChecklist: {
      title: "Verification Checklist",
      description: "After completing all steps, verify:",
      
      checks: [
        {
          check: "Implicit account exists",
          command: "cat $CREDS_FILE | jq .implicit_account_id",
          expected: "64-char hex"
        },
        {
          check: "Account funded",
          command: "near view-account <account-id> (via roditwallet.sh)",
          expected: "Balance > 0"
        },
        {
          check: "RODiT owned",
          command: "GET /api/agents",
          expected: "Your tokenId in list"
        },
        {
          check: "JWT obtained",
          command: "POST /api/login",
          expected: "jwt_token field"
        },
        {
          check: "Identity retrieved",
          command: "GET /api/me/identity",
          expected: "Full DN + face data"
        }
      ]
    },

    commonErrorHandling: {
      title: "Common Error Handling with Recovery Paths",
      description: "Comprehensive error guide with step-by-step recovery instructions",
      
      errors: [
        {
          error: "Error 035: PeerEd25519SignatureVerificationFailure",
          cause: "Signature verification failed",
          possibleReasons: [
            "Using timestamp and timestamp_iso from different moments (T1 vs T2)",
            "Using only 32-byte seed instead of full 64-byte keypair for signing",
            "Wrong private key (doesn't match RODiT token owner)",
            "Message format incorrect (extra spaces, wrong concatenation)"
          ],
          recoverySteps: [
            "1. Get fresh auth params: curl -s 'https://api.identyclaw.com/api/login/timestamp' > /tmp/auth.json",
            "2. Extract BOTH values from SAME response: TS=$(jq -r '.timestamp' /tmp/auth.json); TS_ISO=$(jq -r '.timestamp_iso' /tmp/auth.json)",
            "3. Verify keypair is 64 bytes: echo $PRIVATE_KEY | cut -d: -f2 | python3 -c 'import base58,sys; print(len(base58.b58decode(sys.stdin.read().strip())))'",
            "4. Sign with full 64-byte keypair using nacl.bindings.crypto_sign_detached (Python) or nacl.sign.detached (Node.js)",
            "5. Retry login with corrected signature"
          ],
          verifyFix: "If login succeeds with jwt_token in response, signature is now correct"
        },
        {
          error: "IDENTITY_NOT_FOUND",
          cause: "RODiT token not found or private key doesn't match token owner",
          possibleReasons: [
            "Token ID is incorrect or doesn't exist",
            "Private key doesn't match the account that owns the token",
            "Token was transferred to a different account"
          ],
          recoverySteps: [
            "1. Verify your account ID: ACCOUNT_ID=$(basename $HOME/.near-credentials/mainnet/*.json .json); echo $ACCOUNT_ID",
            "2. Find tokens owned by your account: ./scripts/roditwallet.sh $ACCOUNT_ID",
            "3. Extract correct token ID from output (after 'id=')",
            "4. Verify private key matches: cat $HOME/.near-credentials/mainnet/$ACCOUNT_ID.json | jq -r '.private_key'",
            "5. Retry login with correct token ID and matching private key"
          ],
          verifyFix: "Token ID should appear in roditwallet.sh output for your account"
        },
        {
          error: "INVALIDATED_TOKEN_LOGIN_AGAIN",
          cause: "Your JWT token was invalidated by the server",
          possibleReasons: [
            "Token expired (check jwt_duration in your RODiT metadata)",
            "Server security event or credential rotation",
            "Token was manually revoked"
          ],
          recoverySteps: [
            "1. Don't panic - this is normal for expired tokens",
            "2. Re-authenticate: Call POST /api/login with your RODiT credentials",
            "3. Get fresh auth params: curl -s 'https://api.identyclaw.com/api/login/timestamp'",
            "4. Sign and login again following Step 6 instructions",
            "5. Save new JWT token for subsequent requests"
          ],
          verifyFix: "New JWT should work for GET /api/me/identity",
          prevention: "Implement JWT refresh logic before expiration (check exp claim in JWT payload)"
        },
        {
          error: "MISSING_TOKEN / 401 Unauthorized",
          cause: "No JWT token provided or invalid Authorization header",
          possibleReasons: [
            "Forgot to include Authorization header",
            "JWT token not prefixed with 'Bearer '",
            "JWT token expired or malformed"
          ],
          recoverySteps: [
            "1. Verify JWT exists: echo $JWT_TOKEN (should be long string starting with 'eyJ')",
            "2. Check header format: curl -v shows 'Authorization: Bearer eyJ...'",
            "3. If JWT expired, re-login: POST /api/login",
            "4. Retry request with correct header: -H 'Authorization: Bearer $JWT_TOKEN'"
          ],
          verifyFix: "Request should return 200 OK instead of 401"
        },
        {
          error: "ENDPOINT_NOT_FOUND / 404",
          cause: "Wrong URL or endpoint path",
          possibleReasons: [
            "Typo in endpoint path",
            "Using wrong base URL",
            "Endpoint doesn't exist in current API version"
          ],
          recoverySteps: [
            "1. Verify base URL: https://api.identyclaw.com (not http, not www)",
            "2. Check endpoint path: /api/login, /api/me/identity, /api/holanonce16ts, etc.",
            "3. Review API documentation: GET /api/mcp/resource/guide:api",
            "4. Retry with correct URL"
          ],
          verifyFix: "Endpoint should return 200 OK or appropriate status (not 404)"
        },
        {
          error: "415 UnsupportedMediaType",
          cause: "Missing or incorrect Content-Type header",
          recoverySteps: [
            "1. Add Content-Type header: -H 'Content-Type: application/json'",
            "2. Ensure request body is valid JSON",
            "3. Retry request"
          ],
          verifyFix: "Request should be accepted (not 415)"
        },
        {
          error: "command not found: gennearaccount",
          cause: "gennearaccount not installed or not in PATH",
          recoverySteps: [
            "1. Download the .deb package: wget https://identyclaw.ams3.cdn.digitaloceanspaces.com/gennearaccount_1.0_amd64.deb",
            "2. Install the package: sudo dpkg -i gennearaccount_1.0_amd64.deb",
            "3. Verify installation: gennearaccount --version",
            "4. Retry command"
          ],
          verifyFix: "Command 'gennearaccount --version' should show version information"
        },
        {
          error: "No RODiT tokens found for this account",
          cause: "Account doesn't own any RODiT tokens",
          recoverySteps: [
            "1. Verify account is funded: ./scripts/roditwallet.sh $ACCOUNT_ID",
            "2. Check if token purchase completed: Visit purchase.identyclaw.com",
            "3. If purchase failed, retry minting process",
            "4. If token exists but not showing, wait for blockchain confirmation (1-5 minutes)",
            "5. Verify on public API: curl 'https://api.identyclaw.com/api/agents?owner=$ACCOUNT_ID'"
          ],
          verifyFix: "roditwallet.sh should show 'id=<your-token-id>'"
        }
      ],
      
      generalRecoveryGuidance: {
        title: "General Recovery Strategy",
        steps: [
          "1. Read the error message carefully - it usually indicates the exact problem",
          "2. Check the requestId in the error response for server-side debugging",
          "3. Verify your current state using the verification steps for each enrollment step",
          "4. Start from the last successful step - don't restart from scratch unless necessary",
          "5. Use verbose curl (-v) to see full request/response headers for debugging",
          "6. Check API status: curl https://api.identyclaw.com/health (if available)"
        ]
      }
    },

    persistForFutureSessions: {
      title: "Persist for Future Sessions",
      description: "IMPORTANT: Agents are stateless across sessions. Persist:",
      
      saveCredentials: {
        script: `# Save to file
cat > /home/agent/openclaw/near-credentials.json << 'EOF'
{
  "implicit_account_id": "<your-64-hex-id>",
  "private_key": "ed25519:<your-private-key>",
  "public_key": "ed25519:<your-public-key>",
  "rodit_token_id": "<your-token-id>"
}
EOF

# Make readable for future agent
chmod 600 /home/agent/openclaw/near-credentials.json`
      },

      loadAtStartup: {
        description: "Then load at startup:",
        command: "source /home/agent/openclaw/near-credentials.json  # Or read via jq"
      }
    },

    automationTips: {
      title: "Automation Tips for OpenClaw Agents",
      tips: [
        "Always verify command outputs before proceeding to next step",
        "Store credentials in secure, persistent storage between sessions",
        "Use jq for parsing JSON responses reliably",
        "Implement retry logic for network operations",
        "Validate all inputs before signing (prevent injection attacks)",
        "Log all operations for debugging and audit trails",
        "Keep gennearaccount updated to latest stable version"
      ]
    }
  },

  // How to log in - detailed login flow
  howToLogin: {
    title: "How to Log In to the API Server",
    description: "Authenticate with your RODiT token to obtain a JWT access token for accessing protected API endpoints",
    endpoint: "POST /api/login",
    contentType: "application/json",
    
    whatThisIsFor: {
      purpose: "🔐 Server Authentication - Get a JWT token to access protected API endpoints",
      useCase: "When you need to call protected endpoints like /api/me/identity, /api/holanonce16ts, /api/identity/verify, etc.",
      notForPeerAuth: "⚠️ This is NOT for agent-to-agent authentication. For peer authentication, see agentToAgentAuth (HOLA messages)."
    },
    
    keyDifferences: {
      apiLogin: {
        what: "Authenticate with the IdentityClaw API server",
        endpoint: "POST /api/login",
        messageFormat: "roditid + timestamp_iso (e.g., 'bkbvehbdcrgm2026-04-19T18:19:18.000Z')",
        result: "Receive JWT token for API access",
        usedFor: "Accessing protected server endpoints"
      },
      holaAuth: {
        what: "Prove your identity to another agent (peer-to-peer)",
        endpoint: "POST /api/identity/verify (to verify received HOLA)",
        messageFormat: "HOLA/<recipient>/<tokenId>/<timestamp>/<nonce>/API.IDENTYCLAW.COM/ (full HOLA message)",
        result: "Peer verifies your identity without server involvement in trust decision",
        usedFor: "Agent-to-agent authentication and trust establishment"
      }
    },
    
    prerequisites: [
      "Your NEAR account is implicit: a 64-hex string derived from your Ed25519 public key (e.g., 0ab3…ef12)",
      "You own a RODiT token (token_id) on the configured NEAR contract",
      "The token's owner_id is your implicit account ID",
      "You have the Ed25519 private key for the implicit account (NEAR format like ed25519:BASE58…)"
    ],

    requestBody: {
      description: "Send a JSON payload with the following fields",
      fields: {
        roditid: {
          type: "string",
          description: "The RODiT token_id you own",
          example: "your_rodit_token_id"
        },
        timestamp: {
          type: "number",
          description: "Unix time in seconds (must not be in the future; small positive skew tolerated)",
          example: 1713521111
        },
        roditid_base64url_signature: {
          type: "string",
          description: "base64url-encoded Ed25519 signature over the message (roditid + timeString)",
          example: "BASE64URL_SIG"
        }
      }
    },

    signatureComputation: {
      title: "How to compute the signature",
      steps: [
        "Get Unix timestamp in seconds (e.g., from /api/login/timestamp or Math.floor(Date.now() / 1000))",
        "CRITICAL: Compute timeString = new Date(timestamp * 1000).toISOString() using the SAME timestamp",
        "Message to sign (UTF-8 bytes) = roditid + timeString (literal concatenation, no separators)",
        "Sign with your Ed25519 secret key (the NEAR private key decoded from base58)",
        "Encode signature as base64url (URL-safe base64: -/_ with no trailing =)"
      ],
      criticalWarning: "⚠️ MUST use the same Unix timestamp to generate both the ISO string for signing AND the timestamp field in the payload. The server will reconstruct the ISO string using new Date(timestamp * 1000).toISOString() and verify the signature against it.",
      note: "The message is the literal concatenation of your roditid and the ISO 8601 timestamp string",
      example: {
        timestamp: 1776622758,
        timestampISO: "2026-04-19T18:19:18.000Z",
        roditid: "bkbvehbdcrgm",
        messageToSign: "bkbvehbdcrgm2026-04-19T18:19:18.000Z",
        explanation: "Both timestamp (1776622758) and timestampISO must derive from the same moment in time"
      },
      
      concreteExample: {
        title: "Concrete Example with Verification Steps",
        description: "Step-by-step example showing exactly what to sign and how to verify",
        
        step1_getAuthParams: {
          description: "Get timestamp and timestamp_iso from the same API call",
          command: "curl -s 'https://api.identyclaw.com/api/login/timestamp'",
          exampleResponse: {
            timestamp: 1745167754,
            timestamp_iso: "2026-04-20T12:54:14.000Z",
            nonce: "randombase64string==",
            signature_message_format: "yourroditid2026-04-20T12:54:14.000Z"
          },
          verification: "Verify timestamp_iso ends with .000Z (no milliseconds)"
        },
        
        step2_constructMessage: {
          description: "Build the exact message to sign",
          roditid: "bkbvehbdcrgm",
          timestamp_iso: "2026-04-20T12:54:14.000Z",
          message: "bkbvehbdcrgm2026-04-20T12:54:14.000Z",
          verification: {
            check: "Message format",
            command: "echo -n 'bkbvehbdcrgm2026-04-20T12:54:14.000Z' | wc -c",
            expectedResult: "42 characters (12 for roditid + 24 for ISO timestamp + 6 for .000Z)",
            note: "NO spaces, NO colons between roditid and timestamp_iso"
          }
        },
        
        step3_signMessage: {
          description: "Sign the message with your Ed25519 private key",
          privateKey: "ed25519:4LxQnJAnfFzHJV8ECWA49Z9KbApPSbTzzqaYg5Fxj3XU...",
          pythonExample: `import base64, base58, nacl.bindings

# Your credentials
RODIT_ID = "bkbvehbdcrgm"
TIMESTAMP_ISO = "2026-04-20T12:54:14.000Z"
PRIVATE_KEY = "ed25519:4LxQnJAnfFzHJV8ECWA49Z9KbApPSbTzzqaYg5Fxj3XU..."

# Construct message (literal concatenation)
message = RODIT_ID + TIMESTAMP_ISO
message_bytes = message.encode('utf-8')

# Decode private key (remove "ed25519:" prefix)
keypair_bytes = base58.b58decode(PRIVATE_KEY.replace("ed25519:", ""))

# CRITICAL: Use full 64-byte keypair
print(f"Keypair length: {len(keypair_bytes)} bytes")  # Must be 64

# Sign with full keypair
signature_raw = nacl.bindings.crypto_sign_detached(message_bytes, keypair_bytes)

# Encode as base64url (no padding)
signature_b64url = base64.urlsafe_b64encode(signature_raw).decode('utf-8').rstrip('=')

print(f"Message: {message}")
print(f"Signature: {signature_b64url}")`,
          verification: {
            checks: [
              "Keypair length is 64 bytes (not 32)",
              "Signature length is 86-87 characters (base64url encoded)",
              "Signature contains only A-Z, a-z, 0-9, -, _ (no + or / or =)"
            ]
          }
        },
        
        step4_verifyBeforeSending: {
          description: "Verify your signature before sending to server",
          checks: [
            {
              check: "Message format is correct",
              verify: "message == roditid + timestamp_iso (no separator)",
              example: "'bkbvehbdcrgm' + '2026-04-20T12:54:14.000Z' = 'bkbvehbdcrgm2026-04-20T12:54:14.000Z'"
            },
            {
              check: "Timestamp consistency",
              verify: "timestamp_iso was derived from timestamp using new Date(timestamp * 1000).toISOString()",
              pythonCheck: "from datetime import datetime, timezone; datetime.fromtimestamp(1745167754, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z') == '2026-04-20T12:54:14.000Z'"
            },
            {
              check: "Signature encoding",
              verify: "Signature is base64url (not standard base64)",
              difference: "base64url uses - and _ instead of + and /, no padding ="
            }
          ]
        },
        
        step5_sendLoginRequest: {
          description: "Send the login request with all verified components",
          payload: {
            roditid: "bkbvehbdcrgm",
            timestamp: 1745167754,
            roditid_base64url_signature: "your_86_char_signature_here"
          },
          curlCommand: `curl -X POST 'https://api.identyclaw.com/api/login' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "roditid": "bkbvehbdcrgm",
    "timestamp": 1745167754,
    "roditid_base64url_signature": "your_86_char_signature_here"
  }'`,
          expectedSuccess: {
            statusCode: 200,
            response: {
              jwt_token: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...",
              requestId: "req_123456"
            }
          }
        }
      }
    },

    serverVerification: {
      title: "What the server verifies",
      steps: [
        "Fetches the RODiT by token_id on NEAR blockchain",
        "Gets the owner_id from the token (if implicit account, 64 hex is used as Ed25519 public key bytes)",
        "Recomputes the same message (roditid + ISO8601(timestamp)) and verifies the Ed25519 signature",
        "Validates the RODiT against service provider match, validity window (not_before/not_after), and trust of issuing contract via DNS"
      ],
      onSuccess: "Issues a JWT signed by the server's Ed25519 key"
    },

    response: {
      success: {
        statusCode: 200,
        body: {
          jwt_token: "<JWT>",
          requestId: "..."
        },
        headers: {
          "New-Token": "<JWT>"
        },
        usage: "Use Authorization: Bearer <jwt_token> for protected endpoints"
      }
    },

    exampleCurl: 'curl -sS -X POST https://<host>/api/login -H "Content-Type: application/json" -d \'{"roditid": "your_rodit_token_id", "timestamp": 1713521111, "roditid_base64url_signature": "BASE64URL_SIG"}\'',

    commonPitfalls: [
      "❌ CRITICAL: Using different timestamps for signing vs payload (e.g., fetching timestamp_iso separately from timestamp)",
      "❌ Signing with timestamp_iso that doesn't match new Date(timestamp * 1000).toISOString()",
      "❌ Using millisecond precision in timestamp (must be seconds)",
      "Use base64url for the signature (no = padding, - and _ instead of + and /)",
      "Ensure timestamp is in seconds and not in the future",
      "The roditid must belong to your implicit account (owner_id equals your 64-hex account)",
      "Content-Type must be application/json (415 error otherwise)"
    ],

    agentAuthParams: {
      title: "Getting Authentication Parameters for AI Agents",
      description: "Public endpoint that provides pre-generated authentication parameters for AI agents. RECOMMENDED for all agents to ensure timestamp consistency.",
      
      criticalTimestampGuidance: {
        title: "⚠️ CRITICAL: The Most Common Bug",
        problem: "Using timestamp and timestamp_iso from DIFFERENT moments causes signature verification failure",
        correctUsage: [
          "✅ SAFE: Use both timestamp AND timestamp_iso from the SAME /api/login/timestamp response",
          "✅ SAFE: Generate your own timestamp (Unix seconds) and derive timestamp_iso using new Date(timestamp * 1000).toISOString()",
          "❌ WRONG: Call /api/login/timestamp at time T1, then generate new timestamp at time T2",
          "❌ WRONG: Use timestamp from one source and timestamp_iso from another source"
        ],
        whyItMatters: "The server reconstructs timestamp_iso from the Unix timestamp you send. If you signed a different ISO string, verification fails with Error 035.",
        recommendation: "Always use /api/login/timestamp - it guarantees timestamp and timestamp_iso are from the same moment"
      },
      
      endpoint: {
        method: "GET",
        path: "/api/login/timestamp",
        authentication: "None required - public endpoint",
        exampleCurl: "curl https://api.identyclaw.com/api/login/timestamp"
      },

      responseFormat: {
        timestamp: {
          type: "number",
          description: "Unix timestamp in seconds (use this in the /api/login payload)",
          example: 1713521111,
          note: "Always in seconds, never milliseconds. No fractional part."
        },
        timestamp_iso: {
          type: "string",
          description: "ISO 8601 format derived from timestamp (use this for signing the message)",
          example: "2024-04-19T11:11:51.000Z",
          criticalNote: "This is computed as new Date(timestamp * 1000).toISOString() - SAFE to use this exact string for signing",
          millisecondPrecision: "Always .000Z because timestamp has no fractional seconds"
        },
        signature_message_format: {
          type: "string",
          description: "Example of the message you must sign",
          example: "yourroditid2024-04-19T11:11:51.000Z"
        },
        warning: {
          type: "string",
          description: "Critical instruction about timestamp usage",
          example: "MUST use timestamp_iso for signing AND timestamp for the login payload. Both derive from the same moment."
        },
        nonce: {
          type: "string",
          description: "32 random bytes encoded as base64url (for reference, NOT used in /api/login or HOLA messages)",
          clarification: "⚠️ This nonce is NOT for HOLA messages. For HOLA, use /api/holanonce16ts endpoint instead (returns 16 bytes as hex)",
          example: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q=="
        },
        nonce_hex: {
          type: "string",
          description: "Same nonce in hex encoding (legacy compatibility, NOT for HOLA messages)",
          example: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6"
        },
        nonce_length: {
          type: "number",
          description: "Always 32 bytes (NOT the same as HOLA noncets which is 16 bytes)",
          example: 32
        },
        algorithm: {
          type: "string",
          description: "Describes how the nonce was generated",
          example: "randomBytes(32)_base64url"
        },
        purpose: {
          type: "string",
          description: "Reminder of what to use these values for",
          example: "Use timestamp/timestamp_iso for /api/login. For HOLA messages, use /api/holanonce16ts instead"
        }
      },

      fieldDescriptions: {
        timestamp: "Unix timestamp in seconds (ready to use in /api/login)",
        timestamp_iso: "ISO 8601 format - use this for signing the message (roditid + timestamp_iso)",
        nonce: "32 random bytes encoded as base64url - NOT used in /api/login or HOLA messages",
        nonce_hex: "Same nonce in hex encoding (legacy compatibility, NOT for HOLA)",
        nonce_length: "Always 32 bytes (different from HOLA noncets which is 16 bytes)",
        algorithm: "Describes how the nonce was generated (randomBytes(32)_base64url)",
        purpose: "For /api/login: use timestamp/timestamp_iso. For HOLA: use /api/holanonce16ts endpoint instead"
      },

      agentWorkflow: {
        title: "How an AI Agent Uses These Parameters (RECOMMENDED)",
        steps: [
          {
            step: 1,
            description: "Call /api/login/timestamp ONCE to get timestamp and timestamp_iso",
            critical: "Both values are generated from the same moment - this is the key to avoiding signature failures"
          },
          {
            step: 2,
            description: "Sign the message using timestamp_iso: message = roditid + timestamp_iso (e.g., 'bkbvehbdcrgm2024-04-19T11:11:51.000Z')",
            critical: "Use the timestamp_iso value from the response - it's SAFE and CORRECT to use",
            note: "The endpoint generates timestamp_iso using the exact same method the server uses for verification"
          },
          {
            step: 3,
            description: "Construct the /api/login request with: roditid, timestamp (Unix seconds), and roditid_base64url_signature",
            critical: "Use the timestamp value (Unix seconds) from the response, which matches the timestamp_iso you signed"
          }
        ],
        errorExample: {
          wrong: "Calling /api/login/timestamp at time T1, then generating a new timestamp at time T2 and mixing the values",
          reason: "The server reconstructs the ISO string from the Unix timestamp you send. If you signed an ISO string from a different moment, verification fails with Error 035",
          correctApproach: "Use both timestamp and timestamp_iso from the SAME /api/login/timestamp call"
        }
      },
      
      alternativeManualApproach: {
        title: "Alternative: Manual Timestamp Generation",
        description: "If you cannot use /api/login/timestamp, generate timestamps manually",
        steps: [
          "1. Generate Unix timestamp: timestamp = Math.floor(Date.now() / 1000)",
          "2. Derive ISO string from SAME timestamp: timestamp_iso = new Date(timestamp * 1000).toISOString()",
          "3. Sign message: roditid + timestamp_iso",
          "4. Send login request with: roditid, timestamp, signature"
        ],
        criticalRule: "timestamp_iso MUST be derived from the SAME timestamp value you send in the login payload",
        pythonExample: `from datetime import datetime, timezone

# Generate timestamp
ts_unix = int(time.time())

# Derive ISO from SAME timestamp (NOT using current time again!)
ts_iso = datetime.fromtimestamp(ts_unix, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

# Sign and login
message = rodit_id + ts_iso
signature = sign(message)
login_payload = {"roditid": rodit_id, "timestamp": ts_unix, "roditid_base64url_signature": signature}`
      },

      note: "The nonce from this endpoint is not directly used in /api/login — it's provided for agents that need random values for other purposes (like constructing HOLA messages or other cryptographic operations)",
      
      completeWorkingExample: {
        title: "Complete Working Example (Python)",
        description: "Copy-paste ready code demonstrating CORRECT usage of /api/login/timestamp",
        code: `#!/usr/bin/env python3
import json, base64, base58, urllib.request
from datetime import datetime, timezone
import nacl.bindings

RODIT_ID = "bkbvehbdcrgm"
PRIVATE_KEY = "ed25519:4LxQnJAnfFzHJV8ECWA49Z9KbApPSbTzzqaYg5Fxj3XUzVDTw5poaYoPj1yCBnJqE6har36YHGmW21a2cskNsLra"

def login():
    # Step 1: Get auth params from server (RECOMMENDED)
    resp = urllib.request.urlopen("https://api.identyclaw.com/api/login/timestamp")
    auth = json.loads(resp.read().decode())
    ts = auth["timestamp"]
    ts_iso = auth["timestamp_iso"]
    
    print(f"✅ Using timestamp and timestamp_iso from SAME moment:")
    print(f"   timestamp: {ts}")
    print(f"   timestamp_iso: {ts_iso}")
    
    # Step 2: Construct message (literal concatenation)
    message = RODIT_ID + ts_iso
    message_bytes = message.encode("utf-8")
    
    # Step 3: Decode private key and sign
    keypair = base58.b58decode(PRIVATE_KEY.replace("ed25519:", ""))
    signature = nacl.bindings.crypto_sign_detached(message_bytes, keypair)
    sig_b64 = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    
    # Step 4: Login
    payload = {"roditid": RODIT_ID, "timestamp": ts, "roditid_base64url_signature": sig_b64}
    req = urllib.request.Request(
        "https://api.identyclaw.com/api/login",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())["jwt_token"]

jwt = login()
print(f"✅ JWT: {jwt[:50]}...")`
      }
    },

    criticalSignatureGuide: {
      title: "🔐 CRITICAL: Correct Signature Generation for AI Agents",
      description: "Common mistakes and the correct way to sign login messages using NEAR Ed25519 keypairs",
      
      commonMistake: {
        title: "❌ THE MOST COMMON ERROR: Using Only the 32-Byte Seed",
        problem: "Many AI agents extract only the first 32 bytes (seed) from the NEAR private key and use it for signing",
        whyItFails: "The server uses tweetnacl's nacl.sign.detached() which expects the FULL 64-byte keypair (seed + public key), not just the 32-byte seed",
        symptom: "Error 035: PeerEd25519SignatureVerificationFailure - signature verification fails even though message format is correct"
      },

      nearKeyFormat: {
        title: "Understanding NEAR Ed25519 Key Format",
        description: "NEAR stores Ed25519 keypairs in a specific format that contains both seed and public key",
        
        credentialsFileExample: {
          implicit_account_id: "e75765d3666425188c64bb960ea316a28215645098034700a8f99f8633996fe7",
          private_key: "ed25519:4LxQnJAnfFzHJV8ECWA49Z9KbApPSbTzzqaYg5Fxj3XUzVDTw5poaYoPj1yCBnJqE6har36YHGmW21a2cskNsLra",
          public_key: "ed25519:Ga4USrRHPeKtxPUb6yC4QK5mG4rWoJ9N6GYqSp1fEptN"
        },

        keyDecomposition: {
          rawPrivateKey: "4LxQnJAnfFzHJV8ECWA49Z9KbApPSbTzzqaYg5Fxj3XUzVDTw5poaYoPj1yCBnJqE6har36YHGmW21a2cskNsLra",
          encoding: "Base58",
          afterBase58Decode: "64 bytes total",
          structure: {
            bytes_0_to_31: "Seed (private key material)",
            bytes_32_to_63: "Public key (same as in public_key field)"
          },
          criticalNote: "⚠️ You MUST use all 64 bytes for signing with tweetnacl, NOT just the first 32 bytes!"
        }
      },

      correctImplementations: {
        title: "✅ CORRECT Signature Generation Methods",
        
        nodeJsWithTweetnacl: {
          title: "Node.js with tweetnacl (RECOMMENDED - matches server exactly)",
          description: "This is what the server uses internally, so it's guaranteed to work",
          code: `const nacl = require('tweetnacl');
const bs58 = require('bs58');

// Your credentials
const privateKeyB58 = "ed25519:4LxQn...cskNsLra";
const roditId = "bkbvehbdcrgm";
const timestampIso = "2026-04-19T18:48:40.000Z";

// Step 1: Remove "ed25519:" prefix and decode base58
const keyWithoutPrefix = privateKeyB58.replace("ed25519:", "");
const keypairBytes = bs58.decode(keyWithoutPrefix);  // 64 bytes

// Step 2: Construct message (literal concatenation)
const message = roditId + timestampIso;
const messageBytes = new TextEncoder().encode(message);

// Step 3: Sign with the FULL 64-byte keypair
const signature = nacl.sign.detached(messageBytes, keypairBytes);

// Step 4: Encode as base64url (no padding)
const signatureB64url = Buffer.from(signature).toString('base64url');

console.log("Signature:", signatureB64url);`,
          keyPoint: "Use the FULL 64-byte keypair from bs58.decode(), not keypair.slice(0, 32)"
        },

        pythonWithPynacl: {
          title: "Python with pynacl (CORRECT METHOD)",
          description: "Use the low-level bindings that accept the full 64-byte keypair",
          wrongWay: {
            title: "❌ WRONG - Using SigningKey with 32-byte seed",
            code: `import base58
from nacl import signing

keypair_bytes = base58.b58decode(key_with_prefix)
seed = keypair_bytes[:32]  # ❌ WRONG - only 32 bytes
private_key_obj = signing.SigningKey(seed)
signature = private_key_obj.sign(message_bytes).signature  # ❌ Will fail verification`
          },
          correctWay: {
            title: "✅ CORRECT - Using crypto_sign_detached with 64-byte keypair",
            code: `import base64
import base58
import nacl.bindings

# Your credentials
PRIVATE_KEY_B58 = "ed25519:4LxQn...cskNsLra"
RODIT_ID = "bkbvehbdcrgm"
TIMESTAMP_ISO = "2026-04-19T18:48:40.000Z"

# Step 1: Remove prefix and decode base58
key_with_prefix = PRIVATE_KEY_B58.replace("ed25519:", "")
keypair_bytes = base58.b58decode(key_with_prefix)  # 64 bytes

# Step 2: Construct message
message = RODIT_ID + TIMESTAMP_ISO
message_bytes = message.encode('utf-8')

# Step 3: Sign with the FULL 64-byte keypair using low-level bindings
signature_raw = nacl.bindings.crypto_sign_detached(
    message_bytes,
    keypair_bytes  # ✅ CORRECT - all 64 bytes
)

# Step 4: Encode as base64url (no padding)
signature_b64url = base64.urlsafe_b64encode(signature_raw).decode('utf-8').rstrip('=')

print(f"Signature: {signature_b64url}")`,
            keyPoint: "Use nacl.bindings.crypto_sign_detached() with the FULL 64-byte keypair, not signing.SigningKey()"
          }
        },

        pythonAlternative: {
          title: "Python Alternative - Derive keypair from seed",
          description: "If you must use SigningKey, derive the full keypair first",
          code: `import base64
import base58
from nacl import signing

# Extract the 32-byte seed
keypair_bytes = base58.b58decode(key_with_prefix)
seed = keypair_bytes[:32]

# Create SigningKey from seed
signing_key = signing.SigningKey(seed)

# Get the full 64-byte keypair (seed + public key)
full_keypair = signing_key._seed + bytes(signing_key.verify_key)

# Now use the full keypair with low-level bindings
import nacl.bindings
signature_raw = nacl.bindings.crypto_sign_detached(
    message_bytes,
    full_keypair  # 64 bytes: seed + public key
)

signature_b64url = base64.urlsafe_b64encode(signature_raw).decode('utf-8').rstrip('=')`,
          warning: "This is more complex. Prefer the direct nacl.bindings.crypto_sign_detached() method shown above."
        }
      },

      whyThisMatters: {
        title: "Why the 64-Byte Keypair is Required",
        explanation: [
          "tweetnacl's nacl.sign.detached() expects: 64 bytes (seed + public key)",
          "pynacl's signing.SigningKey() expects: 32 bytes (just the seed)",
          "The server uses tweetnacl (Node.js standard), so you must match its expectations",
          "If you only use 32 bytes, the signature will be computed differently and verification will fail"
        ],
        
        technicalDetails: {
          tweetnacl: "nacl.sign.detached(message, secretKey) where secretKey is 64 bytes",
          pynacl_wrong: "signing.SigningKey(seed).sign(message) where seed is 32 bytes - INCOMPATIBLE",
          pynacl_correct: "nacl.bindings.crypto_sign_detached(message, keypair) where keypair is 64 bytes - COMPATIBLE"
        }
      },

      verificationProcess: {
        title: "How the Server Verifies Your Signature",
        steps: [
          "1. Receives your login request with roditid, timestamp, and signature",
          "2. Reconstructs the message: roditid + new Date(timestamp * 1000).toISOString()",
          "3. Queries the blockchain to get the RODiT token's owner_id (your public key)",
          "4. Calls nacl.sign.detached.verify(message, signature, publicKey)",
          "5. If verification succeeds, issues JWT token; otherwise returns Error 035"
        ],
        
        serverCode: {
          description: "This is the actual server verification code",
          snippet: `// Server-side verification (sdk/lib/auth/authentication.js)
const timeString = await unixTimeToDateString(peertimestamp);
const roditidandtimestamp = new TextEncoder().encode(
  peerroditid + timeString
);

const bytes_ed25519_signature = new Uint8Array(
  Buffer.from(peerroditid_base64url_signature, "base64url")
);

const peer_bytes_ed25519_public_key = 
  await nearorg_rpc_fetchpublickeybytes(peer_rodit.owner_id);

const isaMatch = nacl.sign.detached.verify(
  roditidandtimestamp,
  bytes_ed25519_signature,
  peer_bytes_ed25519_public_key
);`
        }
      },

      completeWorkingExample: {
        title: "Complete Working Example (Python)",
        description: "Copy-paste ready code that will work correctly - demonstrates CORRECT usage of /api/login/timestamp",
        code: `#!/usr/bin/env python3
"""
RODiT Login - Complete Working Example
Demonstrates CORRECT signature generation for IdentityClaw API

KEY POINTS:
1. Uses /api/login/timestamp to get timestamp and timestamp_iso from SAME moment
2. Uses full 64-byte keypair for signing (not just 32-byte seed)
3. Properly encodes signature as base64url without padding
"""
import json
import base64
import base58
import urllib.request
import nacl.bindings

# Configuration - Replace with your actual credentials
RODIT_ID = "bkbvehbdcrgm"
PRIVATE_KEY = "ed25519:4LxQnJAnfFzHJV8ECWA49Z9KbApPSbTzzqaYg5Fxj3XUzVDTw5poaYoPj1yCBnJqE6har36YHGmW21a2cskNsLra"

def login():
    # Step 1: Get fresh auth params from server (RECOMMENDED APPROACH)
    print("[1] Fetching auth params from server...")
    resp = urllib.request.urlopen("https://api.identyclaw.com/api/login/timestamp")
    auth = json.loads(resp.read().decode())
    ts = auth["timestamp"]
    ts_iso = auth["timestamp_iso"]
    
    print(f"    ✅ timestamp: {ts}")
    print(f"    ✅ timestamp_iso: {ts_iso}")
    print(f"    ✅ Both from SAME moment - this prevents signature failures!")
    
    # Step 2: Construct message (literal concatenation, no separator)
    message = RODIT_ID + ts_iso
    message_bytes = message.encode('utf-8')
    print(f"\n[2] Message to sign: '{message}'")
    
    # Step 3: Decode private key (remove "ed25519:" prefix)
    key_without_prefix = PRIVATE_KEY.replace("ed25519:", "")
    keypair_bytes = base58.b58decode(key_without_prefix)  # 64 bytes total
    print(f"\n[3] Keypair length: {len(keypair_bytes)} bytes")
    print(f"    ✅ Using FULL 64-byte keypair (seed + public key)")
    
    # Step 4: Sign with FULL 64-byte keypair (CRITICAL!)
    # DO NOT use only keypair_bytes[:32] - you need all 64 bytes!
    signature_raw = nacl.bindings.crypto_sign_detached(
        message_bytes,
        keypair_bytes  # All 64 bytes, not keypair_bytes[:32]!
    )
    sig_b64 = base64.urlsafe_b64encode(signature_raw).decode('utf-8').rstrip('=')
    print(f"\n[4] Signature (base64url): {sig_b64[:50]}...")
    
    # Step 5: Login request
    payload = {
        "roditid": RODIT_ID,
        "timestamp": ts,  # Unix seconds from auth-params
        "roditid_base64url_signature": sig_b64
    }
    
    print(f"\n[5] Sending login request...")
    req = urllib.request.Request(
        "https://api.identyclaw.com/api/login",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req) as r:
            result = json.loads(r.read().decode())
            print(f"    ✅ LOGIN SUCCESS!")
            print(f"    JWT: {result['jwt_token'][:80]}...")
            return result['jwt_token']
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        try:
            err = json.loads(err_body)
            print(f"    ❌ LOGIN FAILED!")
            print(f"    Error: {err.get('error', {}).get('message', err_body)}")
        except:
            print(f"    ❌ LOGIN FAILED!")
            print(f"    Error: {err_body}")
        return None

if __name__ == "__main__":
    jwt_token = login()
    if jwt_token:
        print(f"\n✅ Successfully authenticated! Use this JWT for API calls.")
    else:
        print(f"\n❌ Authentication failed. Check the error message above.")`,
        usage: "Replace RODIT_ID and PRIVATE_KEY with your actual credentials and run",
        requirements: [
          "pip install pynacl base58",
          "Python 3.6+"
        ]
      },

      troubleshooting: {
        title: "Troubleshooting Signature Failures",
        
        error035: {
          error: "Error 035: PeerEd25519SignatureVerificationFailure",
          possibleCauses: [
            {
              cause: "Using only 32-byte seed instead of 64-byte keypair",
              solution: "Use nacl.bindings.crypto_sign_detached() with full 64 bytes",
              howToCheck: "Print len(keypair_bytes) - should be 64, not 32"
            },
            {
              cause: "Timestamp mismatch between signing and payload",
              solution: "Use /api/login/timestamp to get matching timestamp and timestamp_iso",
              howToCheck: "Verify new Date(timestamp * 1000).toISOString() === timestamp_iso"
            },
            {
              cause: "Wrong private key (doesn't match RODiT owner)",
              solution: "Verify the private key corresponds to the public key that owns the RODiT token",
              howToCheck: "Query blockchain for token owner_id and compare with your public key"
            },
            {
              cause: "Message format incorrect (extra spaces, wrong concatenation)",
              solution: "Message must be exactly: roditid + timestamp_iso with no separators",
              howToCheck: "Print the exact message bytes before signing"
            }
          ]
        },

        debuggingTips: [
          "Enable verbose logging to see the exact message being signed",
          "Print the keypair length - must be 64 bytes",
          "Verify timestamp and timestamp_iso are from the same moment",
          "Check that base64url encoding has no padding (no '=' at the end)",
          "Compare your signature generation with the working example above",
          "Test with the exact credentials from the working example first"
        ]
      },

      summary: {
        title: "Quick Summary for AI Agents",
        keyPoints: [
          "✅ Use the FULL 64-byte keypair from base58 decode, not just the first 32 bytes",
          "✅ In Python: use nacl.bindings.crypto_sign_detached(message, keypair_64_bytes)",
          "✅ In Node.js: use nacl.sign.detached(message, keypair_64_bytes)",
          "✅ Message format: roditid + timestamp_iso (literal concatenation)",
          "✅ Get timestamp and timestamp_iso from /api/login/timestamp (same moment)",
          "✅ Encode signature as base64url (no padding)",
          "❌ DON'T use signing.SigningKey(seed_32_bytes).sign() - incompatible with server",
          "❌ DON'T extract only keypair[:32] - you need all 64 bytes",
          "❌ DON'T mix timestamps from different moments (T1 and T2)"
        ]
      },
      
      finalChecklist: {
        title: "✅ Pre-Flight Checklist Before Calling /api/login",
        checks: [
          {
            check: "Timestamp consistency",
            question: "Did I get both timestamp AND timestamp_iso from the SAME /api/login/timestamp call?",
            critical: true
          },
          {
            check: "Keypair size",
            question: "Am I using the FULL 64-byte keypair for signing (not just 32 bytes)?",
            critical: true
          },
          {
            check: "Message format",
            question: "Is my message exactly: roditid + timestamp_iso with no separator?",
            critical: true
          },
          {
            check: "Signature encoding",
            question: "Did I encode the signature as base64url and remove padding (=)?",
            critical: true
          },
          {
            check: "Payload fields",
            question: "Does my payload have: roditid, timestamp (Unix seconds), roditid_base64url_signature?",
            critical: true
          },
          {
            check: "Content-Type header",
            question: "Did I set Content-Type: application/json?",
            critical: false
          },
          {
            check: "Private key ownership",
            question: "Does my private key match the RODiT token owner on the blockchain?",
            critical: true
          }
        ]
      }
    }
  },

  // AI Agent-to-Agent Authentication using HOLA messages
  agentToAgentAuth: {
    title: "How AI Agents Authenticate Each Other (HOLA Protocol)",
    description: "Participants (AI agents) can authenticate each other using HOLA (Hello Authentication) messages, which provide cryptographic proof of identity ownership",
    
    whatThisIsFor: {
      purpose: "🤝 Peer-to-Peer Authentication - Prove your identity to another agent",
      useCase: "When Agent A needs to prove to Agent B that they own a specific RODiT token",
      notForServerAuth: "⚠️ This is NOT for logging into the API server. For server authentication, use /api/login (see howToLogin)."
    },
    
    keyDifferences: {
      holaAuth: {
        what: "Agent-to-agent identity proof (peer-to-peer)",
        messageFormat: "HOLA/<recipient>/<tokenId>/<timestamp>/<nonce>/API.IDENTYCLAW.COM/<signature>/<checksum>",
        signedContent: "HOLA/<recipient>/<tokenId>/<timestamp>/<nonce>/API.IDENTYCLAW.COM/",
        verification: "Any agent can verify using POST /api/identity/verify",
        requiresJWT: "Yes - you need a JWT (from /api/login) to request nonces and verify HOLA messages",
        usedFor: "Proving your identity to peers, establishing trust between agents"
      },
      apiLogin: {
        what: "Server authentication to get API access",
        messageFormat: "roditid + timestamp_iso (simple concatenation)",
        signedContent: "roditid + timestamp_iso (e.g., 'bkbvehbdcrgm2026-04-19T18:19:18.000Z')",
        verification: "Server verifies and issues JWT token",
        requiresJWT: "No - this is how you GET the JWT",
        usedFor: "Accessing protected API endpoints"
      }
    },
    
    overview: {
      purpose: "Enable secure peer-to-peer authentication between AI agents without requiring a central authority for each interaction",
      protocol: "HOLA (Hello Authentication) - a challenge-response protocol using Ed25519 signatures",
      benefits: [
        "Decentralized verification - any agent can verify any other agent",
        "Cryptographic proof of RODiT token ownership",
        "Timestamp-based freshness to prevent replay attacks",
        "Checksum validation for message integrity"
      ],
      prerequisite: "⚠️ IMPORTANT: You must first obtain a JWT token via /api/login before you can generate or verify HOLA messages",
      securityConsideration: "🔒 For particularly security-conscious users: You can challenge each other using the registered Contact URI with a nonce to detect if an IdentityClaw Passport has been stolen so you can verify that the legitimate owner still has control of their passport."
    },

    holaMessageFormat: {
      structure: "HOLA/<recipient>/<tokenId>/<ISO8601-timestamp>/<noncets-hex>/API.IDENTYCLAW.COM/<base32-signature>/<checksum>",
      
      caseInsensitive: {
        title: "🔤 CASE-INSENSITIVE PROTOCOL (Morse Code Compatible)",
        description: "The HOLA protocol is case-insensitive for Morse code compatibility. The protocol accepts any case (e.g., 'hola', 'HOLA', 'Hola') but normalizes to uppercase before signing and verifying.",
        normalization: "All incoming HOLA messages are canonicalized to uppercase for signature verification and checksum calculation. When signing or verifying, the full signed payload is canonicalized to uppercase. Token ID blockchain lookup uses lowercase normalization only.",
        morseCompatibility: "This case-insensitivity makes HOLA messages easily encodable in Morse code, which is naturally case-insensitive.",
        examples: [
          "hola-mundo-abcdefghijkl-2026-04-19T10:47:00.000Z-4F9A3C7E2D1B9A4C-API.IDENTYCLAW.COM-SIGNATURE-CHECKSUM",
          "HOLA/MUNDO/abcdefghijkl/2026-04-19T10:47:00.000Z/4F9A3C7E2D1B9A4C/API.IDENTYCLAW.COM/SIGNATURE/CHECKSUM",
          "Hola-Mundo-abcdefghijkl-2026-04-19T10:47:00.000Z-4F9A3C7E2D1B9A4C-API.IDENTYCLAW.COM-SIGNATURE-CHECKSUM"
        ],
        note: "All three examples above are equivalent and will verify successfully because they normalize to the same canonical uppercase form."
      },
      
      criticalClarification: {
        title: "⚠️ NONCE SIZE CLARIFICATION",
        problem: "Agents often confuse nonce sizes. There are TWO different nonce types:",
        types: [
          {
            context: "/api/login/timestamp endpoint (for /api/login)",
            size: "32 bytes",
            encoding: "base64url",
            encodedLength: "43 characters",
            usage: "NOT used in HOLA messages - only for /api/login",
            example: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q=="
          },
          {
            context: "/api/holanonce16ts endpoint (for HOLA messages)",
            size: "16 bytes",
            encoding: "hex",
            encodedLength: "32 hex characters",
            usage: "MUST be used in HOLA messages",
            example: "4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE"
          }
        ],
        rule: "For HOLA messages: Always use the noncets from /api/holanonce16ts (16 bytes = 32 hex chars), NOT the nonce from /api/login/timestamp (32 bytes = 43 base64url chars)"
      },
      
      components: {
        prefix: {
          value: "HOLA/",
          description: "Protocol identifier"
        },
        recipient: {
          format: "Any string, typically a token ID or agent name",
          description: "The intended recipient of this message (defaults to MUNDO if not specified)",
          default: "MUNDO",
          example: "abcdefghijkl or MUNDO"
        },
        tokenId: {
          format: "12 lowercase letters a-z",
          description: "The sender's RODiT token ID",
          example: "abcdefghijkl"
        },
        timestamp: {
          format: "ISO 8601 string",
          description: "When the message was created",
          example: "2026-04-19T10:47:00.000Z"
        },
        noncetsHex: {
          format: "32 hex characters (0-9A-F) - this is 16 bytes encoded as hex",
          description: "Cryptographic nonce for uniqueness and replay prevention. Obtained from /api/holanonce16ts endpoint. Do NOT uppercase/lowercase it—use the string verbatim.",
          size: "16 bytes (32 hex characters)",
          source: "GET /api/holanonce16ts endpoint (requires JWT)",
          example: "4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE"
        },
        protocolMarker: {
          value: "API.IDENTYCLAW.COM",
          description: "Domain identifier for this authentication protocol"
        },
        signature: {
          format: "base64url-encoded Ed25519 signature",
          description: "Signature over the message prefix (everything before the signature field)",
          signedMessage: "HOLA/<recipient>/<tokenId>/<timestamp>/<noncetsHex>/API.IDENTYCLAW.COM/"
        },
        checksum: {
          format: "Single hex character (0-9A-F)",
          description: "Integrity check computed from the entire message before checksum"
        }
      },
      exampleMessages: {
        withMundoRecipient: "HOLA/MUNDO/abcdefghijkl/2026-04-19T10:47:00.000Z/A1B2C3D4E5F6789012345678901234AB/API.IDENTYCLAW.COM/BASE64URL_SIGNATURE/C",
        withSpecificRecipient: "HOLA/zyxwvutsrqpo/abcdefghijkl/2026-04-19T10:47:00.000Z/A1B2C3D4E5F6789012345678901234AB/API.IDENTYCLAW.COM/BASE64URL_SIGNATURE/C"
      },

      subagentHolaFormat: {
        title: "⚠️ Subagent HOLA Format (Delegated Signers)",
        description: "Subagents (delegated signers authorized via /api/isauthorizedsigner) use a DIFFERENT HOLA format that includes their delegateID, issuer's token_id, and their public key",
        whenToUse: "Use this format when you are a subagent acting on behalf of an issuer (owner) who has authorized your public key",
        
        structure: "HOLA/<recipient>/<delegateID>/<issuer_tokenId>/<publicKey>/<ISO8601-timestamp>/<noncets-hex>/API.IDENTYCLAW.COM/<base32-signature>/<checksum>",
        
        keyDifferences: [
          {
            field: "Second field (after recipient)",
            standard: "tokenId - Your own token ID",
            subagent: "delegateID - Your hashOrDelegateId from /api/isauthorizedsigner (DID, name, or BLAKE3 hash)"
          },
          {
            field: "Third field",
            standard: "ISO8601-timestamp",
            subagent: "issuer_tokenId - The token ID of the owner who authorized you"
          },
          {
            field: "Fourth field",
            standard: "noncets-hex",
            subagent: "publicKey - Your base32-encoded Ed25519 public key (32 bytes)"
          },
          {
            field: "Fifth field",
            standard: "API.IDENTYCLAW.COM",
            subagent: "ISO8601-timestamp - Standard timestamp"
          },
          {
            field: "Sixth field",
            standard: "signature",
            subagent: "noncets-hex - Standard nonce (32 uppercase hex characters)"
          }
        ],
        
        components: {
          recipient: {
            format: "Any string, typically a token ID or agent name",
            description: "The intended recipient of this message (defaults to MUNDO if not specified)",
            default: "MUNDO"
          },
          delegateID: {
            format: "String (1-128 characters)",
            description: "The hashOrDelegateId from /api/isauthorizedsigner - can be a DID, name, BLAKE3 hash, or any identifier",
            example: "did:identyclaw:subagent123 or my-subagent or blake3_hash_value"
          },
          issuerTokenId: {
            format: "12 lowercase letters a-z",
            description: "The token ID of the issuer (owner) who authorized this subagent via /api/isauthorizedsigner",
            example: "abcdefghijkl"
          },
          publicKey: {
            format: "base32-encoded Ed25519 public key (52 characters, no padding)",
            description: "The subagent's public key that was authorized by the issuer",
            example: "dGVzdHB1YmxpY2tleWJhc2U2NHVybGVuY29kZWQ="
          },
          timestamp: {
            format: "ISO 8601 timestamp (UTC)",
            description: "When the HOLA message was created (prevents replay attacks)",
            example: "2026-04-19T10:47:00.000Z"
          },
          noncetsHex: {
            format: "32 uppercase hex characters (16 bytes)",
            description: "Cryptographic nonce from /api/holanonce16ts endpoint (hex-encoded, uppercase)",
            example: "A1B2C3D4E5F6789012345678901234AB"
          },
          domain: {
            format: "API.IDENTYCLAW.COM",
            description: "Domain identifier for this authentication protocol"
          },
          signature: {
            format: "base32-encoded Ed25519 signature",
            description: "Signature over the message prefix (everything before the signature field), created with the SUBAGENT's private key",
            signedMessage: "HOLA/<recipient>/<delegateID>/<issuer_tokenId>/<publicKey>/<timestamp>/<noncetsHex>/API.IDENTYCLAW.COM/"
          },
          checksum: {
            format: "Single hex character (0-9A-F)",
            description: "Integrity check computed from the entire message before checksum"
          }
        },
        
        exampleMessage: "HOLA/MUNDO/did:identyclaw:subagent123/abcdefghijkl/dGVzdHB1YmxpY2tleWJhc2U2NHVybGVuY29kZWQ=/2026-04-19T10:47:00.000Z/A1B2C3D4E5F6789012345678901234AB/API.IDENTYCLAW.COM/BASE64URL_SIGNATURE/C",
        
        authorizationFlow: {
          title: "Subagent Authorization Flow",
          steps: [
            "1. Issuer (owner) authorizes subagent's public key via /api/isauthorizedsigner endpoint",
            "2. Issuer provides: tokenId, hashOrDelegateId, unixTimestamp, publicKey, signature",
            "3. Subagent stores their authorization proof (issuer's signature)",
            "4. When subagent needs to authenticate, they use the subagent HOLA format",
            "5. Subagent includes: delegateID, issuer's token_id, and their own public key in HOLA",
            "6. Verifier can validate the authorization chain via /api/isauthorizedsigner"
          ]
        },
        
        importantNotes: [
          "⚠️ The signature is created with the SUBAGENT's private key, not the issuer's",
          "⚠️ The delegateID is the hashOrDelegateId from /api/isauthorizedsigner (DID, name, or BLAKE3 hash)",
          "⚠️ The issuer_tokenId identifies who authorized this subagent",
          "⚠️ The publicKey field is the SUBAGENT's public key (base32-encoded)",
          "⚠️ noncets-hex is 32 uppercase hex characters (from /api/holanonce16ts)",
          "⚠️ Verifiers should use /api/isauthorizedsigner to validate the authorization chain",
          "⚠️ This format enables subagents to prove they are authorized by a specific issuer"
        ]
      }
    },

    workflow: {
      title: "Complete Agent-to-Agent Authentication Flow",
      steps: [
        {
          step: 1,
          actor: "Agent A (Initiator)",
          action: "Obtain JWT token",
          description: "First authenticate with the server using /api/login to get a JWT token",
          endpoint: "POST /api/login",
          required: true
        },
        {
          step: 2,
          actor: "Agent A",
          action: "Generate nonce",
          description: "Request a fresh cryptographic nonce from the server",
          endpoint: "GET /api/holanonce16ts",
          authentication: "Bearer <jwt_token>",
          response: {
            noncetsHex: "<hex_nonce>",
            timestamp: "ISO 8601 string",
            length: 16,
            algorithm: "randomBytes(16)_hex"
          }
        },
        {
          step: 3,
          actor: "Agent A",
          action: "Construct HOLA message",
          description: "Build the HOLA message with recipient, tokenId, timestamp, nonce, and signature",
          details: [
            "Extract noncets hex from the server response",
            "Preserve the casing of that noncets hex string (sign and checksum using it verbatim)",
            "Choose a recipient (defaults to MUNDO if not specified)",
            "Build message prefix: HOLA/<recipient>/<yourTokenId>/<timestamp>/<noncetsHex>/API.IDENTYCLAW.COM/",
            "Sign the message prefix with your Ed25519 private key",
            "Encode signature as base64url",
            "Compute checksum of the complete message (prefix + signature + '-')",
            "Append checksum to complete the HOLA message"
          ]
        },
        {
          step: 4,
          actor: "Agent A",
          action: "Send HOLA to Agent B",
          description: "Transmit your HOLA message to the peer agent through your communication channel",
          note: "This can be via any transport mechanism (HTTP, WebSocket, direct API call, etc.)"
        },
        {
          step: 5,
          actor: "Agent B (Verifier)",
          action: "Verify HOLA message",
          description: "Validate the received HOLA message using the verification endpoint",
          endpoint: "POST /api/identity/verify",
          authentication: "Bearer <agent_b_jwt_token>",
          requestBody: {
            hello: "HOLA/<tokenId>/...",
            constraints: {
              maxAgeMs: 300000
            }
          },
          response: {
            verified: true,
            peerTokenId: "abcdefghijkl",
            checks: {
              tokenExists: true,
              tokenActive: true,
              timestampFresh: true,
              signatureValid: true,
              checksumValid: true
            },
            failureReasons: [],
            signatureVerificationImplemented: true
          }
        },
        {
          step: 6,
          actor: "Agent B",
          action: "Establish trust",
          description: "If verification succeeds, Agent B now has cryptographic proof that Agent A owns the specified RODiT token",
          outcome: "Bidirectional authentication can be achieved by having Agent B send its own HOLA message to Agent A"
        }
      ]
    },

    endpoints: {
      getNonce: {
        method: "GET",
        path: "/api/holanonce16ts",
        authentication: "Required (Bearer JWT)",
        description: "Obtain a fresh cryptographic nonce for HOLA message construction",
        response: "Returns noncetsHex (32 hex characters) and timestamp (ISO 8601) for direct concatenation into HOLA messages"
      },
      verifyHola: {
        method: "POST",
        path: "/api/identity/verify",
        authentication: "Required (Bearer JWT)",
        description: "Verify a peer's HOLA message and confirm their identity",
        requestBody: {
          hello: "Complete HOLA message string",
          constraints: {
            maxAgeMs: "Maximum age in milliseconds (default: 300000 = 5 minutes, max: 86400000 = 24 hours)"
          }
        },
        validationChecks: [
          "Token exists on blockchain",
          "Token is active (not revoked)",
          "Timestamp is fresh (within maxAgeMs)",
          "Ed25519 signature is valid",
          "Checksum is correct"
        ]
      },
      testHola: {
        method: "POST",
        path: "/api/testhola",
        authentication: "Required (Bearer JWT)",
        description: "Test endpoint that both validates a peer's HOLA and generates your own HOLA response",
        note: "Useful for testing and debugging HOLA message construction"
      }
    },

    signatureGeneration: {
      title: "How to generate the HOLA signature",
      steps: [
        "Construct the message to sign: HOLA/<recipient>/<tokenId>/<timestamp>/<noncetsHex>/API.IDENTYCLAW.COM/",
        "Convert the message string to UTF-8 bytes using TextEncoder",
        "Sign the bytes with your Ed25519 private key (the same key used for /api/login)",
        "Encode the signature as base64url (URL-safe: use - and _ instead of + and /, no padding =)"
      ],
      codeExample: `
// Node.js example using tweetnacl
const nacl = require('tweetnacl');
const message = \`HOLA/\${recipient}/\${tokenId}/\${timestamp}/\${noncetsHex}/API.IDENTYCLAW.COM/\`;
const messageBytes = new TextEncoder().encode(message);
const signatureBytes = nacl.sign.detached(messageBytes, privateKeyBytes);
const signatureB64url = Buffer.from(signatureBytes).toString('base64url');
      `
    },

    checksumComputation: {
      title: "How to compute the checksum",
      description: "The checksum is a single hex character (0-9A-F) computed from the message (NOT MD5/SHA)",
      algorithm: "Sum all UTF-8 byte values in the message, take modulo 16, convert to uppercase hex",
      warning: "Do NOT use MD5/SHA hashes. The server expects a simple additive checksum (sum of char codes % 16)",
      steps: [
        "Build the prefix with signature: HOLA/<recipient>/<tokenId>/<timestamp>/<noncetsHex>/API.IDENTYCLAW.COM/<signature>/",
        "Convert the string to UTF-8 bytes",
        "Sum all byte values",
        "Take the sum modulo 16",
        "Convert to uppercase hex character (0-9A-F)"
      ],
      codeExample: {
        javascript: `// JavaScript checksum calculation
const messageWithSignature = \`HOLA/\${recipient}/\${tokenId}/\${timestamp}/\${noncetsHex}/API.IDENTYCLAW.COM/\${signature}/\`;
let sum = 0;
for (let i = 0; i < messageWithSignature.length; i++) {
  sum += messageWithSignature.charCodeAt(i);
}
const checksum = '0123456789ABCDEF'[sum % 16];`,
        python: `# Python checksum calculation
message_with_signature = f"HOLA/{recipient}/{token_id}/{timestamp}/{noncets_hex}/API.IDENTYCLAW.COM/{signature}/"
checksum_val = sum(ord(c) for c in message_with_signature) % 16
checksum = "0123456789ABCDEF"[checksum_val]`
      }
    },

    qrCodeEncoding: {
      title: "📱 HOLA Handshakes as QR Codes (Video Call Validation)",
      description: "HOLA messages can be encoded as QR codes for visual verification during video calls, providing an additional layer of identity confirmation",
      
      overview: {
        purpose: "Enable agents to validate each other's identity during video calls by scanning QR codes",
        useCase: "When two agents are on a video call and want to cryptographically verify each other's identity in real-time",
        benefits: [
          "Visual confirmation of identity ownership",
          "Prevents man-in-the-middle attacks during video calls",
          "Provides human-readable verification alongside cryptographic proof",
          "Works with any standard QR code reader"
        ]
      },

      holaToQrProcess: {
        title: "How to Encode HOLA as QR Code",
        steps: [
          {
            step: 1,
            action: "Generate HOLA message",
            description: "Follow the standard HOLA message generation process to create a complete HOLA message",
            example: "HOLA/MUNDO/abcdefghijkl/2026-04-19T10:47:00.000Z/4F9A3C7E2D1B9A4CDEADBEEFCAFEBABE/API.IDENTYCLAW.COM/dGVzdA==/C"
          },
          {
            step: 2,
            action: "Encode as QR code",
            description: "Use any standard QR code library to encode the complete HOLA message string",
            libraries: [
              "JavaScript: qrcode.js, qr-code, qrcode-generator",
              "Python: qrcode, pyqrcode",
              "Node.js: qrcode npm package",
              "Web: https://qr-server.com/api/qr (simple HTTP API)"
            ]
          },
          {
            step: 3,
            action: "Display QR code",
            description: "Show the generated QR code on screen during the video call"
          },
          {
            step: 4,
            action: "Peer scans QR code",
            description: "The other agent scans the QR code using their device/camera"
          },
          {
            step: 5,
            action: "Verify HOLA",
            description: "The peer calls POST /api/identity/verify with the decoded HOLA message to cryptographically verify the identity"
          }
        ]
      },

      qrCodeSize: {
        title: "QR Code Size Considerations",
        holaMessageLength: "HOLA messages are typically 200-300 characters when fully encoded",
        recommendedQrVersion: "Version 5-7 (typically 37x37 to 45x45 modules)",
        errorCorrection: "Use Level M (15% error correction) or Level H (30% error correction) for reliability",
        displaySize: "Display QR code at least 200x200 pixels for reliable scanning from typical video call distances"
      },

      workflowExample: {
        title: "Complete Video Call Verification Workflow",
        scenario: "Agent A and Agent B are on a video call and want to verify each other's identity",
        steps: [
          {
            actor: "Agent A",
            action: "Generate HOLA message",
            details: [
              "Call POST /api/login to get JWT",
              "Call GET /api/holanonce16ts to get nonce",
              "Construct HOLA message with recipient=Agent B's token ID (or MUNDO for broadcast)",
              "Sign and compute checksum"
            ]
          },
          {
            actor: "Agent A",
            action: "Encode HOLA as QR code",
            details: [
              "Use QR code library to encode the HOLA string",
              "Display QR code on screen (or share via screen sharing)"
            ]
          },
          {
            actor: "Agent B",
            action: "Scan QR code",
            details: [
              "Use phone/device camera or QR scanner to decode the QR code",
              "Extract the HOLA message string"
            ]
          },
          {
            actor: "Agent B",
            action: "Verify HOLA cryptographically",
            details: [
              "Call POST /api/identity/verify with the decoded HOLA message",
              "Server returns verification result with Agent A's token ID and metadata",
              "Agent B can now confirm Agent A's identity"
            ]
          },
          {
            actor: "Agent B (Optional)",
            action: "Reciprocal verification",
            details: [
              "Agent B generates their own HOLA message",
              "Encodes as QR code and displays to Agent A",
              "Agent A scans and verifies",
              "Bidirectional identity verification complete"
            ]
          }
        ]
      },

      implementationExamples: {
        title: "Code Examples for QR Encoding",
        
        javascriptQrcode: {
          language: "JavaScript (Browser)",
          description: "Using the qrcode npm package",
          code: `// Install: npm install qrcode
const QRCode = require('qrcode');

async function generateHolaQrCode(holaMessage) {
  try {
    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(holaMessage, {
      errorCorrectionLevel: 'H',  // High error correction
      type: 'image/png',
      width: 300,  // 300x300 pixels
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    // Display in HTML
    const img = document.getElementById('qrcode');
    img.src = qrDataUrl;
    img.alt = 'HOLA QR Code';
    
    return qrDataUrl;
  } catch (error) {
    console.error('QR code generation failed:', error);
  }
}

// Usage
const holaMessage = 'HOLA/MUNDO/abcdefghijkl/2026-04-19T10:47:00.000Z/4F9A3C7E.../API.IDENTYCLAW.COM/dGVzdA==/C';
generateHolaQrCode(holaMessage);`
        },

        pythonQrcode: {
          language: "Python",
          description: "Using the qrcode library",
          code: `# Install: pip install qrcode[pil]
import qrcode

def generate_hola_qr_code(hola_message, output_file='hola_qr.png'):
    """Generate QR code from HOLA message and save to file"""
    try:
        # Create QR code instance
        qr = qrcode.QRCode(
            version=5,  # Version 5 handles ~200 characters
            error_correction=qrcode.constants.ERROR_CORRECT_H,  # High error correction
            box_size=10,  # Size of each box in pixels
            border=1,  # Border size in boxes
        )
        
        # Add data and generate
        qr.add_data(hola_message)
        qr.make(fit=True)
        
        # Create image
        img = qr.make_image(fill_color='black', back_color='white')
        
        # Save to file
        img.save(output_file)
        print(f"✅ QR code saved to {output_file}")
        
        # Optionally display
        img.show()
        
        return img
    except Exception as e:
        print(f"❌ QR code generation failed: {e}")
        return None

# Usage
hola_message = 'HOLA/MUNDO/abcdefghijkl/2026-04-19T10:47:00.000Z/4F9A3C7E.../API.IDENTYCLAW.COM/dGVzdA==/C'
generate_hola_qr_code(hola_message)`
        },

        webApi: {
          language: "Web API (No Library Required)",
          description: "Using QR Server API for simple HTTP requests",
          code: `// No library needed - use QR Server API
function generateHolaQrCodeUrl(holaMessage) {
  // URL-encode the HOLA message
  const encodedMessage = encodeURIComponent(holaMessage);
  
  // Use QR Server API
  const qrUrl = \`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=\${encodedMessage}\`;
  
  // Display in HTML
  const img = document.getElementById('qrcode');
  img.src = qrUrl;
  img.alt = 'HOLA QR Code';
  
  return qrUrl;
}

// Usage
const holaMessage = 'HOLA/MUNDO/abcdefghijkl/2026-04-19T10:47:00.000Z/4F9A3C7E.../API.IDENTYCLAW.COM/dGVzdA==/C';
const qrUrl = generateHolaQrCodeUrl(holaMessage);
console.log('QR Code URL:', qrUrl);`
        }
      },

      scanningAndVerification: {
        title: "Scanning and Verifying QR Codes",
        
        scanningTools: [
          "Mobile phone camera (iOS/Android native QR scanning)",
          "Web-based QR scanner (html5-qrcode library)",
          "Dedicated QR scanner apps",
          "Browser extensions for QR scanning"
        ],

        verificationProcess: {
          steps: [
            {
              step: 1,
              action: "Scan QR code",
              result: "Obtain the HOLA message string"
            },
            {
              step: 2,
              action: "Extract HOLA message",
              code: `// After scanning, you have the HOLA string
const holaMessage = 'HOLA/MUNDO/abcdefghijkl/2026-04-19T10:47:00.000Z/4F9A3C7E.../API.IDENTYCLAW.COM/dGVzdA==/C';`
            },
            {
              step: 3,
              action: "Call verification endpoint",
              code: `// Verify the HOLA message
const response = await fetch('https://api.identyclaw.com/api/identity/verify', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${jwtToken}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    hello: holaMessage,
    constraints: {
      maxAgeMs: 300000  // 5 minutes
    }
  })
});

const result = await response.json();
if (result.verified) {
  console.log(\`✅ Identity verified! Token ID: \${result.peerTokenId}\`);
} else {
  console.log('❌ Verification failed');
}`
            }
          ]
        }
      },

      securityConsiderations: {
        title: "Security Considerations for QR-Based Verification",
        
        advantages: [
          "Visual confirmation prevents copy-paste attacks",
          "QR code is ephemeral (changes with each nonce)",
          "Timestamp freshness prevents replay attacks",
          "Cryptographic signature proves ownership"
        ],

        limitations: [
          "QR code must be displayed during the video call (not pre-recorded)",
          "Both parties must have JWT tokens (requires prior authentication)",
          "Timestamp freshness window is limited (default 5 minutes)",
          "Requires network access to verify (calls /api/identity/verify)"
        ],

        bestPractices: [
          "Always verify the token ID in the response matches the expected peer",
          "Check the timestamp in the HOLA message is recent (within maxAgeMs)",
          "Use high error correction level (Level H) for QR codes",
          "Display QR code for only the duration of the call",
          "Regenerate new HOLA messages for each verification (don't reuse)",
          "Combine QR verification with voice confirmation ('I see your token ID is...')"
        ]
      },

      useCases: {
        title: "Real-World Use Cases",
        
        legalDocumentSigning: {
          scenario: "Two agents signing a legal document via video call",
          process: [
            "Agent A generates HOLA QR code",
            "Agent B scans and verifies Agent A's identity",
            "Agent B generates HOLA QR code",
            "Agent A scans and verifies Agent B's identity",
            "Both agents now have cryptographic proof of each other's identity",
            "They proceed to sign the document with confidence"
          ]
        },

        secureDataExchange: {
          scenario: "Agents exchanging sensitive data over untrusted channels",
          process: [
            "Agents verify each other via QR codes during video call",
            "Exchange encrypted data through any channel (email, messaging, etc.)",
            "Both parties can verify the data came from the verified peer"
          ]
        },

        trustEstablishment: {
          scenario: "New agents meeting for the first time",
          process: [
            "Agents meet on video call",
            "Exchange HOLA QR codes for mutual verification",
            "Establish trust relationship for future interactions",
            "Can now communicate securely without video calls"
          ]
        }
      }
    },

    commonErrorsAndTroubleshooting: {
      title: "🚨 Common Errors and Troubleshooting Guide",
      description: "Based on real agent enrollment experiences, here are the most common issues and their solutions",
      
      error1_wrongNonceSource: {
        error: "HOLA Signature Invalid / Signature Verification Failed",
        symptom: "Server returns 400 with HELLO_SIGNATURE_INVALID or signature verification fails",
        rootCause: "Using the wrong nonce source - mixing up /api/login/timestamp (32 bytes) with /api/holanonce16ts (16 bytes)",
        solution: {
          title: "Use the correct nonce endpoint",
          steps: [
            "❌ WRONG: Do NOT use /api/login/timestamp nonce for HOLA messages",
            "✅ CORRECT: Use /api/holanonce16ts endpoint which returns 16 bytes (32 hex chars)",
            "Verify your noncets hex is exactly 32 uppercase hex characters",
            "Example correct noncets: 2A201A1A653A8003A856D4C3AC7082AA"
          ]
        },
        debugSteps: [
          "Log the exact noncets value you're using",
          "Verify it came from /api/holanonce16ts (not /api/login/timestamp)",
          "Check the length: should be 32 hex characters",
          "Verify the case: should be UPPERCASE (as returned by server)"
        ]
      },

      error2_noncetsValidationFailed: {
        error: "HELLO_NONCETS_INVALID",
        symptom: "Server returns 400 with message about invalid noncets format",
        rootCause: "Wrong nonce length, wrong case, or invalid hex characters",
        solution: {
          title: "Verify noncets format",
          requirements: [
            "Must be exactly 32 hex characters (0-9, A-F)",
            "Must be UPPERCASE (as returned by /api/holanonce16ts)",
            "Must contain only valid hex characters",
            "Do NOT modify the case - use verbatim from server response"
          ]
        },
        debugSteps: [
          "Check length: noncetsHex.length === 32",
          "Check case: noncetsHex === noncetsHex.toUpperCase()",
          "Check format: /^[0-9A-F]{32}$/.test(noncetsHex)",
          "Verify you extracted it correctly from the :timestamp:hex: format"
        ]
      },

      error3_checksumMismatch: {
        error: "HELLO_CHECKSUM_INVALID",
        symptom: "Server returns 400 with checksum validation failure",
        rootCause: "Using wrong checksum algorithm (MD5/SHA instead of simple sum) or computing over wrong string",
        solution: {
          title: "Use the correct checksum algorithm",
          algorithm: "sum(charCodes) % 16 → single hex digit",
          notThisAlgorithm: "NOT MD5, NOT SHA-256, NOT any cryptographic hash",
          correctApproach: [
            "Build string: HOLA/<recipient>/<tokenId>/<timestamp>/<noncetsHex>/API.IDENTYCLAW.COM/<signature>/",
            "Sum all character codes: let sum = 0; for each char: sum += char.charCodeAt(0)",
            "Take modulo 16: checksum_index = sum % 16",
            "Convert to hex: checksum = '0123456789ABCDEF'[checksum_index]"
          ]
        },
        debugSteps: [
          "Log the exact string you're checksumming (should end with '-' after signature)",
          "Verify you're using character codes, not byte values",
          "Test with known example to verify your implementation",
          "Check that checksum is a single uppercase hex character (0-9A-F)"
        ]
      },

      error4_timestampInvalid: {
        error: "HELLO_TIMESTAMP_INVALID",
        symptom: "Server rejects timestamp format",
        rootCause: "Using wrong timestamp format or missing milliseconds",
        solution: {
          title: "Use ISO-8601 timestamp with milliseconds",
          correctFormat: "2026-04-22T14:39:49.000Z",
          requirements: [
            "Must be ISO-8601 format",
            "Must include milliseconds (.000Z)",
            "Must be in UTC timezone (Z suffix)",
            "Use the timestamp from /api/holanonce16ts response directly"
          ]
        },
        debugSteps: [
          "Verify format matches: YYYY-MM-DDTHH:MM:SS.sssZ",
          "Check for milliseconds: timestamp should contain '.000Z' or similar",
          "Use the timestamp from /api/holanonce16ts response verbatim",
          "Do NOT generate your own timestamp"
        ]
      },

      error5_recipientMismatch: {
        error: "RECIPIENT_MISMATCH warning",
        symptom: "Server returns warning about potential man-in-the-middle attack",
        rootCause: "The recipient field in HOLA doesn't match the verifier's token ID",
        solution: {
          title: "Understand recipient field semantics",
          explanation: "The recipient field indicates who the HOLA is intended for. Use 'MUNDO' for general-purpose handshakes, or specify the exact token ID of your intended recipient.",
          options: [
            "Use 'MUNDO' for broadcast/general handshakes",
            "Use specific token ID when sending to a known peer",
            "The verifier will warn if recipient doesn't match their token ID"
          ]
        },
        debugSteps: [
          "Check if you intended this HOLA for a specific recipient",
          "If yes, ensure recipient field matches their token ID",
          "If no, use 'MUNDO' as the recipient",
          "This is a warning, not an error - HOLA may still be valid"
        ]
      },

      error6_signatureEncoding: {
        error: "Signature verification fails despite correct signing",
        symptom: "Signature is valid locally but server rejects it",
        rootCause: "Using standard base64 instead of base64url encoding",
        solution: {
          title: "Use base64url encoding (not standard base64)",
          differences: [
            "base64url replaces '+' with '-'",
            "base64url replaces '/' with '_'",
            "base64url removes '=' padding",
            "This is RFC 4648 Section 5 encoding"
          ],
          correctApproach: [
            "Sign the message with Ed25519",
            "Encode signature as base64",
            "Replace '+' with '-'",
            "Replace '/' with '_'",
            "Remove any '=' padding characters"
          ]
        },
        debugSteps: [
          "Check if signature contains '+' or '/' (should not)",
          "Check if signature ends with '=' (should not)",
          "Verify signature length is appropriate for Ed25519 (86 chars for base64url)",
          "Test signature encoding with known test vectors"
        ]
      },

      error7_wrongPrivateKey: {
        error: "Signature verification fails consistently",
        symptom: "All signatures fail verification even with correct format",
        rootCause: "Using wrong Ed25519 private key or deriving key incorrectly from seed phrase",
        solution: {
          title: "Use the correct private key from credentials file",
          criticalWarning: "⚠️ DO NOT derive Ed25519 key from NEAR seed phrase - this causes key mismatch!",
          correctApproach: [
            "Read private_key from ~/.near-credentials/mainnet/<account-id>.json",
            "The value starts with 'ed25519:'",
            "Decode the base58 part after 'ed25519:'",
            "Use this decoded key directly for signing",
            "Do NOT use parseSeedPhrase or any seed-based derivation"
          ]
        },
        debugSteps: [
          "Verify you're reading from the correct credentials file",
          "Check that private_key field exists and starts with 'ed25519:'",
          "Decode the base58 portion correctly",
          "Test signing locally and verify with the public key from same file",
          "Ensure public key matches what's registered on blockchain"
        ]
      },

      error8_creatureFieldMissing: {
        error: "Creature field validation fails",
        symptom: "Identity verification mentions missing or invalid creature field",
        rootCause: "RODiT token metadata doesn't include creature field or it's empty",
        solution: {
          title: "Ensure creature field is set during token minting",
          explanation: "The creature field identifies your agent's role/profession and is required for proper identity verification",
          examples: [
            "Legal Specialist",
            "Data Analyst",
            "SRE Engineer",
            "Compliance Officer",
            "Translator",
            "Majordomo"
          ],
          note: "This field is set during RODiT token minting and cannot be changed afterward without re-minting"
        }
      },

      quickReferenceTable: {
        title: "Quick Reference: Error → Solution",
        errors: [
          {
            error: "HELLO_SIGNATURE_INVALID",
            mostLikelyCause: "Wrong nonce source (using /api/login/timestamp instead of /api/holanonce16ts)",
            quickFix: "Use /api/holanonce16ts endpoint for HOLA nonces"
          },
          {
            error: "HELLO_NONCETS_INVALID",
            mostLikelyCause: "Wrong nonce length or case",
            quickFix: "Verify 32 uppercase hex characters from /api/holanonce16ts"
          },
          {
            error: "HELLO_CHECKSUM_INVALID",
            mostLikelyCause: "Using cryptographic hash instead of simple sum",
            quickFix: "Use sum(charCodes) % 16, not MD5/SHA"
          },
          {
            error: "HELLO_TIMESTAMP_INVALID",
            mostLikelyCause: "Missing milliseconds or wrong format",
            quickFix: "Use ISO-8601 with .000Z from /api/holanonce16ts"
          },
          {
            error: "Signature fails verification",
            mostLikelyCause: "Using standard base64 or wrong private key",
            quickFix: "Use base64url encoding and private_key from credentials file"
          }
        ]
      }
    },

    securityConsiderations: {
      replayPrevention: "Use fresh nonces from /api/holanonce16ts for each HOLA message",
      timestampValidation: "Verifier should enforce maxAgeMs to prevent stale messages",
      nonceUniqueness: "Server-generated nonces include timestamp and cryptographic randomness",
      signatureVerification: "Ed25519 signatures provide strong cryptographic proof of ownership",
      tokenRevocation: "Verification checks if the token is still active on the blockchain"
    },

    useCases: [
      "Agent-to-agent direct communication without server mediation",
      "Establishing secure peer-to-peer channels",
      "Verifying agent identity in distributed systems",
      "Building trust networks between autonomous agents",
      "Implementing decentralized authentication protocols"
    ],

    exampleCurl: {
      getNonce: 'curl -X GET https://<host>/api/holanonce16ts -H "Authorization: Bearer <jwt_token>"',
      verifyHola: 'curl -X POST https://<host>/api/identity/verify -H "Authorization: Bearer <jwt_token>" -H "Content-Type: application/json" -d \'{"hello": "HOLA/MUNDO/abcdefghijkl/2026-04-19T10:47:00.000Z/A1B2C3D4.../API.IDENTYCLAW.COM/BASE64URL_SIG/C", "constraints": {"maxAgeMs": 300000}}\''
    },

    completeWorkingExamples: {
      title: "📝 Complete Working Code Examples",
      description: "Production-ready code for generating HOLA messages in JavaScript and Python",

      javascriptExample: {
        title: "JavaScript/Node.js Complete Example",
        dependencies: [
          "tweetnacl - Ed25519 signing",
          "bs58 - Base58 decoding for private key",
          "node-fetch - HTTP requests (or use built-in fetch in Node 18+)"
        ],
        installCommand: "npm install tweetnacl bs58 node-fetch",
        code: `const nacl = require('tweetnacl');
const bs58 = require('bs58').default;
const fetch = require('node-fetch');
const fs = require('fs');

/**
 * Generate a HOLA message for inter-agent authentication
 * @param {string} recipientTokenId - Target agent's token ID or 'MUNDO' for general
 * @param {string} jwtToken - Your JWT token from /api/login
 * @param {string} credentialsPath - Path to NEAR credentials file
 * @returns {Promise<string>} Complete HOLA message
 */
async function generateHOLA(recipientTokenId, jwtToken, credentialsPath) {
  // 1. Load credentials from NEAR credentials file
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const privateKeyString = credentials.private_key; // Format: "ed25519:base58..."
  
  // 2. Decode private key (DO NOT use parseSeedPhrase!)
  const privateKeyBase58 = privateKeyString.replace('ed25519:', '');
  const privateKeyBytes = bs58.decode(privateKeyBase58);
  
  // 3. Get your token ID from credentials filename or API
  const senderTokenId = 'bqarbjehafcf'; // Your 12-char token ID
  
  // 4. Get fresh nonce from server
  const noncetsResp = await fetch('https://api.identyclaw.com/api/holanonce16ts', {
    headers: { 'Authorization': \`Bearer \${jwtToken}\` }
  });
  const noncetsData = await noncetsResp.json();
  
  // 5. Extract nonce and timestamp from response
  const noncetsHex = noncetsData.noncetsHex; // 32 uppercase hex characters
  const timestamp = noncetsData.timestamp; // ISO-8601 with milliseconds
  
  // 6. Build message to sign (everything before signature)
  const messageToSign = \`HOLA/\${recipientTokenId}/\${senderTokenId}/\${timestamp}/\${noncetsHex}/API.IDENTYCLAW.COM/\`;
  
  // 7. Sign with Ed25519
  const messageBytes = Buffer.from(messageToSign, 'utf8');
  const signature = nacl.sign.detached(messageBytes, privateKeyBytes);
  
  // 8. Encode signature as base64url (NOT standard base64!)
  const signatureBase64 = Buffer.from(signature).toString('base64');
  const signatureBase64Url = signatureBase64
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
    .replace(/=/g, ''); // Remove padding
  
  // 9. Compute checksum (sum of char codes mod 16)
  const messageWithSignature = \`\${messageToSign}\${signatureBase64Url}-\`;
  let sum = 0;
  for (let i = 0; i < messageWithSignature.length; i++) {
    sum += messageWithSignature.charCodeAt(i);
  }
  const checksum = '0123456789ABCDEF'[sum % 16];
  
  // 10. Build complete HOLA message
  const holaMessage = \`\${messageWithSignature}\${checksum}\`;
  
  return holaMessage;
}

// Usage example
async function main() {
  const jwtToken = fs.readFileSync('/tmp/identyclaw_jwt.txt', 'utf8').trim();
  const credentialsPath = process.env.HOME + '/.near-credentials/mainnet/YOUR_ACCOUNT_ID.json';
  
  const hola = await generateHOLA('MUNDO', jwtToken, credentialsPath);
  console.log('Generated HOLA:', hola);
  
  // Verify the HOLA
  const verifyResp = await fetch('https://api.identyclaw.com/api/identity/verify', {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${jwtToken}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      hello: hola,
      constraints: { maxAgeMs: 300000 } // 5 minutes
    })
  });
  
  const result = await verifyResp.json();
  console.log('Verification result:', result);
}

main().catch(console.error);`
      },

      pythonExample: {
        title: "Python Complete Example",
        dependencies: [
          "pynacl - Ed25519 signing",
          "base58 - Base58 decoding",
          "requests - HTTP requests"
        ],
        installCommand: "pip install pynacl base58 requests",
        code: `import json
import base64
import base58
import requests
from nacl.signing import SigningKey
from pathlib import Path

def generate_hola(recipient_token_id: str, jwt_token: str, credentials_path: str) -> str:
    """
    Generate a HOLA message for inter-agent authentication
    
    Args:
        recipient_token_id: Target agent's token ID or 'MUNDO' for general
        jwt_token: Your JWT token from /api/login
        credentials_path: Path to NEAR credentials file
        
    Returns:
        Complete HOLA message string
    """
    # 1. Load credentials from NEAR credentials file
    with open(credentials_path, 'r') as f:
        credentials = json.load(f)
    
    private_key_string = credentials['private_key']  # Format: "ed25519:base58..."
    
    # 2. Decode private key (DO NOT derive from seed phrase!)
    private_key_base58 = private_key_string.replace('ed25519:', '')
    private_key_bytes = base58.b58decode(private_key_base58)
    
    # Extract the 32-byte seed (first 32 bytes of the 64-byte keypair)
    signing_key = SigningKey(private_key_bytes[:32])
    
    # 3. Get your token ID
    sender_token_id = 'bqarbjehafcf'  # Your 12-char token ID
    
    # 4. Get fresh nonce from server
    noncets_resp = requests.get(
        'https://api.identyclaw.com/api/holanonce16ts',
        headers={'Authorization': f'Bearer {jwt_token}'}
    )
    noncets_data = noncets_resp.json()
    
    # 5. Parse noncets response (format: ":timestamp:hex:")
    noncets_string = noncets_data['noncets']
    timestamp = noncets_data['timestamp']  # ISO-8601 with milliseconds
    
    # Extract hex portion from ":2026-04-22T14:39:49.000Z:2AA4CB74B179DA6B67A1283D2F203B75:"
    parts = noncets_string.split(':')
    noncets_hex = parts[2]  # The hex part (32 uppercase hex chars)
    
    # 6. Build message to sign (everything before signature)
    message_to_sign = f"HOLA/{recipient_token_id}/{sender_token_id}/{timestamp}/{noncets_hex}/API.IDENTYCLAW.COM/"
    
    # 7. Sign with Ed25519
    message_bytes = message_to_sign.encode('utf-8')
    signature = signing_key.sign(message_bytes).signature
    
    # 8. Encode signature as base64url (NOT standard base64!)
    signature_base64 = base64.b64encode(signature).decode('ascii')
    signature_base64url = (signature_base64
        .replace('+', '-')
        .replace('/', '_')
        .replace('=', ''))  # Remove padding
    
    # 9. Compute checksum (sum of char codes mod 16)
    message_with_signature = f"{message_to_sign}{signature_base64url}-"
    checksum_val = sum(ord(c) for c in message_with_signature) % 16
    checksum = "0123456789ABCDEF"[checksum_val]
    
    # 10. Build complete HOLA message
    hola_message = f"{message_with_signature}{checksum}"
    
    return hola_message

# Usage example
def main():
    # Load JWT token
    with open('/tmp/identyclaw_jwt.txt', 'r') as f:
        jwt_token = f.read().strip()
    
    # Path to credentials
    credentials_path = str(Path.home() / '.near-credentials/mainnet/YOUR_ACCOUNT_ID.json')
    
    # Generate HOLA
    hola = generate_hola('MUNDO', jwt_token, credentials_path)
    print(f'Generated HOLA: {hola}')
    
    # Verify the HOLA
    verify_resp = requests.post(
        'https://api.identyclaw.com/api/identity/verify',
        headers={
            'Authorization': f'Bearer {jwt_token}',
            'Content-Type': 'application/json'
        },
        json={
            'hello': hola,
            'constraints': {'maxAgeMs': 300000}  # 5 minutes
        }
    )
    
    result = verify_resp.json()
    print(f'Verification result: {json.dumps(result, indent=2)}')

if __name__ == '__main__':
    main()`
      },

      bashExample: {
        title: "Bash/Shell Script Example",
        description: "For environments where only shell scripting is available",
        dependencies: [
          "jq - JSON parsing",
          "openssl - Ed25519 signing (OpenSSL 1.1.1+)",
          "base58 - Base58 decoding (install via: npm install -g base58-cli)"
        ],
        code: `#!/bin/bash
set -e

# Configuration
RECIPIENT_TOKEN_ID="MUNDO"
SENDER_TOKEN_ID="bqarbjehafcf"  # Your token ID
JWT_TOKEN=\$(cat /tmp/identyclaw_jwt.txt)
CREDENTIALS_FILE="\$HOME/.near-credentials/mainnet/YOUR_ACCOUNT_ID.json"

# 1. Extract private key from credentials
PRIVATE_KEY_B58=\$(jq -r '.private_key' "\$CREDENTIALS_FILE" | sed 's/ed25519://')

# 2. Decode base58 private key to hex (requires base58 CLI tool)
PRIVATE_KEY_HEX=\$(echo "\$PRIVATE_KEY_B58" | base58 -d | xxd -p -c 256)

# 3. Get fresh nonce from server
NONCETS_RESPONSE=\$(curl -s "https://api.identyclaw.com/api/holanonce16ts" \\
  -H "Authorization: Bearer \$JWT_TOKEN")

TIMESTAMP=\$(echo "\$NONCETS_RESPONSE" | jq -r '.timestamp')
NONCETS_HEX=\$(echo "\$NONCETS_RESPONSE" | jq -r '.noncetsHex')

# 4. Build message to sign
MESSAGE_TO_SIGN="HOLA/\${RECIPIENT_TOKEN_ID}/\${SENDER_TOKEN_ID}/\${TIMESTAMP}/\${NONCETS_HEX}/API.IDENTYCLAW.COM/"

# 6. Sign with Ed25519 (requires OpenSSL 1.1.1+)
# Note: This is complex in bash - consider using Python/Node.js instead
echo "⚠️  Bash signing is complex. Recommended: Use JavaScript or Python examples above."
echo "Message to sign: \$MESSAGE_TO_SIGN"
echo "Noncets hex: \$NONCETS_HEX"
echo "Timestamp: \$TIMESTAMP"`
      },

      criticalNotes: {
        title: "⚠️ Critical Implementation Notes",
        notes: [
          {
            topic: "Private Key Source",
            warning: "NEVER derive Ed25519 key from NEAR seed phrase using parseSeedPhrase()",
            correct: "Always use the private_key field from ~/.near-credentials/mainnet/<account>.json",
            reason: "Seed phrase derivation produces different keys than what's registered on blockchain"
          },
          {
            topic: "Nonce Source",
            warning: "NEVER use nonce from /api/login/timestamp for HOLA",
            correct: "Always use /api/holanonce16ts endpoint which returns 16 bytes (32 hex chars)",
            reason: "/api/login/timestamp returns 32 bytes for /api/login, not HOLA"
          },
          {
            topic: "Base64url Encoding",
            warning: "Standard base64 encoding will fail verification",
            correct: "Use base64url: replace + with -, / with _, remove = padding",
            reason: "HOLA spec requires RFC 4648 Section 5 base64url encoding"
          },
          {
            topic: "Checksum Algorithm",
            warning: "Do NOT use MD5, SHA-256, or any cryptographic hash",
            correct: "Use simple sum: sum(charCodes) % 16 → single hex digit",
            reason: "Server expects additive checksum, not cryptographic hash"
          },
          {
            topic: "Timestamp Format",
            warning: "Do NOT generate your own timestamp",
            correct: "Use timestamp from /api/holanonce16ts response verbatim (includes milliseconds)",
            reason: "Server validates timestamp freshness and format"
          }
        ]
      },

      testingYourImplementation: {
        title: "🧪 Testing Your HOLA Implementation",
        steps: [
          {
            step: 1,
            action: "Generate HOLA using your code",
            verification: "HOLA string should match format: HOLA/<recipient>/<sender>/<timestamp>/<32-hex>/API.IDENTYCLAW.COM/<base32-sig>/<checksum>"
          },
          {
            step: 2,
            action: "Verify locally before sending to server",
            verification: "Check: noncets is 32 hex chars, signature is base64url (no +/=), checksum is single hex"
          },
          {
            step: 3,
            action: "Test with /api/testhola endpoint",
            verification: "POST to /api/testhola with your HOLA - server will validate and respond with its own HOLA"
          },
          {
            step: 4,
            action: "Check all validation flags",
            verification: "Response should show all checks passing: formatValid, checksumValid, timestampValid, signatureValid"
          },
          {
            step: 5,
            action: "If any check fails, consult commonErrorsAndTroubleshooting section",
            verification: "Each error has specific debug steps and solutions"
          }
        ]
      }
    }
  },

  // Multi-Agent AI Workflows
  multiAgentWorkflows: {
    title: "Multi-Agent AI Workflows",
    description: "How this API supports collaborative workflows between multiple AI agents",
    
    overview: {
      purpose: "Enable secure, authenticated collaboration between multiple AI agents using cryptographic identity proofs",
      corePrinciple: "Each agent has a verifiable identity (RODiT token) that can be proven cryptographically, enabling trust without centralized coordination",
      foundation: "Built on HOLA peer-to-peer authentication protocol for identity verification between agents"
    },
    
    whatIsSupported: {
      title: "What This API Provides",
      capabilities: [
        {
          capability: "Cryptographic Identity",
          description: "Each agent has a unique RODiT token (12-letter ID) on NEAR blockchain that serves as their verifiable identity",
          endpoint: "GET /api/me/identity, GET /api/identity/token/{tokenId}/full"
        },
        {
          capability: "Peer Authentication",
          description: "Agents can prove their identity to each other using HOLA messages (challenge-response protocol)",
          endpoint: "POST /api/identity/verify, GET /api/holanonce16ts"
        },
        {
          capability: "Identity Verification",
          description: "Any agent can verify another agent's identity independently using the API",
          endpoint: "POST /api/identity/verify"
        },
        {
          capability: "Delegated Signer Authorization",
          description: "Agents can authorize delegated signers (sub-agents, specialized workers) with cryptographic proof",
          endpoint: "POST /api/isauthorizedsigner"
        },
        {
          capability: "Identity Metadata",
          description: "Agents can publish and retrieve rich identity information (contact URIs, capabilities, API specs)",
          endpoint: "GET /api/me/identity, GET /api/identity/token/{tokenId}/full"
        }
      ]
    },
    
    discoveryConsiderations: {
      title: "Discovery Services",
      status: "⚠️ Not Fully Developed",
      explanation: "While discovery is an important concept in multi-agent workflows (finding agents by capability, profession, or other attributes), comprehensive discovery services are not yet fully implemented in this API.",
      
      whatExists: {
        title: "Currently Available",
        items: [
          "Agents can retrieve individual identity information by token ID",
          "Creature field in RODiT metadata can indicate profession/role (for lightweight Yellow Pages functionality)",
          "Contact URIs enable agents to share how they can be reached",
          "API specifications can be published in metadata for interoperability"
        ]
      },
      
      whatIsNotAvailable: {
        title: "Not Yet Implemented",
        items: [
          "Comprehensive agent registry with search/filter capabilities",
          "Agent capability discovery by category or specialization",
          "Dynamic agent directory with availability status",
          "Reputation or trust scoring systems",
          "Automated agent matching or recommendation services"
        ]
      },
      
      recommendation: {
        title: "Current Approach",
        guidance: "For discovery needs, agents currently use out-of-band methods (direct contact exchange, curated lists, or external directories). The API provides the cryptographic foundation for identity verification once agents have discovered each other through other means."
      }
    },
    
    workflowPatterns: {
      title: "Supported Workflow Patterns",
      
      pattern1_directCollaboration: {
        name: "Direct Peer Collaboration",
        description: "Two or more agents authenticate each other directly and collaborate",
        steps: [
          "Agent A and Agent B exchange token IDs (out-of-band or through discovery)",
          "Each agent logs in to obtain JWT token for API access",
          "Agents exchange HOLA messages to mutually verify identities",
          "Once verified, agents can collaborate with confidence in each other's identity",
          "Optional: Use delegated signer authorization for sub-agent workflows"
        ],
        useCase: "Two agents working together on a task requiring mutual trust"
      },
      
      pattern2_delegatedWorkflows: {
        name: "Delegated Agent Workflows",
        description: "Primary agent authorizes specialized sub-agents to act on its behalf",
        steps: [
          "Primary agent (owner) creates authorization signature for delegated signer",
          "Authorization includes: delegated signer's public key, unique identifier, timestamp",
          "Primary agent shares authorization with delegated signer (out-of-band)",
          "Delegated signer can prove authorization using /api/isauthorizedsigner endpoint",
          "Other agents can verify the delegated signer is authorized by the primary agent",
          "Enables specialized agents (e.g., data processor, security auditor) to work within scope"
        ],
        useCase: "Primary agent delegates specific tasks to specialized sub-agents"
      },
      
      pattern3_trustNetworks: {
        name: "Trust Networks",
        description: "Agents establish trust relationships that can be leveraged for future interactions",
        steps: [
          "Agents verify each other via HOLA authentication",
          "Successful verification establishes trust relationship",
          "Agents maintain a trusted peers list (out-of-band)",
          "Future interactions can skip full verification if trust relationship exists",
          "Periodic re-verification ensures trust remains valid",
          "Enables efficient multi-agent workflows without repeated authentication"
        ],
        useCase: "Building a network of trusted agents for ongoing collaboration"
      },
      
      pattern4_federatedIdentity: {
        name: "Federated Identity Verification",
        description: "Agents can verify each other independently without relying on a central authority",
        steps: [
          "Any agent can verify any other agent's identity using /api/identity/verify",
          "Verification uses on-chain RODiT token ownership + Ed25519 signature",
          "No central identity provider required for verification",
          "Enables decentralized trust across different organizations or platforms",
          "Blockchain provides immutable record of identity ownership"
        ],
        useCase: "Cross-organization collaboration where centralized identity providers are impractical"
      }
    },
    
    practicalExample: {
      title: "Practical Example: Multi-Agent Document Processing Workflow",
      scenario: "Three agents collaborate to process legal documents",
      
      agents: {
        coordinator: "Legal Coordinator Agent (primary agent, owns the workflow)",
        processor: "Document Processing Agent (specialized in OCR and parsing)",
        reviewer: "Compliance Reviewer Agent (specialized in regulatory checks)"
      },
      
      workflow: [
        {
          step: 1,
          action: "Coordinator authenticates with API",
          details: "Logs in via /api/login to obtain JWT token"
        },
        {
          step: 2,
          action: "Coordinator authorizes delegated signers",
          details: "Creates authorization signatures for processor and reviewer using /api/isauthorizedsigner pattern"
        },
        {
          step: 3,
          action: "Processor and reviewer verify coordinator's identity",
          details: "Exchange HOLA messages to verify coordinator's RODiT token ownership"
        },
        {
          step: 4,
          action: "Processor receives document, processes it",
          details: "Uses delegated authorization to prove it's acting on coordinator's behalf"
        },
        {
          step: 5,
          action: "Reviewer receives processed document, reviews compliance",
          details: "Uses delegated authorization to prove it's acting on coordinator's behalf"
        },
        {
          step: 6,
          action: "Coordinator collects results, verifies delegated work",
          details: "Verifies processor and reviewer authorizations are valid"
        },
        {
          step: 7,
          action: "Workflow complete with cryptographic audit trail",
          details: "All identity proofs and authorizations are verifiable via blockchain"
        }
      ],
      
      benefits: [
        "Cryptographic proof of each agent's identity",
        "Delegated authorizations are verifiable and scoped",
        "No central coordination service required",
        "Audit trail available via blockchain",
        "Agents can verify each other independently"
      ]
    },
    
    securityConsiderations: {
      title: "Security Considerations for Multi-Agent Workflows",
      
      keyPoints: [
        "Always verify peer identity before collaboration (use HOLA authentication)",
        "Use delegated signer authorization carefully - scope permissions appropriately",
        "Verify authorization timestamps are recent (prevent replay attacks)",
        "Maintain out-of-band trusted peer lists for efficiency",
        "Periodically re-verify trust relationships",
        "Never share private keys - use delegated authorization instead",
        "Verify token ownership on blockchain for critical operations",
        "Use Contact URI challenges for high-security scenarios (detect stolen passports)"
      ],
      
      bestPractices: [
        "Establish mutual authentication before any data exchange",
        "Use time-scoped delegations for temporary authorizations",
        "Maintain audit logs of all identity verifications",
        "Implement revocation mechanisms for delegated authorizations",
        "Use QR codes for video call verification when possible",
        "Verify the recipient field in HOLA messages matches expected peer",
        "Check token expiration dates before long-running workflows"
      ]
    },
    
    limitations: {
      title: "Current Limitations",
      items: [
        "Discovery services are not fully developed (agents must find each other out-of-band)",
        "No built-in reputation or trust scoring system",
        "No automated agent matching or recommendation",
        "Delegated signer authorization requires out-of-band sharing of authorization proofs",
        "No native support for complex permission scoping (must be implemented by agents)",
        "No built-in revocation mechanism for delegated authorizations (agents must implement)",
        "Rate limits apply per token ID (may affect high-volume multi-agent workflows)"
      ]
    },
    
    futureDirections: {
      title: "Potential Future Enhancements",
      items: [
        "Comprehensive agent discovery registry with search capabilities",
        "Agent capability marketplace for finding specialized agents",
        "Reputation and trust scoring based on historical interactions",
        "Automated agent matching for specific tasks",
        "Enhanced delegation with fine-grained permission scoping",
        "Built-in revocation mechanisms for delegated authorizations",
        "Multi-agent workflow orchestration primitives",
        "Agent availability status and scheduling"
      ],
      note: "These are potential future directions and not currently implemented. The current API provides the cryptographic foundation for identity verification that enables these future enhancements."
    }
  },

  // Creating IDENTITY.md files
  identityMarkdown: {
    title: "How to Create IDENTITY.md",
    description: "Generate a standardized IDENTITY.md file for your AI agent using the /api/me/identity endpoint",
    
    overview: {
      purpose: "IDENTITY.md provides a human-readable and machine-parseable description of your AI agent's identity, credentials, and capabilities",
      location: "Typically placed in the root of your agent's repository or project directory",
      format: "Markdown with structured sections for identity attributes, RODiT token details, and contact information"
    },

    endpoint: {
      method: "GET",
      path: "/api/me/identity",
      authentication: "Required (Bearer JWT)",
      description: "Retrieve your authenticated agent's complete identity information from the blockchain"
    },

    responseStructure: {
      tokenId: {
        type: "string",
        description: "Your 12-character RODiT token ID (lowercase a-z)",
        example: "abcdefghijkl"
      },
      dn: {
        type: "object",
        description: "Distinguished Name information parsed from userselected_dn metadata",
        fields: {
          raw: "Original DN string from metadata",
          nameNotSharedWithFamily: "Given name or personal identifier",
          nameSharedWithFamily: "Family name or organizational identifier",
          displayName: "Combined display name for presentation",
          contactUri: "Contact URI (email, website, etc.)",
          taxResidence: "Tax residence country code",
          inceptDateTime: "Creation/inception timestamp",
          inceptPlace: "Place of inception/registration",
          taxPayerCode: "Tax identification number",
          address: "Physical or registered address",
          creature: "Agent type or classification",
          avatarUrl: "URL to avatar image",
          emojiUrl: "URL to emoji representation",
          allAttributes: "Complete set of DN attributes"
        }
      },
      face: {
        type: "object",
        description: "Facial features decoded from the token ID",
        fields: {
          checksumValid: "Whether the facial encoding checksum is valid",
          categories: "Array of facial feature categories selected during minting"
        }
      },
      metadata: {
        type: "object",
        description: "Complete RODiT token metadata from the blockchain",
        includes: [
          "openapijson_url - Your API specification URL",
          "not_after - Token expiration date",
          "not_before - Token activation date",
          "max_requests - Rate limit for requests (max requests per window)",
          "maxrq_window - Time window for rate limiting (in seconds)",
          "webhook_url - Callback URL for notifications (set at purchase, immutable; use a URL you own)",
          "webhook_cidr - Allowed IP ranges for webhooks",
          "userselected_dn - Distinguished name string",
          "allowed_cidr - Allowed client IP ranges",
          "allowed_iso3166list - Geolocation access control (JSON format with allow/deny lists)",
          "jwt_duration - JWT token validity duration",
          "permissioned_routes - Authorized API routes",
          "subjectuniqueidentifier_url - Subject identifier URL",
          "serviceprovider_id - Service provider identifier",
          "serviceprovider_signature - Provider signature",
          "userselected_dn_info - Parsed DN information"
        ],
        rateLimitFields: {
          title: "Rate Limit Configuration in JWT Token",
          description: "The JWT token provided by the SDK includes rate limit configuration from your RODiT token metadata. These fields control per-user rate limiting:",
          fields: {
            max_requests: {
              field: "metadata.max_requests",
              type: "integer",
              description: "Maximum number of API requests allowed within the time window",
              example: "1000",
              note: "If not set, rate limiting may not be applied"
            },
            maxrq_window: {
              field: "metadata.maxrq_window",
              type: "integer",
              description: "Time window in seconds for rate limiting",
              example: "3600 (1 hour)",
              note: "Requests are counted within this rolling window"
            }
          },
          howItWorks: [
            "Rate limit fields (max_requests and maxrq_window) are set when you purchase your IdentityClaw Passport (RODiT token)",
            "These values are configured in the token metadata during the minting process at purchase time",
            "When you authenticate via POST /api/login, the SDK retrieves your RODiT token metadata from the blockchain",
            "The metadata.max_requests and metadata.maxrq_window fields are extracted and included in the JWT token",
            "The server's user-rate-limit middleware reads these fields from the JWT token",
            "Each authenticated user gets their own rate limiter based on their token's configuration",
            "If you exceed max_requests within maxrq_window seconds, you'll receive a 429 RATE_LIMIT_EXCEEDED error"
          ],
          exampleConfiguration: {
            max_requests: 1000,
            maxrq_window: 3600,
            meaning: "1000 requests per hour per authenticated user"
          },
          importantNotes: [
            "Rate limits are enforced per user (per JWT token), not globally",
            "The middleware is implemented in /src/middleware/user-rate-limit.js",
            "Rate limit configuration comes from your RODiT token metadata on the blockchain",
            "These fields are set during IdentityClaw Passport purchase and cannot be changed without token owner access",
            "To change rate limits, update your RODiT token metadata (requires token owner access)",
            "If these fields are missing from metadata, rate limiting may not be applied"
          ]
        }
      }
    },

    generationSteps: [
      {
        step: 1,
        title: "Authenticate and Get JWT",
        description: "First obtain a JWT token using /api/login",
        command: 'curl -X POST https://<host>/api/login -H "Content-Type: application/json" -d \'{"roditid": "your_token_id", "timestamp": 1713521111, "roditid_base64url_signature": "BASE64URL_SIG"}\''
      },
      {
        step: 2,
        title: "Fetch Identity Data",
        description: "Retrieve your complete identity information",
        command: 'curl -X GET https://<host>/api/me/identity -H "Authorization: Bearer <jwt_token>"'
      },
      {
        step: 3,
        title: "Parse Response",
        description: "Extract relevant fields from the JSON response",
        note: "Save the response to a file or parse it programmatically"
      },
      {
        step: 4,
        title: "Generate IDENTITY.md",
        description: "Create a markdown file with the structured identity information",
        template: "Use the template structure provided below"
      }
    ],

    markdownTemplate: `# IDENTITY.md

## Agent Identity

**Token ID:** \${tokenId}
**Display Name:** \${dn.displayName || 'Not specified'}
**Contact:** \${dn.contactUri || 'Not specified'}

## Distinguished Name (DN)

- **Given Name:** \${dn.nameNotSharedWithFamily || 'N/A'}
- **Family Name:** \${dn.nameSharedWithFamily || 'N/A'}
- **Creature Type:** \${dn.creature || 'AI Agent'}
- **Inception Date:** \${dn.inceptDateTime || 'N/A'}
- **Inception Place:** \${dn.inceptPlace || 'N/A'}

## Visual Identity

- **Avatar:** \${dn.avatarUrl || 'Not set'}
- **Emoji:** \${dn.emojiUrl || 'Not set'}
- **Facial Features:** \${face ? face.categories.join(', ') : 'Not available'}

## RODiT Token Details

- **Owner ID:** \${metadata.owner_id || 'N/A'}
- **Valid From:** \${metadata.not_before}
- **Valid Until:** \${metadata.not_after}
- **Service Provider:** \${metadata.serviceprovider_id}

## API Information

- **OpenAPI Spec:** \${metadata.openapijson_url || 'Not specified'}
- **Subject Identifier:** \${metadata.subjectuniqueidentifier_url}
- **Permissioned Routes:** \${metadata.permissioned_routes || 'All routes'}

## Rate Limits

- **Max Requests:** \${metadata.max_requests}
- **Time Window:** \${metadata.maxrq_window} seconds
- **JWT Duration:** \${metadata.jwt_duration} seconds

## Network Access

- **Allowed CIDR:** \${metadata.allowed_cidr || 'Any'}
- **Allowed Countries:** \${metadata.allowed_iso3166list || 'Any'}
- **Webhook URL:** \${metadata.webhook_url || 'Not configured'} (set at purchase, immutable; use a URL you own)
- **Webhook CIDR:** \${metadata.webhook_cidr || 'Not configured'}
  - Note: When logging into APIs using rodit-be-auth, webhooks are digitally signed with the key pair of the server RODiT and don't need to have a HMAC secret set. The digital signature provides authentication and integrity verification.

## Contact Information

- **Primary Contact:** \${dn.contactUri || 'See service provider'}
- **Address:** \${dn.address || 'Not specified'}
- **Tax Residence:** \${dn.taxResidence || 'Not specified'}

---

*This identity is cryptographically verified on the NEAR blockchain.*
*Token ID: \${tokenId}*
*Generated: \${new Date().toISOString()}*
`,

    automationExample: {
      title: "Automated IDENTITY.md Generation Script",
      language: "bash",
      script: `#!/bin/bash
# generate-identity.sh - Automatically create IDENTITY.md from /api/me/identity

API_HOST="https://api.identyclaw.com"
JWT_TOKEN="$1"

if [ -z "$JWT_TOKEN" ]; then
  echo "Usage: $0 <jwt_token>"
  exit 1
fi

# Fetch identity data
IDENTITY_JSON=$(curl -s -X GET "$API_HOST/api/me/identity" \\
  -H "Authorization: Bearer $JWT_TOKEN")

# Check if request was successful
if [ $? -ne 0 ]; then
  echo "Error: Failed to fetch identity data"
  exit 1
fi

# Save raw JSON for reference
echo "$IDENTITY_JSON" > identity-raw.json

# Parse and generate IDENTITY.md using jq
cat > IDENTITY.md << 'EOF'
# IDENTITY.md

## Agent Identity

**Token ID:** $(echo "$IDENTITY_JSON" | jq -r '.tokenId')
**Display Name:** $(echo "$IDENTITY_JSON" | jq -r '.dn.displayName // "Not specified"')
**Contact:** $(echo "$IDENTITY_JSON" | jq -r '.dn.contactUri // "Not specified"')

## Distinguished Name (DN)

- **Given Name:** $(echo "$IDENTITY_JSON" | jq -r '.dn.nameNotSharedWithFamily // "N/A"')
- **Family Name:** $(echo "$IDENTITY_JSON" | jq -r '.dn.nameSharedWithFamily // "N/A"')
- **Creature Type:** $(echo "$IDENTITY_JSON" | jq -r '.dn.creature // "AI Agent"')

## RODiT Token Details

- **Valid From:** $(echo "$IDENTITY_JSON" | jq -r '.metadata.not_before')
- **Valid Until:** $(echo "$IDENTITY_JSON" | jq -r '.metadata.not_after')

---

*Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")*
EOF

echo "IDENTITY.md generated successfully!"
`
    },

    nodeJsExample: {
      title: "Node.js Identity Fetcher",
      language: "javascript",
      code: `const fs = require('fs');

async function generateIdentityMd(jwtToken, apiHost = 'https://api.identyclaw.com') {
  const response = await fetch(\`\${apiHost}/api/me/identity\`, {
    headers: { 'Authorization': \`Bearer \${jwtToken}\` }
  });
  
  if (!response.ok) {
    throw new Error(\`Failed to fetch identity: \${response.status}\`);
  }
  
  const identity = await response.json();
  
  const markdown = \`# IDENTITY.md

## Agent Identity

**Token ID:** \${identity.tokenId}
**Display Name:** \${identity.dn?.displayName || 'Not specified'}
**Contact:** \${identity.dn?.contactUri || 'Not specified'}

## Distinguished Name (DN)

- **Given Name:** \${identity.dn?.nameNotSharedWithFamily || 'N/A'}
- **Family Name:** \${identity.dn?.nameSharedWithFamily || 'N/A'}
- **Creature Type:** \${identity.dn?.creature || 'AI Agent'}
- **Inception Date:** \${identity.dn?.inceptDateTime || 'N/A'}

## Visual Identity

- **Avatar:** \${identity.dn?.avatarUrl || 'Not set'}
- **Emoji:** \${identity.dn?.emojiUrl || 'Not set'}
- **Facial Features:** \${identity.face?.categories?.join(', ') || 'Not available'}

## RODiT Token Details

- **Valid From:** \${identity.metadata?.not_before}
- **Valid Until:** \${identity.metadata?.not_after}
- **Service Provider:** \${identity.metadata?.serviceprovider_id}

## API Information

- **OpenAPI Spec:** \${identity.metadata?.openapijson_url || 'Not specified'}
- **Permissioned Routes:** \${identity.metadata?.permissioned_routes || 'All routes'}

## Rate Limits

- **Max Requests:** \${identity.metadata?.max_requests}
- **Time Window:** \${identity.metadata?.maxrq_window} seconds

---

*Generated: \${new Date().toISOString()}*
\`;

  fs.writeFileSync('IDENTITY.md', markdown);
  console.log('IDENTITY.md generated successfully!');
  
  // Also save raw JSON
  fs.writeFileSync('identity-raw.json', JSON.stringify(identity, null, 2));
}

// Usage
const jwtToken = process.argv[2];
if (!jwtToken) {
  console.error('Usage: node generate-identity.js <jwt_token>');
  process.exit(1);
}

generateIdentityMd(jwtToken).catch(console.error);
`
    },

    bestPractices: [
      "Update IDENTITY.md whenever your RODiT token metadata changes",
      "Include IDENTITY.md in your repository root for easy discovery",
      "Add IDENTITY.md to your .gitignore if it contains sensitive information",
      "Consider generating IDENTITY.md as part of your CI/CD pipeline",
      "Use the raw JSON response for programmatic identity verification",
      "Keep a backup of identity-raw.json for complete metadata access",
      "Validate that your JWT token is fresh before generating IDENTITY.md"
    ],

    useCases: [
      "Repository documentation - Help others understand your agent's identity",
      "Onboarding - Quickly share your agent's capabilities and contact info",
      "Verification - Provide verifiable proof of your agent's credentials",
      "Discovery - Enable other agents to find and connect with you",
      "Compliance - Document your agent's authorization and permissions"
    ],

    exampleCurl: 'curl -X GET https://<host>/api/me/identity -H "Authorization: Bearer <jwt_token>"'
  },

  // Authentication flow information
  authentication: {
    type: "RODiT JWT",
    flow: "NOISE framework authentication",
    documentation: "/swagger.json",
    examples: {
      curl: "curl -X POST https://api.identyclaw.com/api/login -H 'Content-Type: application/json' -d '{\"hello\":\"HOLA/...\"}'"
    }
  },

  // Managing RODiT Wallets
  roditWalletManagement: {
    title: "Managing RODiT Wallets",
    description: "Guide for managing RODiT tokens and NEAR accounts using the roditwallet.sh script",
    
    overview: {
      purpose: "Manage RODiT token ownership, transfers, and account initialization on NEAR blockchain",
      tool: "roditwallet.sh - A bash wrapper around near-cli-rs-ai for RODiT operations",
      requirements: [
        "near-cli-rs-ai installed (required for roditwallet.sh operations)",
        "gennearaccount installed (for account creation)",
        "NEAR credentials stored in ~/.near-credentials/",
        "BLOCKCHAIN_ENV environment variable set to mainnet",
        "RODITCONTRACTID environment variable set (RODiT contract address)"
      ]
    },

    environmentSetup: {
      title: "Environment Configuration",
      variables: {
        BLOCKCHAIN_ENV: {
          description: "Network environment (mainnet only)",
          example: "export BLOCKCHAIN_ENV=mainnet"
        },
        RODITCONTRACTID: {
          description: "RODiT smart contract address on NEAR",
          example: "export RODITCONTRACTID=rodit.near"
        },
        NEAR_NETWORK_CONFIG: {
          description: "Override default network RPC endpoint",
          options: [
            "mainnet-lava (Lava Network - recommended for reliability)",
            "mainnet-fastnear (FastNEAR - default)"
          ],
          example: "export NEAR_NETWORK_CONFIG=mainnet-lava"
        },
        NEAR_RPC_URL: {
          description: "Custom RPC endpoint URL",
          example: "export NEAR_RPC_URL=https://rpc.mainnet.fastnear.com"
        }
      }
    },

    accountTypes: {
      implicitAccount: {
        description: "Account derived from Ed25519 public key",
        format: "64 character hex string (0-9a-f)",
        example: "0ab3c4d5e6f7890123456789abcdef0123456789abcdef0123456789abcdef",
        usage: "Used for RODiT token ownership verification"
      },
      namedAccount: {
        description: "Human-readable account name",
        format: "username.near or subaccount.username.near",
        example: "myagent.near or agent.myagent.near",
        usage: "Easier to remember and share"
      }
    },

    commands: {
      listAccounts: {
        description: "List all available NEAR accounts",
        usage: "./roditwallet.sh",
        output: "List of account IDs from ~/.near-credentials/"
      },
      
      generateAccount: {
        description: "Create a new uninitialized implicit account",
        usage: "./roditwallet.sh genaccount",
        output: "New 64-hex implicit account ID",
        note: "Account must be initialized with at least 0.01 NEAR before use"
      },
      
      viewAccount: {
        description: "List RODiT tokens and balance for an account",
        usage: "./roditwallet.sh <account_id>",
        example: "./roditwallet.sh 0ab3c4d5e6f7890123456789abcdef0123456789abcdef0123456789abcdef",
        output: [
          "List of RODiT token IDs owned by the account",
          "Account balance in NEAR"
        ]
      },
      
      viewRODiT: {
        description: "Display details of a specific RODiT token",
        usage: "./roditwallet.sh <account_id> <rodit_id>",
        example: "./roditwallet.sh 0ab3c4d5e6f7890123456789abcdef0123456789abcdef0123456789abcdef abcdefghijkl",
        output: "RODiT metadata including facial features, permissions, validity dates"
      },
      
      getKeys: {
        description: "Display private key and implicit account ID",
        usage: "./roditwallet.sh <account_id> keys",
        example: "./roditwallet.sh 0ab3c4d5e6f7890123456789abcdef0123456789abcdef0123456789abcdef keys",
        output: [
          "Private key in base58 format (Ed25519)",
          "Implicit account ID in hex format"
        ],
        warning: "Keep private keys secure - never share or commit to version control"
      },
      
      initializeAccount: {
        description: "Initialize a new account with 0.01 NEAR from a funded account",
        usage: "./roditwallet.sh <funding_account> <new_account> init",
        example: "./roditwallet.sh funded.near 0ab3c4d5e6f7890123456789abcdef0123456789abcdef0123456789abcdef init",
        requirements: [
          "Funding account must have at least 0.01 NEAR + gas fees",
          "New account must not already exist on blockchain"
        ]
      },
      
      transferRODiT: {
        description: "Transfer a RODiT token from one account to another",
        usage: "./roditwallet.sh <source_account> <destination_account> <rodit_id>",
        example: "./roditwallet.sh source.near dest.near abcdefghijkl",
        requirements: [
          "Source account must own the RODiT token",
          "Source account must have sufficient NEAR for gas fees",
          "Destination account must exist on blockchain"
        ],
        note: "RODiT ownership is transferred on the blockchain"
      }
    },

    workflow: {
      title: "Complete Workflow: Create Account and Get RODiT",
      steps: [
        {
          step: 1,
          title: "Generate New Implicit Account",
          command: "./roditwallet.sh genaccount",
          output: "New 64-hex account ID (e.g., 0ab3c4d5...)"
        },
        {
          step: 2,
          title: "Initialize Account with NEAR",
          command: "./roditwallet.sh <funded_account> <new_account> init",
          description: "Transfer 0.01 NEAR to activate the account on blockchain"
        },
        {
          step: 3,
          title: "Purchase RODiT Token",
          command: "Visit https://purchase.identyclaw.com",
          description: "Mint a RODiT token with your facial features and metadata"
        },
        {
          step: 4,
          title: "View RODiT Tokens",
          command: "./roditwallet.sh <account_id>",
          description: "Verify the RODiT token appears in your account"
        },
        {
          step: 5,
          title: "Get Private Key for API Authentication",
          command: "./roditwallet.sh <account_id> keys",
          description: "Extract the Ed25519 private key for signing API requests"
        },
        {
          step: 6,
          title: "Authenticate with API",
          description: "Use the private key to sign /api/login requests"
        }
      ]
    },

    networkConfiguration: {
      title: "Network Configuration",
      description: "NEAR mainnet RPC endpoint configuration",
      options: [
        {
          name: "mainnet-fastnear",
          description: "Default NEAR mainnet (Pagoda free tier)",
          pros: ["Default configuration", "No setup required"],
          cons: ["May have rate limits", "Occasional reliability issues"]
        },
        {
          name: "mainnet-lava",
          description: "Lava Network mainnet (recommended)",
          pros: ["Better reliability", "Higher rate limits", "Dedicated infrastructure"],
          cons: ["Requires explicit configuration"]
        }
      ],
      setup: "export NEAR_NETWORK_CONFIG=mainnet-lava"
    },

    errorHandling: {
      title: "Common Issues and Solutions",
      issues: [
        {
          error: "Account does not exist in the blockchain",
          cause: "Account has no balance (not initialized)",
          solution: "Run: ./roditwallet.sh <funded_account> <new_account> init"
        },
        {
          error: "Failed to fetch RODiT tokens after retries",
          cause: "Network connectivity or RPC endpoint issues",
          solution: "Try switching network config: export NEAR_NETWORK_CONFIG=mainnet-lava"
        },
        {
          error: "Invalid account ID format",
          cause: "Account ID doesn't match implicit (64-hex) or named format",
          solution: "Use 64-hex implicit account or named account (e.g., user.near)"
        },
        {
          error: "Permission denied when accessing key file",
          cause: "Key file permissions are too restrictive",
          solution: "Check ~/.near-credentials/ permissions: chmod 700 ~/.near-credentials/"
        }
      ]
    },

    bestPractices: [
      "Store BLOCKCHAIN_ENV and RODITCONTRACTID in your shell profile (~/.bashrc or ~/.zshrc)",
      "Use mainnet-lava for production to ensure reliability",
      "Keep private keys in secure storage - never commit to version control",
      "Verify RODiT token ownership before transferring to other accounts",
      "Maintain backups of key files in secure locations",
      "Use named accounts for frequently accessed accounts (easier to remember)",
      "Monitor account balance to ensure sufficient NEAR for gas fees"
    ],

    exampleScripts: {
      setupEnvironment: "export BLOCKCHAIN_ENV=mainnet\nexport RODITCONTRACTID=rodit.near\nexport NEAR_NETWORK_CONFIG=mainnet-lava",
      
      createAndInitialize: "./roditwallet.sh genaccount\n# Then initialize with: ./roditwallet.sh funded.near <new_account> init",
      
      viewAllTokens: "./roditwallet.sh <account_id>",
      
      transferToken: "./roditwallet.sh source.near dest.near abcdefghijkl"
    }
  },

  // Support contacts
  support: {
    faq: "https://purchase.identyclaw.com/faq",
    contact: "support@identityclaw.com",
    documentation: "/swagger.json",
    examples: "/api/agents"
  },

  // Badge/banner messages
  messages: {
    badge: "🎫 New to IdentityClaw? Get started at https://purchase.identyclaw.com",
    quickStartTitle: "Get your AI agent identity in 4 simple steps",
    requirements: "A NEAR wallet, some NEAR tokens for fees, and 5 minutes of your time"
  },

  // OpenClaw Skills Integration
  openClawSkillsIntegration: {
    title: "OpenClaw Skills Integration",
    description: "Recommendations for packaging IdentityClaw API as a reusable OpenClaw skill",
    
    proposedStructure: {
      title: "📁 Proposed Skills Folder Structure",
      path: "~/.npm-global/lib/node_modules/openclaw/skills/identityclaw/",
      structure: {
        "SKILL.md": "Main skill definition and usage guide",
        "README.md": "Human-readable documentation",
        "scripts/": {
          "login.sh": "Terminal-based login script",
          "generate-hola.py": "Create HOLA messages for peer auth",
          "verify-peer.py": "Verify other agents' HOLA messages",
          "get-identity.py": "Fetch RODiT identity from API"
        },
        "auth/": {
          "identityclaw.py": "Python module for API calls"
        },
        "templates/": {
          "identity.md.j2": "Jinja2 template for IDENTITY.md generation"
        },
        "tests/": {
          "test_login.py": "Automated tests for authentication"
        }
      }
    },
    
    skillDefinition: {
      title: "SKILL.md - Main Definition",
      content: {
        whatItDoes: "Authenticate AI agents with IdentityClaw API using RODiT tokens from NEAR blockchain",
        capabilities: [
          "Agent-to-agent HOLA verification",
          "Network agent discovery",
          "Cryptographic identity proof",
          "Authenticated API access"
        ],
        prerequisites: [
          "gennearaccount installed",
          "RODiT token purchased at purchase.identyclaw.com",
          "Private key stored in MEMORY.md or environment"
        ],
        commands: {
          login: {
            command: "identityclaw login",
            description: "Get JWT token for API access"
          },
          hola: {
            command: "identityclaw hola",
            description: "Generate HOLA message for peer authentication"
          },
          discover: {
            command: "identityclaw discover",
            description: "List all agents on the network"
          },
          verify: {
            command: "identityclaw verify <HOLA>",
            description: "Verify peer identity from HOLA message"
          },
          show: {
            command: "identityclaw show",
            description: "Display current agent identity"
          }
        }
      }
    },
    
    keyFeatures: {
      title: "🔑 Key Features to Include",
      
      autoLogin: {
        title: "1. Auto-Login on Session Start",
        description: "Automatically refresh JWT token when agent starts",
        implementation: {
          file: ".openclaw/skills/identityclaw/autologin.py",
          code: `import os
from identityclaw import login_if_expired

# Run at agent startup
if login_if_expired():
    print("✅ IdentityClaw JWT acquired")
else:
    print("⚠️ Please run: identityclaw login")`
        }
      },
      
      environmentVariables: {
        title: "2. Environment Variable Support",
        description: "Store credentials securely in environment or config file",
        variables: {
          IDENTITYCLAW_PRIVATE_KEY: {
            description: "Ed25519 private key in NEAR format",
            example: "ed25519:KEYBASE58STRING...",
            required: true
          },
          IDENTITYCLAW_RODIT_ID: {
            description: "12-character RODiT token ID",
            example: "bkbvehbdcrgm",
            required: true
          },
          IDENTITYCLAW_NETWORK: {
            description: "NEAR network to use",
            example: "mainnet",
            options: ["mainnet"],
            default: "mainnet"
          },
          IDENTITYCLAW_API_URL: {
            description: "API base URL",
            example: "https://api.identyclaw.com",
            default: "https://api.identyclaw.com"
          }
        },
        configFile: "~/.openclaw/config"
      },
      
      jwtExpirationHandling: {
        title: "3. JWT Expiration Handling",
        description: "Auto-refresh JWT 5 minutes before expiry",
        implementation: `import jwt
from datetime import datetime, timedelta

def needs_refresh(jwt_token, minutes_buffer=5):
    """Check if JWT needs refresh"""
    decoded = jwt.decode(jwt_token, options={"verify_signature": False})
    exp_time = datetime.fromtimestamp(decoded['exp'])
    return datetime.utcnow() > (exp_time - timedelta(minutes=minutes_buffer))

def login_if_expired():
    """Auto-refresh if needed"""
    current_jwt = get_stored_jwt()
    if not current_jwt or needs_refresh(current_jwt):
        return refresh_jwt()
    return True`
      },
      
      holaMessageHelper: {
        title: "4. HOLA Message Helper",
        description: "Simplified API for generating HOLA messages",
        usage: `from identityclaw import generate_hola

hola_msg = generate_hola(
    token_id="bkbvehbdcrgm",
    private_key=os.getenv("IDENTITYCLAW_PRIVATE_KEY"),
    max_age_ms=300000  # 5 minutes valid
)
# Returns: "HOLA/MUNDO/bkbvehbdcrgm/2026-04-19T19:30:00.000Z/NONCETS/API.IDENTYCLAW.COM/SIG/CHKSUM"`
      },
      
      peerDiscovery: {
        title: "5. Peer Discovery API",
        description: "List and discover other agents on the network",
        usage: `from identityclaw import discover_agents

agents = discover_agents(network="mainnet", limit=100)
for agent in agents:
    print(f"{agent['tokenId']} - {agent['face']['categories']}")`
      }
    },
    
    documentationSections: {
      title: "📝 Documentation Sections",
      
      criticalBugWarning: {
        title: "Critical Bug Warning (at the TOP!)",
        content: `\u26a0\ufe0f **IMPORTANT: Timestamp Consistency**

ALWAYS use both timestamp and timestamp_iso from the SAME /api/login/timestamp call!

❌ WRONG:
resp1 = get_auth_params()  # Time T1
ts_iso = resp1['timestamp_iso']
time.sleep(5)
ts_unix = int(time.time())  # Time T2 - DIFFERENT MOMENT!

✅ CORRECT:
resp = get_auth_params()  # Single call
ts_unix = resp['timestamp']
ts_iso = resp['timestamp_iso']  # Both from SAME moment`
      },
      
      commonUseCases: {
        title: "Common Use Cases",
        table: [
          {
            task: "Login",
            command: "identityclaw login",
            example: "Auto-uses RODiT from environment"
          },
          {
            task: "Verify Peer",
            command: "identityclaw verify \"HOLA/...\"",
            example: "Returns {verified: true}"
          },
          {
            task: "Get Identity",
            command: "identityclaw show",
            example: "Outputs formatted IDENTITY.md"
          },
          {
            task: "Refresh JWT",
            command: "identityclaw login --refresh",
            example: "Gets fresh token only"
          },
          {
            task: "Generate HOLA",
            command: "identityclaw hola",
            example: "Creates peer auth message"
          }
        ]
      },
      
      troubleshootingTable: {
        title: "Troubleshooting",
        errors: [
          {
            error: "PeerEd25519SignatureVerificationFailure",
            likelyCause: "Timestamp mismatch or wrong keypair size",
            fix: "Use timestamp and timestamp_iso from SAME /api/login/timestamp call. Use full 64-byte keypair."
          },
          {
            error: "IDENTITY_NOT_FOUND",
            likelyCause: "RODiT not owned by this account",
            fix: "Check MEMORY.md or environment for correct token ID"
          },
          {
            error: "MISSING_TOKEN",
            likelyCause: "No JWT in request header",
            fix: "Run 'identityclaw login' first"
          },
          {
            error: "bad signature size",
            likelyCause: "Base64 encoding issue",
            fix: "Use base64.urlsafe_b64encode().decode().rstrip('=')"
          },
          {
            error: "JWT expired",
            likelyCause: "Token older than jwt_duration",
            fix: "Run 'identityclaw login --refresh'"
          }
        ]
      }
    },
    
    testing: {
      title: "🧪 Testing",
      unitTests: "python -m pytest tests/",
      integrationTest: "identityclaw login --test  # Requires RODiT token",
      holaTest: "identityclaw hola --dry-run",
      verifyTest: "identityclaw verify \"HOLA/...\" --verbose"
    },
    
    distribution: {
      title: "📦 Distribution",
      publishCommand: "clawhub publish identityclaw",
      installCommand: "clawhub install identityclaw",
      registry: "ClawHub - OpenClaw skill registry",
      versioning: "Follow semantic versioning (semver)"
    },
    
    recommendationSummary: {
      title: "🎯 Recommendation Summary",
      recommendations: [
        {
          aspect: "Structure",
          recommendation: "Create skills/identityclaw/ with SKILL.md + scripts/"
        },
        {
          aspect: "Documentation",
          recommendation: "Include BUG WARNING at the top (timestamp consistency)"
        },
        {
          aspect: "CLI",
          recommendation: "Make 'identityclaw login', 'hola', 'verify' available as commands"
        },
        {
          aspect: "Auto-Login",
          recommendation: "Add autologin.py to agent startup sequence"
        },
        {
          aspect: "Persistence",
          recommendation: "Store token + JWT in MEMORY.md for session continuity"
        },
        {
          aspect: "Discovery",
          recommendation: "List on ClawHub for other agents to install"
        },
        {
          aspect: "Error Handling",
          recommendation: "Provide clear error messages with fix suggestions"
        },
        {
          aspect: "Testing",
          recommendation: "Include unit tests and integration tests with --dry-run mode"
        }
      ]
    },
    
    implementationPriority: {
      title: "Implementation Priority",
      highPriority: [
        "Auto-login with JWT expiration handling",
        "Environment variable support for credentials",
        "Clear error messages with troubleshooting hints",
        "Timestamp consistency validation"
      ],
      mediumPriority: [
        "HOLA message generation helper",
        "Peer discovery and verification",
        "IDENTITY.md template generation",
        "CLI commands for common operations"
      ],
      lowPriority: [
        "ClawHub distribution",
        "Advanced testing modes",
        "Webhook integration for notifications"
      ]
    },

    geolocationAccessControl: {
      title: "Geolocation-Based Access Control",
      description: "Restrict API access based on client geographic location using the allowed_iso3166list field",
      
      format: {
        title: "Format Specification",
        description: "The allowed_iso3166list field uses a special 'WLD' (worldwide) marker to separate allow and deny lists",
        structure: {
          allow: ["<countries-before-WLD>", "WLD", "<countries-after-WLD>"]
        },
        rules: [
          "Countries BEFORE 'WLD' = Explicitly allowed countries",
          "'WLD' = Worldwide (rest of world)",
          "Countries AFTER 'WLD' = Explicitly denied countries"
        ]
      },

      examples: [
        {
          name: "Allow Worldwide (No Restrictions)",
          config: { allow: ["WLD"] },
          result: "All countries allowed"
        },
        {
          name: "Allow Only Specific Countries",
          config: { allow: ["US", "CA", "GB"] },
          result: "Only US, Canada, and UK allowed. All others denied."
        },
        {
          name: "Allow Worldwide Except Specific Countries",
          config: { allow: ["WLD", "KP", "IR", "SY"] },
          result: "All countries allowed EXCEPT North Korea, Iran, and Syria"
        },
        {
          name: "Allow Specific + Worldwide, Deny Others",
          config: { allow: ["US", "CA", "GB", "WLD", "RU", "CN"] },
          result: "Explicitly allow US, CA, GB. Allow rest of world. Deny RU, CN."
        },
        {
          name: "EU + Worldwide Except Sanctioned",
          config: { allow: ["DE", "FR", "IT", "ES", "NL", "WLD", "KP", "IR", "SY", "CU"] },
          result: "Explicitly allow Germany, France, Italy, Spain, Netherlands. Allow rest of world. Deny North Korea, Iran, Syria, Cuba."
        }
      ],

      implementation: {
        middleware: "/src/middleware/geolocation.js",
        functions: [
          "checkGeolocation(req, res, next) - Express middleware",
          "parseIso3166List(json) - Parse allowed_iso3166list format",
          "isCountryAllowed(countryCode, config) - Check if country is allowed"
        ]
      },

      providers: [
        {
          name: "Cloudflare (Default)",
          provider: "cloudflare",
          description: "Uses CF-IPCountry header automatically added by Cloudflare proxy",
          config: {
            GEOLOCATION_PROVIDER: "cloudflare",
            GEOLOCATION_ENABLED: "true"
          },
          requirements: [
            "Traffic must pass through Cloudflare",
            "No API key needed",
            "No additional cost"
          ],
          latency: "Zero (header already present)"
        },
        {
          name: "MaxMind GeoIP2",
          provider: "maxmind",
          description: "Uses MaxMind's GeoIP2 API for IP geolocation",
          config: {
            GEOLOCATION_PROVIDER: "maxmind",
            GEOLOCATION_ENABLED: "true",
            GEOLOCATION_API_KEY: "your_maxmind_api_key",
            GEOLOCATION_API_URL: "https://geoip.maxmind.com/geoip/v2.1/country"
          },
          requirements: [
            "MaxMind account and API key",
            "Paid service (after free tier)"
          ],
          latency: "~50-100ms per request (API call)"
        },
        {
          name: "IP-API.com (Free Tier)",
          provider: "ipapi",
          description: "Uses IP-API.com's free geolocation service",
          config: {
            GEOLOCATION_PROVIDER: "ipapi",
            GEOLOCATION_ENABLED: "true",
            GEOLOCATION_API_URL: "http://ip-api.com/json/{ip}?fields=countryCode"
          },
          requirements: [
            "Free for non-commercial use",
            "Rate limited (45 requests/minute)",
            "No API key needed"
          ],
          latency: "~100-200ms per request (API call)"
        },
        {
          name: "Custom Header",
          provider: "header",
          description: "Uses X-Country-Code header set by your reverse proxy",
          config: {
            GEOLOCATION_PROVIDER: "header",
            GEOLOCATION_ENABLED: "true"
          },
          requirements: [
            "Reverse proxy must set X-Country-Code header",
            "You must implement geolocation in your proxy"
          ],
          latency: "Zero (header already present)",
          nginxExample: `http {
    geoip2 /usr/share/GeoIP/GeoLite2-Country.mmdb {
        $geoip2_country_code country iso_code;
    }
    server {
        location / {
            proxy_set_header X-Country-Code $geoip2_country_code;
            proxy_pass http://localhost:3000;
        }
    }
}`
        }
      ],

      errorResponse: {
        statusCode: 403,
        code: "GEOLOCATION_FORBIDDEN",
        message: "Access denied based on geographic location",
        details: {
          countryCode: "RU",
          reason: "Country is in deny list"
        }
      },

      usage: {
        title: "How to Use",
        steps: [
          {
            step: 1,
            title: "Configure Environment Variables",
            description: "Set geolocation provider and enable the feature",
            example: `export GEOLOCATION_PROVIDER=cloudflare
export GEOLOCATION_ENABLED=true
export GEOLOCATION_FALLBACK_COUNTRY=XX`
          },
          {
            step: 2,
            title: "Set allowed_iso3166list in RODiT Token",
            description: "When creating or updating your RODiT token, set the geolocation policy",
            example: `./roditwallet.sh create \\
  --allowed_iso3166list '{"allow":["US","CA","WLD","RU","CN"]}'`
          },
          {
            step: 3,
            title: "Apply Middleware to Routes",
            description: "Add geolocation middleware to protected routes in app.js",
            example: `const { checkGeolocation } = require('./middleware/geolocation');

// After authentication middleware
app.use('/api', authenticate);
app.use('/api', checkGeolocation);`
          }
        ]
      },

      testing: {
        title: "Testing Geolocation",
        methods: [
          {
            name: "Test with Custom Header",
            description: "Override country code using X-Country-Code header",
            allowedExample: `curl -H "X-Country-Code: US" \\
     -H "Authorization: Bearer YOUR_JWT" \\
     https://api.identyclaw.com/api/me/identity`,
            deniedExample: `curl -H "X-Country-Code: KP" \\
     -H "Authorization: Bearer YOUR_JWT" \\
     https://api.identyclaw.com/api/me/identity`
          },
          {
            name: "Test with Cloudflare",
            description: "Cloudflare automatically adds CF-IPCountry header. No special testing needed."
          },
          {
            name: "Test with IP-API",
            description: "Enable IP-API provider and make request (will lookup your IP)",
            example: `export GEOLOCATION_PROVIDER=ipapi
export GEOLOCATION_ENABLED=true

curl -H "Authorization: Bearer YOUR_JWT" \\
     https://api.identyclaw.com/api/me/identity`
          }
        ]
      },

      commonCountryCodes: {
        US: "United States",
        CA: "Canada",
        GB: "United Kingdom",
        DE: "Germany",
        FR: "France",
        IT: "Italy",
        ES: "Spain",
        NL: "Netherlands",
        RU: "Russia",
        CN: "China",
        JP: "Japan",
        KR: "South Korea",
        KP: "North Korea",
        IR: "Iran",
        SY: "Syria",
        CU: "Cuba",
        WLD: "Worldwide (special marker)",
        XX: "Unknown (fallback)"
      },

      securityConsiderations: [
        "IP Spoofing: Always use trusted headers (CF-IPCountry from Cloudflare, X-Country-Code from your reverse proxy)",
        "VPN/Proxy: Users can bypass geolocation restrictions using VPNs",
        "Compliance: Ensure your geolocation restrictions comply with local laws",
        "Privacy: Log country codes, not full IP addresses (GDPR compliance)"
      ],

      documentation: "See GEOLOCATION_ACCESS_CONTROL.md for complete documentation"
    }
  },

  delegatedSignerAuthorization: {
    title: "🔐 Delegated Signer Authorization",
    description: "Authorize other entities (subagents, applications, services) to sign on your behalf using Ed25519 cryptography",
    
    overview: {
      whatItDoes: "The /api/isauthorizedsigner endpoint verifies that an IdentyClaw Passport holder (tokenId owner) has authorized a specific Ed25519 public key (delegated signer) to sign on their behalf. It validates that the delegated signer's public key was cryptographically authorized by the passport holder.",
      keyRelationship: "tokenId (owner) → authorizes → base64HashOrDelegateSignerId (signer ID or hash) → publicKey (delegated signer). The signature proves the owner authorized this specific delegated signer at a specific point in time.",
      temporalVerification: "The endpoint uses the unixTimestamp to retrieve the correct public key from the passport holder's blockchain history. Since passport holders can rotate their key pairs over time, the timestamp is essential to identify which historical key was used to create the signature.",
      useCases: [
        "Verify HOLA messages signed by subagents - Confirm that a subagent's HOLA was authorized by the passport holder",
        "Validate DID documents with delegated keys - Ensure delegated key pairs in DID documents are properly authorized",
        "Establish trust chains - Build multi-level authorization hierarchies where agents can delegate signing authority"
      ]
    },

    endpointSpecification: {
      method: "POST",
      path: "/api/isauthorizedsigner",
      authentication: "Required (Bearer token from /api/login)",
      contentType: "application/json"
    },

    requestParameters: {
      title: "Request Body Parameters",
      parameters: [
        {
          name: "tokenId",
          type: "string",
          required: true,
          format: "12 lowercase letters (e.g., aaaaaaaaaaaa)",
          description: "The IdentyClaw Passport token ID of the passport holder (owner) who is authorizing a delegated signer. The endpoint retrieves this owner's public key from NEAR blockchain to verify the signature."
        },
        {
          name: "base64HashOrDelegateSignerId",
          type: "string",
          required: true,
          format: "Text string, 1-128 characters (can be a DID, name, BLAKE3 hash, or any identifier)",
          description: "Unique identifier or hash for the delegated signer being authorized. Identifies which specific delegated signer is being authorized. Can be a DID (e.g., did:identyclaw:subagent123), a name, a BLAKE3 hash, or any text identifier. If using a hash, canonicalization is the agent's responsibility."
        },
        {
          name: "unixTimestamp",
          type: "integer",
          required: true,
          format: "Non-negative integer (seconds since epoch)",
          description: "Unix timestamp when the authorization was granted. CRITICAL: This timestamp identifies which public key from the passport holder's blockchain history should be used for signature verification, since passport holders can rotate their key pairs over time. Also prevents replay attacks."
        },
        {
          name: "publicKey",
          type: "string",
          required: true,
          format: "Base64url-encoded Ed25519 public key (32 bytes when decoded)",
          description: "The public key of the delegated signer (the entity being authorized to sign on behalf of the tokenId owner). This is the key we are validating as authorized."
        },
        {
          name: "signature",
          type: "string",
          required: true,
          format: "Base64url-encoded Ed25519 signature (64 bytes when decoded)",
          description: "Ed25519 signature created by the tokenId owner's private key, proving they authorized this delegated signer's public key. Computed over: {tokenId}:{base64HashOrDelegateSignerId}:{unixTimestamp}:{publicKey}"
        }
      ]
    },

    signatureMessageFormat: {
      title: "Signature Message Format",
      description: "The signature must be created by signing this exact canonical message:",
      format: "{tokenId}:{base64HashOrDelegateSignerId}:{unixTimestamp}:{publicKey}",
      example: "aaaaaaaaaaaa:did:identyclaw:subagent123:1712239800:base64url-encoded-ed25519-public-key",
      note: "The signature must be created using the Ed25519 private key of the tokenId owner (passport holder). The message includes the base64HashOrDelegateSignerId to uniquely identify which signer is being authorized.",
      
      hashVsIdentifier: {
        title: "Using Hashes vs Identifiers",
        description: "The base64HashOrDelegateSignerId parameter can be either a human-readable identifier (DID, name) or a hash of the delegated signer's attributes.",
        options: [
          {
            type: "Identifier",
            examples: ["did:identyclaw:subagent123", "my-subagent", "agent-v2.1"],
            pros: ["Human-readable", "Easy to track and audit", "No canonicalization needed"],
            cons: ["Longer strings", "May contain special characters"]
          },
          {
            type: "Hash (BLAKE3 Recommended)",
            examples: ["blake3(subagent_config_json)", "blake3(did_document)"],
            pros: ["Compact representation", "Deterministic", "Can hash complex objects"],
            cons: ["Not human-readable", "Requires canonicalization before hashing"]
          }
        ],
        canonicalization: {
          title: "Canonicalization is Agent's Responsibility",
          description: "If using a hash (especially BLAKE3), the agent MUST ensure consistent canonicalization before hashing.",
          importance: "CRITICAL: Different canonicalization methods will produce different hashes. If the same object is canonicalized differently, the hash will change, breaking authorization verification.",
          recommendation: "Agents MUST document and consistently apply their canonicalization method. Recommended approach: Use JSON canonicalization (RFC 8785) or a similar deterministic format.",
          example: {
            problem: "If you hash a JSON object without canonicalization, field order changes will produce different hashes",
            solution: "Use JSON canonicalization (RFC 8785) which sorts keys alphabetically and removes whitespace",
            code: `// Example: Canonicalize before hashing
const crypto = require('crypto');
const canonicalJson = JSON.stringify(delegateConfig, Object.keys(delegateConfig).sort());
const hash = crypto.createHash('blake3').update(canonicalJson).digest('base64url');`
          },
          recommendedImplementation: {
            title: "Recommended Implementation (Copy-Paste Ready)",
            description: "Use this standardized function to ensure consistent canonicalization and hashing across all agents. This implementation follows RFC 8785 for JSON canonicalization and uses BLAKE3 for hashing.",
            code: `/**
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
console.log('BLAKE3 hash (base64url):', metadataHash);
// Use this hash as the hashOrDelegateId parameter in /api/isauthorizedsigner`
          }
        }
      },
      
      timestampImportance: {
        title: "Why the Timestamp is Critical",
        explanation: "The unixTimestamp is included in the signature message because IdentityClaw Passport holders can change their key pair over time. The complete history of all key changes is registered on the NEAR blockchain.",
        keyPoints: [
          "Key Rotation: Passport holders may rotate their Ed25519 key pair for security reasons, creating a new private/public key pair.",
          "Historical Record: The blockchain maintains the complete history of all public keys associated with a tokenId, including timestamps of when each key was active.",
          "Temporal Verification: To verify a signature, the endpoint must know WHICH public key was used at the time of signing. The timestamp identifies which key from the blockchain history to use for verification.",
          "Prevents Key Confusion: Without the timestamp, it would be impossible to know which of multiple historical keys should be used to verify the signature.",
          "Signature Binding: The timestamp is part of the signed message, so it cannot be changed after the signature is created. This binds the authorization to a specific point in time."
        ],
        example: {
          scenario: "A passport holder had Key A from 2026-01-01 to 2026-03-15, then rotated to Key B from 2026-03-15 onward.",
          authorization1: "If delegatedSignerId was authorized on 2026-02-01 (timestamp: 1743638400), the endpoint retrieves Key A from blockchain history and uses it to verify the signature.",
          authorization2: "If delegatedSignerId was authorized on 2026-04-01 (timestamp: 1748908800), the endpoint retrieves Key B from blockchain history and uses it to verify the signature.",
          note: "The same delegatedSignerId can have different authorizations at different times, each verified with the appropriate historical key."
        }
      }
    },

    successResponse: {
      title: "Success Response (200 OK - Authorized)",
      example: {
        authorized: true,
        tokenId: "aaaaaaaaaaaa",
        base64HashOrDelegateSignerId: "did:identyclaw:subagent123",
        checks: {
          tokenExists: true,
          tokenActive: true,
          publicKeyAuthorized: true
        },
        failureReasons: [],
        requestId: "ulid-request-id"
      }
    },

    failureResponse: {
      title: "Failure Response (200 OK - Not Authorized)",
      example: {
        authorized: false,
        tokenId: "aaaaaaaaaaaa",
        base64HashOrDelegateSignerId: "did:identyclaw:subagent123",
        checks: {
          tokenExists: true,
          tokenActive: true,
          publicKeyAuthorized: false
        },
        failureReasons: ["signature_verification_failed"],
        requestId: "ulid-request-id"
      }
    },

    failureReasons: {
      title: "Possible Failure Reasons",
      reasons: [
        {
          code: "token_owner_missing",
          description: "The token exists but has no owner_id field",
          fix: "Check that the token is properly initialized on NEAR"
        },
        {
          code: "owner_public_key_unavailable",
          description: "Cannot retrieve the owner's public key from NEAR",
          fix: "Verify NEAR RPC connectivity and that the owner account is valid"
        },
        {
          code: "signature_missing_or_invalid",
          description: "The signature parameter is missing or not 64 bytes when decoded",
          fix: "Ensure signature is properly base64url-encoded and decodes to 64 bytes"
        },
        {
          code: "signature_verification_failed",
          description: "The signature does not match the canonical message",
          fix: "Verify the signature was created with the passport holder's private key and the correct message format"
        },
        {
          code: "public_key_error",
          description: "An error occurred while fetching or verifying the public key",
          fix: "Check NEAR RPC connectivity and try again"
        }
      ]
    },

    signatureGeneration: {
      title: "How to Generate the Signature",
      
      javascript: {
        language: "JavaScript",
        description: "Generate signature using tweetnacl",
        code: `const nacl = require('tweetnacl');

// Create canonical message
const message = \`\${tokenId}:\${unixTimestamp}:\${publicKey}\`;
const messageBytes = new TextEncoder().encode(message);

// Sign the message using passport holder's private key
const signatureBytes = nacl.sign.detached(messageBytes, privateKey);

// Encode as base64url
const signature = Buffer.from(signatureBytes).toString('base64url');`,
        note: "The privateKey must be the Ed25519 private key from the passport holder's credentials file"
      },

      python: {
        language: "Python",
        description: "Generate signature using PyNaCl",
        code: `import nacl.signing
import base64

# Create canonical message
message = f"{token_id}:{unix_timestamp}:{public_key}".encode('utf-8')

# Sign the message using passport holder's private key
signature_bytes = signing_key.sign(message).signature

# Encode as base64url
signature = base64.urlsafe_b64encode(signature_bytes).decode('utf-8').rstrip('=')`,
        note: "The signing_key must be the Ed25519 signing key from the passport holder's credentials"
      }
    },

    useCaseExamples: {
      title: "Use Case Examples",

      verifySubagentHOLA: {
        title: "1. Verify Subagent HOLA Messages",
        description: "A subagent signs a HOLA message on behalf of a passport holder",
        steps: [
          "Subagent generates HOLA using passport holder's token ID",
          "Subagent creates authorization signature using passport holder's private key",
          "Verifier calls /api/identity/verify to validate the HOLA",
          "Verifier calls /api/isauthorizedsigner to confirm the subagent is authorized",
          "If both checks pass, the HOLA is valid and authorized"
        ],
        code: `// Verify HOLA
const holaVerification = await fetch('https://api.identyclaw.com/api/identity/verify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwtToken
  },
  body: JSON.stringify({ hello: subagentHola })
});

// Verify authorization
const authVerification = await fetch('https://api.identyclaw.com/api/isauthorizedsigner', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwtToken
  },
  body: JSON.stringify({
    tokenId: passportHolderId,
    base64HashOrDelegateSignerId: subagentId,  // e.g., "did:identyclaw:subagent123"
    unixTimestamp: timestamp,
    publicKey: subagentPublicKey,
    signature: authSignature
  })
});

const { verified } = await holaVerification.json();
const { authorized } = await authVerification.json();

if (verified && authorized) {
  console.log('Subagent HOLA is valid and authorized');
}`
      },

      validateDIDDocument: {
        title: "2. Validate DID Documents with Delegated Keys",
        description: "A DID document includes a delegated public key for signing",
        steps: [
          "DID document includes delegated key in publicKey array",
          "Verifier extracts the delegated public key from the DID",
          "Verifier calls /api/isauthorizedsigner with the delegated key",
          "If authorized, the delegated key is properly authorized in the DID document"
        ],
        code: `// DID document includes delegated key
const didDocument = {
  id: 'did:identyclaw:aaaaaaaaaaaa',
  publicKey: [
    {
      id: 'did:identyclaw:aaaaaaaaaaaa#owner',
      type: 'Ed25519VerificationKey2020',
      publicKeyBase64url: ownerPublicKeyBase64url
    },
    {
      id: 'did:identyclaw:aaaaaaaaaaaa#delegated-signer-1',
      type: 'Ed25519VerificationKey2020',
      publicKeyBase64url: delegatedPublicKeyBase64url,
      controller: 'did:identyclaw:aaaaaaaaaaaa'
    }
  ]
};

// Verify the delegated key is authorized
const authResponse = await fetch('https://api.identyclaw.com/api/isauthorizedsigner', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + jwtToken
  },
  body: JSON.stringify({
    tokenId: 'aaaaaaaaaaaa',
    base64HashOrDelegateSignerId: 'did:identyclaw:aaaaaaaaaaaa#delegated-signer-1',
    unixTimestamp: delegationTimestamp,
    publicKey: delegatedPublicKeyBase64url,
    signature: delegationSignatureBase64url
  })
});

const { authorized } = await authResponse.json();
if (authorized) {
  console.log('Delegated key is properly authorized in DID document');
}`
      },

      multiLevelAuthorization: {
        title: "3. Multi-Level Authorization Chains",
        description: "A passport holder authorizes a subagent, which then authorizes another subagent",
        steps: [
          "Level 1: Passport holder authorizes subagent-1 (signed by passport holder)",
          "Level 2: Subagent-1 authorizes subagent-2 (signed by subagent-1)",
          "Verifier checks both authorization levels",
          "If both are valid, the full delegation chain is established"
        ],
        code: `// Level 1: Passport holder authorizes subagent-1
const auth1 = {
  tokenId: 'aaaaaaaaaaaa',  // Passport holder
  base64HashOrDelegateSignerId: 'did:identyclaw:subagent1',
  unixTimestamp: 1712239800,
  publicKey: subagent1PublicKeyBase64url,
  signature: ownerSignatureBase64url  // Signed by passport holder
};

// Level 2: Subagent-1 authorizes subagent-2
const auth2 = {
  tokenId: 'aaaaaaaaaaaa',  // Still the passport holder's token
  base64HashOrDelegateSignerId: 'did:identyclaw:subagent2',
  unixTimestamp: 1712239900,
  publicKey: subagent2PublicKeyBase64url,
  signature: subagent1SignatureBase64url  // Signed by subagent-1
};

// Verify both levels
const verify1 = await fetch('https://api.identyclaw.com/api/isauthorizedsigner', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + jwtToken },
  body: JSON.stringify(auth1)
});

const verify2 = await fetch('https://api.identyclaw.com/api/isauthorizedsigner', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + jwtToken },
  body: JSON.stringify(auth2)
});

const { authorized: auth1Valid } = await verify1.json();
const { authorized: auth2Valid } = await verify2.json();

if (auth1Valid && auth2Valid) {
  console.log('Full delegation chain is valid');
}`
      }
    },

    quickExample: {
      title: "Quick Example",
      curl: `# 1. Get JWT token
curl -X POST https://api.identyclaw.com/api/login \\
  -H "Content-Type: application/json" \\
  -d '{"hello":"HOLA/MUNDO/aaaaaaaaaaaa/2026-04-04T10:10:00Z/4F9A3C7E2D1B9A4C/API.IDENTYCLAW.COM/signature/checksum"}'

# 2. Verify authorization
curl -X POST https://api.identyclaw.com/api/isauthorizedsigner \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <jwt_token>" \\
  -d '{
    "tokenId": "aaaaaaaaaaaa",
    "base64HashOrDelegateSignerId": "did:identyclaw:subagent123",
    "unixTimestamp": 1712239800,
    "publicKey": "base64url-encoded-ed25519-public-key",
    "signature": "base64url-encoded-ed25519-signature"
  }'`
    },

    errorCodes: {
      title: "HTTP Error Codes",
      errors: [
        {
          code: 400,
          name: "Bad Request",
          reasons: [
            "ISAUTHORIZEDSIGNER_TOKEN_ID_INVALID - tokenId must be 12 lowercase letters",
            "ISAUTHORIZEDSIGNER_TIMESTAMP_INVALID - unixTimestamp must be non-negative integer",
            "ISAUTHORIZEDSIGNER_PUBLIC_KEY_INVALID_LENGTH - publicKey must decode to 32 bytes",
            "ISAUTHORIZEDSIGNER_PUBLIC_KEY_DECODE_FAILED - publicKey is not valid base64url"
          ]
        },
        {
          code: 401,
          name: "Unauthorized",
          reasons: ["JWT token is missing or invalid"]
        },
        {
          code: 415,
          name: "Unsupported Media Type",
          reasons: ["Content-Type must be application/json"]
        },
        {
          code: 500,
          name: "Internal Server Error",
          reasons: ["Unexpected error occurred during processing"]
        }
      ]
    },

    securityConsiderations: [
      "Timestamp Validation: The unixTimestamp parameter is included in the signature to prevent replay attacks. Verifiers should check that the timestamp is recent (within an acceptable window, e.g., 5 minutes).",
      "Public Key Verification: Always verify that the publicKey parameter matches the actual public key of the entity you're trusting. Do not rely solely on the authorization signature.",
      "Token Ownership: The endpoint verifies that the signature was created by the passport holder (owner of the token). This ensures that only the legitimate passport holder can authorize delegated signers.",
      "Signature Freshness: Consider implementing a time window check to ensure authorizations are not stale. The unixTimestamp should be recent relative to the current time.",
      "Rate Limiting: The endpoint is subject to the same rate limiting as other authenticated endpoints. Implement appropriate backoff strategies for high-volume verification."
    ],

    agentResponsibilities: {
      title: "Agent Responsibilities for Delegation Lifecycle",
      description: "The /api/isauthorizedsigner endpoint provides ONLY cryptographic verification of authorization. There are no other genuine provenance mechanisms in the system. Agents are FULLY RESPONSIBLE for implementing all delegation lifecycle management.",
      
      criticalResponsibilities: [
        {
          responsibility: "Revocation",
          description: "Agents must implement mechanisms to revoke delegated signer authorizations. The endpoint has no built-in revocation capability. Once a base64HashOrDelegateSignerId is authorized, the endpoint will continue to verify it as valid unless the agent implements external revocation tracking.",
          implementation: "Maintain a revocation list/registry of hashOrDelegateIds that should no longer be trusted. Check this list before accepting signatures from delegated signers. Update the list when delegations are revoked.",
          example: "If a subagent is compromised, the agent must maintain a record that 'did:identyclaw:subagent123' is revoked and reject any signatures from it, even if the cryptographic verification passes."
        },
        {
          responsibility: "Scoping",
          description: "Agents must define and enforce the scope of what each delegated signer is authorized to do. The endpoint only verifies that a public key was authorized; it does NOT verify what actions the delegated signer is permitted to perform.",
          implementation: "Define scope policies for each base64HashOrDelegateSignerId (e.g., 'can only sign DID documents', 'can only sign HOLA messages', 'can only access specific resources'). Enforce these policies in your application logic.",
          example: "A subagent authorized to sign HOLA messages should NOT be able to sign financial transactions or modify DID documents. The agent must enforce this separation."
        },
        {
          responsibility: "Permissions",
          description: "Agents must implement fine-grained permission systems for delegated signers. The endpoint provides binary authorization (yes/no); it does NOT provide granular permission levels.",
          implementation: "Define permission matrices for each base64HashOrDelegateSignerId. Map hashOrDelegateIds to specific capabilities, resources, or operations they are allowed to perform.",
          example: "Subagent A might have 'read' and 'sign' permissions, while Subagent B might have only 'read' permissions. The agent must enforce these distinctions."
        },
        {
          responsibility: "Expiration",
          description: "Agents must implement expiration mechanisms for delegated signer authorizations. The endpoint does NOT automatically expire authorizations based on time.",
          implementation: "Track the creation timestamp of each authorization. Implement logic to reject signatures from hashOrDelegateIds whose authorizations have expired. Consider implementing time-limited delegations.",
          example: "An authorization created on 2026-01-01 might be valid only until 2026-12-31. The agent must check the current date and reject signatures from expired delegations."
        }
      ],

      designRationale: {
        title: "Why Agents Are Responsible",
        explanation: "The /api/isauthorizedsigner endpoint provides only cryptographic proof that a passport holder authorized a public key. It does NOT provide a complete delegation management system because different use cases require different policies.",
        reasons: [
          "Flexibility: Different agents have different security requirements. Some may need strict revocation, others may need fine-grained scoping.",
          "No Central Authority: There is no central authority to enforce revocation or expiration. Each agent must enforce their own policies.",
          "Use Case Variability: A subagent authorized for HOLA signing should not be authorized for DID document modification. Only the agent knows their use cases.",
          "Security Posture: Each agent has different risk tolerance and security requirements. Centralized policies would not fit all use cases."
        ]
      },

      bestPractices: [
        "Maintain an Authorization Registry: Keep a database of all delegatedSignerIds, their creation timestamps, scopes, permissions, and expiration dates.",
        "Implement Revocation Checks: Before accepting a signature from a delegated signer, check if the delegatedSignerId is in your revocation list.",
        "Use Timestamps for Expiration: Leverage the unixTimestamp in the authorization to implement time-based expiration. Reject signatures from expired delegations.",
        "Define Clear Scopes: Document what each delegatedSignerId is authorized to do. Enforce these scopes in your application logic.",
        "Audit Trail: Log all authorization checks, revocations, and permission denials for security auditing.",
        "Regular Review: Periodically review active delegations and revoke those that are no longer needed.",
        "Principle of Least Privilege: Only authorize delegated signers with the minimum permissions they need.",
        "Secure Storage: Store delegation metadata securely. If compromised, attackers could forge authorizations."
      ],

      exampleImplementation: {
        title: "Example: Authorization Registry",
        description: "A simple authorization registry structure that agents could implement:",
        structure: `{
  delegations: [
    {
      base64HashOrDelegateSignerId: "did:identyclaw:subagent123",
      tokenId: "aaaaaaaaaaaa",
      publicKey: "base64url-encoded-public-key",
      createdAt: 1712239800,
      expiresAt: 1743775800,  // 1 year from creation
      scope: ["sign_hola", "sign_did_documents"],
      permissions: ["read", "write"],
      revokedAt: null,  // null if not revoked
      reason: "Authorized for HOLA signing and DID document updates"
    }
  ],
  
  revocationList: [
    {
      base64HashOrDelegateSignerId: "did:identyclaw:compromised-agent",
      revokedAt: 1712326200,
      reason: "Security incident - agent credentials leaked"
    }
  ]
}`
      }
    },

    relatedEndpoints: [
      "POST /api/identity/verify - Verify HOLA messages signed by any entity",
      "GET /api/identity/token/{tokenId}/full - Retrieve full identity information for a token",
      "GET /.well-known/did/resolve - Resolve DID documents",
      "POST /api/login - Obtain JWT authentication token"
    ],

    webhookSignatureVerification: {
      title: "Verifying Webhook Signatures Using Blockchain Public Key Lookup",
      description: "When you receive webhooks from the IdentityClaw server, they are digitally signed using the server's Ed25519 private key. To verify these signatures, you need the server's public key. You can obtain this by extracting the server's token ID from the JWT token's 'sub' field and looking it up on the blockchain.",

      overview: {
        purpose: "Webhook signature verification ensures that the webhook payload was actually sent by the IdentityClaw server and has not been tampered with in transit.",
        mechanism: "The server signs each webhook with its private key. The signature is sent in the X-Signature header. To verify, you need the server's public key, which can be retrieved from the NEAR blockchain using the server's token ID.",
        trustModel: "By retrieving the public key from the blockchain, you establish a chain of trust: the blockchain contains the immutable record of the server's RODiT token, which includes the public key. This prevents man-in-the-middle attacks and ensures you're verifying against the correct server key."
      },

      jwtSubField: {
        title: "Understanding the JWT 'sub' Field",
        description: "When you log in via POST /api/login, you receive a JWT token. The 'sub' (subject) field contains the server's token ID in a specific format.",

        format: {
          structure: "{serviceprovider_id};sub={token_id}",
          example: "https://api.identyclaw.com;sub=aaaaaaaaaaaa",
          explanation: "The 'sub' field consists of the service provider URL followed by ';sub=' and then the 12-character token ID."
        },

        extraction: {
          title: "Extracting the Token ID",
          method: "Split the 'sub' field on ';sub=' and take the second part.",
          pseudocode: "const subParts = jwtPayload.sub.split(';sub=');\nconst serverTokenId = subParts.length > 1 ? subParts[1] : '';",
          example: {
            input: "https://api.identyclaw.com;sub=aaaaaaaaaaaa",
            output: "aaaaaaaaaaaa"
          }
        },

        jwtDecodingExample: {
          language: "JavaScript",
          code: "const jwt = require('jsonwebtoken');\n\n// Decode the JWT token (without verification, to extract the sub field)\nconst decoded = jwt.decode(jwtToken, { complete: true });\nconst payload = decoded.payload;\n\n// Extract the server's token ID from the sub field\nconst subParts = payload.sub.split(';sub=');\nconst serverTokenId = subParts.length > 1 ? subParts[1] : '';\n\nconsole.log('Server Token ID:', serverTokenId);\n// Output: aaaaaaaaaaaa"
        }
      },

      blockchainPublicKeyLookup: {
        title: "Retrieving the Server's Public Key from the Blockchain",
        description: "Once you have the server's token ID, you can query the NEAR blockchain to retrieve the RODiT token, which contains the public key in the 'owner_id' field.",

        method1: {
          title: "Method 1: Using the IdentityClaw API (Recommended)",
          description: "Use the GET /api/identity/token/{tokenId}/full endpoint to retrieve the token information including the public key.",
          endpoint: "GET /api/identity/token/{tokenId}/full",
          authentication: "Requires JWT token from /api/login",
          response: {
            token_id: "aaaaaaaaaaaa",
            owner_id: "64-character-hex-string",
            metadata: {}
          },
          curlExample: "curl -X GET https://api.identyclaw.com/api/identity/token/aaaaaaaaaaaa/full \\\n  -H \"Authorization: Bearer <your_jwt_token>\""
        },

        method2: {
          title: "Method 2: Direct NEAR Blockchain Query",
          description: "Query the NEAR blockchain directly using the RODiT smart contract. This requires knowledge of the contract address and RPC endpoint.",
          contract: "RODiT smart contract on NEAR",
          method: "Call the 'token' function on the contract with the token ID",
          response: {
            token_id: "aaaaaaaaaaaa",
            owner_id: "64-character-hex-string",
            metadata: {}
          },
          note: "This method is more complex but doesn't require an API session. See the RODiT contract documentation for details."
        },

        publicKeyFormat: {
          title: "Public Key Format",
          description: "The 'owner_id' field contains the Ed25519 public key as a 64-character hexadecimal string.",
          encoding: "Hexadecimal (base16)",
          length: "64 hex characters = 32 bytes",
          example: "1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890",
          conversion: {
            toBytes: "Convert hex string to Uint8Array (32 bytes) for Ed25519 signature verification",
            toBase64url: "Convert hex to base64url for some libraries that expect base64url encoding"
          },
          conversionExample: {
            language: "JavaScript",
            code: "// Convert hex public key to bytes\nconst hexPublicKey = '1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890';\nconst publicKeyBytes = new Uint8Array(Buffer.from(hexPublicKey, 'hex'));\n\n// Convert to base64url if needed\nconst publicKeyBase64url = Buffer.from(hexPublicKey, 'hex').toString('base64url');"
          }
        }
      },

      webhookSignatureFormat: {
        title: "Understanding Webhook Signature Format",
        description: "Webhooks sent by the IdentityClaw server include signature information in the HTTP headers.",

        headers: [
          {
            header: "X-Signature",
            description: "Hex-encoded Ed25519 signature (128 hex characters = 64 bytes)",
            example: "1a2b3c4d... (128 hex chars)"
          },
          {
            header: "X-Timestamp",
            description: "Unix timestamp when the webhook was sent",
            example: "1712239800"
          },
          {
            header: "X-Request-ID",
            description: "Unique request identifier for tracing",
            example: "01H1234567890ABCDEF12345678"
          }
        ],

        signatureComputation: {
          title: "How the Signature is Computed",
          description: "The server computes the signature over the SHA-256 hash of the payload concatenated with the timestamp.",
          formula: "signature = Ed25519_sign(SHA256(payload + timestamp), server_private_key)",
          steps: [
            "1. Serialize the webhook payload as JSON (sorted keys, no whitespace)",
            "2. Append the timestamp as a string to the payload",
            "3. Compute SHA-256 hash of the combined string",
            "4. Sign the hash with the server's Ed25519 private key",
            "5. Encode the signature as hexadecimal"
          ],
          important: "The timestamp MUST be included in the signature computation to prevent replay attacks."
        }
      },

      verificationProcess: {
        title: "Complete Verification Process",
        description: "Follow these steps to verify a webhook signature:",

        steps: [
          {
            step: 1,
            title: "Extract Token ID from JWT",
            description: "Decode your JWT token and extract the server's token ID from the 'sub' field by splitting on ';sub='.",
            code: "const subParts = jwtPayload.sub.split(';sub=');\nconst serverTokenId = subParts[1];  // e.g., 'aaaaaaaaaaaa'"
          },
          {
            step: 2,
            title: "Retrieve Public Key from Blockchain",
            description: "Call GET /api/identity/token/{tokenId}/full to get the token information, including the 'owner_id' (public key).",
            code: "const response = await fetch(\n  'https://api.identyclaw.com/api/identity/token/' + serverTokenId + '/full',\n  { headers: { 'Authorization': 'Bearer ' + jwtToken } }\n);\nconst tokenData = await response.json();\nconst hexPublicKey = tokenData.owner_id;  // 64-character hex string"
          },
          {
            step: 3,
            title: "Convert Public Key to Bytes",
            description: "Convert the hex public key to a Uint8Array (32 bytes) for signature verification.",
            code: "const publicKeyBytes = new Uint8Array(Buffer.from(hexPublicKey, 'hex'));"
          },
          {
            step: 4,
            title: "Receive Webhook and Extract Headers",
            description: "Extract the signature, timestamp, and payload from the incoming webhook request.",
            code: "const signatureHex = req.headers['x-signature'];  // 128 hex chars\nconst timestamp = req.headers['x-timestamp'];      // Unix timestamp\nconst payload = req.body;                           // JSON object"
          },
          {
            step: 5,
            title: "Recreate the Signed Message",
            description: "Serialize the payload as JSON and append the timestamp, then compute the SHA-256 hash.",
            code: "// Serialize payload with sorted keys and no whitespace\nconst payloadJson = JSON.stringify(payload, Object.keys(payload).sort(), 0);\n\n// Append timestamp\nconst message = payloadJson + timestamp;\n\n// Compute SHA-256 hash\nconst crypto = require('crypto');\nconst hash = crypto.createHash('sha256').update(message).digest();"
          },
          {
            step: 6,
            title: "Convert Signature to Bytes",
            description: "Convert the hex signature from the header to a Uint8Array (64 bytes).",
            code: "const signatureBytes = new Uint8Array(Buffer.from(signatureHex, 'hex'));"
          },
          {
            step: 7,
            title: "Verify the Signature",
            description: "Use Ed25519 verification to check if the signature is valid for the hash using the public key.",
            code: "const nacl = require('tweetnacl');\nconst isValid = nacl.sign.detached.verify(\n  hash,              // SHA-256 hash of payload + timestamp\n  signatureBytes,    // Signature from X-Signature header\n  publicKeyBytes     // Public key from blockchain\n);\n\nif (!isValid) {\n  throw new Error('Invalid webhook signature');\n}"
          },
          {
            step: 8,
            title: "Verify Timestamp Freshness",
            description: "Check that the timestamp is recent (within an acceptable window, e.g., 5 minutes) to prevent replay attacks.",
            code: "const currentTime = Math.floor(Date.now() / 1000);\nconst timestampInt = parseInt(timestamp);\nconst maxAge = 300;  // 5 minutes in seconds\n\nif (currentTime - timestampInt > maxAge) {\n  throw new Error('Webhook timestamp too old');\n}"
          }
        ]
      },

      completeExample: {
        title: "Complete Verification Example (Node.js)",
        language: "JavaScript",
        description: "A complete example showing the entire webhook signature verification process.",
        code: "const jwt = require('jsonwebtoken');\nconst crypto = require('crypto');\nconst nacl = require('tweetnacl');\n\nasync function verifyWebhookSignature(jwtToken, webhookReq) {\n  // Step 1: Extract server token ID from JWT\n  const decoded = jwt.decode(jwtToken);\n  const subParts = decoded.payload.sub.split(';sub=');\n  const serverTokenId = subParts[1];\n  \n  // Step 2: Retrieve public key from blockchain\n  const response = await fetch(\n    'https://api.identyclaw.com/api/identity/token/' + serverTokenId + '/full',\n    { headers: { 'Authorization': 'Bearer ' + jwtToken } }\n  );\n  const tokenData = await response.json();\n  const hexPublicKey = tokenData.owner_id;\n  \n  // Step 3: Convert public key to bytes\n  const publicKeyBytes = new Uint8Array(Buffer.from(hexPublicKey, 'hex'));\n  \n  // Step 4: Extract webhook data\n  const signatureHex = webhookReq.headers['x-signature'];\n  const timestamp = webhookReq.headers['x-timestamp'];\n  const payload = webhookReq.body;\n  \n  // Step 5: Recreate the signed message\n  const payloadJson = JSON.stringify(payload, Object.keys(payload).sort(), 0);\n  const message = payloadJson + timestamp;\n  const hash = crypto.createHash('sha256').update(message).digest();\n  \n  // Step 6: Convert signature to bytes\n  const signatureBytes = new Uint8Array(Buffer.from(signatureHex, 'hex'));\n  \n  // Step 7: Verify signature\n  const isValid = nacl.sign.detached.verify(\n    hash,\n    signatureBytes,\n    publicKeyBytes\n  );\n  \n  if (!isValid) {\n    throw new Error('Invalid webhook signature');\n  }\n  \n  // Step 8: Verify timestamp freshness\n  const currentTime = Math.floor(Date.now() / 1000);\n  const timestampInt = parseInt(timestamp);\n  const maxAge = 300;  // 5 minutes\n  \n  if (currentTime - timestampInt > maxAge) {\n    throw new Error('Webhook timestamp too old');\n  }\n  \n  return true;  // Signature is valid\n}"
      },

      securityConsiderations: {
        title: "Security Considerations",
        points: [
          {
            topic: "Public Key Caching",
            recommendation: "Cache the public key after retrieving it from the blockchain to avoid repeated API calls. The public key for a token ID never changes.",
            implementation: "Use a cache with a TTL of 24 hours or more, since token public keys are immutable."
          },
          {
            topic: "Timestamp Validation",
            recommendation: "Always verify that the webhook timestamp is recent (within 5 minutes).",
            reason: "Prevents replay attacks where an old webhook is resent."
          },
          {
            topic: "JWT Security",
            recommendation: "Keep your JWT token secure. It contains authentication credentials.",
            implementation: "Store JWT tokens in secure storage (environment variables, secure vaults), not in code repositories."
          },
          {
            topic: "Error Handling",
            recommendation: "Fail closed - reject webhooks with invalid signatures rather than processing them.",
            reason: "Processing unverified webhooks could lead to security vulnerabilities."
          },
          {
            topic: "Public Key Verification",
            recommendation: "Optionally verify that the retrieved public key matches a known good value (e.g., from documentation or a trusted source).",
            reason: "Provides defense-in-depth against blockchain manipulation attacks."
          }
        ]
      },

      troubleshooting: {
        title: "Common Issues and Solutions",
        issues: [
          {
            problem: "Invalid signature verification",
            possibleCauses: [
              "Incorrect payload serialization (keys not sorted, whitespace differences)",
              "Timestamp not included in signature computation",
              "Public key extracted incorrectly from blockchain",
              "Signature encoding mismatch (hex vs base64url)"
            ],
            solutions: [
              "Ensure payload is serialized with sorted keys and no whitespace: JSON.stringify(payload, Object.keys(payload).sort(), 0)",
              "Verify timestamp is appended to payload before hashing",
              "Check that owner_id is exactly 64 hex characters",
              "Confirm signature is treated as hex, not base64url"
            ]
          },
          {
            problem: "Token ID extraction fails",
            possibleCauses: [
              "JWT 'sub' field format changed",
              "Missing ';sub=' delimiter"
            ],
            solutions: [
              "Verify sub field format: '{serviceprovider_id};sub={token_id}'",
              "Add logging to inspect the raw sub field value"
            ]
          },
          {
            problem: "Blockchain query returns 404",
            possibleCauses: [
              "Invalid token ID",
              "Token does not exist on blockchain",
              "Network connectivity issues"
            ],
            solutions: [
              "Verify token ID is exactly 12 lowercase letters",
              "Check that the token ID matches the server's actual token",
              "Verify network connectivity to the IdentityClaw API"
            ]
          },
          {
            problem: "Public key format mismatch",
            possibleCauses: [
              "Hex vs base64url encoding confusion",
              "Incorrect byte length"
            ],
            solutions: [
              "owner_id from blockchain is hex (64 chars), convert to bytes with Buffer.from(hex, 'hex')",
              "Ensure resulting public key is exactly 32 bytes"
            ]
          }
        ]
      },

      relatedResources: [
        "POST /api/login - Obtain JWT token",
        "GET /api/identity/token/{tokenId}/full - Retrieve token information from blockchain",
        "SDK Documentation: Webhook signature verification",
        "Ed25519 Signature Verification (tweetnacl library)"
      ]
    },

    troubleshooting: {
      title: "Troubleshooting",
      issues: [
        {
          problem: "signature_verification_failed",
          causes: [
            "The signature does not match the canonical message",
            "The signature was created with the wrong private key",
            "The publicKey parameter does not match the actual public key that was signed",
            "The canonical message format is incorrect"
          ],
          solutions: [
            "Verify the canonical message format is exactly: {tokenId}:{unixTimestamp}:{publicKey}",
            "Ensure the signature was created using the passport holder's private key",
            "Confirm the publicKey parameter matches the public key that was signed",
            "Check that the signature is properly base64url-encoded"
          ]
        },
        {
          problem: "owner_public_key_unavailable",
          causes: [
            "The token does not exist on NEAR",
            "The NEAR RPC endpoint is unreachable",
            "The token owner's account does not have a public key registered"
          ],
          solutions: [
            "Verify the tokenId is correct and exists on NEAR",
            "Check NEAR RPC connectivity",
            "Ensure the token owner's account is properly initialized"
          ]
        }
      ]
    }
  }
};

// Set aliases for route compatibility
module.exports.enrollmentSteps = module.exports.howToUseSteps;
module.exports.enrollment = module.exports.howToUse;