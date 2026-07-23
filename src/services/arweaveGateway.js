import dotenv from 'dotenv';
import { WebIrys } from "@irys/sdk";

dotenv.config();

/**
 * Arweave Gateway Service
 * Handles persisting the Registry to the permanent web via Irys.
 */
export async function uploadToArweave(registryData) {
    console.log("Preparing to anchor registry to Arweave...");

    let walletKey;
    try {
        walletKey = JSON.parse(process.env.WALLET_KEY);
    } catch (e) {
        walletKey = process.env.WALLET_KEY;
    }

    if (!walletKey) {
        throw new Error("WALLET_KEY is missing from environment configuration.");
    }

    const irys = new WebIrys({
        url: "https://irys.xyz",
        token: "arweave",
        key: walletKey
    });

    const data = JSON.stringify(registryData);

    try {
        const receipt = await irys.upload(data, {
            tags: [{ name: "Content-Type", value: "application/json" }]
        });

        console.log(`Registry permanently anchored! ID: ${receipt.id}`);
        return receipt.id;
    } catch (error) {
        console.error("Arweave upload failed:", error);
        throw error;
    }
}
