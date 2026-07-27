import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bs58 from 'bs58';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serverless fallback placeholders to keep the engine from crashing on boot
let validateUpload = (req, res, next) => next();
let initArweave = () => ({ transactions: { sign: () => {}, post: () => {} }, createTransaction: () => {} });
let uploadManifest = async () => ({ success: false, error: 'Serverless gateway mode active' });

// Safely try to import local dependencies without throwing 500 runtime panics
try {
    const validatorModule = await import('./validator.js');
    validateUpload = validatorModule.validateUpload;
} catch (e) { console.warn("⚠️ Local validator module deferred."); }

// --- App Setup ---
const app = express();
// Middleware configuration: accept raw binary streams up to 100MB to accommodate compiled files safely
const rawBodyParser = express.raw({ type: 'application/octet-stream', limit: '100mb' });
// In-memory store for chunking
const uploadBuffer = new Map();


app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname));

// --- Arweave Setup ---
const arweave = initArweave({
    host: process.env.AR_HOST || 'arweave.net',
    port: Number(process.env.AR_PORT || 443),
    protocol: process.env.AR_PROTOCOL || 'https',
});

function loadWallet() {
    // Fly.io / serverless: wallet JSON stored as env var
    if (process.env.ARWEAVE_KEY_JSON) {
        try { return JSON.parse(process.env.ARWEAVE_KEY_JSON) }
        catch (e) { console.error('Failed to parse ARWEAVE_KEY_JSON:', e.message) }
    }
    const keyPath = process.env.ARWEAVE_KEY_PATH;
    if (!keyPath || !fs.existsSync(keyPath)) return {};
    return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
}

const GATEWAY = process.env.AR_GATEWAY || 'https://arweave.net';

// --- Durable registry via Upstash Redis (survives serverless redeploys) ---
// Configure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in Vercel env
// vars (free tier at upstash.com). Without them, behavior is unchanged
// (Arweave manifest pointer + ephemeral filesystem).
const REGISTRY_KEY = 'fontainor:registry:v1';
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
        const { Redis } = await import('@upstash/redis');
        redis = Redis.fromEnv();
        console.log('✓ Upstash Redis configured — registry is durable.');
    } catch (e) {
        console.error('⚠️ @upstash/redis failed to load, falling back:', e.message);
    }
}

async function readDurableRegistry() {
    if (!redis) return null;
    try {
        const data = await redis.get(REGISTRY_KEY);
        return Array.isArray(data) ? data : null;
    } catch (e) {
        console.error('Redis read error:', e.message);
        return null;
    }
}

async function writeDurableRegistry(manifestArray) {
    if (!redis) return false;
    try {
        await redis.set(REGISTRY_KEY, manifestArray);
        return true;
    } catch (e) {
        console.error('Redis write error:', e.message);
        return false;
    }
}

// --- Manifest Pointer Logic ---
const POINTER_FILE = path.join(__dirname, 'pointer.json');

function readManifestPointer() {
    // 🔒 PROD SAFETY: Priority sequence for serverless execution environments
    if (process.env.REGISTRY_MANIFEST) return process.env.REGISTRY_MANIFEST;
    try {
        if (fs.existsSync(POINTER_FILE)) {
            const raw = fs.readFileSync(POINTER_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.txId) return parsed.txId;
        }
    } catch (e) {
        console.error('Pointer read error:', e.message);
    }
    return null;
}


/**
 * 🔥 MILESTONE D1-D2: 10-TxID ROLLING HISTORY LOG CONTROLLER 🔥
 * Manages the active state manifest pointer using a bounded array queue matrix.
 * Retains a chronological history stack of the last 10 successful transactions
 * to provide robust data rollback protection layers across the protocol network.
 */
