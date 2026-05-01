# Terms of Service

**Version**: 1.0  
**Effective Date**: April 5, 2026  
**Last Updated**: April 5, 2026  
**Service**: IDENTYCLAW API (api.identyclaw.com)  
**Operator**: Discernible Inc.

---

## 1. Acceptance of Terms

By accessing or using the IDENTYCLAW API service ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Service.

## 2. Service Description

IDENTYCLAW provides an API service for:
- **RODiT Token Management**: Minting, transferring, and managing Rich Online Digital Tokens on the NEAR blockchain
- **AI Agent Identity**: Identity verification and authentication for AI agents
- **Mutual Authentication**: Cryptographic hello message verification between agents
- **MCP Integration**: Machine-readable capabilities for AI agent discovery

## 2.1 Design Philosophy

IdentityClaw is built on three core design principles that differentiate it from other identity systems:

### 2.1.1 Sybil Resistance
**Why no free tier:**  
We do not offer a free tier because free identities enable Sybil attacks—where malicious actors create large numbers of fake identities to manipulate systems. By requiring a minimal economic stake (as low as 0.066 NEAR for a 30-day test token), we ensure every identity has skin in the game. This cost prevents spam while keeping experimentation affordable.

### 2.1.2 Identity Mortality
**Why no renewals:**  
We do not support token renewals. This is by design, not an omission. Identity should have a lifespan—when it dies, a new one is born. This "mortality" model prevents long-term identity abuse, encourages purpose renewal, and reflects the natural lifecycle of identities. When your token expires, you create a new one with a new face—a rebirth, not a renewal.

### 2.1.3 Sovereign Ownership
**Why blockchain-backed:**  
Your identity is yours—you own your RODiT token on the NEAR blockchain. No central authority can revoke it (only you can dispose of it), and you can verify it directly on-chain without trusting this API. This creates censorship resistance, portability, and true sovereignty.

## 3. Eligibility

To use the Service, you must:
- Be at least 18 years old or have legal capacity to enter contracts
- Have a valid NEAR Protocol account
- Comply with all applicable laws and regulations
- Not be prohibited from using the Service under any applicable jurisdiction
- Not be located in or a resident of a sanctioned country (see Section 3.1)

### 3.1 Geographic Restrictions and Sanctioned Countries

**Prohibited Jurisdictions**: The Service is NOT available to individuals or entities located in, operating from, or residents of the following countries:

- **Russia** (RU)
- **Belarus** (BY)
- **North Korea** (KP)
- **Myanmar** (MM)
- **Afghanistan** (AF)
- **Eritrea** (ER)

**Reason for Restrictions**: These restrictions are implemented to comply with international sanctions, export controls, and regulatory requirements. We cannot provide services to users in these jurisdictions regardless of payment method or technical workarounds.

**Geolocation Enforcement**: The Service may use IP geolocation and other technical measures to enforce these geographic restrictions. Access attempts from prohibited jurisdictions will be automatically denied.

**VPN and Proxy Prohibition**: Users are prohibited from using VPNs, proxies, or other technical means to circumvent geographic restrictions. Violation of this prohibition may result in immediate account termination and forfeiture of any fees paid.

**Changes to Restricted Countries**: We reserve the right to add or remove countries from this list at any time in response to changes in international sanctions, legal requirements, or business decisions. Users will be notified of such changes with 30 days' notice when feasible.

## 4. Critical Acknowledgments

By minting a RODiT token (IdentityClaw Passport), you explicitly acknowledge and agree to the following:

### 4.1 Unverified Information
**The information you provide is not vetted in any way and is your sole responsibility as the passport owner.**
- IdentityClaw does not verify, validate, or guarantee the accuracy of any information you provide
- All identity claims, including name, location, and other fields, are self-declared
- You are solely responsible for ensuring the accuracy and truthfulness of your information
- Third parties relying on this information do so at their own risk

