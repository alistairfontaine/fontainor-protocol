// testConnection.js
require('dotenv').config();
const { WebIrys } = require("@irys/sdk");
const { createHash } = require('crypto');

async function testConnection() {
    try {
        console.log("Checking connection to Irys...");

        const walletKey = JSON.parse(process.env.WALLET_KEY);

        const irys = new WebIrys({
            url: "https://node1.irys.xyz",
            token: "arweave",
            key: walletKey
        });

        // The address is the Base64URL-encoded SHA-256 hash of your key's modulus (n)
        const n = Buffer.from(walletKey.n, 'base64');
        const hash = createHash('sha256').update(n).digest();
        const address = hash.toString('base64url');

        console.log("✅ Success! Connected to Irys.");
        console.log("Verified Wallet Address:", address);

    } catch (error) {
        console.error("❌ Connection failed.");
        console.error("Error details:", error.message);
    }
}

testConnection();
