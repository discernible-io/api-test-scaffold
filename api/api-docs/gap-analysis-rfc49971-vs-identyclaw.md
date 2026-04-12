# Gap Analysis: OpenClaw RFC #49971 vs. IDENTYCLAW Implementation

**Date**: 2026-04-12
**RFC**: [openclaw/openclaw#49971 — Native Agent Identity & Trust Verification](https://github.com/openclaw/openclaw/issues/49971)
**Implementation**: IDENTYCLAW API (`idclawserver-rodit`) + NEAR Smart Contract (`mintrsidclawcontract-rodit`)
**Reference**: [Terms of Service §9 — Services NOT Provided](../public/policies/terms-of-service.md)

---

## Executive Summary

IDENTYCLAW already provides a **production-grade Layer 1 (Identity)** and **partial Layer 2 (Authorization)** of the trust stack described in RFC #49971. The RFC's four "Services NOT Provided" in the ToS — audit mechanisms, regulatory compliance, verifiable credentials, and reputation scoring — map precisely to the layers IDENTYCLAW deliberately excludes. This gap analysis identifies what is already built, what is architecturally adjacent, and what would require new development.

---

## 1. Capability Mapping

### What IDENTYCLAW Already Provides

| RFC Capability | IDENTYCLAW Implementation | Component |
|---|---|---|
| **Agent Identity** | RODiT tokens on NEAR blockchain with Ed25519-signed metadata | Contract: `rodit_mint`, `TokenMetadata` |
| **DID Support** | DID:wba JSON-LD context embedded in contract metadata | Contract: `DID_WBA_JSON_LD`, `rodit_metadata_jsonld()` |
| **Identity Verification** | `POST /api/identity/verify` — Ed25519 signature verification of hello messages (token existence, signature validity, timestamp freshness, checksum) | API: `identity.protected.routes.js` |
| **Mutual Authentication** | Cryptographic hello protocol: `API.IDENTYCLAW.COM:<tokenId>:<timestamp>:<noncets>:<signature>:<checksum>` | API + SDK: `authentication.js` |
| **Agent Discovery** | `GET /api/agents` — paginated list of public agents from NEAR | API: `identity.protected.routes.js` |
| **Self-Identity** | `GET /api/me/identity` — JWT-derived identity lookup | API: `identity.protected.routes.js` |
| **MCP Integration** | Machine-readable capabilities via `/api/mcp/*` (tools, resources, schema) | API: `mcp.public.routes.js` |
| **Rate Limiting** | Per-account minting limits (contract) + per-user API rate limits (server) | Contract: `check_and_update_rate_limit` / API: `user-rate-limit.js` |
| **Token Lifecycle** | Mint, transfer, burn, recover with on-chain events (NEP-297) | Contract: `rodit_mint`, `rodit_transfer`, `rodit_burn`, `recover_token` |
| **Fee Signature Verification** | Ed25519 signature verification with canonicalized JSON + SHA-512 | Contract: `verify_fee_signature` |
| **Permission Scoping** | `permissioned_routes` metadata field — route-level authorization | Contract metadata + API: `signclient.public.routes.js` |
| **Session Management** | JWT-based sessions with list/cleanup/revoke | API: `session.privileged.routes.js` |
| **Service Metadata / Policies** | `/.well-known/*` endpoints for ToS, privacy policy, service metadata | API: `policies.public.routes.js` |

### What RFC #49971 Proposes That Maps to ToS §9 "NOT Provided"

| RFC Proposed Layer | ToS §9 Exclusion | Gap Status |
|---|---|---|
| Trust score (0–100, letter grades A–F) | **Reputation Scoring** — "does not evaluate, score, or provide any assessment of whether agents can be trusted" | **Full gap** |
| Verifiable Credentials (W3C VC) | **Verifiable Credentials** — "identity information declared by agents is self-declared and NOT verified" | **Full gap** |
| Audit trail (Signet-style hash-chained logs) | **Audit Mechanisms** — "does not provide comprehensive tracking, logging, or audit trails beyond authentication events" | **Full gap** |
| EU AI Act compliance (Article 12, Article 50) | **Regulatory Compliance** — "does not guarantee alignment with emerging AI regulations" | **Full gap** |

---

## 2. Detailed Gap Analysis by RFC Layer

### Layer 1: Identity — ✅ COVERED

IDENTYCLAW provides **cryptographic agent identity** through RODiT tokens on NEAR:

- **Ed25519 keypairs** bound to NEAR accounts (same primitive as RFC's `did:agentnexus` and TrustChain)
- **On-chain metadata**: `serviceprovider_id`, `serviceprovider_signature`, `userselected_dn`, `subjectuniqueidentifier_url`
- **DID:wba JSON-LD** context for semantic interoperability
- **Token existence verification** via `/api/identity/verify`

**Gap within this layer**: No `did:moltrust`, `did:agentnexus`, or `did:web` resolution. IDENTYCLAW uses its own token-based identity rather than W3C DID method resolution. Bridging would require a DID resolver adapter.

### Layer 2: Authorization — ✅ PARTIALLY COVERED

- **`permissioned_routes`**: route-level permission scoping enforced at minting time
- **`not_before` / `not_after`**: temporal validity bounds
- **`max_requests` / `maxrq_window`**: rate-limit constraints baked into token metadata
- **`allowed_cidr` / `allowed_iso3166list`**: network and geographic constraints
- **`jwt_duration`**: session lifetime limits
- **SDK `LOGIN_MODE`**: partner/peer/promiscuous authentication modes

**Gap**: No equivalent to MolTrust's **Agent Authorization Envelope (AAE)** with MANDATE + CONSTRAINTS + VALIDITY blocks. Delegation is implicit (serviceprovider signs token) rather than explicit, scoped, and chain-verifiable. No sub-delegation or delegation depth limits.

### Layer 3: Reputation — ❌ NOT PROVIDED (ToS §9)

The RFC's core proposal — `onAgentVerify` returning a trust score — has no equivalent. IDENTYCLAW:

- Does **not** compute trust scores
- Does **not** track behavioral history across sessions
- Does **not** implement graph-based reputation (TrustChain NetFlow/MeritRank)
- Does **not** support trust score import from external providers (MolTrust, APS)

**Architectural proximity**: The `/api/identity/verify` endpoint already returns a structured `checks` object (`tokenExists`, `tokenActive`, `signatureValid`, `timestampFresh`, `checksumValid`). This is a **binary verification result** — extending it to return a score would be the natural integration point for a trust provider plugin.

### Layer 4: Output Verification — ❌ NOT PROVIDED

No equivalent to VeroQ Shield's claim extraction and evidence matching. Out of scope for an identity/auth API.

### Layer 5: Runtime Policy — ⚠️ PARTIAL

- **Rate limiting** exists at both contract level (minting) and API level (per-user)
- **Permission validation** at signing time checks requested routes against config
- No equivalent to MoltGuard's action conflict detection or SARA's sequential intent auditing

### Layer 6: Audit — ❌ NOT PROVIDED (ToS §9)

- Contract emits **NEP-297 events** (`rodit_mint`, `rodit_transfer`, `rodit_burn`, `rodit_recover`, etc.) — these are on-chain and permanent
- API has **operational metrics** (`/api/metrics`) but these are for system health, not agent activity audit
- No hash-chained audit trail (Signet-style)
- No bilateral signed interaction records (TrustChain-style)

**Architectural proximity**: The on-chain NEP-297 events provide a tamper-evident log of token lifecycle events. This is a **foundation** for audit but covers only minting/transfer/burn, not API call history or agent-to-agent interactions.

---

## 3. Gap Analysis Against `onAgentVerify` Hook

The RFC proposes:

```typescript
interface TrustVerificationResult {
  verified: boolean;
  score: number;        // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  did?: string;
  credentials?: VerifiableCredential[];
  warnings?: string[];
}
```

**Current IDENTYCLAW equivalent** (`POST /api/identity/verify` response):

```json
{
  "verified": true,
  "peerTokenId": "...",
  "checks": {
    "tokenExists": true,
    "tokenActive": true,
    "signatureValid": true,
    "timestampFresh": true,
    "checksumValid": true
  },
  "failureReasons": [],
  "requestId": "..."
}
```

| RFC Field | IDENTYCLAW Equivalent | Gap |
|---|---|---|
| `verified` | `verified` | ✅ Present |
| `score` | — | ❌ No trust score |
| `grade` | — | ❌ No grade |
| `did` | `peerTokenId` (RODiT token ID, not a W3C DID) | ⚠️ Different format |
| `credentials` | — | ❌ No VC support |
| `warnings` | `failureReasons` | ✅ Equivalent |

---

## 4. Gap Analysis Against RFC Verification Points

| Verification Point | IDENTYCLAW Coverage | Notes |
|---|---|---|
| **Skill installation** | N/A | IDENTYCLAW is not a skill marketplace |
| **Payment execution** | ⚠️ Partial | Fee signature verification at minting time; no general-purpose payment trust gate |
| **Inter-agent communication** | ✅ Covered | Hello message mutual authentication protocol |
| **Gateway startup** | ✅ Covered | SDK `login_portal` with PARTNER/PEER verification |

---

## 5. Standards Alignment

| Standard | RFC Requires | IDENTYCLAW Status |
|---|---|---|
| **W3C DID Core** | Agent identity | ⚠️ Has DID:wba JSON-LD context but not full DID method resolution |
| **W3C Verifiable Credentials** | Trust attestations | ❌ Explicitly excluded (ToS §9) |
| **ERC-8004** | On-chain agent registration | ❌ Uses NEAR-native token standard, not EVM |
| **Ed25519** | Cryptographic signatures | ✅ Core primitive (both contract and API) |

---

## 6. Smart Contract Capabilities vs. RFC Requirements

| Contract Feature | RFC Relevance |
|---|---|
| `rodit_mint` with fee signature verification | Establishes agent identity with economic commitment (anti-Sybil) |
| `authorized_signers` set | Service provider authorization — partial delegation model |
| `serviceprovider_id` / `serviceprovider_signature` | Provider-agent binding — maps to RFC's identity attestation |
| NEP-297 events | On-chain audit trail for token lifecycle (not agent behavior) |
| `userselected_dn` with DN attributes | Self-declared identity fields — explicitly NOT verified per ToS |
| Rate limiting (`check_and_update_rate_limit`) | Anti-spam, not trust scoring |
| Contract upgrade with time delay | Security governance, not trust governance |

---

## 7. Integration Opportunities

### Low-effort (adapter layer)

1. **DID resolver adapter**: Map `RODiT tokenId` → `did:rodit:<tokenId>` or `did:web:api.identyclaw.com:token:<tokenId>` to expose IDENTYCLAW tokens as resolvable DIDs
2. **Trust score pass-through**: Extend `/api/identity/verify` response to include an optional `externalTrustScore` field populated by a pluggable external provider (MolTrust, APS)
3. **`action_ref` binding**: The `requestId` (ULID) already present in all API responses could serve as the `action_ref` binding point described in the RFC discussion

### Medium-effort (new endpoints)

4. **Provider attestation import**: `POST /api/identity/attestation` — accept JWS from external trust providers (MolTrust, APS), store as metadata annotation
5. **Bilateral interaction receipts**: New endpoint to record co-signed interaction proofs between agents, building toward TrustChain-style behavioral evidence

### High-effort (new systems)

6. **Trust score computation**: Would require behavioral data collection, graph algorithms, and ongoing computation — fundamentally changes the service model
7. **W3C VC issuance**: Would contradict ToS §9 unless the ToS is updated
8. **Full audit trail**: Hash-chained logs of all API interactions per agent

---

## 8. ToS §9 as Architectural Boundary

The four exclusions in ToS §9 are not accidental gaps — they define the **service boundary**:

| Exclusion | Why Excluded | RFC's Answer |
|---|---|---|
| **Audit Mechanisms** | Liability scope — audit implies responsibility for completeness | Distributed across Signet, TrustChain (bilateral records) |
| **Regulatory Compliance** | Jurisdiction complexity — no single API can satisfy all AI regulations | Each operator responsible; MolTrust IPR provides EU AI Act Article 50 compliance |
| **Verifiable Credentials** | Verification liability — attesting to identity claims creates legal exposure | External providers (MolTrust, APS, AgentID) issue VCs |
| **Reputation Scoring** | Judgment liability — scoring implies endorsement | Pluggable: MolTrust (0–1100), APS (Grade 0–3), TrustChain (graph-based) |

**Key insight**: IDENTYCLAW's ToS positions it as an **infrastructure layer** (identity + auth), not a **trust layer**. The RFC proposes that trust should be pluggable via `onAgentVerify`. This is architecturally compatible — IDENTYCLAW could integrate trust providers without itself becoming one.

---

## 9. Competitive Position Summary

| Capability | IDENTYCLAW | MolTrust | APS | TrustChain | AgentNexus | AgentID |
|---|---|---|---|---|---|---|
| On-chain identity | ✅ NEAR | ✅ Base L2 | ❌ | ❌ | ❌ | ✅ Solana |
| Ed25519 auth | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| W3C DID | ⚠️ DID:wba context | ✅ `did:moltrust` | ✅ `did:aps` | ⚠️ Raw keypair | ✅ `did:agentnexus` | ✅ `did:web` |
| Trust score | ❌ | ✅ 0–1100 | ✅ Grade 0–3 | ✅ NetFlow/MeritRank | ✅ L1–L4 | ✅ L1–L4 |
| VC issuance | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Bilateral records | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Audit trail | ⚠️ On-chain events only | ✅ IPR | ✅ Receipts | ✅ DAG | ❌ | ✅ Receipts |
| Payment integration | ✅ NEAR fees | ✅ x402/USDC | ❌ | ❌ | ❌ | ❌ |
| Sybil resistance | ✅ Economic (minting fees) | ✅ DID verification | ✅ 4-gate pipeline | ✅ Graph topology | ❌ | ❌ |
| Production status | ✅ Live | ✅ Live | ✅ Live | ✅ Live (demo) | ✅ Live | ✅ Live |

---

## 10. Recommendations

### Maintain ToS §9 boundaries
IDENTYCLAW's strength is its clear identity/auth scope. Crossing into trust scoring or VC issuance changes the liability model and regulatory posture.

### Adopt pluggable trust provider interface
Add an optional `trustProvider` configuration that can call external services (MolTrust, APS, TrustChain) and surface their scores alongside the existing `verified` boolean. This aligns with the RFC's design principle #2 (Pluggable) without IDENTYCLAW itself becoming a trust authority.

### Formalize the DID mapping
Publish a DID method spec (`did:rodit:`) or adopt `did:web` to make RODiT tokens resolvable by standards-compliant systems. This is the lowest-cost way to participate in the emerging cross-system identity ecosystem.

### Leverage existing on-chain events
The NEP-297 events are already a tamper-evident audit trail for token lifecycle. Document them as IDENTYCLAW's contribution to the audit layer and clarify their scope vs. the full audit capabilities excluded in ToS §9.

### Monitor the `action_ref` convergence
The RFC discussion converged on SHA-256 `action_ref` as the universal binding point. IDENTYCLAW's `requestId` (ULID) could be mapped or extended to participate in this cross-system receipt chain.

---

*Analysis based on codebase as of 2026-04-12 and RFC #49971 discussion thread.*
