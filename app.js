const { importJWK, jwtVerify } = require('jose');

let token = '{"token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ2cG4uY2FibGVndWFyZC5uZXQiLCJzdWIiOiJiYz1uZWFyLm9yZztzYz0wOTMxMy1jYWJsZWd1YXJkLW9yZy50ZXN0bmV0O2lkPTAxSjIxQTBTOU5KQ0ZYSFozVkE1M0swOTdNO3N1Yj0wMUoyMUEwU0NCUVZGN1JTS01ROTQ1RVQ1NyIsImF1ZCI6ImJjPW5lYXIub3JnO3NjPTA5MzEzLWNhYmxlZ3VhcmQtb3JnLnRlc3RuZXQ7aWQ9MDFKMjFBMFM5TkpDRlhIWjNWQTUzSzA5N00iLCJleHAiOjE3MjEwNjAxMDUsIm5iZiI6MTcyMDEzNzYwMCwiaWF0IjoxNzIxMDU2NTA1LCJqdGkiOiJqdGkwMUoyVkZDQkdBUlhQTUI4R0dER0RYR0pUNSIsInJvZGl0aWQiOiIwMUoyMUEwU0NGNFBDVjVCNE45UlZGUlNESyIsInJvZGl0aWRzaWduYXR1cmUiOiJ2V05UNkplaDVaa3ZUX21wRlZQSUoyQ2ZPOGFEWDhhME0xcXFDSzRxbGZILXd3Q2t6VDdHTmZQR0JreWFFN3plX0xLbU5PYnVhSkw4VmFKdzRuUnJDdyJ9.89ln8NQmPhUk4qJqQE7kysoeaJywYMhIvRxjbu9OC_zTarbCVx-i9ADeOS65l_ZgNE3wHoADp7W2ediH8VIjDQ"}';
let publicKey;

async function fetchPublicKey() {
    const publicKeyJwk = {
        kty: "OKP",
        crv: "Ed25519",
        x: "Ix9lAYNP0Q5IKeC6ISTv1V56HyUHxWv7ZEKliMVXz70",
        use: "sig"
    };
    publicKey = await importJWK(publicKeyJwk, 'EdDSA');
}

async function validateToken(token) {
    try {
        const decodedtoken= Buffer.from(token, 'base64url').toString('utf-8');
        console.debug(`Info: token`,decodedtoken);
        console.debug(`Info: publicKey`,publicKey);
        const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
            algorithms: ['EdDSA']
        });

        const now = Math.floor(Date.now() / 1000);

        if (payload.exp <= now) {
            throw new Error('Token has expired');
        }

        if (payload.nbf > now) {
            throw new Error('Token is not yet valid');
        }

        if (payload.iss !== 'vpn.cableguard.net') {
            throw new Error('Invalid issuer');
        }

        if (payload.aud !== 'bc=near.org;sc=09313-cableguard-org.testnet;id=01J21A0S9NJCFXHZ3VA53K097M') {
            throw new Error('Invalid audience');
        }

        return payload;
    } catch (error) {
        console.error('Token validation failed:', error);
        throw error;
    }
}

async function login(peer_roditid, peer_roditid_base64url_signature) {
    try {
        const response = await fetch('http://167.99.5.69:3000/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({peer_roditid, peer_roditid_base64url_signature }),
        });

        if (!response.ok) {
            throw new Error('Login failed');
        }

        const data = await response.json();
        token = data.token;

        await validateToken(token);

        console.log('Logged in successfully!');
        return true;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return false;
    }
}

async function accessProtectedRoute(echoInput) {
    try {
        await validateToken(token);

        const response = await fetch('http://167.99.5.69:3000/api/echo', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: echoInput }),
        });

        console.debug(`response:`, response);

        if (!response.ok) {
            throw new Error('Failed to access protected route');
        }

        const data = await response.json();
        console.debug(`Server response: ${JSON.stringify(data)}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

(async () => {
    await fetchPublicKey();

    const peer_rodit_id = '01J21A0SCBQVF7RSKMQ945ET57';
    const base64url_peer_rodit_id_signature = 'kWtnUDj6AmnhJqJQ2eHJTcopnsis8HH7rGOgPc6gy2Ipv2zFgMmxTR/gZp+fgwRIiyIKHLzAtDmpQnnHw9+BDg==';

    const loginSuccess = await login(peer_rodit_id, base64url_peer_rodit_id_signature);

    if (loginSuccess) {
        const echoInput = 'Hello, World!';
        await accessProtectedRoute(echoInput);
    }
})();
