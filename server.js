import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { uploadData } from './irysStorage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ---- Manifest pointer (auto, no more manual .env edits) ----
// The "head" of the registry is stored in pointer.json on disk.
// On every successful /upload we rewrite it; /registry always reads it.
const POINTER_FILE = path.join(__dirname, 'pointer.json');

function readManifestPointer() {
    // Priority: pointer.json -> REGISTRY_MANIFEST env (legacy/seed) -> null
    try {
        if (fs.existsSync(POINTER_FILE)) {
            const raw = fs.readFileSync(POINTER_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.txId) return parsed.txId;
        }
    } catch (e) {
        console.error("Pointer read error:", e.message);
    }
    return process.env.REGISTRY_MANIFEST || null;
}

function writeManifestPointer(txId) {
    try {
        fs.writeFileSync(
            POINTER_FILE,
            JSON.stringify({ txId, updatedAt: new Date().toISOString() }, null, 2)
        );
        console.log("Pointer updated -> current manifest:", txId);
    } catch (e) {
        console.error("Pointer write error:", e.message);
    }
}

// Helper: Fetches the registry array from Irys
async function fetchRegistryFromIrys(txId) {
    if (!txId) throw new Error("No Manifest ID defined");
    const response = await fetch(`https://gateway.irys.xyz/${txId}`);
    if (!response.ok) throw new Error("Failed to fetch from Irys");
    return await response.json();
}

app.get('/registry', async (req, res) => {
    try {
        // Resolve the current manifest from pointer.json (falls back to env, then local file)
        const manifestId = readManifestPointer();
        if (manifestId) {
            const data = await fetchRegistryFromIrys(manifestId);
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

        // Auto-advance the pointer to the new manifest — no manual .env edit needed.
        writeManifestPointer(txId);

        res.json({ success: true, txId });
    } catch (error) {
        console.error("Backend Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Optional: expose the current pointer for debugging / the UI
app.get('/manifest', (req, res) => {
    res.json({ txId: readManifestPointer() });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Fontainor Protocol live at http://localhost:${PORT}`);
});
