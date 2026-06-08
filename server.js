import express from 'express';
import fs from 'fs';
import { validateUpload } from './validator.js';
import { initArweave, uploadManifest } from './src/protocol/arweaveUploader.js';

const app = express();
app.use(express.json());

// Placeholder for your existing pointer logic
// Ensure this matches the function you already have in your project
function writeManifestPointer(txId) {
    console.log("Pointer updated for tx:", txId);
}

// Updated /upload route
app.post('/upload', validateUpload, async (req, res) => {
    try {
        // 1. Load the wallet securely from the path in your .env
        const wallet = JSON.parse(fs.readFileSync(process.env.ARWEAVE_KEY_PATH, 'utf8'));

        // 2. Initialize Arweave client
        const arweave = initArweave({
            host: process.env.AR_HOST || 'localhost',
            port: Number(process.env.AR_PORT || 1984),
            protocol: process.env.AR_PROTOCOL || 'http',
        });

        // 3. Stringify the validated body data
        const manifest = JSON.stringify(req.body);

        // 4. Upload to Arweave
        const up = await uploadManifest(manifest, { arweave, wallet });

        if (!up.success) {
            return res.status(502).json({ success: false, error: up.error, code: up.code });
        }

        // 5. Finalize and respond
        writeManifestPointer(up.txId);
        return res.json({ success: true, txId: up.txId });

    } catch (error) {
        console.error("Upload route error:", error);
        return res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

app.listen(3000, () => console.log('Fontainor Protocol running on port 3000'));
