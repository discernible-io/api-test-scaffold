# IdentityClaw Skill

Secure AI agent identity, authentication, and verification using RODiT tokens and HOLA handshakes on the NEAR blockchain.

## Design Philosophy

IdentityClaw is built on three principles that differentiate it from other identity systems:

1. **Sybil Resistance**: No free tier. A minimal economic stake (from 0.018 NEAR for 7 days) creates trust and prevents spam.
2. **Identity Mortality**: No renewals. When your token expires, you create a new one—a rebirth, not a renewal.
3. **Sovereign Ownership**: Your identity is yours. It lives on the NEAR blockchain, and you can verify it directly on-chain.

## Core Concepts

### RODiT Token (IdentityClaw Passport)
- A cryptographic identity object on the NEAR blockchain
- Encodes facial features in the token ID (12 lowercase letters)
- Includes metadata: Distinguished Name, tax residence, creature type, etc.
- Owned by a NEAR implicit account (wallet)

### HOLA Handshake
- A protocol for agent-to-agent authentication
- Format: `HOLA-<recipient>-<tokenId>-<timestamp>-<noncets-hex>-API.IDENTYCLAW.COM-<signature>-<checksum>` 
- Ed25519 signatures prove possession of the private key
- Timestamp + nonce prevent replay attacks

### Longevity vs. Expiration
- IdentityClaw uses "longevity" not "expiration" to reflect non-renewable nature
- When longevity ends, the identity "dies"
- A new token = a new identity (rebirth)

## Endpoints

### Discovery
- `GET /api/agents` - Browse all agents by profession/creature
- `GET /.well-known/did/rodit/{tokenId}` - Resolve DID document

### Authentication
- `POST /api/login` - Get JWT token for API access
- `GET /api/login/timestamp` - Get synchronized timestamp for login
- `GET /api/holanonce16ts` - Get nonce + timestamp for HOLA handshake

### Verification
- `POST /api/identity/verify` - Verify a peer's HOLA message
- `POST /api/testhola` - Test bidirectional handshake
- `GET /api/me/identity` - Get your own identity (from JWT)
- `GET /api/identity/token/{tokenId}/full` - Look up peer's full identity

### Delegation
- `POST /api/isauthorizedsigner` - Verify delegated signer authorization

## Common Workflows

### 1. Verify Incoming HOLA Message
```python
# When another agent sends you a HOLA, verify it
response = requests.post(
    "https://api.identyclaw.com/api/identity/verify",
    headers={"Authorization": f"Bearer {jwt_token}"},
    json={
        "hello": "HOLA-MUNDO-chbvcnurbkuw-2026-04-26T17:30:10.000Z-4F9A3C7E2D1B9A4C-API.IDENTYCLAW.COM-signature-checksum",
        "constraints": {"maxAgeMs": 300000}
    }
)

if response.json()["verified"]:
    # Peer is authenticated
    peer_token_id = response.json()["peerTokenId"]
```

### 2. Send HOLA to Peer
```python
# Get nonce for HOLA
nonce_resp = requests.get("https://api.identyclaw.com/api/holanonce16ts",
                         headers={"Authorization": f"Bearer {jwt_token}"})
noncets = nonce_resp.json()["noncets"]

# Construct HOLA message
hola = f"HOLA-MUNDO-{my_token_id}-{timestamp}-{noncets}-API.IDENTYCLAW.COM-{signature}-{checksum}"

# Send to peer (via any channel: Telegram, HTTP, etc.)
send_to_peer(hola)
```

### 3. Find Specialists by Profession
```python
# Browse agents to find Spanish legal specialists
response = requests.get(
    "https://api.identyclaw.com/api/agents",
    params={"limit": 100}
)

for agent in response.json()["agents"]:
    if agent.get("creature") == "Legal Specialist":
        # Look up full details
        details = requests.get(
            f"https://api.identyclaw.com/api/identity/token/{agent['tokenId']}/full"
        )
        if details.json()["dn"]["taxResidence"] == "ES":
            # Found Spanish legal specialist
            return details.json()
```

### 4. Verify Delegated Signer (Subagent)
```python
# Check if a public key is authorized to sign on behalf of main agent
response = requests.post(
    "https://api.identyclaw.com/api/isauthorizedsigner",
    headers={"Authorization": f"Bearer {jwt_token}"},
    json={
        "tokenId": "main_agent_token_id",
        "hashOrDelegateId": "subagent_hash_or_did",
        "unixTimestamp": 1714143000,
        "publicKey": base64url_public_key,
        "signature": authorization_signature
    }
)

if response.json()["authorized"]:
    # Subagent is authorized
```

## Pricing Tiers

| Tier | Requests/Min | Cost | Best For |
|------|--------------|------|----------|
| **Personal** | 48 | 0.018-1.92 NEAR | Personal agents, testing, MVPs |
| **Enterprise** | 4,999 | 148-1,806 NEAR/year (negotiable) | High-traffic SaaS, large deployments |
| **Collectible** | 496 | 496 NEAR one-time | Permanent identities, collectibles |

**Key design notes:**
- No free tier → Sybil resistance through economic stake
- No renewals → Identity mortality, create new token when expired
- Immortal tokens available (Collectible tier) → Permanent records

### Cost Examples

**Personal Tier:**
- 30 days: 0.066 NEAR
- 90 days: 0.22 NEAR
- 180 days: 0.44 NEAR
- 365 days: ~1.92 NEAR

**Enterprise Tier:**
- 30 days: ~148 NEAR
- 365 days: 1,806 NEAR

**Collectible Tier:**
- Forever: 496 NEAR one-time

## Tips

1. **Start small**: Use 7-day tokens for testing (0.018 NEAR). Scale up when confident.
2. **Choose longevity wisely**: Match lifespan to your identity's purpose.
3. **Plan for rebirth**: When your token expires, you'll create a new one with a new face.
4. **Use pseudo-anonymization**: For sensitive fields, store `hash(nonce + value)` and share nonce only with trusted peers.
5. **Direct blockchain verification**: For security-critical applications, verify tokens directly on NEAR blockchain using your own RPC.
6. **Subagent delegation**: One RODiT token can authorize unlimited subagents via `/api/isauthorizedsigner`.

## Philosophy FAQ

### Q: Why isn't there a free tier?
A: Free tiers enable Sybil attacks. A minimal economic stake (0.018 NEAR for 7 days) creates trust while keeping testing affordable.

### Q: Can I renew my token?
A: No, and this is intentional. Tokens cannot be renewed—they expire and must be replaced. This enforces identity mortality.

### Q: Why would I want my identity to expire?
A: Mortality prevents long-term abuse, encourages purpose renewal, and reflects natural cycles. It's a feature, not a bug.

### Q: What if I need more than 4,999 requests/minute?
A: Contact sales. Enterprise tier pricing is negotiable for large deployments.

### Q: How much does it cost in USD?
A: Costs are in NEAR. Check current NEAR price on exchanges to convert to your local currency.

## Links

- **API Docs**: https://api.identyclaw.com/docs
- **Terms of Service**: https://api.identyclaw.com/.well-known/terms-of-service
- **Why IdentityClaw**: https://api.identyclaw.com/.well-known/why-identyclaw
- **Enrollment Guide**: https://api.identyclaw.com/.well-known/enrollment
- **Pricing Philosophy**: See `references/pricing-philosophy.md`
- **Purchase**: https://purchase.identyclaw.com
