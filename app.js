// import * as jose from 'jose';

let token = '{"token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ2cG4uY2FibGVndWFyZC5uZXQiLCJzdWIiOiJiYz1uZWFyLm9yZztzYz0wOTMxMy1jYWJsZWd1YXJkLW9yZy50ZXN0bmV0O2lkPTAxSjIxQTBTOU5KQ0ZYSFozVkE1M0swOTdNO3N1Yj0wMUoyMUEwU0NCUVZGN1JTS01ROTQ1RVQ1NyIsImF1ZCI6ImJjPW5lYXIub3JnO3NjPTA5MzEzLWNhYmxlZ3VhcmQtb3JnLnRlc3RuZXQ7aWQ9MDFKMjFBMFM5TkpDRlhIWjNWQTUzSzA5N00iLCJleHAiOjE3MjEwMzg0MDYsIm5iZiI6MTcyMDEzNzYwMCwiaWF0IjoxNzIxMDM0ODA2LCJqdGkiOiJqdGkwMUoyVFRQNUZBMVJHU0FTS1ZRVDZFUEY1VyIsInJvZGl0aWQiOiIwMUoyMUEwU0NGNFBDVjVCNE45UlZGUlNESyIsInJvZGl0aWRzaWduYXR1cmUiOiJ2V05UNkplaDVaa3ZUX21wRlZQSUoyQ2ZPOGFEWDhhME0xcXFDSzRxbGZILXd3Q2t6VDdHTmZQR0JreWFFN3plX0xLbU5PYnVhSkw4VmFKdzRuUnJDdyJ9.OjJHZjtsC_HVYg6hRW3ZnKddIAGZjynS62dsXyNAZT2xMye3RyPz8Xq6HzlbF4ulKLmVj4u5WJN-9hwtsQhUBw"}';
let publicKey;

async function fetchPublicKey() {
    const publicKeyJwk = {
        kty: "OKP",
        crv: "Ed25519",
        x: "MDFKMjFBMFNDRjRQQ1Y1QjROOVJWRlJTREs",
        use: "sig"
    };
    publicKey = await jose.importJWK(publicKeyJwk, 'EdDSA');
}

async function validateToken(token) {
    try {
        const { payload, protectedHeader } = await jose.jwtVerify(token, publicKey, {
            algorithms: ['EdDSA']
        });

        const now = Math.floor(Date.now() / 1000);

        if (payload.exp <= now) {
            throw new Error('Token has expired');
        }

        if (payload.nbf > now) {
            throw new Error('Token is not yet valid');
        }

        if (payload.iss !== 'expected_issuer') {
            throw new Error('Invalid issuer');
        }

        if (payload.aud !== 'expected_audience') {
            throw new Error('Invalid audience');
        }

        return payload;
    } catch (error) {
        console.error('Token validation failed:', error);
        throw error;
    }
}

async function login() {
    const peer_rodit_id = document.getElementById('peer_rodit_id').value;
    const base64url_peer_rodit_id_signature = document.getElementById('base64url_peer_rodit_id_signature').value;

    try {
        const response = await fetch('http://167.99.5.69:3000/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ peer_rodit_id, base64url_peer_rodit_id_signature }),
        });

        if (!response.ok) {
            throw new Error('Login failed');
        }

        const data = await response.json();
        token = data.token;

        await validateToken(token);

        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('protectedRoute').style.display = 'block';
        document.getElementById('output').textContent = 'Logged in successfully!';
    } catch (error) {
        document.getElementById('output').textContent = `Error: ${error.message}`;
    }
}

async function accessProtectedRoute() {
    const echoInput = document.getElementById('echoInput').value;

    try {
        await validateToken(token);

        const response = await fetch('http://167.99.5.69:3000/protected', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: echoInput }),
        });

        if (!response.ok) {
            throw new Error('Failed to access protected route');
        }

        const data = await response.json();
        document.getElementById('output').textContent = `Server response: ${JSON.stringify(data)}`;
    } catch (error) {
        document.getElementById('output').textContent = `Error: ${error.message}`;
    }
}

// Fetch the public key when the page loads
fetchPublicKey();

// Make functions globally available
window.login = login;
window.accessProtectedRoute = accessProtectedRoute;