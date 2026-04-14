# idclawserver Skills

This file describes high-level capabilities that can be exposed to AI agents via MCP.

- **get_noncets**  
  Protected endpoint to obtain a strong random timestamp+noncets composite (NOT a simple nonce) for challenge–response protocols. Returns `noncets` and `timestamp` fields for constructing HOLA handshake messages.  
  HTTP: `GET /api/noncets` (requires Bearer authentication)

- **lookup_identity_by_token**  
  Protected endpoint to fetch the public identity/persona for a given `token_id`, including parsed `userselected_dn_info` with contactUri, displayName, and name attributes.  
  HTTP: `GET /api/identity/token/{tokenId}` (requires Bearer authentication)

- **get_my_identity**  
  Protected endpoint for self-identification only. Returns the caller's own identity based on their authenticated RODiT token, including full metadata with parsed Distinguished Name attributes. Derives the caller's tokenId from the JWT sub field. For looking up other agents' identities, use `lookup_identity_by_token`.  
  HTTP: `GET /api/me/identity` (self-identification only)

- **verify_agent_identity**  
  Protected endpoint that verifies another agent's identity using off-band evidence and mutual authentication. Validates HOLA handshake format with Ed25519 signature verification. Security: hello string limited to 512 characters, user-based rate limiting enforced.  
  HTTP: `POST /api/identity/verify`

- **mint_client_rodit**  
  Public endpoint to request minting of a client RODiT token for a service provider via SignPortal, validating requested permissions and minting fee.  
  HTTP: `POST /api/signclient`

- **get_policies**  
  Public endpoints to retrieve service policies for compliance evaluation before becoming a customer. HTTP discovery covers the legal documents while detailed service metadata is exposed via MCP resources.  
  HTTP: `GET /.well-known/terms-of-service`, `GET /.well-known/privacy-policy`, `GET /.well-known/data-retention`  
  MCP: `policy:terms`, `policy:privacy`, `policy:data-retention`, `policy:service-info`

- **resolve_did_document**  
  Protected DID resolution for paid customers. Returns DID documents for `did:rodit` and `did:web` identifiers and advertises MCP discovery as the canonical service lookup.  
  HTTP: `GET /.well-known/did/rodit/{tokenId}`, `GET /.well-known/did/web/token/{tokenId}`, `GET /.well-known/did/web/token/{tokenId}/did.json`, `GET /.well-known/did/resolve?did=<did>` (all require Bearer authentication)

- **setup_near_account**  
  Onboarding guide for AI agents that need a NEAR implicit account before minting a RODiT token. Covers installing near-cli-rs, generating an Ed25519 keypair, deriving the implicit account address, and obtaining NEAR tokens (testnet faucets and mainnet exchanges).  
  MCP: `onboarding:near`  
  HTTP: `GET /api/mcp/resource/onboarding:near`

- **get_jsonld_context**  
  DID:wba JSON-LD context vocabulary for RODiT tokens. Defines semantic mappings for all token metadata fields and Distinguished Name attributes, enabling interoperability with other DID systems.  
  MCP: `jsonld:context` (application/ld+json)  
  HTTP: `GET /api/mcp/resource/jsonld:context`

- **get_contract_metadata**  
  Smart contract metadata as a fully-formed JSON-LD document with embedded context. Provides contract version, name, symbol, and issuer information for discovery and verification.  
  MCP: `jsonld:contract-metadata` (application/ld+json)  
  HTTP: `GET /api/mcp/resource/jsonld:contract-metadata`

- **parse_distinguished_name**  
  Protected endpoint that parses RFC 2253 Distinguished Name into structured attributes. Returns raw DN string, parsed fields (nameNotSharedWithFamily, nameSharedWithFamily, displayName, contactUri, taxResidence, etc.), and all attributes as key-value pairs.  
  HTTP: `GET /api/identity/token/{tokenId}/dn` (requires Bearer authentication)

---

## RODiT Token Metadata Capabilities

RODiT (Rich Online Digital Token) tokens on NEAR blockchain contain comprehensive metadata for API access control and identity representation. Understanding these capabilities helps agents leverage the full power of the identity system.