function writeManifestPointer(txId) {
    try {
        let history = [];

        // If the pointer node already exists on disk, read and parse its structural fields
        if (fs.existsSync(POINTER_FILE)) {
            try {
                const raw = fs.readFileSync(POINTER_FILE, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.history)) {
                    history = parsed.history;
                } else if (parsed && parsed.txId) {
                    // Backwards compatibility fallback loop if upgrading from an older single txId schema
                    history.push({ txId: parsed.txId, updatedAt: parsed.updatedAt || new Date().toISOString() });
                }
            } catch (e) {
                console.warn('⚠️ Existing pointer parse failure — initializing clean history queue.');
            }
        }

        // Push the brand new decentralized transaction hash onto the front of the chronological stack
        history.unshift({
            txId,
            updatedAt: new Date().toISOString()
        });

        // Enforce rigid, lean allocation constraints: truncate the array stack to exactly 10 slots
        if (history.length > 10) {
            history = history.slice(0, 10);
        }

        // Commit the complete historical data matrix cleanly back to the local file block
        const payload = {
            txId,
            updatedAt: history[0].updatedAt,
            history
        };

        fs.writeFileSync(POINTER_FILE, JSON.stringify(payload, null, 2));
        console.log(`📝 [Registry Pointer] Consolidated rolling ledger entry. Active Top TxID: ${txId}`);
    } catch (e) {
        console.error('❌ Critical pointer history write violation:', e.message);
    }
}

async function fetchRegistryFromGateway(txId) {
    if (!txId) throw new Error('No Manifest ID defined');
    // Manifests can live on Arweave L1 (legacy, server wallet) or be Irys
    // bundle items (musician-pays publish flow). Try both gateways.
    for (const base of [GATEWAY, 'https://gateway.irys.xyz']) {
        try {
            const response = await fetch(`${base}/${txId}`);
            if (response.ok) return await response.json();
        } catch { /* try next gateway */ }
    }
    throw new Error('Failed to fetch manifest from gateway');
}

// --- Registry self-heal via Irys GraphQL ---
// The musician-pays publish flow uploads every registry manifest to Irys with
// these tags. If the serverless pointer is lost (cold start) and no durable
// store is configured, the newest tagged manifest is recovered from the
// permanent record, so the catalog survives redeploys even with zero env vars.
// NOTE: tags are not access-controlled; a durable store (Upstash), once
// configured, always takes precedence over this recovery path.
const MANIFEST_TAGS = [
    { name: 'App-Name', value: 'Fontainor-Protocol' },
    { name: 'Type', value: 'registry-manifest' },
];

async function recoverLatestManifestFromIrys() {
    try {
        const query = `query { transactions(tags: [
            { name: "App-Name", values: ["Fontainor-Protocol"] },
            { name: "Type", values: ["registry-manifest"] }
        ], order: DESC, limit: 1) { edges { node { id } } } }`;
        const res = await fetch('https://uploader.irys.xyz/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        if (!res.ok) return null;
        const out = await res.json();
        const id = out?.data?.transactions?.edges?.[0]?.node?.id;
        if (!id) return null;
        const data = await fetchRegistryFromGateway(id);
        if (!Array.isArray(data) || data.length === 0) return null;
        writeManifestPointer(id); // warm-instance cache for subsequent reads
        return data;
    } catch (e) {
        console.error('Irys manifest recovery failed:', e.message);
        return null;
    }
}

// --- Routes ---

// 1. Registry Ingress Gate
app.get('/registry', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, content-type, Authorization, X-Upload-Id, X-Chunk-Index, X-Total-Chunks');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // durable store first — survives redeploys, no gateway round-trip
        const durable = await readDurableRegistry();
        if (durable && durable.length > 0) return res.json(durable);

        const txId = readManifestPointer();
        if (txId) {
            const data = await fetchRegistryFromGateway(txId);
            // backfill the durable store so the next read skips the gateway
            if (Array.isArray(data) && data.length > 0) {
                await writeDurableRegistry(data);
                return res.json(data);
            }
        }

        // last resort: recover the newest published manifest from Irys
        const recovered = await recoverLatestManifestFromIrys();
        if (recovered) {
            await writeDurableRegistry(recovered);
            return res.json(recovered);
        }
        return res.json([]);
    } catch (error) {
        console.error('Registry fetch error:', error.message);
        // even on pointer/gateway errors, attempt permanent-record recovery
        try {
            const recovered = await recoverLatestManifestFromIrys();
            if (recovered) return res.status(200).json(recovered);
        } catch { /* fall through */ }
        return res.status(200).json([]);
    }
});

