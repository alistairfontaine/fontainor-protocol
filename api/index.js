import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bs58 from 'bs58';
import { checkAppendOnly, findHandleConflicts, getProtectedOwner, normalizeHandle } from './registryGuard.js';

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
const PURCHASES_KEY = 'fontainor:purchases:v1';
const favoritesKey = (wallet) => `fontainor:favorites:v1:${wallet}`;
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

// --- Wallet-bound handles (claimed usernames) ---
// Two Upstash hashes: wallet -> bare handle, and bare handle -> wallet.
// Claiming requires a fresh Phantom signature, so a handle can only ever be
// bound to a wallet whose private key signed the claim.
const HANDLES_BY_WALLET = 'fontainor:handles:byWallet:v1';
const HANDLES_BY_NAME = 'fontainor:handles:byName:v1';

async function getHandleForWallet(wallet) {
    if (!redis) return null;
    try {
        const h = await redis.hget(HANDLES_BY_WALLET, wallet);
        return typeof h === 'string' && h ? h : null;
    } catch (e) {
        console.error('Redis handle read error:', e.message);
        return null;
    }
}

async function getWalletForHandle(bareHandle) {
    if (!redis) return null;
    try {
        const w = await redis.hget(HANDLES_BY_NAME, bareHandle);
        return typeof w === 'string' && w ? w : null;
    } catch (e) {
        console.error('Redis handle read error:', e.message);
        return null;
    }
}

/**
 * Manifest safety gate shared by /upload and /api/v1/publish:
 * append-only vs. the trusted durable registry + claimed-handle ownership
 * on new entries. Returns null when clean, otherwise {status, body}.
 */
async function guardIncomingManifest(incoming) {
    // Trusted baseline: durable store first, then the live manifest pointer.
    // With neither available there is no trusted state to defend yet.
    let current = await readDurableRegistry();
    if (!current || current.length === 0) {
        try {
            const txId = readManifestPointer();
            if (txId) {
                const fromGateway = await fetchRegistryFromGateway(txId);
                if (Array.isArray(fromGateway)) current = fromGateway;
            }
        } catch { /* gateway unreachable — fall through */ }
    }
    current = current ?? [];
    const check = checkAppendOnly(current, incoming);
    if (!check.ok) {
        return { status: 403, body: { success: false, error: check.error, code: 'REGISTRY_TAMPER' } };
    }
    const conflicts = await findHandleConflicts(check.newEntries, getWalletForHandle);
    if (conflicts.length > 0) {
        const c = conflicts[0];
        return {
            status: 403,
            body: {
                success: false,
                code: 'HANDLE_OWNED',
                error: `"${c.artist}" is a claimed handle bound to another wallet. Publish with your own name, or sign in with the wallet that owns it.`,
            },
        };
    }
    return null;
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

        // Tamper/impersonation gate: append-only vs. trusted registry,
        // claimed handles only publishable by their owner wallet.
        const guardFail = await guardIncomingManifest(manifestArray);
        if (guardFail) return res.status(guardFail.status).json(guardFail.body);

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
                await redis.lpush(PURCHASES_KEY, JSON.stringify({
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
        // Claimed username wins over the address-derived fallback.
        const claimed = await getHandleForWallet(displayKey);
        return res.json({
            success: true,
            wallet: displayKey,
            handle: claimed ? `@${claimed}` : `@${displayKey.slice(0, 4)}...${displayKey.slice(-4)}`,
            claimed: Boolean(claimed),
        });
    } catch (authError) {
        return res.status(500).json({ success: false, message: authError.message });
    }
});

// 5b. Claim / change a wallet-bound @handle.
// The wallet signs `Fontainor handle claim: @<handle>` so a handle can only
// ever be bound by whoever controls the wallet's private key. Uniqueness is
// case-insensitive; changing your handle releases the old one.
app.post('/api/v1/auth/set-handle', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { publicKey, signature, handle } = req.body;
        if (!publicKey || !signature || !handle) {
            return res.status(400).json({ success: false, message: 'Missing wallet verification payload or handle.' });
        }

        const bare = normalizeHandle(handle);
        if (!bare) {
            return res.status(400).json({
                success: false,
                code: 'HANDLE_INVALID',
                message: 'Handles are 3–20 characters: lowercase letters, numbers, underscores (reserved names excluded).',
            });
        }

        const nacl = await import('tweetnacl');
        const expectedMessage = `Fontainor handle claim: @${bare}`;
        const encodedMessage = new TextEncoder().encode(expectedMessage);
        const signatureBytes = Uint8Array.from(JSON.parse(signature));
        const publicKeyBytes = Uint8Array.from(JSON.parse(publicKey));
        const verified = nacl.default.sign.detached.verify(encodedMessage, signatureBytes, publicKeyBytes);
        if (!verified) {
            return res.status(401).json({ success: false, message: 'Cryptographic signature validation rejected.' });
        }

        if (!redis) {
            return res.status(503).json({
                success: false,
                code: 'HANDLES_UNAVAILABLE',
                message: 'Username registry is not configured on this deployment yet.',
            });
        }

        const wallet = bs58.encode(publicKeyBytes);
        const protectedOwner = getProtectedOwner(bare);
        if (protectedOwner && protectedOwner !== wallet) {
            return res.status(403).json({
                success: false,
                code: 'HANDLE_PROTECTED',
                message: `@${bare} is reserved for the project and can only be claimed by its official wallet.`,
            });
        }
        const existingOwner = await getWalletForHandle(bare);
        if (existingOwner && existingOwner !== wallet) {
            return res.status(409).json({ success: false, code: 'HANDLE_TAKEN', message: `@${bare} is already claimed.` });
        }

        const previous = await getHandleForWallet(wallet);
        await redis.hset(HANDLES_BY_NAME, { [bare]: wallet });
        await redis.hset(HANDLES_BY_WALLET, { [wallet]: bare });
        if (previous && previous !== bare) {
            try { await redis.hdel(HANDLES_BY_NAME, previous); }
            catch (e) { console.error('Old handle release failed:', e.message); }
        }

        return res.json({ success: true, wallet, handle: `@${bare}` });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});


