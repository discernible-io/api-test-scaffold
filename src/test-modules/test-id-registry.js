/**
 * Test ID Registry
 * 
 * Maintains stable test IDs for correlation with coverage matrix.
 * Enables log search (rg not-passed) to map directly to matrix rows.
 * 
 * Format: DOMAIN-CATEGORY-NUMBER
 * Examples:
 *   AUTH-POS-001: Authentication positive test 1
 *   AUTH-NEG-001: Authentication negative test 1
 *   SCHEMA-VAL-NEG-001: Schema validation negative test 1
 *   RATE-LIMIT-NEG-001: Rate limiting negative test 1
 */

const testIdRegistry = {
  // Authentication domain
  'AUTH-POS': {
    domain: 'Authentication',
    category: 'Positive',
    description: 'Valid authentication flows',
    tests: {
      '001': 'Login with valid credentials',
      '002': 'Refresh token with valid refresh token',
      '003': 'Logout and invalidate token',
      '004': 'Multiple concurrent authenticated requests',
      '005': 'Token expiration and renewal'
    }
  },
  'AUTH-NEG': {
    domain: 'Authentication',
    category: 'Negative',
    description: 'Invalid authentication attempts',
    tests: {
      '001': 'Missing Authorization header',
      '002': 'Invalid JWT format',
      '003': 'Empty Authorization header',
      '004': 'Wrong Authorization scheme',
      '005': 'Expired JWT token',
      '006': 'Tampered JWT signature',
      '007': 'JWT from wrong issuer'
    }
  },

  // Authorization domain
  'AUTHZ-POS': {
    domain: 'Authorization',
    category: 'Positive',
    description: 'Valid permission checks',
    tests: {
      '001': 'Admin user can access privileged endpoint',
      '002': 'User can access own resource',
      '003': 'User with correct scope can perform action'
    }
  },
  'AUTHZ-NEG': {
    domain: 'Authorization',
    category: 'Negative',
    description: 'Invalid permission attempts',
    tests: {
      '001': 'User cannot access other user resource',
      '002': 'User cannot perform action without permission',
      '003': 'Non-admin cannot access admin endpoint',
      '004': 'Insufficient scope for operation'
    }
  },

  // Content-Type validation
  'CONTENT-TYPE-NEG': {
    domain: 'Content-Type',
    category: 'Negative',
    description: 'Invalid Content-Type handling',
    tests: {
      '001': 'Missing Content-Type header',
      '002': 'Wrong Content-Type for JSON',
      '003': 'Malformed JSON body',
      '004': 'Empty body with Content-Type'
    }
  },

  // Schema validation
  'SCHEMA-VAL-POS': {
    domain: 'Schema Validation',
    category: 'Positive',
    description: 'Valid schema conformance',
    tests: {
      '001': 'Response matches Swagger schema',
      '002': 'All required fields present',
      '003': 'Field types match schema',
      '004': 'Nested objects conform to schema'
    }
  },
  'SCHEMA-VAL-NEG': {
    domain: 'Schema Validation',
    category: 'Negative',
    description: 'Invalid schema handling',
    tests: {
      '001': 'Invalid TokenId format',
      '002': 'Missing required field',
      '003': 'Invalid field type',
      '004': 'Field exceeds maximum length',
      '005': 'Field below minimum value',
      '006': 'Invalid enum value'
    }
  },

  // Rate limiting
  'RATE-LIMIT-NEG': {
    domain: 'Rate Limiting',
    category: 'Negative',
    description: 'Rate limit enforcement',
    tests: {
      '001': 'Rate limit exceeded returns 429',
      '002': 'Retry-After header present',
      '003': 'Rate limit resets after window'
    }
  },

  // Error response structure
  'ERROR-RESPONSE-POS': {
    domain: 'Error Response',
    category: 'Positive',
    description: 'Valid error response structure',
    tests: {
      '001': 'Error response has error.code',
      '002': 'Error response has error.message',
      '003': 'Error response has requestId',
      '004': 'Error response has timestamp',
      '005': 'Timestamp is valid ISO 8601'
    }
  },

  // HOLA protocol
  'HOLA-POS': {
    domain: 'HOLA Protocol',
    category: 'Positive',
    description: 'Valid HOLA handshake',
    tests: {
      '001': 'HOLA nonce generation',
      '002': 'HOLA timestamp validation',
      '003': 'HOLA signature verification',
      '004': 'HOLA message construction'
    }
  },
  'HOLA-NEG': {
    domain: 'HOLA Protocol',
    category: 'Negative',
    description: 'Invalid HOLA handling',
    tests: {
      '001': 'Invalid nonce format',
      '002': 'Expired timestamp',
      '003': 'Invalid signature',
      '004': 'Malformed HOLA message'
    }
  },

  // MCP endpoints
  'MCP-POS': {
    domain: 'MCP',
    category: 'Positive',
    description: 'Valid MCP operations',
    tests: {
      '001': 'List resources',
      '002': 'Get resource by URI',
      '003': 'MCP discovery metadata',
      '004': 'MCP schema endpoint'
    }
  },
  'MCP-NEG': {
    domain: 'MCP',
    category: 'Negative',
    description: 'Invalid MCP handling',
    tests: {
      '001': 'Invalid resource URI',
      '002': 'Resource not found',
      '003': 'Malformed MCP request'
    }
  },

  // Webhook delivery
  'WEBHOOK-POS': {
    domain: 'Webhooks',
    category: 'Positive',
    description: 'Valid webhook delivery',
    tests: {
      '001': 'Webhook delivered to registered endpoint',
      '002': 'Webhook signature valid',
      '003': 'Webhook retry on failure',
      '004': 'Webhook payload matches schema'
    }
  },
  'WEBHOOK-NEG': {
    domain: 'Webhooks',
    category: 'Negative',
    description: 'Invalid webhook handling',
    tests: {
      '001': 'Webhook not delivered to unregistered endpoint',
      '002': 'Invalid webhook signature rejected',
      '003': 'Webhook timeout handling',
      '004': 'Webhook retry exhaustion'
    }
  },

  // Session management
  'SESSION-POS': {
    domain: 'Session Management',
    category: 'Positive',
    description: 'Valid session operations',
    tests: {
      '001': 'Session creation',
      '002': 'Session persistence',
      '003': 'Session expiration',
      '004': 'Session renewal'
    }
  },
  'SESSION-NEG': {
    domain: 'Session Management',
    category: 'Negative',
    description: 'Invalid session handling',
    tests: {
      '001': 'Expired session rejected',
      '002': 'Invalid session ID',
      '003': 'Session hijacking prevention',
      '004': 'Concurrent session limits'
    }
  },

  // Discovery endpoints
  'DISCOVERY-POS': {
    domain: 'Discovery',
    category: 'Positive',
    description: 'Valid discovery endpoints',
    tests: {
      '001': 'Health check returns status',
      '002': 'Root endpoint returns API info',
      '003': 'OpenAPI spec available',
      '004': 'Well-known endpoints accessible'
    }
  },

  // Integration tests
  'INTEGRATION-POS': {
    domain: 'Integration',
    category: 'Positive',
    description: 'Valid end-to-end flows',
    tests: {
      '001': 'DID web resolution',
      '002': 'Agent identity verification',
      '003': 'Token validation flow',
      '004': 'Multi-step authentication'
    }
  }
};