// 2. Upload (Manifest)
app.post('/upload', validateUpload, async (req, res) => {
    try {
        const manifestArray = Array.isArray(req.body) ? req.body : [req.body];

        // Try the permanent write first when a funded wallet exists.
        const wallet = loadWallet();
        const hasWallet = wallet && Object.keys(wallet).length > 0;
        let txId = null;
        if (hasWallet) {
            const up = await uploadManifest(JSON.stringify(req.body), { arweave, wallet });
            if (up.success) {
                writeManifestPointer(up.txId);
                txId = up.txId;
            } else if (!redis) {
                // no durable fallback either — surface the Arweave failure as before
                return res.status(502).json({ success: false, error: up.error, code: up.code });
            }
        }

        // Durable registry write (works with or without Arweave).
        const durableOk = await writeDurableRegistry(manifestArray);
        if (!txId && !durableOk) {
            return res.status(502).json({
                success: false,
                error: 'No write target available: fund an Arweave wallet or set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.',
                code: 'NO_WRITE_TARGET',
            });
        }
        return res.json({ success: true, txId: txId ?? 'REGISTRY_' + Date.now().toString(36).toUpperCase(), durable: durableOk, arweave: txId != null });
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
            console.log(`📦 Final chunk received. Concatenating bitstream (${fullFileBuffer.length} bytes)...`);

            /* 🔥 NATIVE BARE-METAL ARWEAVE TRANSACTION ENGINE 🔥 */
            try {
                const wallet = loadWallet();

                // 🔒 FIXED: Securely copy the exact file bitstream into an isolated standard web Uint8Array
                const binaryDataArray = new Uint8Array(fullFileBuffer);

                // 1. Instantiate a raw data transaction container directly from the verified byte array
                const transaction = await arweave.createTransaction({
                    data: binaryDataArray
                }, wallet);


                // 2. Attach standard, high-integrity cryptographic protocol tags
                transaction.addTag('Content-Type', 'application/octet-stream');
                transaction.addTag('Protocol-Layer', 'Fontainor-Audio-Registry');

                // 3. Cryptographically sign the transaction using the local developer JWK wallet
                await arweave.transactions.sign(transaction, wallet);
                const txId = transaction.id;

                // 4. Broadcast the signed transaction bytes to Arweave mainnet
                let finalTxId = txId;

                try {
                    const response = await arweave.transactions.post(transaction);

                    if (response.status !== 200 && response.status !== 208) {
                        throw new Error(`Node rejected with status: ${response.status}`);
                    }

                    console.log(`🎯 [Blockchain] Audio upload successful! Permanent TxID: ${txId}`);
                } catch (nodeError) {
                    console.error(`❌ Arweave upload failed: ${nodeError.message}`);
                    uploadBuffer.delete(uploadId);
                    return res.status(502).json({
                        success: false,
                        error: "BLOCKCHAIN_WRITE_FAILED",
                        message: nodeError.message
                    });
                }

                // Wipe the volatile in-memory storage buffer array space to prevent heap leakage
                uploadBuffer.delete(uploadId);

                return res.status(201).json({
                    success: true,
                    audioUri: `https://arweave.net/${finalTxId}`
                });




            } catch (storageError) {
                console.error("❌ On-Chain Native Arweave Upload Failed:", storageError.message);
                uploadBuffer.delete(uploadId);
                return res.status(502).json({
                    success: false,
                    error: "BLOCKCHAIN_WRITE_FAILED",
                    message: storageError.message
                });
            }
        }

        return res.status(200).json({ success: true, chunkReceived: chunkIndex });
    } catch (err) {
        return res.status(500).json({ success: false, error: "CHUNK_WRITE_FAILED", message: err.message });
    }
});

