// services/irysStorage.js
import Irys from "@irys/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Initializes a high-performance, standalone connection to an Irys Network node.
 * Automatically loads the cryptographic Arweave wallet JSON key from environmental pointers.
 */
const initIrys = () => {
    const keyPath = process.env.ARWEAVE_KEY_PATH;
    if (!keyPath) {
        throw new Error("ARWEAVE_KEY_PATH is missing from environmental parameters.");
    }

    const absoluteKeyPath = path.isAbsolute(keyPath) ? keyPath : path.resolve(__dirname, "..", keyPath);
    if (!fs.existsSync(absoluteKeyPath)) {
        throw new Error(`Target cryptographic wallet keyfile not found at path: ${absoluteKeyPath}`);
    }

    const walletKey = JSON.parse(fs.readFileSync(absoluteKeyPath, "utf8"));

    // Establish network context: route the client directly to your local ArLocal testnet instance
    const nodeUrl = process.env.IRYS_NODE_URL || "http://localhost:1984";
    const token = process.env.IRYS_TOKEN || "arweave";

    return new Irys({

        url: nodeUrl,
        token: token,
        key: walletKey,
    });
};

/**
 * 🔥 PHASE II: ON-CHAIN DECENTRALIZED DATA WRITER ENGINE 🔥
 * Consumes raw concatenated binary file buffers, injects media metadata tags,
 * and streams the assets permanently to decentralized storage infrastructure nodes.
 *
 * @param {Buffer} fileBuffer - The fully concatenated audio data bitstream block.
 * @returns {Promise<{success: boolean, txId: string, message: string}>}
 */
export const uploadToIrys = async (fileBuffer) => {
    try {
        if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
            throw new Error("Invalid payload: Irys engine requires a raw binary data buffer.");
        }

        const irys = initIrys();

        // Define clean, non-bloated on-chain structural tagging parameters
        const tags = [
            { name: "Content-Type", value: "application/octet-stream" },
            { name: "Protocol-Layer", value: "Fontainor-Audio-Registry" },
            { name: "Timestamp-Unix", value: Date.now().toString() }
        ];

        // Execute the direct hardware network transaction stream broadcast pass
        const transaction = await irys.upload(fileBuffer, { tags });

        if (!transaction || !transaction.id) {
            throw new Error("Storage infrastructure node failed to allocate an immutable Transaction ID.");
        }

        return {
            success: true,
            txId: transaction.id,
            message: "Decentralized transaction write finalized cleanly."
        };
    } catch (error) {
        console.error("❌ On-Chain Irys Upload Failed:", error.message);
        return {
            success: false,
            txId: null,
            message: `STORAGE_NODE_FAULT: ${error.message}`
        };
    }
};