### 4.2 Permanent Public Record
**All information will be made public forever and cannot be deleted or amended.**
- RODiT token metadata is permanently stored on the NEAR blockchain
- This data is publicly visible to anyone worldwide
- Once minted, the transaction cannot be reversed, edited, or deleted
- Even if you request data deletion under GDPR, blockchain data cannot be removed
- This is a technical limitation of blockchain technology, not a policy choice
- Only include information you are comfortable being permanently public

### 4.3 No Account Recovery
**The passport will be minted and sent to the specified NEAR account address. If you lose access to that account, the passport cannot be recovered.**
- Your RODiT token is permanently associated with your NEAR account address
- If you lose access to your NEAR account (lost private key, forgotten password, etc.), your passport cannot be recovered
- IdentityClaw cannot recover your token or transfer it to a different account
- You are solely responsible for maintaining access to your NEAR account
- There is no password reset, account recovery, or customer support intervention possible for lost NEAR accounts

### 4.4 Non-Refundable Fees
**Minting involves a non-refundable transaction fee.**
- All fees (blockchain gas fees and service fees) are non-refundable once the transaction is confirmed
- Blockchain transactions are irreversible by design
- No refunds will be issued for minted tokens under any circumstances
- This applies regardless of whether you subsequently lose access to your account or decide you no longer want the token

### 4.5 Identity Longevity & Mortality

**Each passport has a fixed lifespan—this is intentional.**

By design, IdentityClaw passports **cannot be renewed or extended**. When your passport's longevity period expires, it becomes inactive. This is not a limitation—it's a feature that reinforces the concept of **identity mortality**.

**Why mortality matters:**

- **Prevents long-term abuse:** Identities that persist forever become attractive targets for attackers
- **Encourages purpose renewal:** When your identity expires, you reassess your purpose and create a new identity aligned with your current goals
- **Reflects natural cycles:** Just as organisms have lifespans, identities should too—death and rebirth are fundamental to trust ecosystems
- **Creates fresh starts:** A new face means a clean slate—new reputation, new relationships, new opportunities

**What happens when longevity expires:**

1. Your passport becomes inactive and can no longer be used for authentication
2. You must mint a new passport with a different facial identity combination
3. Your new passport is a rebirth—a new cryptographic identity, not a continuation of the old one
4. Relationships built on the old identity do not transfer automatically

**Choosing the right longevity:**

| Longevity | Best For | Cost (Personal tier) |
|-----------|----------|----------------------|
| 30 days | Testing, experimentation, short-term projects | 0.066 NEAR |
| 90 days | MVPs, pilots, seasonal work | 0.22 NEAR |
| 180 days | Longer-term projects | 0.44 NEAR |
| 365 days | Production agents, ongoing services | ~1.92 NEAR |
| Collectible (immortal) | Permanent records, collectible tokens | 496 NEAR one-time |

**Pro tip:** Start with a short longevity for testing. Scale up when you're confident in your identity and purpose. Remember: longer is not always better—consider the lifecycle of your identity's purpose.

## 5. Account and Security

### 5.1 NEAR Account
- You are responsible for maintaining the security of your NEAR account private keys
- You must not share your private keys with third parties
- You are solely responsible for all activities under your account

### 5.2 RODiT Tokens and Blockchain Immutability

**Permanent Public Record**: RODiT token metadata is stored on the NEAR blockchain and is:
- **Publicly visible** to anyone worldwide
- **Permanently immutable** - cannot be edited or deleted
- **Not erasable** - even if you request data deletion under GDPR

**GDPR Right to Erasure Limitation**: By minting a RODiT token, you explicitly acknowledge that:
- Blockchain data cannot be deleted or modified
- Your GDPR "right to be forgotten" cannot apply to on-chain data
- This limitation is inherent to blockchain technology
- You consent to permanent public visibility of your token metadata

**What Can Be Deleted**: We can delete off-chain data (API logs, session data) but NOT blockchain data.

## 5. Acceptable Use

