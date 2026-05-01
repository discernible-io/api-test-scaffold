# Configuration Files & Documentation Generation

## Overview

This document covers the centralized configuration system and unified documentation generator for the project. The system ensures consistency across all enrollment endpoints, documentation, and configuration files.

## How-To Configuration (`howto.config.js`)

**Single source of truth for all how-to guides and usage information.**

### Purpose

The `src/config/howto.config.js` file centralizes all how-to guides and usage information, which is then consumed by:

1. **API Endpoints** - Discovery and enrollment endpoints
2. **Documentation** - skills.md enrollment section
3. **HTML Pages** - Quick-start guides

This ensures consistency across all enrollment endpoints and documentation. When you need to update pricing, steps, or contact information, you only need to edit this one file.

### What's Centralized

- **Enrollment URLs**: Purchase portal, FAQ, support contacts
- **Pricing Tiers**: All tier names, descriptions, and features
- **Enrollment Steps**: Complete step-by-step process with commands and details
- **Authentication Info**: Flow description and examples
- **Support Contacts**: Email, documentation links
- **UI Messages**: Badges, banners, and quick-start titles

### Configuration Structure

The `howto.config.js` exports an object with these main sections:

#### 1. `howToUse`
Core enrollment URLs and descriptions
```javascript
{
  url: "https://purchase.identyclaw.com",
  faq: "https://purchase.identyclaw.com/faq",
  description: "Purchase and mint RODiT tokens for API access"
}
```

#### 2. `howToUseSteps`
Step-by-step enrollment process
```javascript
[
  {
    step: 1,
    title: "Create NEAR Account",
    description: "...",
    details: { command: "...", exchange: "...", note: "..." }
  },
  // ... more steps
]
```

#### 3. `howToLogin`
Detailed login authentication guide
- Prerequisites
- Request body structure
- Signature computation
- Server verification
- Response format
- Example cURL commands

#### 4. `agentToAgentAuth`
HOLA message authentication protocol
- Message format
- Workflow steps
- Endpoints
- Security considerations

#### 5. `identityMarkdown`
IDENTITY.md generation guide
- Response structure
- Generation steps
- Markdown template
- Automation examples

### Where It's Used

The configuration is imported and used in:

1. **`GET /`** - Root API discovery endpoint
   - Displays enrollment badge and URLs

2. **`GET /.well-known/enrollment`** - Full enrollment information (JSON)
   - Returns complete pricing, steps, and authentication details

3. **`GET /docs/enrollment`** - Quick-start HTML guide
   - Generates step-by-step HTML from config

4. **`GET /docs`** - Main API documentation page
   - Shows enrollment banner with purchase link

### How to Update

**Example: Change the purchase URL**

```javascript
// src/config/howto.config.js
module.exports = {
  howToUse: {
    url: "https://new-purchase-url.com",  // ← Change here
    // ...
  }
};
```

This single change automatically updates:
- Root endpoint response
- Enrollment guide JSON
- Quick-start HTML page
- Main docs page banner
- All links and references

**Example: Add a new pricing tier**

```javascript
pricing: {
  tiers: [
    // ... existing tiers
    {
      name: "Startup",
      description: "For growing startups",
      features: [
        "Medium API access",
        "Flexible rate limits",
        "Email support"
      ]
    }
  ]
}
```

**Example: Modify enrollment steps**

```javascript
enrollmentSteps: [
  {
    step: 1,
    title: "New First Step",
    description: "Updated description",
    details: {
      command: "new-command-here",
      // ... other details
    }
  },
  // ... other steps
]
```

## Unified Documentation Generator (`update-context.js`)

The `update-context.js` script is a unified tool that combines three previously separate generation tasks into a single command. It serves as the central documentation and configuration updater for the project.

### Purpose

Maintain consistency across documentation and configuration files by generating them from authoritative sources:

1. **Updates skills.md** - Generates enrollment section from `howto.config.js`
2. **Updates README.md** - Generates from `swagger.json` and `skills.md`
3. **Updates permissions** - Generates `METHOD_PERMISSION_MAP` from `swagger.json`

### Quick Start

#### Update Everything
```bash
npm run update:context
```

#### Update Individual Components
```bash
npm run update:skills        # Only update skills.md enrollment section
npm run update:readme        # Only update README.md
npm run update:permissions   # Only update METHOD_PERMISSION_MAP
npm run validate:permissions # Validate permissions without updating
```

### Detailed Usage

