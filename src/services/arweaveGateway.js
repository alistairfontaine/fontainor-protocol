// AT THE VERY TOP OF arweaveGateway.js
require('dotenv').config(); 

const { WebIrys } = require("@irys/sdk");

async function uploadToArweave(registryData) {
    // This line pulls the WALLET_KEY out of your .env file
    const walletKey = JSON.parse(process.env.WALLET_KEY); 

    const irys = new WebIrys({ 
        url: "https://node1.irys.xyz", 
        token: "arweave", 
        key: walletKey 
    });
    // ... rest of your logic ...
}

/**
 * Arweave Gateway Service
 * Handles persisting the Registry to the permanent web.
 */

const { WebIrys } = require("@irys/sdk");

async function uploadToArweave(registryData) {
    console.log("Preparing to anchor registry to Arweave...");

    // 1. Initialize Irys (Mainnet or Devnet)
    const irys = new WebIrys({ 
        url: "https://node1.irys.xyz", 
        token: "arweave", 
        key: process.env.WALLET_KEY // You'll need to set this securely
    });

    // 2. Prepare the data
    const data = JSON.stringify(registryData);
    
    // 3. Upload
    try {
        const receipt = await irys.upload(data, {
            tags: [{ name: "Content-Type", value: "application/json" }]
        });
        
        console.log(`Registry permanently anchored! ID: ${receipt.id}`);
        return receipt.id; // This is your link to the immutable registry
    } catch (e) {
        console.error("Upload failed:", e);
        throw e;
    }
}

module.exports = { uploadToArweave };
