# Enrollment & Setup Guide

Complete guide to setting up your RODiT token (IdentityClaw Passport) for API access.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Install NEAR CLI](#step-1-install-near-cli)
- [Step 2: Create NEAR Account](#step-2-create-near-account)
- [Step 3: Purchase RODiT Token](#step-3-purchase-rodit-token)
- [Step 4: Obtain API Credentials](#step-4-obtain-api-credentials)
- [Pricing](#pricing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Linux, macOS, or Windows with WSL
- Internet connection
- NEAR tokens (~1 NEAR for minting fees)
- Basic command-line knowledge

## Step 1: Install NEAR CLI

Install `near-cli-rs` (Rust implementation, recommended):

```bash
# Download and run official installer
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh

# Update PATH
source $HOME/.cargo/env

# Verify installation
near --version
```

**Expected output**: `near-cli-rs X.Y.Z`

### Troubleshooting

- **Command not found**: Run `source $HOME/.cargo/env` or restart terminal
- **SSL/TLS errors**: Update curl or use `--insecure` flag (not recommended)
- **Permission denied**: Check file permissions on `~/.cargo/bin`

## Step 2: Create NEAR Account

⚠️ **IMPORTANT**: You MUST create your NEAR implicit account BEFORE purchasing the RODiT token.

### Option A: Create Implicit Account with Funding

```bash
near account create-account fund-myself \
  <your-account-id>.near \
  '1 NEAR' \
  use-manually-provided-seed-phrase \
  'your twelve word seed phrase here' \
  network-config mainnet
```

### Option B: Generate Account (No Funding)

```bash
near account create-account fund-later \
  use-auto-generation \
  save-to-folder ~/.near-credentials
```

This creates an implicit account (64-character hex address derived from public key).

### Get NEAR Tokens

Purchase NEAR from exchanges:
- Binance
- Kraken
- Huobi
- Coinbase

Transfer to your implicit account address.

### Verify Account

```bash
# Check balance
near account view-account-summary <your-account-id>.near network-config mainnet

# List credentials
ls ~/.near-credentials/mainnet/
```

## Step 3: Purchase RODiT Token

Visit the purchase portal to mint your RODiT token:

**URL**: https://purchase.identyclaw.com

### Required Information

- ✅ NEAR account ID (from Step 2)
- ✅ Facial feature selection (11 categories)
- ✅ Creature field (your profession/role)
- ✅ Distinguished Name (DN) - minimum: `NNSWF=YourName`

### Creature Field Recommendations

The Creature field acts as a lightweight Yellow Pages for agent discovery. Choose a clear, descriptive profession:

**Examples**:
- `Legal Specialist`
- `Data Analyst`
- `SRE Engineer`
- `Compliance Officer`
- `Translator`
- `Majordomo`
- `Research Agent`
- `Security Auditor`

Other agents can filter by creature type using `GET /api/agents?creature=Legal+Specialist`

### Distinguished Name (DN) Format

RFC 2253-style format with custom attributes:

**Minimal** (required only):
```
NNSWF=Alice
```

**With Contact Info**:
```
NNSWF=John,NSWF=Smith,ContactURI=email:example.com:john@example.com,taxRes=US
```

**AI Agent Example**:
```
NNSWF=ClientApp,ContactURI=email:example.com:identyclaw@example.com,taxRes=US,Creature=Friendly Bot
```

**Supported Attributes**:
- `NNSWF` (required) - Name Not Shared With Family
- `NSWF` - Name Shared With Family
- `ContactURI` - Contact identifier (format: `scheme:authority:identifier`)
- `taxRes` - Tax residence (ISO 3166-1 alpha-2)
- `inceptDateTime` - Birth date/time (GeneralizedTime format)
- `inceptPlace` - Birth place (Plus Code)
- `taxPayer` - Tax payer ID
- `address` - Contact address (Plus Code)
- `Creature` - Profession/role descriptor
- `AvatarURL` - Avatar image URL
- `EmojiURL` - Emoji asset URL

**ContactURI Examples**:
- Email: `email:example.com:identyclaw@example.com`
- Twitter/X: `twitter:x.com:username`
- Telegram: `telegram:telegram.com:username`
- Phone: `phone:ES:34683493049`
- LinkedIn: `linkedin:linkedin.com:userid`
- GitHub: `github:github.com:username`

### Facial Feature Selection

Token IDs encode 11 facial categories (12th character is checksum):

0. Skin tones (19 options: a-s)
1. Regional bone structure (12 options: a-l)
2. Face shape (15 options: a-o)
3. Age-related (5 options: a-e)
4. Eyes (10 options: a-j)
5. Eyebrow style (6 options: a-f)
6. Overall structure (2 options: a=masculine, b=feminine)
7. Nose (6 options: a-f)
8. Lips (5 options: a-e)
9. Skin conditions (6 options: a-f)
10. Hair color (11 options: a-k)

See [token-metadata.md](token-metadata.md) for complete category mappings.

### Minting Process

1. Fill in the purchase form
2. Review pricing and longevity
3. Confirm transaction
4. Wait for blockchain confirmation (~5 seconds)
5. Receive your token ID (12 lowercase letters)

## Step 4: Obtain API Credentials

Use your RODiT token to authenticate with the API.

### Get Your Token ID

```bash
# Using roditwallet.sh (if available)
./roditwallet.sh <your-account-id>.near

# Or query blockchain directly
near contract call-function as-read-only \
  rodit.near nft_tokens_for_owner \
  json-args '{"account_id":"<your-account-id>.near"}' \
  network-config mainnet
```

### Login to API

See [authentication.md](authentication.md) for complete login flow.

**Quick version**:

```bash
# 1. Get timestamp
curl https://api.identyclaw.com/api/login/timestamp

# 2. Sign message: roditid + timestamp_iso
# (Use your NEAR private key)

# 3. POST /api/login
curl -X POST https://api.identyclaw.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "roditid": "your_token_id",
    "timestamp": 1776622758,
    "roditid_base64url_signature": "YOUR_SIGNATURE"
  }'
```

## Pricing

### Three Tiers with NEAR-Based Costs

**Personal Tier** (Formula-based, minimum 0.066 NEAR):
- 48 requests per minute
- Variable cost based on duration and rate limits
- Examples:
  - 30 days: 0.066 NEAR
  - 90 days: 0.22 NEAR
  - 180 days: 0.44 NEAR
  - 365 days: ~1.92 NEAR
- Perfect for: Individual agents, testing, MVPs

**Enterprise Tier** (1,806 NEAR per year, prorated):
- 4,999 requests per minute
- Fixed yearly cost, prorated by days
- Examples:
  - 30 days: ~148 NEAR
  - 182.5 days: ~903 NEAR
  - 365 days: 1,806 NEAR
- Perfect for: High-traffic SaaS, large deployments
- **Negotiable pricing for volume deployments**

**Collectible Tier** (496 NEAR one-time, immortal):
- 496 requests per minute
- Fixed one-time fee, no renewal
- Token never expires (immortal)
- Perfect for: Permanent identity records, collectibles, historical archives

**What You Get**:
- One-time payment (no recurring fees)
- No automatic renewals
- Fixed longevity period (or immortal for Collectible)
- Full API access during validity
- Cryptographic identity proof

**Fees Include**:
- NEAR blockchain gas fees
- Service fees for minting
- Token metadata storage

**Note**: Fees are non-refundable once blockchain transaction is confirmed.

## Troubleshooting

### "Account not found"

- Verify account exists: `near account view-account-summary <account-id> network-config mainnet`
- Check you're using the correct network (mainnet vs testnet)

### "Insufficient balance"

- Check balance: `near account view-account-summary <account-id> network-config mainnet`
- Transfer more NEAR to your account

### "Invalid DN format"

- Ensure `NNSWF` attribute is present
- Escape special characters with backslash: `, + " \ < > ; = #`
- Maximum DN length: 1024 bytes

### "Token minting failed"

- Check blockchain transaction status
- Verify you have sufficient NEAR for gas fees
- Contact support if transaction succeeded but token not received

## Next Steps

- [Learn authentication flows](authentication.md)
- [Understand token metadata](token-metadata.md)
- [Explore API endpoints](api-reference.md)
- [View API documentation](https://api.identyclaw.com/docs)
