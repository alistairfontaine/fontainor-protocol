require('dotenv').config();
const Arweave = require('arweave');

async function uploadToIrysREST() {
    console.log("Preparing secure payload...");

    // 1. Setup Arweave crypto
    const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });
    const jwk = JSON.parse(process.env.WALLET_KEY);

    // 2. Prepare the data
    const data = "Fontainor Protocol: REST API Success!";

    // 3. We use the Irys transaction structure (Arweave-compatible)
    // Note: Irys requires a specific header for Arweave tokens
    const response = await fetch('https://node1.irys.xyz/tx/arweave', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'x-currency': 'arweave',
            // Here you would eventually add the signature
        },
        body: data
    });

    const result = await response.json();
    console.log("Irys Node Response:", result);
}

uploadToIrysREST();