#### 1. Update Skills.md Enrollment Section

**Source**: `src/config/howto.config.js`  
**Target**: `skills.md` (enrollment section only)

```bash
npm run update:skills
```

**What it does**:
- Reads `howToUseSteps` from `howto.config.js`
- Generates markdown for enrollment steps
- Replaces the section between `## 🚀 Getting Started` and `---` markers
- Preserves the rest of `skills.md`

**When to run**:
- After editing `src/config/howto.config.js`
- When adding/modifying enrollment steps
- When updating pricing or URLs

#### 2. Update README.md

**Sources**: `api-docs/swagger.json` + `skills.md`  
**Target**: `README.md`

```bash
npm run update:readme
```

**What it does**:
- Extracts title, description, and version from `swagger.json`
- Includes complete `skills.md` content
- Generates endpoints table from `swagger.json` paths
- Creates a comprehensive README

**When to run**:
- After updating `swagger.json`
- After updating `skills.md`
- Before releases or documentation updates

#### 3. Update Permission Map

**Source**: `api-docs/swagger.json`  
**Target**: `config/production.json` (METHOD_PERMISSION_MAP field)

```bash
npm run update:permissions
```

**What it does**:
- Scans all paths in `swagger.json`
- Identifies authenticated endpoints (those with `security` defined)
- Generates permission scopes for each operation
- Updates `METHOD_PERMISSION_MAP` in `config/production.json`

**Default scopes**: `["entityAndProperties", "propertiesOnly", "entityOnly"]`

**Custom scopes**: Add `x-permission-scopes` to operations in `swagger.json`:
```json
{
  "/admin/endpoint": {
    "post": {
      "summary": "Admin only endpoint",
      "x-permission-scopes": ["entityAndProperties"],
      "security": [{ "bearerAuth": [] }]
    }
  }
}
```

**When to run**:
- After adding new authenticated endpoints
- After modifying endpoint paths
- Before deploying permission changes

#### 4. Validate Permissions

```bash
npm run validate:permissions
```

**What it does**:
- Generates permission map from `swagger.json`
- Compares with existing `config/production.json`
- Reports differences without making changes
- Exits with code 0 if valid, 1 if invalid

**Use in CI/CD**:
```yaml
- name: Validate Permissions
  run: npm run validate:permissions
```

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    update-context.js                        │
│                  (Unified Generator)                        │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────┐          ┌─────────┐        ┌──────────┐
    │ Part 1  │          │ Part 2  │        │  Part 3  │
    │ Skills  │          │ README  │        │  Perms   │
    └─────────┘          └─────────┘        └──────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   skills.md            README.md          production.json
```

### Data Flow

```
howto.config.js ──────────────────┐
                                  │
swagger.json ─────────┬───────────┼──────────┐
                      │           │          │
                      ▼           ▼          ▼
                 README.md   skills.md   permissions
```

### Replaced Scripts

The unified `update-context.js` replaces these three scripts:

| Old Script | New Command | Function |
|------------|-------------|----------|
| `generate-skills-enrollment.js` | `npm run update:skills` | Skills enrollment |
| `generate-readme.js` | `npm run update:readme` | README generation |
| `generate-permission-map.js` | `npm run update:permissions` | Permission map |

**Migration**: The old scripts can be safely removed. All functionality is preserved in `update-context.js`.

## Integration with Workflow

### Pre-commit Hook

Automatically update documentation before commits:

```bash
#!/bin/bash
# .git/hooks/pre-commit

npm run update:context
git add skills.md README.md config/production.json
```

### GitHub Actions

Auto-update on config changes:

```yaml
name: Update Documentation
on:
  push:
    paths:
      - 'src/config/howto.config.js'
      - 'api-docs/swagger.json'

jobs:
  update-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run update:context
      - uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: "docs: auto-update from config changes"
          file_pattern: "skills.md README.md config/production.json"
```

### CI Validation

Ensure permissions stay in sync:

```yaml
- name: Validate Permissions
  run: npm run validate:permissions
