# JSON-LD and Semantic Web Integration

RODiT tokens are DID:wba (Web-Based Authentication) compatible with JSON-LD semantic mappings for interoperability with other decentralized identity systems.

## Table of Contents

- [Overview](#overview)
- [JSON-LD Context](#json-ld-context)
- [DN Attribute Mappings](#dn-attribute-mappings)
- [Token Metadata Mappings](#token-metadata-mappings)
- [Contract Metadata](#contract-metadata)
- [Usage Examples](#usage-examples)

## Overview

**Purpose**: Enable semantic interoperability between RODiT tokens and other DID systems without custom parsing logic.

**Benefits**:
- Token metadata can be understood by other DID systems
- Tokens become part of the semantic web with typed properties
- Standardized URIs for all fields
- Automatic type inference (dates, URLs, etc.)

## JSON-LD Context

**Access**: Available via MCP resource `jsonld:context`

The JSON-LD context defines semantic URIs for all token metadata fields and DN attributes.

**Base URI**: `https://rodit.org/context/v1#`

**Example Context Structure**:
```json
{
  "@context": {
    "@version": 1.1,
    "rodit": "https://rodit.org/context/v1#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    
    "token_id": "rodit:tokenId",
    "owner_id": "rodit:ownerId",
    "userselected_dn": "rodit:distinguishedName",
    
    "openapijson_url": {
      "@id": "rodit:openApiJsonUrl",
      "@type": "@id"
    },
    
    "not_after": {
      "@id": "rodit:notAfter",
      "@type": "xsd:dateTime"
    },
    
    "not_before": {
      "@id": "rodit:notBefore",
      "@type": "xsd:dateTime"
    }
  }
}
```

## DN Attribute Mappings

All Distinguished Name attributes are mapped to semantic URIs with appropriate types.

| DN Attribute | JSON-LD Mapping | Type | Description |
|--------------|-----------------|------|-------------|
| `dn_NNSWF` | `rodit:dn_nameNotSharedWithFamily` | `xsd:string` | Given name |
| `dn_NSWF` | `rodit:dn_nameSharedWithFamily` | `xsd:string` | Family name |
| `dn_ContactURI` | `rodit:dn_contactUri` | `@id` | Contact identifier (URI) |
| `dn_taxRes` | `rodit:dn_taxResidence` | `xsd:string` | Tax residence country code |
| `dn_inceptDateTime` | `rodit:dn_inceptDateTime` | `xsd:dateTime` | Birth date/time |
| `dn_inceptPlace` | `rodit:dn_inceptPlace` | `xsd:string` | Birth place (Plus Code) |
| `dn_taxPayer` | `rodit:dn_taxPayerCode` | `xsd:string` | Tax payer ID |
| `dn_address` | `rodit:dn_contactAddress` | `xsd:string` | Contact address (Plus Code) |
| `dn_Creature` | `rodit:dn_creatureDescriptor` | `xsd:string` | Profession/role |
| `dn_AvatarURL` | `rodit:dn_avatarUrl` | `@id` | Avatar image URL |
| `dn_EmojiURL` | `rodit:dn_emojiUrl` | `@id` | Emoji asset URL |

### Type Annotations

- **`@id`**: Field is a URI/URL (e.g., ContactURI, AvatarURL)
- **`xsd:dateTime`**: Field is a timestamp (e.g., inceptDateTime)
- **`xsd:string`**: Field is a plain string (default)

## Token Metadata Mappings

Core RODiT token fields mapped to semantic URIs:

| Token Field | JSON-LD Mapping | Type | Description |
|-------------|-----------------|------|-------------|
| `token_id` | `rodit:tokenId` | `xsd:string` | 12-character token ID |
| `owner_id` | `rodit:ownerId` | `xsd:string` | NEAR account ID |
| `userselected_dn` | `rodit:distinguishedName` | `xsd:string` | RFC 2253 DN |
| `openapijson_url` | `rodit:openApiJsonUrl` | `@id` | OpenAPI spec URL |
| `not_after` | `rodit:notAfter` | `xsd:dateTime` | Expiration date |
| `not_before` | `rodit:notBefore` | `xsd:dateTime` | Start date |
| `max_requests` | `rodit:maxRequests` | `xsd:integer` | Request limit |
| `maxrq_window` | `rodit:maxRequestWindow` | `xsd:integer` | Rate limit window (seconds) |
| `webhook_url` | `rodit:webhookUrl` | `@id` | Webhook endpoint |
| `webhook_cidr` | `rodit:webhookCidr` | `xsd:string` | Webhook IP restrictions |
| `allowed_cidr` | `rodit:allowedCidr` | `xsd:string` | Allowed IP ranges |
| `allowed_iso3166list` | `rodit:allowedIso3166List` | `xsd:string` | Country policy (JSON) |
| `jwt_duration` | `rodit:jwtDuration` | `xsd:integer` | JWT validity (seconds) |
| `permissioned_routes` | `rodit:permissionedRoutes` | `xsd:string` | Route permissions (JSON) |
| `subjectuniqueidentifier_url` | `rodit:subjectUniqueIdentifierUrl` | `@id` | Identity descriptor URL |
| `serviceprovider_id` | `rodit:serviceProviderId` | `xsd:string` | Issuer identifier |
| `serviceprovider_signature` | `rodit:serviceProviderSignature` | `xsd:string` | Issuer signature |

## Contract Metadata

**Access**: Available via MCP resource `jsonld:contract-metadata`

Provides contract information as a JSON-LD document.

**Example**:
```json
{
  "@context": "https://rodit.org/context/v1",
  "@type": "SmartContract",
  "@id": "near:rodit.near",
  "name": "RODiT Token Contract",
  "description": "Rich Online Digital Token for agent identity",
  "blockchain": "NEAR Protocol",
  "network": "mainnet",
  "contractAddress": "rodit.near",
  "standard": "NEP-171",
  "version": "1.0.0"
}
```

## Usage Examples

### Example 1: Token as JSON-LD Document

**Standard RODiT Token**:
```json
{
  "token_id": "bkbvehbdcrgm",
  "owner_id": "abc123...def.near",
  "userselected_dn": "NNSWF=Alice,ContactURI=email:example.com:alice@example.com",
  "not_after": "2027-04-19T00:00:00Z",
  "not_before": "2026-04-19T00:00:00Z",
  "openapijson_url": "https://api.identyclaw.com/openapi.json"
}
```

**With JSON-LD Context**:
```json
{
  "@context": "https://rodit.org/context/v1",
  "@type": "RoditToken",
  "@id": "did:wba:rodit.near:bkbvehbdcrgm",
  "rodit:tokenId": "bkbvehbdcrgm",
  "rodit:ownerId": "abc123...def.near",
  "rodit:distinguishedName": "NNSWF=Alice,ContactURI=email:example.com:alice@example.com",
  "rodit:notAfter": {
    "@type": "xsd:dateTime",
    "@value": "2027-04-19T00:00:00Z"
  },
  "rodit:notBefore": {
    "@type": "xsd:dateTime",
    "@value": "2026-04-19T00:00:00Z"
  },
  "rodit:openApiJsonUrl": {
    "@id": "https://api.identyclaw.com/openapi.json"
  }
}
```

### Example 2: DN Attributes as Linked Data

**Standard DN**:
```
NNSWF=Alice,NSWF=Smith,ContactURI=email:example.com:alice@example.com,taxRes=US,Creature=Legal Specialist
```

**As JSON-LD**:
```json
{
  "@context": "https://rodit.org/context/v1",
  "@type": "DistinguishedName",
  "rodit:dn_nameNotSharedWithFamily": "Alice",
  "rodit:dn_nameSharedWithFamily": "Smith",
  "rodit:dn_contactUri": {
    "@id": "email:example.com:alice@example.com"
  },
  "rodit:dn_taxResidence": "US",
  "rodit:dn_creatureDescriptor": "Legal Specialist"
}
```

### Example 3: DID Document

**DID**: `did:wba:rodit.near:bkbvehbdcrgm`

**DID Document**:
```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://rodit.org/context/v1"
  ],
  "id": "did:wba:rodit.near:bkbvehbdcrgm",
  "controller": "did:wba:rodit.near:bkbvehbdcrgm",
  "verificationMethod": [
    {
      "id": "did:wba:rodit.near:bkbvehbdcrgm#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:wba:rodit.near:bkbvehbdcrgm",
      "publicKeyMultibase": "z6Mk..."
    }
  ],
  "authentication": [
    "did:wba:rodit.near:bkbvehbdcrgm#key-1"
  ],
  "service": [
    {
      "id": "did:wba:rodit.near:bkbvehbdcrgm#api",
      "type": "IdentityClawAPI",
      "serviceEndpoint": "https://api.identyclaw.com"
    }
  ],
  "rodit:tokenId": "bkbvehbdcrgm",
  "rodit:ownerId": "abc123...def.near",
  "rodit:distinguishedName": "NNSWF=Alice,ContactURI=email:example.com:alice@example.com"
}
```

### Example 4: Querying with SPARQL

With JSON-LD context, tokens can be queried using SPARQL:

```sparql
PREFIX rodit: <https://rodit.org/context/v1#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?token ?name ?creature
WHERE {
  ?token rodit:dn_nameNotSharedWithFamily ?name .
  ?token rodit:dn_creatureDescriptor ?creature .
  ?token rodit:notAfter ?expiry .
  FILTER(?expiry > "2026-04-19T00:00:00Z"^^xsd:dateTime)
  FILTER(?creature = "Legal Specialist")
}
```

## Benefits for Agents

### 1. Automatic Type Inference

Agents can automatically determine field types without custom parsing:

```javascript
// With JSON-LD context, agents know:
// - openapijson_url is a URL (can be dereferenced)
// - not_after is a dateTime (can be parsed/compared)
// - ContactURI is a URI (can be resolved)
```

### 2. Semantic Interoperability

Tokens can be understood by other DID systems:

```javascript
// Other DID systems can map:
// rodit:dn_nameNotSharedWithFamily → schema:givenName
// rodit:dn_nameSharedWithFamily → schema:familyName
// rodit:dn_contactUri → schema:contactPoint
```

### 3. Linked Data Integration

Tokens become part of the semantic web:

```javascript
// Agents can follow links:
// rodit:openApiJsonUrl → Dereference to get API spec
// rodit:dn_avatarUrl → Dereference to get avatar image
// rodit:subjectUniqueIdentifierUrl → Dereference to get identity descriptor
```

### 4. Schema Validation

JSON-LD enables automatic schema validation:

```javascript
// Validate that:
// - not_after is a valid dateTime
// - openapijson_url is a valid URL
// - max_requests is an integer
```

## Accessing JSON-LD Resources

### Via MCP

```bash
# Get JSON-LD context
GET /api/mcp/resource/jsonld:context

# Get contract metadata
GET /api/mcp/resource/jsonld:contract-metadata
```

### Via DID Resolution

```bash
# Resolve DID to get DID document with JSON-LD context
GET /.well-known/did/resolve?token_id=bkbvehbdcrgm
```

## Next Steps

- [Learn authentication flows](authentication.md)
- [Understand token metadata](token-metadata.md)
- [Explore API endpoints](api-reference.md)
- [Return to main guide](../skills.md)
