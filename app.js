const nacl       = require('tweetnacl');
nacl.util        = require('tweetnacl-util');
const config     = require('config');
const { roditconfig, login } = require('./middleware/rodit');
  
// Configuration is now loaded from config files
const CONFIGURATION_FILE_PATH = config.get('CONFIGURATION_FILE_PATH');
const PORT = config.get('PORT');
const API_PROTOCOL = config.get('API_PROTOCOL');

// Accessing the protected route for a test
async function accessProtectedRouteEcho(apiendpoint,apiroute,echoInput) {
    try {

        const response = await fetch(apiendpoint+apiroute, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: echoInput }),
        });

        if (!response.ok) {
            throw new Error('Error: Failed to access Echo protected route');
        }

        const data = await response.json();
        console.info(`Info: Server Response: ${JSON.stringify(data)}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

// Client main
(async () => {

    // Fetching own rodit 
    const { own_rodit, own_roditid_base64url_signature, _ } = await roditconfig(CONFIGURATION_FILE_PATH);

    // Find API endpoint from configuration and rodit
    apiendpoint = `${API_PROTOCOL}://${own_rodit.metadata.subjectuniqueidentifierurl}:${PORT}`;

    // Log in
    const loginSuccess = await login( apiendpoint, own_roditid_base64url_signature, own_rodit );

    // Test a protected route once logged in
    if (loginSuccess) {
        const echoInput = 'Hello, World!';      
        await accessProtectedRouteEcho( apiendpoint, '/api/echo', echoInput );
    }
})();
