const path       = require('path');
const { Buffer } = require('buffer');
const nacl       = require('tweetnacl');
nacl.util        = require('tweetnacl-util');
const { CONSTANTS, RODiT, roditconfig, validate_jwt_token } = require('./middleware/rodit');
  
const config = {
      CONFIGURATION_FILE_PATH: path.join(
        '/etc/rodit',
        'roditconfig.client'
      ),
};

// Log In
// CG: Strangely enough changing the names of these variables make the whole
// thing stop working. These are OWN RODiT not PEER RODiT
async function login(peer_roditid, peer_roditid_base64url_signature,ownrodit) {
    try {
        apiroute = '/login';
        const response = await fetch(apiendpoint+apiroute, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({peer_roditid, peer_roditid_base64url_signature}),
        });

        if (!response.ok) {
            throw new Error('Error: Login failed');
        }

        const data = await response.json();
        token = data.token;

        await validate_jwt_token(token,ownrodit);

        console.info('Info: Client of API endpoint is logged in');
        return true;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return false;
    }
}

// Accessing the protected route for a test
async function accessProtectedRouteEcho(echoInput) {
    try {

        apiroute = '/api/echo';
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
    const {own_rodit, own_roditid_base64url_signature,nada} = await roditconfig(config.CONFIGURATION_FILE_PATH);

    // Locate the API endpoint
    port = 3000; // CG: hppt until https gets implemented
    apiendpoint = 'http://'+own_rodit.metadata.subjectuniqueidentifierurl+':'+port;

    // Log in
    const loginSuccess = await login(own_rodit.token_id,  own_roditid_base64url_signature,own_rodit);

    if (loginSuccess) {
        const echoInput = 'Hello, World!';
        
        // Access the protected route
        await accessProtectedRouteEcho(echoInput);
    }
})();