/**
 * Get test ID metadata
 * @param {string} testId - Test ID (e.g., 'AUTH-POS-001')
 * @returns {Object} Test metadata or null
 */
function getTestMetadata(testId) {
  const [domain, category, number] = testId.split('-');
  const key = `${domain}-${category}`;
  
  if (!testIdRegistry[key]) {
    return null;
  }

  const entry = testIdRegistry[key];
  const testDescription = entry.tests[number];

  return {
    testId,
    domain: entry.domain,
    category: entry.category,
    description: testDescription || 'Unknown test',
    domainDescription: entry.description
  };
}

/**
 * Get all test IDs for a domain
 * @param {string} domain - Domain name (e.g., 'AUTH')
 * @returns {Array} Array of test IDs
 */
function getTestIdsByDomain(domain) {
  const testIds = [];
  
  for (const [key, entry] of Object.entries(testIdRegistry)) {
    if (key.startsWith(domain)) {
      for (const number of Object.keys(entry.tests)) {
        testIds.push(`${key}-${number}`);
      }
    }
  }
  
  return testIds;
}

/**
 * Generate failure playbook entry
 * @param {string} testId - Test ID
 * @param {Object} failure - Failure details
 * @returns {Object} Playbook entry
 */
function createFailurePlaybookEntry(testId, failure) {
  const metadata = getTestMetadata(testId);
  
  if (!metadata) {
    return {
      testId,
      error: 'Unknown test ID'
    };
  }

  return {
    testId,
    metadata,
    failure: {
      what_happened: failure.what_happened || 'See logs',
      what_should_happen: failure.what_should_happen || metadata.description,
      required_fix: failure.required_fix || 'Investigate test module and API implementation'
    },
    triage: {
      matrix_row: `See coverage matrix for ${metadata.domain} / ${metadata.category}`,
      search_logs: `rg "${testId}" logs/`,
      last_green_commit: 'Use git log to find last passing commit',
      related_tests: getTestIdsByDomain(metadata.domain.split(' ')[0])
    }
  };
}

module.exports = {
  testIdRegistry,
  getTestMetadata,
  getTestIdsByDomain,
  createFailurePlaybookEntry
};
