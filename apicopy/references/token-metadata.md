# RODiT Token Metadata

Complete reference for RODiT (Rich Online Digital Token) metadata fields, facial encoding, and DN attributes.

## Table of Contents

- [Overview](#overview)
- [Distinguished Name (DN)](#distinguished-name-dn)
- [Facial Token ID Encoding](#facial-token-id-encoding)
- [Token Metadata Fields](#token-metadata-fields)
- [Token Profiles](#token-profiles)
- [API Endpoints](#api-endpoints)

## Overview

RODiT tokens on NEAR blockchain contain comprehensive metadata for:
- API access control
- Identity representation
- Rate limiting
- Geographic restrictions
- Webhook configuration

## Distinguished Name (DN)

The `userselected_dn` field uses RFC 2253-style format with custom attributes for structured identity information.

### Format

```
NNSWF=NameNotSharedWithFamily,NSWF=NameSharedWithFamily,ContactURI=scheme:authority:identifier,...
```

### Supported Attributes

| Attribute | Required | Description | Example |
|-----------|----------|-------------|---------|
| **NNSWF** | **Yes** | Name Not Shared With Family | `Alice` |
| NSWF | No | Name Shared With Family | `Smith` |
| ContactURI | No | Generic identifier | `twitter:x.com:alice` |
| taxRes | No | Tax residence country (ISO 3166-1 alpha-2) | `US`, `GB`, `DE` |
| inceptDateTime | No | Birth date/time (GeneralizedTime) | `19900315120000Z` |
| inceptPlace | No | Birth place (Plus Code) | `9F4MGCH7+R6` |
| taxPayer | No | Tax payer ID | `123-45-6789` |
| address | No | Contact address (Plus Code) | `87G8Q23F+XF` |
| Creature | No | Profession/role descriptor | `Legal Specialist`, `AI Agent` |
| AvatarURL | No | Avatar media URL | `https://example.com/avatar.png` |
| EmojiURL | No | Emoji asset URL | `https://example.com/emoji.svg` |

### ContactURI Format

Format: `scheme:authority:identifier`

**Examples**:
- **Email**: `email:example.com:identyclaw@example.com`
- **Twitter/X**: `twitter:x.com:username`
- **Telegram**: `telegram:telegram.com:username`
- **Phone**: `phone:ES:34683493049`
- **LinkedIn**: `linkedin:linkedin.com:userid`
- **GitHub**: `github:github.com:username`

### DN Examples

**Minimal** (required only):
```
NNSWF=Alice
```

**With contact info**:
```
NNSWF=John,NSWF=Smith,ContactURI=email:example.com:john@example.com,taxRes=US
```

**AI Agent**:
```
NNSWF=ClientApp,ContactURI=email:example.com:identyclaw@example.com,taxRes=US,Creature=Friendly Bot
```

**Full example**:
```
NNSWF=Jane,NSWF=Doe,ContactURI=email:example.com:jane@example.com,taxRes=GB,inceptDateTime=19900315120000Z,inceptPlace=9F4MGCH7+R6,Creature=Data Analyst,AvatarURL=https://example.com/avatar.png
```

### Validation Rules

- **Maximum DN length**: 1024 bytes
- **Only `NNSWF` is required**
- **RFC 2253 special characters** must be escaped with backslash: `, + " \ < > ; = #`
- **Unknown attributes allowed** for extensibility

### Creature Field as Yellow Pages

The `Creature` field functions as a lightweight Yellow Pages for agent discovery:

**Purpose**: Enable other agents to find specialists by profession

**Examples**:
- `Legal Specialist`
- `Data Analyst`
- `SRE Engineer`
- `Compliance Officer`
- `Translator`
- `Majordomo`
- `Research Agent`
- `Security Auditor`

**Discovery**: Use `GET /api/agents?creature=Legal+Specialist` to filter by profession

---

## Facial Token ID Encoding

Each RODiT `token_id` is a 12-character lowercase ASCII string encoding facial features.

### Format

**Structure**: 11 category indices + 1 checksum letter

**Example**: `bkbvehbdcrgm`
- Positions 0-10: Facial feature categories
- Position 11: Checksum

### Category Order

| Position | Category | Values | Range |
|----------|----------|--------|-------|
| 0 | Skin tones | 19 | a-s |
| 1 | Regional bone structure | 12 | a-l |
| 2 | Face shape | 15 | a-o |
| 3 | Age-related | 5 | a-e |
| 4 | Eyes | 10 | a-j |
| 5 | Eyebrow style | 6 | a-f |
| 6 | Overall structure | 2 | a-b |
| 7 | Nose | 6 | a-f |
| 8 | Lips | 5 | a-e |
| 9 | Skin conditions | 6 | a-f |
| 10 | Hair color | 11 | a-k |
| 11 | Checksum | 26 | a-z |

### Category Details

#### 0. Skin Tones (a-s, 19 values)
- `a` = pale-skinned
- `b` = fair-skinned
- `c` = light-skinned
- `d` = medium-light-skinned
- `e` = medium-skinned
- `f` = olive-skinned
- `g` = tan-skinned
- `h` = brown-skinned
- `i` = dark-brown-skinned
- `j` = deep-brown-skinned
- `k` = black-skinned
- `l` = porcelain-skinned
- `m` = ivory-skinned
- `n` = beige-skinned
- `o` = golden-skinned
- `p` = bronze-skinned
- `q` = mahogany-skinned
- `r` = ebony-skinned
- `s` = blue-gray-skinned

#### 1. Regional Bone Structure (a-l, 12 values)
- `a` = Nordic
- `b` = Mediterranean
- `c` = East-Asian
- `d` = Sub-Saharan-African
- `e` = South-Asian
- `f` = Middle-Eastern
- `g` = Native-American
- `h` = Pacific-Islander
- `i` = Central-Asian
- `j` = Southeast-Asian
- `k` = Aboriginal-Australian
- `l` = Mixed-ancestry

#### 2. Face Shape (a-o, 15 values)
- `a` = oval-faced
- `b` = round-faced
- `c` = square-faced
- `d` = heart-shaped-face
- `e` = diamond-faced
- `f` = triangular-faced
- `g` = oblong-faced
- `h` = rectangular-faced
- `i` = pear-shaped-face
- `j` = trapezoid-faced
- `k` = hexagonal-faced
- `l` = pentagonal-faced
- `m` = asymmetric-faced
- `n` = angular-faced
- `o` = soft-featured

#### 3. Age-Related (a-e, 5 values)
- `a` = teenage-person
- `b` = young-adult
- `c` = middle-aged
- `d` = senior
- `e` = elderly

#### 4. Eyes (a-j, 10 values)
- `a` = small-eyes
- `b` = large-eyes
- `c` = almond-eyes
- `d` = round-eyes
- `e` = hooded-eyes
- `f` = monolid-eyes
- `g` = deep-set-eyes
- `h` = close-set-eyes
- `i` = wide-set-eyes
- `j` = protruding-eyes

#### 5. Eyebrow Style (a-f, 6 values)
- `a` = thick-eyebrows
- `b` = thin-eyebrows
- `c` = arched-eyebrows
- `d` = straight-eyebrows
- `e` = bushy-eyebrows
- `f` = sparse-eyebrows

#### 6. Overall Structure (a-b, 2 values)
- `a` = masculine
- `b` = feminine

#### 7. Nose (a-f, 6 values)
- `a` = aquiline-nose
- `b` = button-nose
- `c` = flat-nose
- `d` = roman-nose
- `e` = snub-nose
- `f` = hooked-nose

#### 8. Lips (a-e, 5 values)
- `a` = thin-lips
- `b` = full-lips
- `c` = wide-lips
- `d` = narrow-lips
- `e` = bow-shaped-lips

#### 9. Skin Conditions (a-f, 6 values)
- `a` = freckled
- `b` = moles
- `c` = acne-scarred
- `d` = smooth-skin
- `e` = wrinkled
- `f` = birthmarked

#### 10. Hair Color (a-k, 11 values)
- `a` = black-hair
- `b` = brown-hair
- `c` = blonde-hair
- `d` = red-hair
- `e` = gray-hair
- `f` = white-hair
- `g` = auburn-hair
- `h` = chestnut-hair
- `i` = platinum-hair
- `j` = silver-hair
- `k` = bald

### Example Decoding

**Token ID**: `aaaaaaaaaaaa`

| Position | Letter | Category | Value |
|----------|--------|----------|-------|
| 0 | `a` | Skin tone | pale-skinned |
| 1 | `a` | Bone structure | Nordic |
| 2 | `a` | Face shape | oval-faced |
| 3 | `a` | Age | teenage-person |
| 4 | `a` | Eyes | small-eyes |
| 5 | `a` | Eyebrows | thick-eyebrows |
| 6 | `a` | Structure | masculine |
| 7 | `a` | Nose | aquiline-nose |
| 8 | `a` | Lips | thin-lips |
| 9 | `a` | Skin | freckled |
| 10 | `a` | Hair | black-hair |
| 11 | `a` | Checksum | (validates sum) |

### Checksum Calculation

```javascript
// Sum indices (letter - 'a') for positions 0-10
let sum = 0;
for (let i = 0; i < 11; i++) {
  sum += token_id.charCodeAt(i) - 'a'.charCodeAt(0);
}

// Checksum is sum modulo 26
const checksum_index = sum % 26;
const checksum_letter = String.fromCharCode('a'.charCodeAt(0) + checksum_index);
```

**Example**:
- Token ID: `aaaaaaaaaaaa`
- Sum: 0 + 0 + 0 + 0 + 0 + 0 + 0 + 0 + 0 + 0 + 0 = 0
- Checksum: 0 % 26 = 0 → `a`

---

## Token Metadata Fields

RODiT tokens contain comprehensive API access control metadata:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `openapijson_url` | URL | OpenAPI specification URL | `https://api.identyclaw.com/openapi.json` |
| `not_after` | ISO 8601 | Expiration date (`1970-01-01` = no limit) | `2027-04-19T00:00:00Z` |
| `not_before` | ISO 8601 | Start date | `2026-04-19T00:00:00Z` |
| `max_requests` | String | Request limit (`0` = unlimited) | `1000` or `0` |
| `maxrq_window` | String | Time window for rate limits (seconds) | `3600` |
| `webhook_url` | URL | Webhook endpoint for notifications | `https://example.com/webhook` |
| `webhook_cidr` | String | IP restrictions for webhook | `192.168.1.0/24` |
| `allowed_cidr` | String | Allowed IP ranges for API access | `0.0.0.0/0` |
| `allowed_iso3166list` | JSON | Country policy | `{"allow":["WLD"]}` |
| `jwt_duration` | String | JWT validity period in seconds (`0` = unlimited) | `3600` |
| `permissioned_routes` | JSON | Entity/method permissions | `{"/api/identity":"+0"}` |
| `subjectuniqueidentifier_url` | URL | Stable identity descriptor URL | `https://example.com/identity` |
| `serviceprovider_id` | String | Issuing service identifier | `bc=near.org;sc=rodit.near;id=abc` |
| `serviceprovider_signature` | String | Issuer's signature over fee/issuance data | `base64_signature` |

### Geographic Restrictions (`allowed_iso3166list`)

**Format**: JSON object with `allow` array

**Examples**:

**Worldwide access**:
```json
{"allow": ["WLD"]}
```

**Specific countries only**:
```json
{"allow": ["US", "GB", "DE"]}
```

**Worldwide except specific countries**:
```json
{"allow": ["US", "GB", "WLD", "RU", "BY"]}
```
- Countries before `WLD` = allow list
- Countries after `WLD` = deny list

**Behavior**: When `WLD` is the only content, geolocation checks are skipped entirely.

### Permissioned Routes

**Format**: JSON object mapping routes to access levels

**Examples**:

**Unlimited access**:
```json
{"/api/identity": "+0"}
```

**Limited requests**:
```json
{"/api/identity": "+100"}
```

**Scoped access**:
```json
{
  "/api/identity": {
    "scopes": ["entityAndProperties", "propertiesOnly"],
    "limit": "+0"
  }
}
```

---

## Token Profiles

### Root RODiT (mint root)

**Environment**: Private server/network

**Purpose**: Top-level authority for minting server tokens

**Defaults**:
- `not_after`: `1970-01-01` (no expiration)
- `max_requests`: `0` (unlimited)
- `jwt_duration`: `0` (unlimited)
- `allowed_iso3166list`: `{"allow":["WLD"]}` (worldwide)

**Use Case**: Mint server tokens for client token issuance

### Server RODiT (mint server)

**Environment**: Private network

**Purpose**: Server-side authorization for client token issuance

**Defaults**:
- `jwt_duration`: `3600` (1 hour)
- `max_requests`: Inherited from root
- `serviceprovider_id`: Inherited from root

**Use Case**: Sign client token requests via `/api/signclient`

### Client RODiT (mint client)

**Environment**: Public Internet

**Purpose**: End-client API consumer with routing and limits

**Defaults**:
- `max_requests`: Numeric value (e.g., `1000`)
- `maxrq_window`: `3600` (1 hour)
- `jwt_duration`: `3600` (1 hour)
- `allowed_iso3166list`: Specific countries or worldwide
- `permissioned_routes`: Specific routes with limits

**Use Case**: Agent authentication and API access

---

## API Endpoints

### Get Your Own Identity

**Endpoint**: `GET /api/me/identity`

**Auth**: Required (JWT)

**Response**:
```json
{
  "token_id": "bkbvehbdcrgm",
  "owner_id": "abc123...def.near",
  "userselected_dn": "NNSWF=Alice,ContactURI=email:example.com:alice@example.com",
  "facial_description": "pale-skinned Nordic oval-faced teenage-person...",
  "metadata": {
    "openapijson_url": "https://api.identyclaw.com/openapi.json",
    "not_after": "2027-04-19T00:00:00Z",
    ...
  }
}
```

### Get Any Token Metadata

**Endpoint**: `GET /api/identity/token/{tokenId}/full`

**Auth**: Required (JWT)

**Response**: Same as `/api/me/identity`

### List All Agents

**Endpoint**: `GET /api/agents`

**Auth**: Not required (public)

**Query Parameters**:
- `limit` (default: 50, max: 100)
- `offset` (default: 0)
- `creature` (filter by profession)

**Response**:
```json
{
  "agents": [
    {
      "token_id": "bkbvehbdcrgm",
      "owner_id": "abc123...def.near",
      "userselected_dn": "NNSWF=Alice,Creature=Legal Specialist",
      "facial_description": "pale-skinned Nordic oval-faced..."
    }
  ],
  "total": 1234,
  "limit": 50,
  "offset": 0
}
```

---

## Next Steps

- [Learn authentication flows](authentication.md)
- [View JSON-LD integration](jsonld.md)
- [Explore API endpoints](api-reference.md)
- [Return to main guide](../skills.md)
