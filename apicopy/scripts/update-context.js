#!/usr/bin/env node
/**
 * Update Context - Permission Map Generator
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 * 
 * This script generates METHOD_PERMISSION_MAP from swagger.json.
 * 
 * Usage:
 *   node scripts/update-context.js                    # Update permissions from swagger.json
 *   node scripts/update-context.js --validate         # Validate permissions only
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const validateOnly = args.includes('--validate');

// Paths
const ROOT = path.join(__dirname, '..');
const SWAGGER_PATH = path.join(ROOT, 'api-docs', 'swagger.json');
const CONFIG_PATH = path.join(ROOT, 'config', 'production.json');

// ============================================================================
// Permission Map Generator
// ============================================================================

function extractOperationName(pathStr) {
  const segments = pathStr.split('/').filter(s => s && !s.startsWith('{'));
  if (segments.length === 0) return null;
  return segments[segments.length - 1];
}

function requiresAuthentication(pathItem) {
  const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
  
  for (const method of methods) {
    if (pathItem[method]) {
      const operation = pathItem[method];
      if (operation.security && operation.security.length > 0) {
        return true;
      }
    }
  }
  
  return false;
}

function getCustomPermissionScopes(pathItem) {
  const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
  
  for (const method of methods) {
    if (pathItem[method]) {
      const operation = pathItem[method];
      if (operation['x-permission-scopes']) {
        return operation['x-permission-scopes'];
      }
    }
  }
  
  return null;
}

function generatePermissionMap(swaggerSpec) {
  const permissionMap = {};
  const paths = swaggerSpec.paths || {};
  
  console.log('Generating METHOD_PERMISSION_MAP from swagger.json...\n');
  
  for (const [pathStr, pathItem] of Object.entries(paths)) {
    const operation = extractOperationName(pathStr);
    
    if (!operation) {
      console.log(`⚠️  Skipping path without operation name: ${pathStr}`);
      continue;
    }
    
    const requiresAuth = requiresAuthentication(pathItem);
    
    if (!requiresAuth) {
      console.log(`ℹ️  Skipping unauthenticated endpoint: ${pathStr} (${operation})`);
      continue;
    }
    
    const customScopes = getCustomPermissionScopes(pathItem);
    const scopes = customScopes || ['entityAndProperties', 'propertiesOnly', 'entityOnly'];
    
    if (permissionMap[operation]) {
      console.log(`⚠️  Duplicate operation name detected: ${operation}`);
      console.log(`    Existing: ${JSON.stringify(permissionMap[operation])}`);
      console.log(`    New from ${pathStr}: ${JSON.stringify(scopes)}`);
      console.log(`    Keeping existing definition.`);
    } else {
      permissionMap[operation] = scopes;
      console.log(`✓ ${operation.padEnd(20)} <- ${pathStr}`);
    }
  }
  
  console.log(`\n✓ Generated ${Object.keys(permissionMap).length} permission entries`);
  
  return permissionMap;
}

function validatePermissionMap(generated, existing) {
  console.log('\n=== Validation Report ===\n');
  
  let isValid = true;
  const generatedKeys = new Set(Object.keys(generated));
  const existingKeys = new Set(Object.keys(existing));
  
  const missingInGenerated = [...existingKeys].filter(k => !generatedKeys.has(k));
  if (missingInGenerated.length > 0) {
    console.log('❌ Operations in config but NOT in swagger.json:');
    missingInGenerated.forEach(op => {
      console.log(`   - ${op}: ${JSON.stringify(existing[op])}`);
    });
    isValid = false;
  }
  
  const newInGenerated = [...generatedKeys].filter(k => !existingKeys.has(k));
  if (newInGenerated.length > 0) {
    console.log('ℹ️  New operations found in swagger.json:');
    newInGenerated.forEach(op => {
      console.log(`   + ${op}: ${JSON.stringify(generated[op])}`);
    });
  }
  
  const commonKeys = [...generatedKeys].filter(k => existingKeys.has(k));
  const differences = [];
  
  for (const key of commonKeys) {
    const genScopes = JSON.stringify(generated[key].sort());
    const existScopes = JSON.stringify(existing[key].sort());
    
    if (genScopes !== existScopes) {
      differences.push({
        operation: key,
        generated: generated[key],
        existing: existing[key]
      });
    }
  }
  
  if (differences.length > 0) {
    console.log('\n⚠️  Operations with different permission scopes:');
    differences.forEach(diff => {
      console.log(`   ${diff.operation}:`);
      console.log(`     Config:    ${JSON.stringify(diff.existing)}`);
      console.log(`     Generated: ${JSON.stringify(diff.generated)}`);
    });
    isValid = false;
  }
  
  if (isValid && missingInGenerated.length === 0 && newInGenerated.length === 0) {
    console.log('✓ Generated map matches existing config perfectly!');
  } else if (isValid) {
    console.log('\n✓ Existing operations match, but there are new operations to add.');
  }
  
  return isValid;
}

function updateConfigFile(configPath, permissionMap) {
  console.log(`\nUpdating ${configPath}...`);
  
  let config;
  try {
    const configContent = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configContent);
  } catch (error) {
    console.error(`❌ Failed to read config file: ${error.message}`);
    return false;
  }
  
  config.METHOD_PERMISSION_MAP = permissionMap;
  
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.log('✓ Config file updated successfully!');
    return true;
  } catch (error) {
    console.error(`❌ Failed to write config file: ${error.message}`);
    return false;
  }
}

function updatePermissions() {
  console.log('\n=== Updating METHOD_PERMISSION_MAP ===\n');
  
  let swaggerSpec;
  try {
    const swaggerContent = fs.readFileSync(SWAGGER_PATH, 'utf8');
    swaggerSpec = JSON.parse(swaggerContent);
    console.log(`✓ Loaded swagger.json from ${SWAGGER_PATH}\n`);
  } catch (error) {
    console.error(`❌ Failed to read swagger.json: ${error.message}`);
    return false;
  }
  
  const generatedMap = generatePermissionMap(swaggerSpec);
  
  if (validateOnly) {
    let existingConfig;
    try {
      const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
      existingConfig = JSON.parse(configContent);
    } catch (error) {
      console.error(`❌ Failed to read config file: ${error.message}`);
      return false;
    }
    
    return validatePermissionMap(generatedMap, existingConfig.METHOD_PERMISSION_MAP || {});
  } else {
    const success = updateConfigFile(CONFIG_PATH, generatedMap);
    
    if (success) {
      console.log('\n=== Summary ===');
      console.log(`Total operations: ${Object.keys(generatedMap).length}`);
      console.log('Default scopes: ["entityAndProperties", "propertiesOnly", "entityOnly"]');
    }
    
    return success;
  }
}

// ============================================================================
// Main Execution
// ============================================================================

function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Update Context - Permission Map Generator         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const success = updatePermissions();
  
  console.log('\n' + '═'.repeat(60));
  if (success) {
    console.log('✓ Permission map updated successfully!');
  } else {
    console.log('⚠️  Update failed. Please check the output above.');
  }
  console.log('═'.repeat(60) + '\n');
  
  process.exit(success ? 0 : 1);
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  updatePermissions,
  generatePermissionMap
};
