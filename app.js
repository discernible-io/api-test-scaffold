const nacl       = require('tweetnacl');
nacl.util        = require('tweetnacl-util');
const config     = require('config');
const { roditconfig, requestlogin } = require('./middleware/rodit');
  
// Configuration is now loaded from config files
const CONFIGURATION_FILE_PATH = config.get('CONFIGURATION_FILE_PATH');
const PORT = config.get('PORT');
const API_PROTOCOL = config.get('API_PROTOCOL');

async function testCRUDAOperations(apiendpoint, token) {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  
    try {
      // CREATE
      console.info('Testing CREATE operation...');
      let response = await fetch(`${apiendpoint}/api/cruda/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Test Comment', description: 'This is a test comment' }),
      });
      if (!response.ok) throw new Error('Failed to create comment');
      let data = await response.json();
      console.info(`Created comment: ${JSON.stringify(data)}`);
      const createdItemId = data.id;
  
      // READ (list all)
      console.info('Testing READ (list all) operation...');
      response = await fetch(`${apiendpoint}/api/cruda/list`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Failed to list comments');
      data = await response.json();
      console.info(`All comments: ${JSON.stringify(data)}`);

      // READ (single comment)
      console.info('Testing READ (single comment) operation...');
      response = await fetch(`${apiendpoint}/api/cruda/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: createdItemId }),
      });
      if (!response.ok) throw new Error('Failed to get single comment');
      data = await response.json();
      console.info(`Single comment: ${JSON.stringify(data)}`);
  
      // UPDATE
      console.info('Testing UPDATE operation...');
      response = await fetch(`${apiendpoint}/api/cruda/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: createdItemId, name: 'Updated Test Comment', description: 'This comment has been updated' }),
      });
      if (!response.ok) throw new Error('Failed to update comment');
      data = await response.json();
      console.info(`Updated comment: ${JSON.stringify(data)}`);
  
      // DESTROY
      console.info('Testing DESTROY operation...');
      response = await fetch(`${apiendpoint}/api/cruda/destroy`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: createdItemId }),
      });
      if (!response.ok) throw new Error('Failed to destroy comment');
      console.info('Comment destroyed successfully');
  
      // Verify deletion
      console.info('Verifying deletion...');
      response = await fetch(`${apiendpoint}/api/cruda/list`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Failed to list comments after deletion');
      data = await response.json();
      console.info(`Items after deletion: ${JSON.stringify(data)}`);
  
      console.info('CRUD operations test completed successfully');
    } catch (error) {
      console.error(`Error during CRUD operations test: ${error.message}`);
    }
  }

// Accessing the protected route for a test
async function accessProtectedRouteEcho(apiendpoint,apiroute,echoInput, token) {
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
    console.debug(`'Hello, World!'`);
}

// Client main
(async () => {

    // Fetching own rodit 
    const { own_rodit, own_roditid_base64url_signature, _ } = await roditconfig(CONFIGURATION_FILE_PATH);

    // Find API endpoint from configuration and rodit
    apiendpoint = `${API_PROTOCOL}://${own_rodit.metadata.subjectuniqueidentifierurl}:${PORT}`;

    // Log in
    const jwt_token = await requestlogin( apiendpoint, own_roditid_base64url_signature, own_rodit );

    // Test a protected route once logged in
    if (jwt_token) {
        const echoInput = 'Hello, World!';
        await accessProtectedRouteEcho( apiendpoint, '/api/echo', echoInput, jwt_token );
        await testCRUDAOperations(apiendpoint, jwt_token);
    }
})();