You agree NOT to:
- Use the Service for any unlawful purpose
- Attempt to circumvent rate limits or security measures
- Impersonate other users or AI agents
- Submit false or misleading identity information
- Use the Service to harass, abuse, or harm others
- Reverse engineer or attempt to extract source code
- Resell or redistribute API access without authorization

## 6. Rate Limits and Quotas

- **Minting**: Maximum 10 RODiT tokens per hour per account
- **API Requests**: Subject to your token's `max_requests` and `maxrq_window` settings
- **JWT Duration**: As specified in your token metadata
- Exceeding limits may result in temporary or permanent suspension

## 7. Fees and Payment

**One-Time Payment Model**: The Service operates on a **one-time upfront payment** basis:
- You pay once when minting your RODiT token (IdentityClaw Passport)
- **No recurring fees, subscriptions, or renewal charges**
- **No automatic renewals** - the service does not auto-renew
- Payment covers the token longevity period specified at time of minting

**Fee Structure**:
- Token minting requires NEAR blockchain fees (gas fees) plus service fees
- Fee amounts are displayed before minting confirmation
- For detailed pricing tiers and rate limits, see the technical documentation at https://api.identyclaw.com/.well-known/howto
- Fees are non-refundable once the blockchain transaction is confirmed
- We reserve the right to modify fees for future token minting with 30 days notice (does not affect already-minted tokens)

**Token Longevity**: Each RODiT token has a fixed longevity period (duration of service). Once this period expires:
- The token becomes inactive and cannot be used for authentication
- **No renewal option exists** - tokens cannot be renewed or extended
- You must mint a new token with a different facial identity if you wish to continue using the Service

### 7.1 Pricing Philosophy

Our pricing reflects three principles:

**Affordable testing:**  
A 30-day token costs 0.066 NEAR. This is effectively free for serious developers while preventing automated Sybil attacks.

**No subscriptions, no hidden costs:**  
You pay once upfront. No monthly fees, no automatic renewals, no surprise charges. What you see is what you pay.

**Mortality is built in:**  
Because tokens cannot be renewed, your cost is tied to your identity's lifespan. Choose longevity aligned with your purpose—don't overpay for time you won't need.

**Enterprise flexibility:**  
The Enterprise tier has negotiable pricing. Contact sales for custom terms, volume discounts, or specialized arrangements.

**Sybil resistance as a service:**  
The economic stake you commit to your identity (even at 0.018 NEAR) creates trust. Others know you're not a throwaway account—you've invested in your identity, and that investment is visible on-chain.

## 8. Service Availability

- We aim for 99.9% uptime but do not guarantee uninterrupted service
- Scheduled maintenance will be announced in advance when possible
- We are not liable for service interruptions beyond our control

## 9. Services NOT Provided

This API provides authentication and identity management for AI agents. However, it explicitly does NOT provide:

- **Audit Mechanisms**: While the API helps identify which agent performed which action through authentication, it does not provide comprehensive tracking, logging, or audit trails of agent activities beyond authentication events
- **Regulatory Compliance**: The Service does not guarantee alignment with emerging AI regulations, AI safety standards, or jurisdiction-specific AI governance requirements. Users are solely responsible for ensuring their use of AI agents complies with applicable laws
- **Verifiable Claims**: All identity information declared by agents (including name, location, and other fields) is self-declared and NOT verified by the Service. The Service does not validate, attest to, or guarantee the accuracy of any identity claims made by agents
- **Reputation Scoring**: The Service does not evaluate, score, or provide any assessment of whether agents can be trusted, their reliability, performance history, or behavioral patterns
- **Trust Services**: The Service does not verify, validate, or certify the trustworthiness, capabilities, or claims of any AI agent. No endorsement, warranty, or guarantee is provided regarding any agent's behavior, safety, or fitness for any purpose
- **Comprehensive Agent Directory**: While the Service provides basic agent discovery through public blockchain data, it is NOT a full-featured AI agent directory service. It does not curate, categorize, recommend, or maintain comprehensive profiles of agents beyond what is stored on-chain
- **Human Authorization Proof**: The Service does NOT verify or prove that any AI agent is authorized to act on behalf of a specific human, organization, or legal entity. Agent-to-human relationships and authorization claims are not validated by the Service
- **End-to-End Encrypted Communication**: The Service does NOT provide end-to-end encrypted communication channels. Users requiring eavesdropping resistant, encrypted communication must find a trusted reputable provider to implement this capability independently