// 4. Solana On-Chain Payment Settlement & Token Minting Gate
app.post('/api/v1/verify-payment', async (req, res) => {
    try {
        const { signature, artistWallet, amountLamports, buyerWallet, currency, trackId } = req.body;

        if (!signature || !artistWallet || !trackId || !(Number(amountLamports) > 0)) {
            return res.status(400).json({ success: false, message: 'Missing signature, artistWallet, trackId or amountLamports.' });
        }

        // Verify the 98/2 split actually happened on the Solana ledger.
        const { verifySolanaPayment } = await import('./paymentBridge.js');
        const isVerified = await verifySolanaPayment(signature, artistWallet, Number(amountLamports), currency || 'SOL');
        if (!isVerified) {
            return res.status(400).json({ success: false, message: 'On-chain payment verification failed.' });
        }

        // Durable purchase receipt (best-effort; requires Upstash env vars).
        let receiptStored = false;
        if (redis) {
            try {
                await redis.lpush('fontainor:purchases:v1', JSON.stringify({
                    trackId,
                    signature,
                    artistWallet,
                    buyerWallet: buyerWallet || null,
                    amountLamports: Number(amountLamports),
                    currency: currency || 'SOL',
                    verifiedAt: new Date().toISOString(),
                }));
                receiptStored = true;
            } catch (e) {
                console.error('Purchase receipt write failed:', e.message);
            }
        }

        return res.json({ success: true, verified: true, receiptStored, signature });
    } catch (err) {
        console.error('Payment verification endpoint crashed:', err.message);
        return res.status(500).json({ success: false, error: 'SETTLEMENT_CRASH', message: err.message });
    }
});


// 5. Zero-Cost Cryptographic Sovereign Identity Login Gate
app.post('/api/v1/auth/sovereign-login', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { publicKey, signature, message } = req.body;
        if (!publicKey || !signature) {
            return res.status(400).json({ success: false, message: "Missing wallet verification payload." });
        }

        const nacl = await import('tweetnacl');
        const encodedMessage = new TextEncoder().encode(message || "Authenticate Fontainor Sovereign Session");

        const signatureBytes = Uint8Array.from(JSON.parse(signature));
        const publicKeyBytes = Uint8Array.from(JSON.parse(publicKey));

        const isWalletOwnerVerified = nacl.default.sign.detached.verify(encodedMessage, signatureBytes, publicKeyBytes);

        if (!isWalletOwnerVerified) {
            return res.status(401).json({ success: false, message: "Cryptographic signature validation rejected." });
        }

        // Derive the base58 address from the *verified* public key bytes so the
        // handle is human-readable (raw `publicKey` is a JSON byte-array string and
        // produces garbage handles like "@[132...,72]") and cannot be spoofed.
        const displayKey = bs58.encode(publicKeyBytes);
        return res.json({
            success: true,
            wallet: displayKey,
            handle: `@${displayKey.slice(0, 4)}...${displayKey.slice(-4)}`
        });
    } catch (authError) {
        return res.status(500).json({ success: false, message: authError.message });
    }
});
// 6. Publish Manifest Pointer Update
app.post('/api/v1/publish', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { txId } = req.body;
        if (!txId || typeof txId !== 'string' || txId.length < 10 || txId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(txId)) {
            return res.status(400).json({ success: false, error: 'Invalid txId' });
        }
        // Fetch and sanity-check the manifest before repointing the registry:
        // it must resolve on a gateway and parse as a non-empty array.
        let manifest = null;
        try {
            manifest = await fetchRegistryFromGateway(txId);
        } catch {
            return res.status(400).json({ success: false, error: 'Manifest not resolvable on any gateway yet — retry in a few seconds.' });
        }
        if (!Array.isArray(manifest) || manifest.length === 0) {
            return res.status(400).json({ success: false, error: 'Manifest is not a non-empty registry array.' });
        }
        writeManifestPointer(txId);
        const durable = await writeDurableRegistry(manifest);
        return res.json({ success: true, txId, durable });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/manifest', (req, res) => {
    res.json({ txId: readManifestPointer() });
});


// --- Start Server ---

// 🔒 VERCEL SERVERLESS FUNCTION HANDSHAKE PASS 🔒
// We export the app instance cleanly, allowing Vercel to route incoming web requests natively.
export default app;

