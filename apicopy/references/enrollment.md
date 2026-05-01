# Enrollment & Setup Guide

Complete guide to setting up your RODiT token (IdentityClaw Passport) for API access.

This guide is for both humans and automation agents. Account creation is performed with `gennearaccount`; the purchase portal step is the human-operated checkout step.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Install gennearaccount](#step-1-install-gennearaccount)
- [Step 1b: Install near-cli-rs-ai](#step-1b-install-near-cli-rs-ai)
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
- `gennearaccount` installed (required for NEAR account creation)

## Human vs Agent Responsibilities

- **Agent-compatible (CLI):** Install `gennearaccount` (for account creation), create NEAR account, query owned RODiT tokens, run blockchain reads, and perform API login/signing flows.
- **Human-operated:** Complete checkout at `https://purchase.identyclaw.com` to buy/mint the IdentityClaw Passport (RODiT token).
- **Boundary:** There is currently no IdentityClaw MCP tool documented as replacing `gennearaccount` for NEAR account creation.

## Step 1: Install gennearaccount

Install `gennearaccount` (pre-compiled binary):

```bash
# Download the .deb package
wget https://identyclaw.ams3.cdn.digitaloceanspaces.com/gennearaccount_1.0_amd64.deb

# Install the package
sudo dpkg -i gennearaccount_1.0_amd64.deb

# Verify installation
gennearaccount --version
```

**Expected output**: `gennearaccount version 1.0.0` (or similar)

### Alternative: Build from Source

If the pre-compiled binary doesn't work for your architecture:

```bash
# Clone the repository
git clone https://github.com/rodit-org/gennearaccount.git
cd gennearaccount

# Build the binary
go build

# Install to /usr/bin
sudo cp gennearaccount /usr/bin/gennearaccount
```

### Troubleshooting

- **Command not found**: Check `/usr/bin` is in your PATH
- **dpkg dependency errors**: Run `sudo apt-get install -f` to fix missing dependencies
- **Architecture mismatch**: Build from source using the alternative method above

## Step 1b: Install near-cli-rs-ai

Install `near-cli-rs-ai` (pre-compiled binary):

```bash
# Download the .deb package
wget https://identyclaw.ams3.cdn.digitaloceanspaces.com/near-cli-rs-ai.deb

# Install the package
sudo dpkg -i near-cli-rs-ai.deb

# Verify installation
near --version
```

**Expected output**: `near-cli-rs-ai X.Y.Z`

### Alternative: Build from Source

If the pre-compiled binary doesn't work for your architecture:

```bash
# Clone the repository
git clone https://github.com/rodit-org/near-cli-rs-ai.git
cd near-cli-rs-ai

# Build the binary
cargo build --release

# Install to /usr/bin
sudo cp target/release/near /usr/bin/near
```

### Troubleshooting

- **Command not found**: Check `/usr/bin` is in your PATH
- **dpkg dependency errors**: Run `sudo apt-get install -f` to fix missing dependencies
- **Architecture mismatch**: Ensure you're using the correct architecture (amd64)

## Step 2: Create NEAR Account

⚠️ **IMPORTANT**: You MUST create your NEAR implicit account with `gennearaccount` BEFORE purchasing the RODiT token.

### Create Implicit Account

```bash
# Create credentials directory
mkdir -p ~/.near-credentials/mainnet

# Generate account
gennearaccount

# Move account file to credentials directory
mv <account-id>.json ~/.near-credentials/mainnet/
```

This will output:
- Account ID (64 hex characters)
- Public key (ed25519:...)
- Private key (ed25519:...)

The credentials are initially saved to `./<account-id>.json` (current directory), then moved to `~/.near-credentials/mainnet/<account-id>.json`

**⚠️ Important**: gennearaccount automatically saves the account file to `.` and the file needs to be moved to `~/.near-credentials/mainnet/`. If you have account files elsewhere, they must be moved to this directory for compatibility with wallet management tools.

### Fund Your Account

After creating the account, you need to fund it with NEAR tokens:

1. Purchase NEAR tokens from exchanges like Binance, Kraken, or Huobi
2. Transfer NEAR to your implicit account address (the 64-hex account ID)
3. Minimum required: 0.01 NEAR for account initialization + ~1 NEAR for RODiT token purchase

You can use any NEAR wallet or exchange to transfer NEAR to your implicit account address.

### Verify Account Creation

```bash
# Check that credentials file exists
ls -la ~/.near-credentials/mainnet/*.json

# View your account ID and private key
cat ~/.near-credentials/mainnet/*.json | jq -r '.account_id, .private_key'
```

### Option: Generate Account Without Funding (Advanced)

If you want to create an account without funding it first (not recommended for most users):

```bash
# This is the same as running gennearaccount
gennearaccount
```

This creates an implicit account (64-character hex address derived from public key) without funding it on-chain. You can fund it later using any NEAR wallet.

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

This is the human checkout step. Agents can prepare all required data, but a human should complete portal purchase/confirmation unless your environment has separate automation outside IdentityClaw MCP.

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
