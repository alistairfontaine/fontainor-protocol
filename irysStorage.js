import 'dotenv/config';
import { NodeIrys } from "@irys/sdk";

export async function uploadData(dataObject) {
    const walletKey = JSON.parse(process.env.WALLET_KEY);

    const irys = new NodeIrys({
        url: "https://node1.irys.xyz",
        token: "arweave",
        key: walletKey,
        config: { providerUrl: "https://arweave.net" }
    });

    await irys.ready();

    try {
        console.log("Uploading data object to Irys...");

        // Convert the full object to a JSON string then a Buffer
        const dataBuffer = Buffer.from(JSON.stringify(dataObject));

        const tx = await irys.upload(dataBuffer, {
            tags: [
                { name: "Content-Type", value: "application/json" },
                { name: "App-Name", value: "Fontainor-Protocol" }
            ]
        });

        console.log(`✅ Upload success: https://gateway.irys.xyz/${tx.id}`);
        return tx.id;
    } catch (e) {
        console.error("❌ Deep Error Info:", e);
        throw e;
    }
}
