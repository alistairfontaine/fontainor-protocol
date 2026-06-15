import 'dotenv/config'; // Add this line
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { validateUpload } from './validator.js';
import { initArweave, uploadManifest } from './src/protocol/arweaveUploader.js';
import { devFundArLocal } from './src/protocol/devFundArLocal.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' })); // registry arrays grow; default 100kb is too small
app.use(express.static(__dirname));

// ---- Arweave client (endpoint comes from .env; defaults = ArLocal) ----
const arweave = initArweave({
    host: process.env.AR_HOST || 'localhost',
    port: Number(process.env.AR_PORT || 1984),
    protocol: process.env.AR_PROTOCOL || 'http',
});

// Wallet is loaded lazily per upload from a server-side path (never committed).
function loadWallet() {
    const keyPath = process.env.ARWEAVE_KEY_PATH;
    if (!keyPath) throw new Error('ARWEAVE_KEY_PATH not set in .env');
    return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
}

// Where to READ manifests back from. For ArLocal that's the local node itself;
// for production it's a public gateway (e.g. https://arweave.net or Irys).
const GATEWAY =
    process.env.AR_GATEWAY ||
    `${process.env.AR_PROTOCOL || 'http'}://${process.env.AR_HOST || 'localhost'}:${process.env.AR_PORT || 1984}`;

// ---- Manifest pointer (auto, no manual .env edits) ----
// The "head" of the registry lives in pointer.json on disk.
// Every successful /upload rewrites it; /registry always reads it.
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
        console.error('Pointer read error:', e.message);
    }
    return process.env.REGISTRY_MANIFEST || null;
}

function writeManifestPointer(txId) {
    try {
        fs.writeFileSync(
            POINTER_FILE,
            JSON.stringify({ txId, updatedAt: new Date().toISOString() }, null, 2)
        );
        console.log('Pointer updated -> current manifest:', txId);
    } catch (e) {
        console.error('Pointer write error:', e.message);
    }
}

// Helper: fetch the registry array back from the gateway (ArLocal or public)
async function fetchRegistryFromGateway(txId) {
    if (!txId) throw new Error('No Manifest ID defined');
    const response = await fetch(`${GATEWAY}/${txId}`);
    if (!response.ok) throw new Error('Failed to fetch manifest from gateway');
    return await response.json();
}

// ---- Routes ----

app.get('/registry', async (req, res) => {
    try {
        // Resolve the current manifest from pointer.json (falls back to env, then local file)
        const manifestId = readManifestPointer();
        if (manifestId) {
            const data = await fetchRegistryFromGateway(manifestId);
            res.json(data);
        } else {
            res.sendFile(path.join(__dirname, 'registry.json'));
        }
    } catch (error) {
        console.error('Registry Fetch Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Zod gate first (400 + details on bad shape), then the real Arweave write.
app.post('/upload', validateUpload, async (req, res) => {
    try {
        const wallet = loadWallet();
        const manifest = JSON.stringify(req.body);

        const up = await uploadManifest(manifest, { arweave, wallet });
        if (!up.success) {
            // spec failure shape passes straight through to the frontend
            return res.status(502).json({ success: false, error: up.error, code: up.code });
        }

        // Auto-advance the pointer to the new manifest — closes the persistence loop.
        writeManifestPointer(up.txId);
        return res.json({ success: true, txId: up.txId });
    } catch (error) {
        console.error('Upload route error:', error.message);
        return res.status(500).json({ success: false, error: error.message, code: 'SERVER_ERR' });
    }
});

// Debug: expose the current pointer
app.get('/manifest', (req, res) => {
    res.json({ txId: readManifestPointer() });
});

const PORT = 3000;
app.listen(PORT, async () => {
    console.log(`Fontainor Protocol live at http://localhost:${PORT}`);
    console.log(`Arweave target: ${process.env.AR_HOST || 'localhost'}:${process.env.AR_PORT || 1984} | gateway: ${GATEWAY}`);

    // DEV-ONLY: top up the wallet on local ArLocal. No-op on real networks.
    try {
        const wallet = loadWallet();
        const result = await devFundArLocal(arweave, wallet, {
            host: process.env.AR_HOST || 'localhost',
            enabled: process.env.AR_DEV_AUTOFUND === '1',
            endpoint: GATEWAY,
        });
        if (result.funded) console.log('[dev] ArLocal wallet funded:', result.address);
        else console.log('[dev] auto-fund skipped:', result.reason);
    } catch (e) {
        console.log('[dev] auto-fund error (ignored):', e.message);
    }
});