### Distinguished Name (`userselected_dn`)

The `userselected_dn` field uses RFC 2253-style format with custom attributes for structured identity information:

**Format**: `NNSWF=NameNotSharedWithFamily,NSWF=NameSharedWithFamily,ContactURI=scheme:authority:identifier,...`

**Supported Attributes**:

| Attribute | Required | Description | Example |
|-----------|----------|-------------|---------|
| **NNSWF** | **Yes** | Name Not Shared With Family  | `Alice` |
| NSWF | No | Name Shared With Family  | `Smith` |
| ContactURI | No | Generic identifier | `twitter:x.com:alice`, `email:example.com:identyclaw@example.com` |
| taxRes | No | Tax residence country (ISO 3166-1 alpha-2) | `US`, `GB`, `DE` |
| inceptDateTime | No | Incept date/time (GeneralizedTime) | `19900315120000Z` |
| inceptPlace | No | Incept place (Plus Code) | `9F4MGCH7+R6` |
| taxPayer | No | Tax payer ID | `123-45-6789` |
| address | No | Contact address (Plus Code) | `87G8Q23F+XF` |
| Creature | No | Descriptive label | `Friendly Bot`, `AI Agent` |
| AvatarURL | No | Avatar media URL | `https://example.com/avatar.png` |
| EmojiURL | No | Emoji asset URL | `https://example.com/emoji.svg` |

**ContactURI Format**: `scheme:authority:identifier`
- Twitter/X: `twitter:x.com:username`
- Email: `email:example.com:identyclaw@example.com`
- Telegram: `telegram:telegram.com:username`
- Phone: `phone:ES:34683493049`
- LinkedIn: `linkedin:linkedin.com:userid`
- GitHub: `github:github.com:username`

**Examples**:
```
# Minimal (required only)
NNSWF=Alice

# With contact info
NNSWF=John,NSWF=Smith,ContactURI=email:example.com:john@example.com,taxRes=US

# AI Agent example
NNSWF=ClientApp,ContactURI=email:example.com:identyclaw@example.com,taxRes=US,Creature=Friendly Bot
```

**Validation Rules**:
- Maximum DN length: 1024 bytes
- Only `NNSWF` is required
- RFC 2253 special characters (`, + " \ < > ; = #`) must be escaped with backslash
- Unknown attributes allowed for extensibility

### Facial Token ID Encoding

Each RODiT `token_id` is a 12-character lowercase ASCII string encoding facial features:

**Format**: 11 category indices + 1 checksum letter

**Category Order** (positions 0-10):
0. `skin_tones` (19 values: a-s)
1. `regional_bone_structure` (12 values: a-l)
2. `face_shape` (15 values: a-o)
3. `age_related` (5 values: a-e)
4. `eyes` (10 values: a-j)
5. `eyebrow_style` (6 values: a-f)
6. `overall_structure` (2 values: a-b for masculine/feminine)
7. `nose` (6 values: a-f)
8. `lips` (5 values: a-e)
9. `skin_conditions` (6 values: a-f)
10. `hair_color` (11 values: a-k)

**Example Decoding**:
- Token ID: `aaaaaaaaaaaa`
  - Skin tone: `a` = pale-skinned
  - Bone structure: `a` = Nordic
  - Face shape: `a` = oval-faced
  - Age: `a` = teenage-person
  - Eyes: `a` = small-eyes
  - Eyebrows: `a` = thick-eyebrows
  - Structure: `a` = masculine
  - Nose: `a` = aquiline-nose
  - Lips: `a` = thin-lips
  - Skin: `a` = freckled
  - Hair: `a` = black-hair
  - Checksum: `a` (validates sum of indices)

**Checksum Calculation**:
```
sum_indices = Σ(token_id[i] - 'a') for i in 0..10
checksum_index = sum_indices % 26
checksum_letter = 'a' + checksum_index
```

### Token Metadata Fields

RODiT tokens contain comprehensive API access control metadata:

- **`openapijson_url`**: OpenAPI specification URL for the API
- **`not_after`**: Expiration date (ISO 8601 or `1970-01-01` for no limit)
- **`not_before`**: Start date (ISO 8601)
- **`max_requests`**: Request limit (numeric string, `0` = unlimited)
- **`maxrq_window`**: Time window for rate limits (seconds)
- **`webhook_url`**: Webhook endpoint for notifications
- **`webhook_cidr`**: IP restrictions for webhook
- **`allowed_cidr`**: Allowed IP ranges for API access
- **`allowed_iso3166list`**: JSON country policy, e.g., `{"allow":["WLD"]}`
- **`jwt_duration`**: JWT validity period in seconds (`0` = unlimited)
- **`permissioned_routes`**: JSON describing entity/method permissions
- **`subjectuniqueidentifier_url`**: Stable identity descriptor URL
- **`serviceprovider_id`**: Issuing service identifier (format: `bc=near.org;sc=contract.near;id=token_id`)
- **`serviceprovider_signature`**: Issuer's signature over fee/issuance data

### Token Profiles

**Root RODiT** (mint root):
- Environment: Private server/network
- Purpose: Top-level authority
- Defaults: No limits (`not_after=1970-01-01`, `max_requests=0`, `jwt_duration=0`)

**Server RODiT** (mint server):
- Environment: Private network
- Purpose: Server-side authorization for client token issuance
- Defaults: `jwt_duration=3600`, inherits serviceprovider_id from root

**Client RODiT** (mint client):
- Environment: Public Internet
- Purpose: End-client API consumer with actual routing and limits
- Defaults: Numeric `max_requests`, `maxrq_window`, `jwt_duration=3600`

### API Endpoints for Metadata Access

- **`GET /api/identity/token/{tokenId}`**: Returns full token metadata including parsed `userselected_dn_info` with `contactUri`, `displayName`, and `name` attributes
- **`GET /api/identity/token/{tokenId}/dn`**: Returns parsed Distinguished Name attributes in structured format (nameNotSharedWithFamily, nameSharedWithFamily, displayName, contactUri, taxResidence, inceptDateTime, inceptPlace, taxPayerCode, address, creature, avatarUrl, emojiUrl)
- **`GET /api/identity/face/{tokenId}`**: Returns decoded facial features from token_id encoding
- **`GET /api/me/identity`**: Returns authenticated agent's own token metadata
- **`GET /api/me/face`**: Returns authenticated agent's own facial features

### JSON-LD and Semantic Web Integration

RODiT tokens are DID:wba (Web-Based Authentication) compatible with JSON-LD semantic mappings:

- **JSON-LD Context**: Available via MCP resource `jsonld:context` - defines semantic URIs for all token metadata fields and DN attributes
- **Contract Metadata**: Available via MCP resource `jsonld:contract-metadata` - provides contract information as a JSON-LD document
- **Semantic Interoperability**: Token metadata can be understood by other DID systems without custom parsing logic
- **Linked Data**: Tokens become part of the semantic web with typed properties (e.g., dates as `XMLSchema#date`, URLs as `@id`)

**DN Attribute Mappings** (from JSON-LD context):
- `dn_NNSWF` → `rodit:dn_nameNotSharedWithFamily`
- `dn_NSWF` → `rodit:dn_nameSharedWithFamily`
- `dn_ContactURI` → `rodit:dn_contactUri` (typed as `@id`)
- `dn_taxRes` → `rodit:dn_taxResidence`
- `dn_inceptDateTime` → `rodit:dn_inceptDateTime` (typed as `dateTime`)
- `dn_inceptPlace` → `rodit:dn_inceptPlace` (Plus Code)
- `dn_taxPayer` → `rodit:dn_taxPayerCode`
- `dn_address` → `rodit:dn_contactAddress` (Plus Code)
- `dn_Creature` → `rodit:dn_creatureDescriptor`
- `dn_AvatarURL` → `rodit:dn_avatarUrl` (typed as `@id`)
- `dn_EmojiURL` → `rodit:dn_emojiUrl` (typed as `@id`)
