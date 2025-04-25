// test-modules/rate-limiting.js
const { fetchWithErrorHandling, stateManager } = require("../middleware/rodit");

/**
 * Rate limiting test module
 */
const rateLimitTests = {
  /**
   * Test rate limit enforcement across requests
   */
  testRateLimitEnforcement: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing"
      };
    }
    
    try {
      // Get current rate limit configuration to determine how many requests to send
      const configResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/system/rate_limit_config`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          }
        }
      );
      
      if (configResult.error) {
        return {
          success: false,
          error: `Failed to get rate limit configuration: ${configResult.error}`,
          details: configResult
        };
      }
      
      const maxRequests = configResult.maxRequests || 100;
      const windowMinutes = configResult.windowMinutes || 1;
      
      // Send requests until we hit the rate limit or reach 110% of the max
      const results = [];
      let hitRateLimit = false;
      const requestLimit = Math.min(Math.ceil(maxRequests * 1.1), maxRequests + 20);
      
      for (let i = 0; i < requestLimit; i++) {
        // Use echo endpoint as it's lightweight
        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/echo`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              message: `Rate limit test request ${i+1}`
            })
          }
        );
        
        // Store response headers to track rate limit info
        results.push({
          requestNumber: i + 1,
          success: !result.error,
          rateLimitRemaining: result.headers?.["x-ratelimit-remaining"],
          rateLimitMax: result.headers?.["x-ratelimit-limit"],
          rateLimitReset: result.headers?.["x-ratelimit-reset"],
          error: result.error
        });
        
        // Check if we hit the rate limit
        if (result.error === "RateLimitExceeded") {
          hitRateLimit = true;
          break;
        }
      }
      
      if (!hitRateLimit && results.length >= maxRequests) {
        return {
          success: false,
          error: `Did not hit rate limit after ${results.length} requests (limit should be ${maxRequests})`,
          details: { results }
        };
      }
      
      return {
        success: true,
        details: {
          maxRequests,
          windowMinutes,
          requestsSent: results.length,
          hitRateLimit,
          results: results.slice(-5) // Just include the last 5 results to keep the log size reasonable
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { stack: error.stack }
      };
    }
  },
  
  /**
   * Test rate limit headers are present and accurate
   */
  testRateLimitHeaders: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing"
      };
    }
    
    try {
      // Make a few requests and check the headers
      const headerResults = [];
      const expectedHeaders = [
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset"
      ];
      
      for (let i = 0; i < 3; i++) {
        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/echo`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              message: `Rate limit header test ${i+1}`
            })
          }
        );
        
        const presentHeaders = {};
        const missingHeaders = [];
        
        for (const header of expectedHeaders) {
          if (result.headers && result.headers[header] !== undefined) {
            presentHeaders[header] = result.headers[header];
          } else {
            missingHeaders.push(header);
          }
        }
        
        headerResults.push({
          requestNumber: i + 1,
          presentHeaders,
          missingHeaders,
          allHeadersPresent: missingHeaders.length === 0
        });
        
        // Wait a short time between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Check if all requests had the expected headers
      const allHeadersPresent = headerResults.every(r => r.allHeadersPresent);
      
      if (!allHeadersPresent) {
        return {
          success: false,
          error: "Not all rate limit headers were present in responses",
          details: { headerResults }
        };
      }
      
      // Check if the 'remaining' header decreases with each request
      const decreasing = headerResults.slice(1).every((current, i) => {
        const previous = headerResults[i];
        return parseInt(current.presentHeaders["x-ratelimit-remaining"]) < 
               parseInt(previous.presentHeaders["x-ratelimit-remaining"]);
      });
      
      if (!decreasing) {
        return {
          success: false,
          error: "Rate limit remaining header did not consistently decrease",
          details: { headerResults }
        };
      }
      
      return {
        success: true,
        details: {
          headerResults,
          allHeadersPresent,
          rateLimitHeadersDecreasing: decreasing
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { stack: error.stack }
      };
    }
  },
  
  /**
   * Test rate limit configuration changes
   */
  testRateLimitConfigChanges: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing"
      };
    }
    
    try {
      // Get current configuration
      const initialConfig = await fetchWithErrorHandling(
        `${apiEndpoint}/api/system/rate_limit_config`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          }
        }
      );
      
      if (initialConfig.error) {
        return {
          success: false,
          error: `Failed to get initial rate limit configuration: ${initialConfig.error}`,
          details: initialConfig
        };
      }
      
      // Try to update rate limit configuration
      const newMaxRequests = initialConfig.maxRequests * 0.8; // 80% of current
      const updateResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/system/update_rate_limit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            maxRequests: newMaxRequests,
            windowMinutes: initialConfig.windowMinutes
          })
        }
      );
      
      if (updateResult.error) {
        return {
          success: false,
          error: `Failed to update rate limit configuration: ${updateResult.error}`,
          details: { updateResult, initialConfig }
        };
      }
      
      // Verify the configuration was updated
      const updatedConfig = await fetchWithErrorHandling(
        `${apiEndpoint}/api/system/rate_limit_config`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`
          }
        }
      );
      
      if (updatedConfig.error) {
        return {
          success: false,
          error: `Failed to get updated rate limit configuration: ${updatedConfig.error}`,
          details: { updatedConfig, initialConfig }
        };
      }
      
      // Check if maxRequests was updated
      if (updatedConfig.maxRequests !== newMaxRequests) {
        return {
          success: false,
          error: `Rate limit not updated as expected. Expected ${newMaxRequests}, got ${updatedConfig.maxRequests}`,
          details: { initialConfig, updatedConfig }
        };
      }
      
      // Restore original configuration
      const restoreResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/system/update_rate_limit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            maxRequests: initialConfig.maxRequests,
            windowMinutes: initialConfig.windowMinutes
          })
        }
      );
      
      if (restoreResult.error) {
        return {
          success: false,
          error: `Failed to restore rate limit configuration: ${restoreResult.error}`,
          details: { restoreResult, initialConfig, updatedConfig }
        };
      }
      
      return {
        success: true,
        details: {
          initialConfig,
          updatedConfig,
          configurationUpdated: true,
          restoreSuccessful: !restoreResult.error
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { stack: error.stack }
      };
    }
  }
};

module.exports = rateLimitTests;