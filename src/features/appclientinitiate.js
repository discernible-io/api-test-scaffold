let jwt_token;
let tokenExpirationTime = null; // New variable to hold the token expiration time
let refreshTimeout = null; // New variable to hold the refresh timeout ID

// Function to schedule a token refresh
function scheduleTokenRefresh() {
  if (tokenExpirationTime) {
    const currentTime = Date.now();
    const timeUntilExpiration = tokenExpirationTime - currentTime;

    // Refresh token 1 minute before expiration
    const refreshTime = timeUntilExpiration - 60000; // 60,000 ms = 1 minute

    if (refreshTime > 0) {
      refreshTimeout = setTimeout(async () => {
        logger.debug("Info: Refreshing token...");
        await refreshToken();
      }, refreshTime);
    }
  }
}

// Function to refresh the token
async function refreshToken() {
  try {
    const response = await fetch("/api/refresh-token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt_token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to refresh token");
    }

    const data = await response.json();
    jwt_token = data.new_token; // Update the JWT token
    tokenExpirationTime = Date.now() + data.expires_in * 1000; // Assuming the server returns the expiration time in seconds
    scheduleTokenRefresh(); // Schedule the next token refresh
  } catch (error) {
    logger.error(`Error refreshing token: ${error.message}`);
  }
}

// Start the server and run the client
app.listen(WEBHOOKPORT, async () => {
  logger.info(`Webhook server listening on port ${WEBHOOKPORT}`);
  // Run the client operations before the server starts accepting requests
  await sampleclient();
  logger.info("Server ready to accept webhook requests");
});
