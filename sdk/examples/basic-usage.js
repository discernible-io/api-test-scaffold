/**
 * Basic usage example for the RODiT SDK
 * 
 * This example demonstrates how to:
 * 1. Initialize the client with credentials
 * 2. Validate token metadata
 * 3. Make authenticated API requests
 * 4. Use utility functions
 * 5. Work with webhooks
 */

const { RoditClient, utils, createClient } = require('@cableguard/rodit-sdk');

async function main() {
  try {
    console.log('Initializing RODiT client...');
    
    // Create a client instance
    // You can use either the constructor or the createClient helper
    const client = createClient({
      credentialsPath: '../config/credentials.json'
    });
    
    // Initialize the client
    await client.init();
    console.log('Client initialized successfully');
    
    // Check if subscription is active
    if (!client.isSubscriptionActive()) {
      console.error('Service subscription is not active at the current time');
      return;
    }
    
    // Get and display token metadata
    const metadata = client.getTokenMetadata();
    console.log('\nToken Metadata:');
    console.log('- API Endpoint:', metadata.subjectuniqueidentifier_url);
    console.log('- Valid From:', metadata.not_before || 'Not specified');
    console.log('- Valid Until:', metadata.not_after || 'Not specified');
    console.log('- Rate Limit:', metadata.max_requests || 'Not specified', 'requests per', 
                metadata.maxrq_window || 'Not specified', 'seconds');
    
    // Check if an operation is permitted
    const isPermitted = client.isOperationPermitted('GET', '/api/cruda/list');
    console.log('\nOperation GET /api/cruda/list permitted:', isPermitted);
    
    // Fetch OpenAPI specification if available
    if (metadata.openapijson_url) {
      console.log('\nFetching API specification from', metadata.openapijson_url);
      try {
        const endpoints = await client.getAvailableEndpoints();
        console.log('Available endpoints:', Object.keys(endpoints).slice(0, 5), '...');
      } catch (error) {
        console.error('Failed to fetch API specification:', error.message);
      }
    }
    
    // Make an authenticated API request
    console.log('\nMaking API request...');
    try {
      const response = await client.request('GET', '/api/health');
      console.log('API Response:', response);
    } catch (error) {
      console.error('API request failed:', error.message);
    }
    
    // Demonstrate utility functions
    console.log('\nUtility Functions:');
    
    // Validate IP range format
    const cidr = metadata.allowed_cidr || '0.0.0.0/0';
    console.log('Is IP range valid:', utils.isValidIpRange(cidr));
    
    // Check if client IP is authorized
    const clientIp = '192.168.1.1';
    console.log(`Is client IP ${clientIp} authorized:`, utils.isClientIpAuthorized(clientIp, cidr));
    
    // Parse metadata JSON fields
    if (metadata.permissioned_routes) {
      const routes = utils.parseMetadataJson(metadata.permissioned_routes, {});
      console.log('\nPermissioned routes:', JSON.stringify(routes, null, 2));
    }
    
    // Register webhook if available
    if (metadata.webhook_url) {
      console.log('\nWebhook URL available:', metadata.webhook_url);
      console.log('To register a webhook:');
      console.log('client.registerWebhook("event_name", "https://your-callback-url.com")');
    }
    
    console.log('\nExample completed successfully');
  } catch (error) {
    console.error('Example failed:', error.message);
    console.error(error.stack);
  }
}

// Run the example
main().catch(console.error);
