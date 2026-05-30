import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadData } from './irysStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Helper: Fetches the registry array from Irys
async function fetchRegistryFromIrys(txId) {
    if (!txId) throw new Error("No Manifest ID defined");
    const response = await fetch(`https://gateway.irys.xyz/${txId}`);
    if (!response.ok) throw new Error("Failed to fetch from Irys");
    return await response.json();
}

app.get('/registry', async (req, res) => {
    try {
        // If we have a manifest ID, fetch from blockchain.
        // Fallback to local file if the env variable isn't set yet.
        if (process.env.REGISTRY_MANIFEST) {
            const data = await fetchRegistryFromIrys(process.env.REGISTRY_MANIFEST);
            res.json(data);
        } else {
            res.sendFile(path.join(__dirname, 'registry.json'));
        }
    } catch (error) {
        console.error("Registry Fetch Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/upload', async (req, res) => {
    console.log("DEBUG: Received upload request body:", JSON.stringify(req.body, null, 2));
    try {
        const data = req.body;

        if (!data || Object.keys(data).length === 0) {
            throw new Error("Data payload is empty");
        }

        const txId = await uploadData(data);
        res.json({ success: true, txId });
    } catch (error) {
        console.error("Backend Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Fontainor Protocol live at http://localhost:${PORT}`);
});