```

## Best Practices

### 1. Always Use the Generator

❌ **Don't**: Manually edit generated sections
```bash
vim skills.md  # Don't manually edit enrollment section
```

✅ **Do**: Update source and regenerate
```bash
vim src/config/howto.config.js  # Edit source
npm run update:skills           # Regenerate
```

### 2. Run After Source Changes

```bash
# Workflow for updating enrollment
vim src/config/howto.config.js
npm run update:skills
git diff skills.md  # Verify changes
git add src/config/howto.config.js skills.md
git commit -m "docs: update enrollment steps"
```

### 3. Update All at Once

When making multiple changes:
```bash
vim src/config/howto.config.js
vim api-docs/swagger.json
npm run update:context  # Updates everything
```

### 4. Validate Before Deploy

```bash
npm run validate:permissions  # Check permissions
npm test                      # Run tests
npm run update:context        # Ensure docs are current
```

### 5. Keep Structure Consistent

Don't change the object structure in `howto.config.js` without updating the generation script.

### 6. Test After Changes

```bash
npm test
npm run update:context
git diff
```

## Troubleshooting

### Skills.md Section Not Found

**Error**: "Could not find enrollment section markers"

**Cause**: Section markers were modified or removed

**Fix**: Ensure these markers exist in `skills.md`:
- Start: `## 🚀 Getting Started: Enrollment & API Discovery`
- End: `---`

### Permission Validation Fails

**Error**: "Operations in config but NOT in swagger.json"

**Cause**: Endpoints were removed from `swagger.json` but still in config

**Fix**: 
1. Review the validation output
2. Remove obsolete operations from config, or
3. Add missing endpoints back to `swagger.json`

### README Generation Fails

**Error**: "Failed to read swagger.json"

**Cause**: Invalid JSON in `swagger.json`

**Fix**: Validate JSON syntax
```bash
cat api-docs/swagger.json | jq .  # Validate JSON
```

### Changes Not Reflected

**Problem**: Updated config but skills.md unchanged

**Cause**: Forgot to run generation script

**Fix**: Run `npm run update:skills`

### Merge Conflicts

**Problem**: Git conflicts in skills.md

**Cause**: Manual edits to generated section

**Fix**: 
1. Accept incoming changes
2. Update `howto.config.js` with desired content
3. Run `npm run update:skills`

## Output Examples

### Successful Run

```
╔════════════════════════════════════════════════════════════╗
║         Update Context - Unified Generator                ║
╚════════════════════════════════════════════════════════════╝

=== Updating skills.md ===

✓ skills.md enrollment section updated from howto.config.js

=== Updating README.md ===

✓ README.md regenerated from swagger.json and skills.md

=== Updating METHOD_PERMISSION_MAP ===

Generating METHOD_PERMISSION_MAP from swagger.json...

✓ identity              <- /api/identity/token/{tokenId}/full
✓ verify                <- /api/identity/verify
✓ holanonce16ts         <- /api/holanonce16ts
...

✓ Generated 15 permission entries

Updating config/production.json...
✓ Config file updated successfully!

=== Summary ===
Total operations: 15
Default scopes: ["entityAndProperties", "propertiesOnly", "entityOnly"]

════════════════════════════════════════════════════════════
✓ All updates completed successfully!
════════════════════════════════════════════════════════════
```

### Validation Output

```
=== Validation Report ===

ℹ️  New operations found in swagger.json:
   + newEndpoint: ["entityAndProperties","propertiesOnly","entityOnly"]

✓ Existing operations match, but there are new operations to add.
```

## Extending the System

### Add New Sections

1. **Add to howto.config.js**:
```javascript
module.exports = {
  // ... existing sections
  
  newSection: {
    title: "New Feature Guide",
    steps: [...]
  }
};
```

2. **Update generation script**:
```javascript
// In scripts/update-context.js
if (howtoConfig.newSection) {
  markdown += generateNewSection(howtoConfig.newSection);
}
```

### Generate Other Documentation

Create similar scripts for other documentation files:
- `scripts/generate-readme-enrollment.js` - Update README.md
- `scripts/generate-api-docs.js` - Update API documentation
- `scripts/generate-swagger-examples.js` - Update Swagger examples

## Related Files

- `src/config/howto.config.js` - Source of truth configuration
- `src/routes/discovery.public.routes.js` - API consumer
- `scripts/update-context.js` - Unified generator script
- `api-docs/swagger.json` - OpenAPI specification
- `skills.md` - Target documentation file
- `README.md` - Main project documentation
- `config/production.json` - Permission configuration

## Future Enhancements

- [ ] Add schema validation for `howto.config.js`
- [ ] Support multiple output formats (HTML, PDF)
- [ ] Add dry-run mode for all operations
- [ ] Generate changelog from updates
- [ ] Support custom templates
- [ ] Add watch mode for auto-regeneration