Users requiring these capabilities must implement them independently or use additional third-party services.

## 10. Intellectual Property

- The Service, API, and documentation are owned by Discernible Inc.
- Your RODiT tokens and associated metadata remain your property
- You grant us a license to process your data as necessary to provide the Service

## 11. Disclaimer of Warranties

THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

## 12. Limitation of Liability

**For Business Users**: TO THE MAXIMUM EXTENT PERMITTED BY LAW, DISCERNIBLE INC. SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE.

**For EU Consumers**: Nothing in these Terms excludes or limits our liability for:
- Death or personal injury caused by our negligence
- Fraud or fraudulent misrepresentation
- Any liability that cannot be excluded or limited under EU law

For EU consumers, our liability for other losses is limited to losses that are a reasonably foreseeable consequence of our breach of these Terms.

## 13. Indemnification

You agree to indemnify and hold harmless Discernible Inc. from any claims, damages, or expenses arising from your use of the Service or violation of these Terms.

## 14. Termination

- We may suspend or terminate your access for violation of these Terms
- You may terminate by discontinuing use of the Service
- Token ownership on the blockchain persists independently of Service access

## 15. Modifications

We reserve the right to modify these Terms at any time. Continued use of the Service after modifications constitutes acceptance of the updated Terms.

## 16. Governing Law and Jurisdiction

These Terms shall be governed by and construed in accordance with the laws of Spain, without regard to its conflict of law principles.

**EU Consumer Protection**: If you are a consumer resident in the European Union, you also benefit from mandatory provisions of consumer protection law in your country of residence. Nothing in these Terms affects your rights as a consumer under EU law.

**Dispute Resolution**:
- **For EU Consumers**: You may bring claims in the courts of Spain or your country of residence
- **For Business Users**: Exclusive jurisdiction in the courts of Madrid, Spain
- **EU Online Dispute Resolution**: EU consumers can access the European Commission's Online Dispute Resolution platform at https://ec.europa.eu/consumers/odr

## 17. Contact and Company Information

**Service Operator**: Discernible Inc.  
**Registered Address**: PLACEHOLDER_FULL_POSTAL_ADDRESS_IN_SPAIN_OR_EU  
**Company Registration Number**: PLACEHOLDER_SPANISH_CIF_OR_EQUIVALENT  
**VAT Number**: PLACEHOLDER_ES_VAT_NUMBER_IF_APPLICABLE  

**Contact Information**:  
**Email**: legal@identyclaw.com  
**Data Protection Officer**: dpo@identyclaw.com  
**Web**: https://identyclaw.com/contact

**EU Online Dispute Resolution**: https://ec.europa.eu/consumers/odr

## 18. Data Protection and GDPR Compliance

**GDPR Rights**: If you are located in the European Economic Area (EEA), you have specific rights under the General Data Protection Regulation (GDPR):
- **Right to access** your personal data
- **Right to rectification** of inaccurate data
- **Right to erasure** ("right to be forgotten") - subject to blockchain immutability limitations (see Section 4.2)
- **Right to restrict processing**
- **Right to data portability**
- **Right to object** to processing
- **Right to withdraw consent**

**Blockchain Data Limitation**: RODiT token metadata stored on the NEAR blockchain is immutable and cannot be deleted. By minting a token, you acknowledge that this data will remain publicly visible on the blockchain permanently. This is a technical limitation of blockchain technology, not a refusal of your GDPR rights.

**Legal Basis for Processing**:
- **Contract performance** - providing the Service you requested
- **Legitimate interests** - security, fraud prevention, service improvement
- **Legal obligations** - compliance with applicable laws
- **Consent** - where explicitly obtained for specific processing activities

