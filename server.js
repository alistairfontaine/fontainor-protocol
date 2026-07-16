import 'dotenv/config';
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

// --- App Setup ---
const app = express();
// Middleware to handle raw binary chunks (for audio upload)
const rawBodyParser = express.raw({ type: 'application/octet-stream', limit: '1mb' });
// In-memory store for chunking
const uploadBuffer = new Map();

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname));

// --- Arweave Setup ---
const arweave = initArweave({
    host: process.env.AR_HOST || 'localhost',
    port: Number(process.env.AR_PORT || 1984),
    protocol: process.env.AR_PROTOCOL || 'http',
});

function loadWallet() {
    const keyPath = process.env.ARWEAVE_KEY_PATH;
    if (!keyPath) throw new Error('ARWEAVE_KEY_PATH not set in .env');
    return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
}

const GATEWAY = process.env.AR_GATEWAY || `${process.env.AR_PROTOCOL || 'http'}://${process.env.AR_HOST || 'localhost'}:${process.env.AR_PORT || 1984}`;

// --- Manifest Pointer Logic ---
const POINTER_FILE = path.join(__dirname, 'pointer.json');

function readManifestPointer() {
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
        fs.writeFileSync(POINTER_FILE, JSON.stringify({ txId, updatedAt: new Date().toISOString() }, null, 2));
    } catch (e) {
        console.error('Pointer write error:', e.message);
    }
}

async function fetchRegistryFromGateway(txId) {
    if (!txId) throw new Error('No Manifest ID defined');
    const response = await fetch(`${GATEWAY}/${txId}`);
    if (!response.ok) throw new Error('Failed to fetch manifest from gateway');
    return await response.json();
}

// --- Routes ---

// 1. Registry
app.get('/registry', async (req, res) => {
    try {
        const manifestId = readManifestPointer();
        if (manifestId) {
            const data = await fetchRegistryFromGateway(manifestId);
            res.json(data);
        } else {
            res.sendFile(path.join(__dirname, 'registry.json'));
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Upload (Manifest)
app.post('/upload', validateUpload, async (req, res) => {
    try {
        const wallet = loadWallet();
        const manifest = JSON.stringify(req.body);
        const up = await uploadManifest(manifest, { arweave, wallet });
        if (!up.success) return res.status(502).json({ success: false, error: up.error, code: up.code });
        writeManifestPointer(up.txId);
        return res.json({ success: true, txId: up.txId });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message, code: 'SERVER_ERR' });
    }
});

// 3. Audio Chunk Upload
app.post('/api/v1/upload-audio/chunk', rawBodyParser, async (req, res) => {
    try {
        const uploadId = req.headers['x-upload-id'];
        const chunkIndex = parseInt(req.headers['x-chunk-index']);
        const totalChunks = parseInt(req.headers['x-total-chunks']);

        if (!uploadId || isNaN(chunkIndex) || !req.body) {
            return res.status(400).json({ success: false, message: "Missing headers or binary body" });
        }

        if (!uploadBuffer.has(uploadId)) {
            uploadBuffer.set(uploadId, new Array(totalChunks).fill(null));
        }

        const session = uploadBuffer.get(uploadId);
        session[chunkIndex] = req.body; // Buffer stored here

        if (chunkIndex === totalChunks - 1) {
            const fullFileBuffer = Buffer.concat(session);

            /* 🔥 PHASE II: BIND REAL ON-CHAIN DECENTRALIZED DATA WRITER 🔥 */
            const { uploadToIrys } = await import('./services/irysStorage.js');
            const storageResult = await uploadToIrys(fullFileBuffer);

            // Clean up the volatile in-memory cache space to prevent server heap bloat
            uploadBuffer.delete(uploadId);

            if (!storageResult.success) {
                return res.status(502).json({
                    success: false,
                    error: "BLOCKCHAIN_WRITE_FAILED",
                    message: storageResult.message
                });
            }

            return res.status(201).json({
                success: true,
                audioUri: `https://arweave.net/${storageResult.txId}`
            });
        }
        return res.status(200).json({ success: true, chunkReceived: chunkIndex });
    } catch (err) {
        return res.status(500).json({ success: false, error: "CHUNK_WRITE_FAILED", message: err.message });
    }
});

app.get('/manifest', (req, res) => {
    res.json({ txId: readManifestPointer() });
});

// --- Start Server ---
const PORT = 3000;
app.listen(PORT, async () => {
    console.log(`Fontainor Protocol live at http://localhost:${PORT}`);
    try {
        const wallet = loadWallet();
        await devFundArLocal(arweave, wallet, {
            host: process.env.AR_HOST || 'localhost',
            enabled: process.env.AR_DEV_AUTOFUND === '1',
            endpoint: GATEWAY,
        });
    } catch (e) {
        console.log('[dev] auto-fund skipped/error');
    }
});
