const nacl       = require('tweetnacl');
nacl.util        = require('tweetnacl-util');
const config     = require('config');
const { roditconfig, login } = require('./middleware/rodit');
  
// Configuration is now loaded from config files
const CONFIGURATION_FILE_PATH = config.get('CONFIGURATION_FILE_PATH');
const PORT = config.get('PORT');
const API_PROTOCOL = config.get('API_PROTOCOL');

async function testCRUDAperations(apiendpoint, token) {
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
        body: JSON.stringify({ name: 'Test Item', description: 'This is a test item' }),
      });
      if (!response.ok) throw new Error('Failed to create item');
      let data = await response.json();
      console.info(`Created item: ${JSON.stringify(data)}`);
      const createdItemId = data.id;
  
      // READ (list all)
      console.info('Testing READ (list all) operation...');
      response = await fetch(`${apiendpoint}/api/cruda/list`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Failed to list items');
      data = await response.json();
      console.info(`All items: ${JSON.stringify(data)}`);
  
      // READ (single item)
      console.info('Testing READ (single item) operation...');
      response = await fetch(`${apiendpoint}/api/cruda/get`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: createdItemId }),
      });
      if (!response.ok) throw new Error('Failed to get single item');
      data = await response.json();
      console.info(`Single item: ${JSON.stringify(data)}`);
  
      // UPDATE
      console.info('Testing UPDATE operation...');
      response = await fetch(`${apiendpoint}/api/cruda/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: createdItemId, name: 'Updated Test Item', description: 'This item has been updated' }),
      });
      if (!response.ok) throw new Error('Failed to update item');
      data = await response.json();
      console.info(`Updated item: ${JSON.stringify(data)}`);
  
      // DELETE
      console.info('Testing DELETE operation...');
      response = await fetch(`${apiendpoint}/api/cruda/delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: createdItemId }),
      });
      if (!response.ok) throw new Error('Failed to delete item');
      console.info('Item deleted successfully');
  
      // Verify deletion
      console.info('Verifying deletion...');
      response = await fetch(`${apiendpoint}/api/cruda/list`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Failed to list items after deletion');
      data = await response.json();
      console.info(`Items after deletion: ${JSON.stringify(data)}`);
  
      console.info('CRUD operations test completed successfully');
    } catch (error) {
      console.error(`Error during CRUD operations test: ${error.message}`);
    }
  }

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
        await testCRUDAperations(apiendpoint, token);
    }
})();
