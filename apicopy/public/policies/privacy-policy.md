# Privacy Policy

**Effective Date**: April 5, 2026  
**Service**: IDENTYCLAW API (api.identyclaw.com)  
**Operator**: Discernible Inc.

---

## 1. Introduction

This Privacy Policy describes how Discernible Inc. ("we", "us", "our") collects, uses, and protects information when you use the IDENTYCLAW API service ("Service").

## 2. Information We Collect

### 2.1 Information You Provide

**RODiT Token Metadata** (stored on NEAR blockchain):
- `userselected_dn`: Distinguished name with identity attributes (NNSWF, NSWF, ContactURI, etc.)
- `AvatarURL`, `EmojiURL`: Optional media references
- `Creature`: Descriptive label for your agent/identity
- Token configuration (rate limits, permissions, validity dates)

**Account Information**:
- NEAR account ID (public blockchain address)
- Public key for signature verification

### 2.2 Information Collected Automatically

**API Usage Data**:
- Request timestamps and endpoints accessed
- IP addresses and geolocation (country level)
- Request/response metadata (not content)
- Error logs and debugging information

**Session Data**:
- JWT tokens (temporary, for authentication)
- Session identifiers
- Authentication events

### 2.3 Blockchain Data

RODiT token data is stored on the NEAR Protocol blockchain. This data is:
- **Publicly visible** to anyone querying the blockchain
- **Immutable** once written (cannot be deleted)
- **Decentralized** and not under our exclusive control

## 3. How We Use Information

We use collected information to:
- **Provide the Service**: Authenticate requests, process API calls, mint tokens
- **Maintain Security**: Detect fraud, prevent abuse, enforce rate limits
- **Improve the Service**: Analyze usage patterns, debug issues, optimize performance
- **Communicate**: Send service announcements, respond to support requests
- **Comply with Law**: Respond to legal requests, enforce our Terms

## 4. Information Sharing

We may share information with:

### 4.1 Service Providers
Third parties who assist in operating the Service (hosting, analytics) under confidentiality agreements.

### 4.2 Blockchain Network
Token metadata is published to the NEAR blockchain and is publicly accessible.

### 4.3 Legal Requirements
When required by law, subpoena, or to protect our rights and safety.

### 4.4 Business Transfers
In connection with a merger, acquisition, or sale of assets.

**We do NOT sell your personal information to third parties.**

## 5. Data Retention

| Data Type | Retention Period |
|-----------|------------------|
| Session data | 24 hours after session end |
| API access logs | 90 days |
| Authentication logs | 90 days |
| Error logs | 30 days |
| RODiT token metadata | Lifetime of token (on blockchain) |
| Account deletion requests | Processed within 30 days |

## 6. Data Security

We implement security measures including:
- **Encryption**: TLS 1.3 for data in transit
- **Authentication**: Ed25519 signature verification
- **Access Control**: Role-based access to systems
- **Monitoring**: Real-time security monitoring and alerting
- **Rate Limiting**: Protection against abuse and DoS attacks

## 7. Your Rights

Depending on your jurisdiction, you may have rights to:

### 7.1 Access
Request a copy of your personal information we hold.

### 7.2 Correction
Request correction of inaccurate information.

### 7.3 Deletion
Request deletion of your data (note: blockchain data cannot be deleted).

### 7.4 Portability
Receive your data in a portable format.

### 7.5 Objection
Object to certain processing activities.

### 7.6 Withdraw Consent
Withdraw consent where processing is based on consent.

To exercise these rights, contact: privacy@identyclaw.com

## 8. International Transfers

Your data may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place for such transfers.

## 9. Children's Privacy

The Service is not intended for children under 18. We do not knowingly collect information from children.

## 10. Cookies and Tracking

The API service does not use cookies. We use request headers for authentication (Bearer tokens).

## 11. AI Agent Considerations

### 11.1 AI Agent Data
If you operate an AI agent using our Service:
- Hello messages exchanged between agents are processed for verification
- Agent identity information in `userselected_dn` is publicly visible
- Agent-to-agent communications content is not stored by us

### 11.2 Facial Token IDs
The 12-character facial `token_id` encoding is:
- A pseudonymous identifier, not biometric data
- Derived from user-selected descriptive attributes
- Not linked to actual facial recognition or biometric systems

## 12. Changes to This Policy

We may update this Privacy Policy periodically. We will notify you of material changes via:
- Service announcements
- Email (if provided)
- Updated "Effective Date" on this document

## 13. Contact Us

**Data Protection Inquiries**:  
Email: privacy@identyclaw.com

**General Inquiries**:  
Email: support@identyclaw.com  
Web: https://identyclaw.com/contact

**Data Protection Officer**:  
Email: dpo@identyclaw.com

---

*Last Updated: April 5, 2026*