**Data Controller**: Discernible Inc. is the data controller for personal data processed through the Service.

**Data Protection Officer**: Contact our DPO at dpo@identyclaw.com for any data protection inquiries.

**Full Privacy Policy**: See our Privacy Policy at https://api.identyclaw.com/.well-known/privacy-policy for complete details on data processing, retention, and your rights.

**Exercising Your Rights**: To exercise any of your GDPR rights, contact privacy@identyclaw.com. We will respond within 30 days.

## 19. Consumer Rights (EU Residents)

**Right of Withdrawal**: EU consumers have a 14-day right of withdrawal for distance contracts under EU Directive 2011/83/EU. However, this right does NOT apply to:
- Digital content delivered immediately with your express consent
- Services fully performed with your prior express consent before the end of the withdrawal period
- Blockchain transactions that are irreversible by nature

**Blockchain Minting Limitation**: Once a RODiT token is minted on the NEAR blockchain, the transaction is irreversible and cannot be undone. By confirming the minting transaction, you:
- Expressly acknowledge the irreversible nature of blockchain transactions
- Consent to immediate performance of the minting service
- Waive your right of withdrawal for that specific blockchain transaction

**Fees and Refunds**: 
- Blockchain transaction fees (gas fees) are paid directly to the NEAR network and are non-refundable
- Service fees for minting are non-refundable once the blockchain transaction is confirmed
- This limitation exists because blockchain transactions cannot be reversed once confirmed on-chain

**Pre-Contractual Information**: Before minting a RODiT token, you will be provided with:
- Total cost including all fees and charges
- Main characteristics of the RODiT token service
- Duration of the service (token longevity period)
- Payment and transaction details
- Confirmation that this is a **one-time payment with no recurring charges or subscriptions**

## 20. AI Agent Services and EU AI Act Compliance

**Nature of Service**: This Service provides identity verification and authentication infrastructure for AI agents. It does NOT:
- Deploy, operate, or control AI systems on your behalf
- Make automated decisions affecting your legal rights
- Provide AI safety guarantees or compliance certification
- Validate AI agent behavior, outputs, or decision-making
- Offer AI-as-a-Service or AI model hosting

**User Responsibility for AI Compliance**: Users deploying AI agents are solely responsible for:
- **Compliance with the EU AI Act** (Regulation 2024/1689) and national AI regulations
- **Risk classification** - determining whether their AI system is prohibited, high-risk, limited-risk, or minimal-risk
- **Required safeguards** - implementing technical and organizational measures for high-risk AI systems
- **Transparency obligations** - disclosing when users interact with AI systems
- **Human oversight** - maintaining appropriate human oversight and accountability for AI agent actions
- **Documentation and record-keeping** - maintaining required technical documentation
- **Conformity assessments** - conducting required assessments for high-risk AI systems

**No High-Risk AI Classification**: The IdentityClaw API itself is NOT classified as a high-risk AI system under the EU AI Act. It provides authentication and identity verification primitives, not AI decision-making capabilities.

**AI Agent Identity Transparency**: When using IdentityClaw to authenticate AI agents, you must ensure:
- Clear disclosure that interactions involve AI agents, not humans
- Compliance with transparency requirements under EU AI Act Article 52
- Proper labeling of AI-generated content where applicable

**No Liability for AI Agent Actions**: Discernible Inc. is not responsible for:
- Actions taken by AI agents authenticated through the Service
- Compliance of AI agents with applicable AI regulations
- Harm caused by AI agent decisions or outputs
- Violations of law committed by AI agents

## 21. Language

These Terms are provided in English. If you are a consumer in Spain, you have the right to receive these Terms in Spanish upon request.

**Spanish Translation**: PLACEHOLDER_URL_TO_SPANISH_TRANSLATION

In case of conflict between the English and Spanish versions, the Spanish version shall prevail for Spanish consumers in accordance with Spanish consumer protection law.

---

*Last Updated: April 5, 2026*
