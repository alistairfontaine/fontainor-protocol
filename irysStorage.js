require('dotenv').config();
const sdk = require("@irys/sdk");
const NodeIrys = sdk.NodeIrys;

async function uploadData(content) {
    const walletKey = JSON.parse(process.env.WALLET_KEY);

    // Initializing with Devnet URL AND a Provider RPC
    const irys = new NodeIrys({
        url: "https://devnet.irys.xyz",
        token: "arweave",
        key: walletKey,
        config: {
            // This is the required RPC for Arweave Devnet
            providerUrl: "https://arweave.dev"
        }
    });

    try {
        console.log("Connecting to Fontainor Protocol (Devnet)...");
        console.log("Your wallet address:", irys.address);

        const tx = await irys.upload(content, {
            tags: [{ name: "Content-Type", value: "text/plain" }]
        });

        console.log(`✅ Upload success: https://gateway.irys.xyz/${tx.id}`);
        return tx.id;
    } catch (e) {
        console.error("❌ Upload failed:");
        console.error(e.message);
        throw e;
    }
}

module.exports = { uploadData };