// 6. Wallet-Portable Profile — purchases + favorites follow the wallet across devices.
//    Reads are public (everything here is already public on-chain / low-stakes);
//    favorites writes require the same TweetNaCl signature the sovereign login uses.

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function profileCors(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
    return false;
}

// 6a. Purchases by buyer wallet — rebuilds "Your collection" on any machine.
app.get('/api/v1/purchases', async (req, res) => {
    if (profileCors(req, res)) return;
    try {
        const wallet = String(req.query.wallet || '');
        if (!WALLET_RE.test(wallet)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing wallet address.' });
        }
        if (!redis) return res.json({ success: true, durable: false, purchases: [] });

        const raw = await redis.lrange(PURCHASES_KEY, 0, 999);
        const purchases = (Array.isArray(raw) ? raw : [])
            .map((item) => {
                try { return typeof item === 'string' ? JSON.parse(item) : item; }
                catch { return null; }
            })
            .filter((p) => p && p.buyerWallet === wallet);
        return res.json({ success: true, durable: true, purchases });
    } catch (err) {
        console.error('Purchases lookup failed:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 6b. Favorites, keyed by wallet.
app.get('/api/v1/favorites', async (req, res) => {
    if (profileCors(req, res)) return;
    try {
        const wallet = String(req.query.wallet || '');
        if (!WALLET_RE.test(wallet)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing wallet address.' });
        }
        if (!redis) return res.json({ success: true, durable: false, ids: [] });
        const stored = await redis.get(favoritesKey(wallet));
        const ids = Array.isArray(stored) ? stored.map(String) : [];
        return res.json({ success: true, durable: true, ids });
    } catch (err) {
        console.error('Favorites read failed:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/v1/favorites', async (req, res) => {
    if (profileCors(req, res)) return;
    try {
        const { publicKey, signature, message, ids } = req.body || {};
        if (!publicKey || !signature || !Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'Missing publicKey, signature or ids.' });
        }
        if (ids.length > 500 || ids.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 200)) {
            return res.status(400).json({ success: false, message: 'ids must be up to 500 non-empty strings.' });
        }

        // Same proof of wallet ownership the sovereign login produces — the app
        // stores it for the session so likes never trigger extra Phantom popups.
        const nacl = await import('tweetnacl');
        const encodedMessage = new TextEncoder().encode(message || 'Authenticate Fontainor Sovereign Session');
        const signatureBytes = Uint8Array.from(JSON.parse(signature));
        const publicKeyBytes = Uint8Array.from(JSON.parse(publicKey));
        const verified = nacl.default.sign.detached.verify(encodedMessage, signatureBytes, publicKeyBytes);
        if (!verified) {
            return res.status(401).json({ success: false, message: 'Cryptographic signature validation rejected.' });
        }

        const wallet = bs58.encode(publicKeyBytes);
        if (!redis) return res.json({ success: true, durable: false, wallet });
        await redis.set(favoritesKey(wallet), ids.map(String));
        return res.json({ success: true, durable: true, wallet });
    } catch (err) {
        console.error('Favorites write failed:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 6c. Play counts — anonymous, durable, powers the Trending rail.
// Weekly zset (fontainor:plays:v1:w:<ISO week>) + all-time zset. No auth on
// purpose (plays are anonymous); ids are validated and counts are only ever
// social proof, never money. Degrades honestly without redis.
const PLAYS_ALL_KEY = 'fontainor:plays:v1';
const PLAY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function playsWeekKey(d = new Date()) {
    // ISO-8601 week number, UTC.
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return `fontainor:plays:v1:w:${t.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

app.post('/api/v1/plays', async (req, res) => {
    if (profileCors(req, res)) return;
    try {
        const id = String((req.body || {}).id || '');
        if (!PLAY_ID_RE.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid release id.' });
        }
        if (!redis) return res.json({ success: true, durable: false });
        const wk = playsWeekKey();
        await redis.zincrby(PLAYS_ALL_KEY, 1, id);
        await redis.zincrby(wk, 1, id);
        await redis.expire(wk, 21 * 86400); // weekly keys self-clean
        return res.json({ success: true, durable: true });
    } catch (err) {
        console.error('Play count write failed:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/plays/top', async (req, res) => {
    if (profileCors(req, res)) return;
    try {
        const window = req.query.window === 'all' ? 'all' : 'week';
        const n = Math.min(Math.max(parseInt(String(req.query.n || '12'), 10) || 12, 1), 50);
        if (!redis) return res.json({ success: true, durable: false, window, top: [] });
        const key = window === 'all' ? PLAYS_ALL_KEY : playsWeekKey();
        // zrange rev withScores returns [member, score, member, score, ...]
        const flat = await redis.zrange(key, 0, n - 1, { rev: true, withScores: true });
        const top = [];
        for (let i = 0; i + 1 < flat.length; i += 2) {
            top.push({ id: String(flat[i]), plays: Number(flat[i + 1]) });
        }
        return res.json({ success: true, durable: true, window, top });
    } catch (err) {
        console.error('Play count read failed:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 7. Publish Manifest Pointer Update
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
        // Tamper/impersonation gate: the new manifest must contain every
        // existing entry unchanged, and new entries may not use someone
        // else's claimed handle.
        const guardFail = await guardIncomingManifest(manifest);
        if (guardFail) return res.status(guardFail.status).json(guardFail.body);
        writeManifestPointer(txId);
        const durable = await writeDurableRegistry(manifest);
        return res.json({ success: true, txId, durable });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// F34: per-release share cards. Crawlers (Slack/Discord/Twitter/WhatsApp)
// cannot see hash-routed pages, so /share/:id serves real per-release OG
// meta and bounces humans to the SPA route. Durable registry first, bundled
// demo catalog as fallback (same order the app itself uses).
const SHARE_ID_RE = /^[A-Za-z0-9-]{4,64}$/;
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function priceText(price) {
    if (!price || typeof price.amount !== 'number') return null;
    const cur = String(price.currency || '').toUpperCase();
    if (cur === 'SOL') return `\u25CE${price.amount} SOL`;
    return `$${price.amount.toFixed(2)} ${cur || 'USDC'}`.trim();
}

async function findShareRelease(req, id) {
    const durable = await readDurableRegistry();
    const inDurable = (durable || []).find((r) => r && r.id === id);
    if (inDurable) return inDurable;
    try {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        const resp = await fetch(`${proto}://${req.headers.host}/registry.json`);
        if (!resp.ok) return null;
        const demo = await resp.json();
        return (Array.isArray(demo) ? demo : []).find((r) => r && r.id === id) || null;
    } catch {
        return null;
    }
}

app.get('/share/:id', async (req, res) => {
    const id = String(req.params.id || '');
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const origin = `${proto}://${req.headers.host}`;
    const appUrl = `${origin}/#/release/${encodeURIComponent(id)}`;
    if (!SHARE_ID_RE.test(id)) return res.redirect(302, origin);

    const rel = await findShareRelease(req, id);
    if (!rel) return res.redirect(302, appUrl);

    const title = `${rel.title} \u2014 ${rel.artist}`;
    const bits = [priceText(rel.price), rel.editions && rel.editions.total ? `edition of ${rel.editions.total}` : null, 'on Fontainor \u2014 the permanent record shop'].filter(Boolean);
    const desc = bits.join(' \u00B7 ');
    const rawCover = typeof rel.coverUri === 'string' && rel.coverUri ? rel.coverUri : '/og.png';
    const image = /^https?:\/\//.test(rawCover) ? rawCover : `${origin}${rawCover.startsWith('/') ? '' : '/'}${rawCover}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="Fontainor">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:image" content="${escHtml(image)}">
<meta property="og:url" content="${escHtml(appUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@fontainor">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(desc)}">
<meta name="twitter:image" content="${escHtml(image)}">
<meta http-equiv="refresh" content="0;url=${escHtml(appUrl)}">
</head>
<body>
<p>Redirecting to <a href="${escHtml(appUrl)}">${escHtml(title)} on Fontainor</a>\u2026</p>
<script>location.replace(${JSON.stringify(appUrl)})</script>
</body>
</html>`);
});

app.get('/manifest', (req, res) => {
    res.json({ txId: readManifestPointer() });
});


// --- Start Server ---

// 🔒 VERCEL SERVERLESS FUNCTION HANDSHAKE PASS 🔒
// We export the app instance cleanly, allowing Vercel to route incoming web requests natively.
export default app;

