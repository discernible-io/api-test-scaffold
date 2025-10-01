/**
 * Token Renewal Example
 * 
 * This example demonstrates how to test token renewal functionality
 * by maintaining a long-lived RoditClient instance.
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { RoditClient, logger } = require('../sdk');

/**
 * Example: Testing automatic token renewal
 * 
 * This demonstrates the pattern used in the token renewal tests:
 * 1. Create a single long-lived client
 * 2. Make periodic requests over time
 * 3. Monitor for token changes (renewal)
 */
async function demonstrateTokenRenewal() {
  console.log('=== Token Renewal Demonstration ===\n');

  try {
    // Step 1: Create a long-lived test client
    console.log('1. Creating RoditClient instance...');
    const client = await RoditClient.createTestInstance({ testMode: true });
    console.log('   ✓ Client created and initialized\n');

    // Step 2: Authenticate and get initial token
    console.log('2. Authenticating...');
    await client.login_server();
    const initialToken = client.getSessionToken();
    
    if (!initialToken) {
      throw new Error('Failed to obtain token');
    }

    // Decode token to get metadata
    const initialPayload = decodeJwtPayload(initialToken);
    const tokenDuration = initialPayload.exp - initialPayload.iat;
    
    console.log(`   ✓ Authenticated successfully`);
    console.log(`   Token JTI: ${initialPayload.jti}`);
    console.log(`   Token Duration: ${tokenDuration} seconds`);
    console.log(`   Expires At: ${new Date(initialPayload.exp * 1000).toISOString()}\n`);

    // Step 3: Calculate renewal threshold
    const RENEWAL_THRESHOLD = 0.15; // 15% of token lifetime
    const renewalThresholdSeconds = Math.floor(tokenDuration * RENEWAL_THRESHOLD);
    
    console.log('3. Token Renewal Configuration:');
    console.log(`   Renewal Threshold: ${RENEWAL_THRESHOLD * 100}% of lifetime`);
    console.log(`   Renewal After: ${renewalThresholdSeconds} seconds`);
    console.log(`   Will wait: ${renewalThresholdSeconds + 5} seconds (with buffer)\n`);

    // Step 4: Make periodic requests and monitor for renewal
    console.log('4. Making periodic requests to trigger renewal...');
    const requestInterval = 10000; // 10 seconds
    const waitTimeMs = (renewalThresholdSeconds + 5) * 1000;
    const numRequests = Math.ceil(waitTimeMs / requestInterval);
    
    console.log(`   Will make ${numRequests} requests over ${Math.floor(waitTimeMs / 1000)} seconds\n`);

    let renewalDetected = false;
    let requestCount = 0;

    for (let i = 0; i < numRequests; i++) {
      requestCount++;
      const currentToken = client.getSessionToken();
      const currentPayload = decodeJwtPayload(currentToken);

      // Check if token has changed (renewal occurred)
      if (currentPayload.jti !== initialPayload.jti) {
        renewalDetected = true;
        const elapsedSeconds = Math.floor((Date.now() - (initialPayload.iat * 1000)) / 1000);
        
        console.log(`   🎉 TOKEN RENEWAL DETECTED!`);
        console.log(`   Request #${requestCount}`);
        console.log(`   Time Elapsed: ${elapsedSeconds} seconds`);
        console.log(`   Old Token JTI: ${initialPayload.jti}`);
        console.log(`   New Token JTI: ${currentPayload.jti}`);
        console.log(`   New Token Duration: ${currentPayload.exp - currentPayload.iat} seconds\n`);
        break;
      }

      // Make a request to keep session active
      try {
        const metadata = client.getRoditMetadata();
        const timeLeft = currentPayload.exp - Math.floor(Date.now() / 1000);
        const percentLeft = ((timeLeft / tokenDuration) * 100).toFixed(1);
        
        console.log(`   Request #${requestCount}: Token still valid (${percentLeft}% lifetime remaining)`);
      } catch (error) {
        console.log(`   Request #${requestCount}: Failed - ${error.message}`);
      }

      // Wait before next request (unless this is the last one)
      if (i < numRequests - 1) {
        await sleep(requestInterval);
      }
    }

    // Step 5: Report results
    console.log('\n5. Results:');
    if (renewalDetected) {
      console.log('   ✓ Token renewal successfully triggered and detected');
      console.log('   ✓ Automatic renewal is working correctly');
    } else {
      console.log('   ⚠ Token renewal not detected within test period');
      console.log('   This may be normal if token lifetime is very long');
      console.log('   or renewal threshold not yet reached');
    }

    // Clean up
    client.clearSession();
    console.log('\n=== Demonstration Complete ===\n');

  } catch (error) {
    console.error('\n❌ Error during demonstration:', error.message);
    console.error(error.stack);
  }
}

/**
 * Example: Testing manual token refresh
 * 
 * This demonstrates explicitly calling refreshToken()
 */
async function demonstrateManualRefresh() {
  console.log('=== Manual Token Refresh Demonstration ===\n');

  try {
    // Step 1: Create client and authenticate
    console.log('1. Creating and authenticating client...');
    const client = await RoditClient.createTestInstance({ testMode: true });
    await client.login_server();
    
    const initialToken = client.getSessionToken();
    const initialPayload = decodeJwtPayload(initialToken);
    
    console.log(`   ✓ Initial Token JTI: ${initialPayload.jti}\n`);

    // Step 2: Call refreshToken() explicitly
    console.log('2. Calling refreshToken() explicitly...');
    const startTime = Date.now();
    await client.refreshToken();
    const duration = Date.now() - startTime;
    
    const refreshedToken = client.getSessionToken();
    const refreshedPayload = decodeJwtPayload(refreshedToken);
    
    console.log(`   ✓ Token refreshed in ${duration}ms`);
    console.log(`   New Token JTI: ${refreshedPayload.jti}\n`);

    // Step 3: Verify token changed
    console.log('3. Verification:');
    if (refreshedPayload.jti !== initialPayload.jti) {
      console.log('   ✓ Token JTI changed (renewal successful)');
    } else {
      console.log('   ❌ Token JTI unchanged (renewal failed)');
    }

    if (refreshedPayload.iat > initialPayload.iat) {
      console.log('   ✓ New token has later issued-at time');
    } else {
      console.log('   ❌ New token does not have later issued-at time');
    }

    // Clean up
    client.clearSession();
    console.log('\n=== Demonstration Complete ===\n');

  } catch (error) {
    console.error('\n❌ Error during demonstration:', error.message);
    console.error(error.stack);
  }
}

/**
 * Helper: Decode JWT payload
 */
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = Buffer.from(parts[1], 'base64').toString('utf8');
  return JSON.parse(payload);
}

/**
 * Helper: Sleep for specified duration
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demonstrations if executed directly
if (require.main === module) {
  (async () => {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         Token Renewal Testing Examples                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Run manual refresh first (faster)
    await demonstrateManualRefresh();
    
    console.log('\n');
    console.log('─────────────────────────────────────────────────────────────');
    console.log('\n');

    // Run automatic renewal (slower, takes 72+ seconds)
    console.log('⏱  Note: Automatic renewal test will take 72+ seconds...\n');
    await demonstrateTokenRenewal();
  })();
}

module.exports = {
  demonstrateTokenRenewal,
  demonstrateManualRefresh
};
