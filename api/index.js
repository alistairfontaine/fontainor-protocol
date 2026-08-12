import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bs58 from 'bs58';
import { canonical, checkAppendOnly, findHandleConflicts, getProtectedOwner, normalizeHandle } from './registryGuard.js';

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

app.use(cors());
app.use(express.json({ limit: '5mb' }));
// A malformed JSON body makes express.json throw a SyntaxError; without this
// the default handler returns an HTML error page (and a 413 HTML page when the
// 5mb limit is exceeded), so JSON clients get an unparseable body and the
// wrong-looking status. Answer with a clean JSON error instead.
app.use((err, _req, res, next) => {
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 5mb.' });
    }
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
        return res.status(400).json({ success: false, error: 'INVALID_JSON', message: 'Request body is not valid JSON.' });
    }
    return next(err);
});
// NOTE: no express.static here on purpose — __dirname is the api/ source
// directory; serving it exposed index.js/pointer.json on non-Vercel deploys.

// Decode a wallet-signature payload safely. The three signed endpoints all
// receive `publicKey` and `signature` as JSON byte-array strings; a client
// sending non-JSON, a non-array, or a wrong-length key must be a 400 (bad
// request) — not a 500 that leaks a raw parser/tweetnacl error message. Ed25519
// public keys are exactly 32 bytes and detached signatures exactly 64; nacl
// throws on any other size, so we reject those up front too.
function decodeSignedPayload(publicKey, signature) {
    try {
        const pk = Uint8Array.from(JSON.parse(publicKey));
        const sig = Uint8Array.from(JSON.parse(signature));
        if (pk.length !== 32 || sig.length !== 64) return null;
        if (pk.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
        if (sig.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
        return { pk, sig };
    } catch {
        return null;
    }
}

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
const PURCHASE_SIGS_KEY = 'fontainor:purchases:sigs:v1'; // replay guard: signatures already receipted
const EDITIONS_MINTED_KEY = 'fontainor:editions:minted:v1'; // track id -> durable verified sale count
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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

/**
 * Overlay mutable sale counts onto the immutable append-only registry.
 *
 * An Arweave manifest cannot be edited after each purchase, so `editions.minted`
 * lives in Redis and is merged into responses. The original edition limit and
 * all provenance stay permanent; only the live verified-sale counter changes.
 */
async function withMintedCounts(manifestArray) {
    if (!redis || !Array.isArray(manifestArray) || manifestArray.length === 0) return manifestArray;
    const ids = manifestArray
        .filter((entry) => entry && entry.type !== 'editorial' && typeof entry.id === 'string')
        .map((entry) => entry.id);
    if (ids.length === 0) return manifestArray;
    try {
        const raw = await redis.hmget(EDITIONS_MINTED_KEY, ...ids);
        const counts = raw && typeof raw === 'object' ? raw : {};
        return manifestArray.map((entry) => {
            if (!entry || typeof entry.id !== 'string') return entry;
            const n = Number(counts[entry.id]);
            if (!Number.isSafeInteger(n) || n < 1) return entry;
            return { ...entry, editions: { ...(entry.editions || {}), minted: n } };
        });
    } catch (e) {
        // Availability beats a missing counter: verification still fail-closes
        // if its atomic sale write cannot reach Redis.
        console.error('Edition-count read error:', e.message);
        return manifestArray;
    }
}

/**
 * Merge-on-write for publish paths. The guard validates `incoming` against a
 * registry snapshot read earlier; writing `incoming` verbatim would drop any
 * entry another publisher appended in between (lost update). Re-reading at
 * write time and unioning by id narrows that race to milliseconds. (A full
 * fix needs an atomic compare-and-set, which Upstash REST doesn't offer.)
 * Existing durable entries always win over incoming duplicates.
 */
async function mergeWriteDurableRegistry(incoming) {
    const latest = await readDurableRegistry();
    if (!latest || latest.length === 0) {
        return { merged: incoming, durable: await writeDurableRegistry(incoming) };
    }
    const haveIds = new Set(latest.map((e) => (e && typeof e.id === 'string' ? e.id : null)).filter(Boolean));
    const haveCanon = new Set(latest.map((e) => canonical(e)));
    const merged = [
        ...latest,
        ...incoming.filter((e) => {
            const id = e && typeof e.id === 'string' ? e.id : null;
            return id ? !haveIds.has(id) : !haveCanon.has(canonical(e));
        }),
    ];
    return { merged, durable: await writeDurableRegistry(merged) };
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

// Tunable via env: a deeper scan widens the window an attacker must flood
// with tagged manifests to push honest history out of recovery range. Each
// extra slot costs one gateway fetch on a cold start, so keep it bounded.
const RECOVERY_SCAN_DEPTH = Math.min(100, Math.max(4, Number(process.env.RECOVERY_SCAN_DEPTH) || 24));

async function recoverLatestManifestFromIrys() {
    try {
        const query = `query { transactions(tags: [
            { name: "App-Name", values: ["Fontainor-Protocol"] },
            { name: "Type", values: ["registry-manifest"] }
        ], order: DESC, limit: ${RECOVERY_SCAN_DEPTH}) { edges { node { id } } } }`;
        const res = await fetch('https://uploader.irys.xyz/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        if (!res.ok) return null;
        const out = await res.json();
        const ids = (out?.data?.transactions?.edges ?? []).map((e) => e?.node?.id).filter(Boolean);
        if (ids.length === 0) return null;

        // Tags are not access-controlled, so the newest tagged manifest may be
        // an attacker's. Every LEGIT manifest is an append-only extension of
        // the one before it, so we fetch the newest few and accept the newest
        // candidate that contains every older fetched manifest unchanged
        // (checkAppendOnly). A forged full-replacement manifest drops or edits
        // honest history and is skipped; a forged append-only extension is
        // equivalent to a normal publish (spam entry, no hijack). Limitation:
        // an attacker who floods more than RECOVERY_SCAN_DEPTH manifests can
        // push honest history out of the window — the durable store (Upstash),
        // once configured, always takes precedence over this path.
        const manifests = [];
        for (const id of ids) {
            try {
                const data = await fetchRegistryFromGateway(id);
                if (Array.isArray(data) && data.length > 0) manifests.push({ id, data });
            } catch { /* unresolvable yet — skip */ }
        }
        for (let i = 0; i < manifests.length; i++) {
            const candidate = manifests[i];
            const tampers = manifests.slice(i + 1).some((older) => !checkAppendOnly(older.data, candidate.data).ok);
            if (tampers) continue;
            if (i > 0) console.warn(`⚠️ Irys recovery: skipped ${i} newer manifest(s) that tampered with older history.`);
            writeManifestPointer(candidate.id); // warm-instance cache for subsequent reads
            return candidate.data;
        }
        console.error('Irys manifest recovery: no consistent manifest found in the newest ' + manifests.length + '.');
        return null;
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
    // (no Allow-Credentials: it is invalid combined with the * origin)

    try {
        // durable store first — survives redeploys, no gateway round-trip
        const durable = await readDurableRegistry();
        if (durable && durable.length > 0) return res.json(await withMintedCounts(durable));

        const txId = readManifestPointer();
        if (txId) {
            const data = await fetchRegistryFromGateway(txId);
            // backfill the durable store so the next read skips the gateway
            if (Array.isArray(data) && data.length > 0) {
                await writeDurableRegistry(data);
                return res.json(await withMintedCounts(data));
            }
        }

        // last resort: recover the newest published manifest from Irys
        const recovered = await recoverLatestManifestFromIrys();
        if (recovered) {
            await writeDurableRegistry(recovered);
            return res.json(await withMintedCounts(recovered));
        }
        return res.json([]);
    } catch (error) {
        console.error('Registry fetch error:', error.message);
        // even on pointer/gateway errors, attempt permanent-record recovery
        try {
            const recovered = await recoverLatestManifestFromIrys();
            if (recovered) return res.status(200).json(await withMintedCounts(recovered));
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
            // Always etch the normalized ARRAY (req.body may be a bare object).
            const up = await uploadManifest(JSON.stringify(manifestArray), { arweave, wallet });
            if (up.success) {
                writeManifestPointer(up.txId);
                txId = up.txId;
            } else if (!redis) {
                // no durable fallback either — surface the Arweave failure as before
                return res.status(502).json({ success: false, error: up.error, code: up.code });
            }
        }

        // Durable registry write (works with or without Arweave). Merge-on-write
        // so a concurrent publish that landed since the guard check isn't dropped.
        const { durable: durableOk } = await mergeWriteDurableRegistry(manifestArray);
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

// 3. Audio Chunk Upload — REMOVED. This route was permanently non-functional:
// `arweave` is always the boot-time stub (the real Arweave client was never
// wired in), so every completed upload 502'd, and no client ever called it —
// the real publish path is musician-pays Irys (src/lib/irysPublish.ts).

// 4. Solana On-Chain Payment Settlement & Token Minting Gate
// --- Purchase price binding helpers ---------------------------------------
// Server-side SOL/USD quote (CoinGecko → Jupiter fallback), cached 5 minutes,
// with a stale last-known value (≤24h) accepted before giving up: a flaky
// price API should delay verification, not silently reopen the underpay hole.
let solUsdCache = { usd: 0, at: 0 };
async function serverSolUsd() {
    const now = Date.now();
    if (solUsdCache.usd > 0 && now - solUsdCache.at < 5 * 60_000) return solUsdCache.usd;
    const sources = [
        async () => {
            const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return null;
            const j = await r.json();
            const usd = j?.solana?.usd;
            return typeof usd === 'number' && usd > 0 ? usd : null;
        },
        async () => {
            const r = await fetch('https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112', { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return null;
            const j = await r.json();
            const p = Number(j?.data?.So11111111111111111111111111111111111111112?.price);
            return Number.isFinite(p) && p > 0 ? p : null;
        },
    ];
    for (const src of sources) {
        try {
            const usd = await src();
            if (usd) { solUsdCache = { usd, at: now }; return usd; }
        } catch { /* try next */ }
    }
    // stale-but-known beats unavailable, within reason
    if (solUsdCache.usd > 0 && now - solUsdCache.at < 24 * 3600_000) return solUsdCache.usd;
    return null;
}

/**
 * Minimum lamports a purchase of `price` must have moved.
 * SOL listings convert exactly (minus 10 lamports rounding slack); USD-pegged
 * listings convert at the server's live quote with a 10% drift allowance
 * (client quoted at ITS rate moments earlier). Returns:
 *   number  → enforce this floor
 *   null    → no rate available right now (caller should 503, not fail open)
 *   0       → release has no positive price (not purchasable)
 */
async function lamportsFloorForPrice(price) {
    const amount = Number(price?.amount);
    if (!(amount > 0)) return 0;
    const cur = String(price?.currency || 'USD').toUpperCase();
    if (cur === 'SOL') return Math.max(0, Math.round(amount * 1e9) - 10);
    const usd = await serverSolUsd();
    if (!usd) return null;
    return Math.floor((amount / usd) * 1e9 * 0.9);
}

app.post('/api/v1/verify-payment', async (req, res) => {
    try {
        const { signature, artistWallet, amountLamports, buyerWallet, currency, trackId } = req.body || {};

        if (!signature || !artistWallet || !buyerWallet || !trackId || !(Number(amountLamports) > 0)) {
            return res.status(400).json({ success: false, code: 'BUYER_REQUIRED', message: 'Missing signature, artistWallet, buyerWallet, trackId or amountLamports.' });
        }
        // Validate shapes up front so a malformed request is a clean 400 rather
        // than a downstream PublicKey throw, and so junk is never written into a
        // receipt. amountLamports must be a finite positive integer (Infinity /
        // 1e309 would otherwise sail through `Number(x) > 0`).
        const amt = Number(amountLamports);
        if (!Number.isSafeInteger(amt) || amt <= 0) {
            return res.status(400).json({ success: false, message: 'amountLamports must be a positive integer.' });
        }
        if (typeof signature !== 'string' || signature.length < 32 || signature.length > 200) {
            return res.status(400).json({ success: false, message: 'Invalid transaction signature.' });
        }
        if (!WALLET_RE.test(String(artistWallet))) {
            return res.status(400).json({ success: false, message: 'Invalid artistWallet address.' });
        }
        if (!WALLET_RE.test(String(buyerWallet))) {
            return res.status(400).json({ success: false, message: 'Invalid buyerWallet address.' });
        }
        if (typeof trackId !== 'string' || trackId.length < 1 || trackId.length > 64) {
            return res.status(400).json({ success: false, message: 'Invalid trackId.' });
        }

        // Price/artist binding: the client claims artistWallet + amountLamports,
        // and the chain check below only proves that THAT amount moved to THAT
        // wallet. Without binding trackId → the registry's listed price and
        // payout wallet, anyone could self-pay 100 lamports and mint a
        // "verified" receipt for a $29.99 edition (or pocket the 98% by naming
        // themselves artistWallet). Unknown trackIds are rejected outright.
        const listed = await findShareRelease(req, trackId); // durable registry first, bundled demo catalog fallback
        if (!listed) {
            return res.status(400).json({ success: false, code: 'UNKNOWN_TRACK', message: 'trackId is not a listed release.' });
        }
        if (listed.artistWallet && listed.artistWallet !== artistWallet) {
            return res.status(400).json({ success: false, code: 'ARTIST_MISMATCH', message: 'artistWallet does not match the payout wallet on record for this release.' });
        }
        const floor = await lamportsFloorForPrice(listed.price);
        if (floor === null) {
            return res.status(503).json({ success: false, code: 'PRICE_UNAVAILABLE', message: 'Live SOL price unavailable — retry verification in a moment.' });
        }
        if (floor === 0) {
            return res.status(400).json({ success: false, code: 'NOT_FOR_SALE', message: 'This release has no listed price — nothing to purchase.' });
        }
        if (Number(amountLamports) < floor) {
            return res.status(400).json({ success: false, code: 'UNDERPAID', message: 'amountLamports is below the listed price for this release.' });
        }
        const editionTotal = Number(listed.editions?.total);
        if (!Number.isSafeInteger(editionTotal) || editionTotal < 0) {
            return res.status(400).json({ success: false, code: 'INVALID_EDITION', message: 'This release has an invalid edition limit.' });
        }

        // Verify the 98/2 split actually happened on the Solana ledger, and —
        // that the claimed buyer SIGNED and paid in that transaction (otherwise
        // anyone who sees a signature on-chain could attach someone else's
        // purchase to their own wallet, or race the owner with a null buyer).
        const { verifySolanaPayment } = await import('./paymentBridge.js');
        const isVerified = await verifySolanaPayment(signature, artistWallet, Number(amountLamports), currency || 'SOL', buyerWallet);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: 'On-chain payment verification failed.' });
        }

        // Verification is only useful if the receipt and scarcity counter are
        // durably committed. One Redis Lua script makes replay claim + capacity
        // check + receipt append + minted increment a single atomic operation:
        // no LPUSH failure can burn a signature, and parallel last-copy buyers
        // cannot both mint past the edition limit. total=0 means unlimited.
        if (!redis) {
            return res.status(503).json({
                success: false,
                code: 'RECEIPT_STORE_UNAVAILABLE',
                message: 'The receipt store is unavailable — the on-chain payment is real; retry verification without paying again.',
                signature,
            });
        }
        const receipt = JSON.stringify({
            trackId,
            signature,
            artistWallet,
            buyerWallet,
            amountLamports: Number(amountLamports),
            currency: currency || 'SOL',
            verifiedAt: new Date().toISOString(),
        });
        let outcome;
        try {
            outcome = await redis.eval(
                `local sigs=KEYS[1]
                 local receipts=KEYS[2]
                 local minted=KEYS[3]
                 local signature=ARGV[1]
                 local receipt=ARGV[2]
                 local track=ARGV[3]
                 local total=tonumber(ARGV[4]) or 0
                 if redis.call('SISMEMBER', sigs, signature) == 1 then return {'DUPLICATE', redis.call('HGET', minted, track) or '0'} end
                 local count=tonumber(redis.call('HGET', minted, track) or '0')
                 if total > 0 and count >= total then return {'SOLD_OUT', tostring(count)} end
                 local pushed=redis.pcall('LPUSH', receipts, receipt)
                 if type(pushed) == 'table' and pushed.err then return {'STORE_ERROR', tostring(count)} end
                 local added=redis.pcall('SADD', sigs, signature)
                 if (type(added) == 'table' and added.err) or added ~= 1 then
                   redis.call('LPOP', receipts)
                   return {'STORE_ERROR', tostring(count)}
                 end
                 local incremented=redis.pcall('HINCRBY', minted, track, 1)
                 if type(incremented) == 'table' and incremented.err then
                   redis.call('SREM', sigs, signature)
                   redis.call('LPOP', receipts)
                   return {'STORE_ERROR', tostring(count)}
                 end
                 count=incremented
                 return {'STORED', tostring(count)}`,
                [PURCHASE_SIGS_KEY, PURCHASES_KEY, EDITIONS_MINTED_KEY],
                [signature, receipt, trackId, String(editionTotal)],
            );
        } catch (e) {
            console.error('Purchase receipt write failed:', e.message);
            return res.status(503).json({
                success: false,
                code: 'RECEIPT_STORE_UNAVAILABLE',
                message: 'The receipt store is unavailable — the on-chain payment is real; retry verification without paying again.',
                signature,
            });
        }
        const state = Array.isArray(outcome) ? String(outcome[0]) : '';
        const minted = Array.isArray(outcome) ? Number(outcome[1]) || 0 : 0;
        if (state === 'DUPLICATE') {
            return res.json({ success: true, verified: true, receiptStored: true, duplicate: true, signature, minted });
        }
        if (state === 'SOLD_OUT') {
            return res.status(409).json({
                success: false,
                verified: true,
                code: 'SOLD_OUT',
                message: 'This edition sold out before this payment was receipted. Contact support with the transaction signature for a refund.',
                signature,
                minted,
            });
        }
        if (state === 'STORE_ERROR') {
            return res.status(503).json({
                success: false,
                code: 'RECEIPT_STORE_UNAVAILABLE',
                message: 'The receipt store is unavailable — the on-chain payment is real; retry verification without paying again.',
                signature,
            });
        }
        if (state !== 'STORED') {
            return res.status(503).json({ success: false, code: 'RECEIPT_STORE_UNAVAILABLE', message: 'The receipt store returned an invalid response.', signature });
        }
        return res.json({ success: true, verified: true, receiptStored: true, signature, minted });
    } catch (err) {
        console.error('Payment verification endpoint crashed:', err.message);
        return res.status(500).json({ success: false, error: 'SETTLEMENT_CRASH', message: err.message });
    }
});


// --- Signed-message freshness ------------------------------------------------
// Every signed auth message carries an issue timestamp: "<intent> :: <unix-ms>".
// Without it a captured signature was a bearer token forever: the localStorage
// session proof (or any intercepted payload) could authenticate favorites
// writes and logins for eternity. Now:
//   - logins / handle claims must be signed within the last LOGIN_FRESHNESS_MS
//     (a stolen payload goes stale in minutes);
//   - stored session proofs may keep authenticating profile writes for
//     SESSION_TTL_MS, after which the app asks Phantom for one fresh signature.
// Timestamps slightly in the future are tolerated up to CLOCK_SKEW_MS.
const LOGIN_FRESHNESS_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;

/** Extract the trailing " :: <unix-ms>" issue timestamp, or null if absent/invalid. */
function signedMessageIssuedAt(message) {
    const m = /^[\s\S]*? :: (\d{10,16})$/.exec(String(message || ''));
    if (!m) return null;
    const ts = Number(m[1]);
    return Number.isSafeInteger(ts) ? ts : null;
}

/** null if fresh, else a human-readable rejection reason. */
function signedMessageStaleness(message, maxAgeMs) {
    const ts = signedMessageIssuedAt(message);
    if (ts == null) return 'Signed message is missing its issue timestamp — update the app and sign in again.';
    const age = Date.now() - ts;
    if (age > maxAgeMs) return 'Signed message has expired — sign in again to refresh the session.';
    if (age < -CLOCK_SKEW_MS) return 'Signed message is timestamped in the future — check the device clock and try again.';
    return null;
}

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

        const decoded = decodeSignedPayload(publicKey, signature);
        if (!decoded) {
            return res.status(400).json({ success: false, message: 'Malformed verification payload (publicKey/signature must be 32-/64-byte JSON arrays).' });
        }
        const { pk: publicKeyBytes, sig: signatureBytes } = decoded;

        const stale = signedMessageStaleness(message, LOGIN_FRESHNESS_MS);
        if (stale) {
            return res.status(401).json({ success: false, code: 'SIGNATURE_STALE', message: stale, serverTime: Date.now() });
        }

        const nacl = await import('tweetnacl');
        const encodedMessage = new TextEncoder().encode(message);

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

        const decoded = decodeSignedPayload(publicKey, signature);
        if (!decoded) {
            return res.status(400).json({ success: false, message: 'Malformed verification payload (publicKey/signature must be 32-/64-byte JSON arrays).' });
        }
        const { pk: publicKeyBytes, sig: signatureBytes } = decoded;

        // The claim is bound to an issue timestamp (client sends the ms value it
        // signed) so a captured claim payload can't be replayed later — e.g. to
        // revert a handle the wallet has since changed.
        const issuedAt = Number(req.body?.issuedAt);
        const expectedMessage = `Fontainor handle claim: @${bare} :: ${issuedAt}`;
        const stale = signedMessageStaleness(expectedMessage, LOGIN_FRESHNESS_MS);
        if (!Number.isSafeInteger(issuedAt) || stale) {
            return res.status(401).json({ success: false, code: 'SIGNATURE_STALE', message: stale || 'Handle claim is missing its issue timestamp — update the app and try again.', serverTime: Date.now() });
        }

        const nacl = await import('tweetnacl');
        const encodedMessage = new TextEncoder().encode(expectedMessage);
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
        // Atomic claim: HSETNX loses cleanly when two wallets race for the
        // same name (the old check-then-HSET let the second claimer overwrite
        // the first). A falsy result with a different owner = taken.
        const claimedNow = await redis.hsetnx(HANDLES_BY_NAME, bare, wallet);
        if (!claimedNow) {
            const owner = await getWalletForHandle(bare);
            if (owner && owner !== wallet) {
                return res.status(409).json({ success: false, code: 'HANDLE_TAKEN', message: `@${bare} is already claimed.` });
            }
        }
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

function profileCors(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
    return false;
}

/** Read purchase receipts in pages (the old flat lrange 0..999 silently
 *  truncated collections once the platform passed 1000 total receipts). */
async function readAllPurchaseReceipts(limit = 10000) {
    if (!redis) return [];
    const out = [];
    for (let start = 0; start < limit; start += 1000) {
        const batch = await redis.lrange(PURCHASES_KEY, start, Math.min(start + 999, limit - 1));
        if (!Array.isArray(batch) || batch.length === 0) break;
        out.push(...batch);
        if (batch.length < 1000) break;
    }
    return out;
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

        const raw = await readAllPurchaseReceipts();
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
        if (!redis) return res.json({ success: true, durable: false, ids: [], likedAt: {}, unlikedAt: {} });
        const doc = parseStoredFavorites(await redis.get(favoritesKey(wallet)));
        return res.json({ success: true, durable: true, ids: doc.ids, likedAt: doc.likedAt, unlikedAt: doc.unlikedAt });
    } catch (err) {
        console.error('Favorites read failed:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Tombstones older than this are pruned — after 90 days every device has
// long since synced the unlike, so the marker is dead weight.
const FAV_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const FAV_TS_MAP_MAX = 1500;

/** Coerce a client/server likedAt/unlikedAt map to { id: finite-ms }, capped. */
function sanitizeFavTimestampMap(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    let n = 0;
    for (const [id, ts] of Object.entries(raw)) {
        if (typeof id !== 'string' || id.length === 0 || id.length > 200) continue;
        const t = Number(ts);
        if (!Number.isFinite(t) || t <= 0) continue;
        out[id] = t;
        if (++n >= FAV_TS_MAP_MAX) break;
    }
    return out;
}

/** Parse a stored favorites value — either the legacy bare id array or the
 *  versioned { ids, likedAt, unlikedAt } doc. */
function parseStoredFavorites(stored) {
    if (Array.isArray(stored)) return { ids: stored.map(String), likedAt: {}, unlikedAt: {} };
    if (stored && typeof stored === 'object' && Array.isArray(stored.ids)) {
        return {
            ids: stored.ids.map(String),
            likedAt: sanitizeFavTimestampMap(stored.likedAt),
            unlikedAt: sanitizeFavTimestampMap(stored.unlikedAt),
        };
    }
    return { ids: [], likedAt: {}, unlikedAt: {} };
}

/** Last-write-wins per id: for each track the newest action (like vs unlike)
 *  across both replicas decides. This is what stops the resurrection bug —
 *  an unlike on device A used to be undone by device B pushing a stale union. */
function mergeFavoritesLww(a, b) {
    const now = Date.now();
    const likedAt = {};
    const unlikedAt = {};
    const allIds = new Set([...Object.keys(a.likedAt), ...Object.keys(b.likedAt), ...Object.keys(a.unlikedAt), ...Object.keys(b.unlikedAt), ...a.ids, ...b.ids]);
    for (const id of allIds) {
        // Legacy replicas carry ids without timestamps — treat those likes as
        // epoch 1 so any explicit, timestamped action beats them.
        const like = Math.max(a.likedAt[id] ?? (a.ids.includes(id) ? 1 : 0), b.likedAt[id] ?? (b.ids.includes(id) ? 1 : 0));
        const unlike = Math.max(a.unlikedAt[id] ?? 0, b.unlikedAt[id] ?? 0);
        if (like > 0 && like >= unlike) likedAt[id] = like;
        else if (unlike > 0 && now - unlike < FAV_TOMBSTONE_TTL_MS) unlikedAt[id] = unlike;
    }
    // Order: keep each replica's local ordering where possible, a first.
    const ids = [...a.ids, ...b.ids.filter((id) => !a.ids.includes(id))].filter((id) => id in likedAt);
    for (const id of Object.keys(likedAt)) if (!ids.includes(id)) ids.push(id);
    return { ids: ids.slice(0, 500), likedAt, unlikedAt };
}

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
        // The proof carries its signed issue timestamp and expires after
        // SESSION_TTL_MS (a leaked localStorage proof is no longer forever).
        const decoded = decodeSignedPayload(publicKey, signature);
        if (!decoded) {
            return res.status(400).json({ success: false, message: 'Malformed verification payload (publicKey/signature must be 32-/64-byte JSON arrays).' });
        }
        const { pk: publicKeyBytes, sig: signatureBytes } = decoded;

        const stale = signedMessageStaleness(message, SESSION_TTL_MS);
        if (stale) {
            return res.status(401).json({ success: false, code: 'SIGNATURE_STALE', message: stale, serverTime: Date.now() });
        }

        const nacl = await import('tweetnacl');
        const encodedMessage = new TextEncoder().encode(message);
        const verified = nacl.default.sign.detached.verify(encodedMessage, signatureBytes, publicKeyBytes);
        if (!verified) {
            return res.status(401).json({ success: false, message: 'Cryptographic signature validation rejected.' });
        }

        const wallet = bs58.encode(publicKeyBytes);
        if (!redis) return res.json({ success: true, durable: false, wallet });

        const incoming = {
            ids: ids.map(String),
            likedAt: sanitizeFavTimestampMap(req.body?.likedAt),
            unlikedAt: sanitizeFavTimestampMap(req.body?.unlikedAt),
        };
        const current = parseStoredFavorites(await redis.get(favoritesKey(wallet)));
        const merged = mergeFavoritesLww(current, incoming);
        await redis.set(favoritesKey(wallet), merged);
        return res.json({ success: true, durable: true, wallet, ids: merged.ids, likedAt: merged.likedAt, unlikedAt: merged.unlikedAt });
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

// Light anti-spam on the anonymous play counter: per-IP sliding minute,
// in-memory (per serverless instance — a floor, not a wall; keeps a naive
// while-loop from pumping Trending). PLAYS_RATE_LIMIT=0 disables; default 120
// plays/min/IP is far above human listening rates, shared-NAT friendly.
const PLAYS_RATE_LIMIT = process.env.PLAYS_RATE_LIMIT === undefined ? 120 : Number(process.env.PLAYS_RATE_LIMIT) || 0;
const playHits = new Map(); // ip -> { count, windowStart }
function playRateExceeded(ip) {
    if (!PLAYS_RATE_LIMIT) return false;
    const now = Date.now();
    if (playHits.size > 10000) playHits.clear(); // hard memory cap
    const h = playHits.get(ip);
    if (!h || now - h.windowStart > 60_000) {
        playHits.set(ip, { count: 1, windowStart: now });
        return false;
    }
    h.count += 1;
    return h.count > PLAYS_RATE_LIMIT;
}

app.post('/api/v1/plays', async (req, res) => {
    if (profileCors(req, res)) return;
    try {
        const id = String((req.body || {}).id || '');
        if (!PLAY_ID_RE.test(id)) {
            return res.status(400).json({ success: false, message: 'Invalid release id.' });
        }
        const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
        if (playRateExceeded(ip)) {
            // Count not recorded; still 200 so clients never retry-loop (plays are fire-and-forget).
            return res.json({ success: true, durable: false, throttled: true });
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
        const flat = (await redis.zrange(key, 0, n - 1, { rev: true, withScores: true })) || [];
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

// 6d. Aggregate stats — one call answers "is anyone using this?".
// Reads only what already exists: the all-time plays zset and the durable
// purchase receipts. No auth: nothing here is private (wallets are public
// keys, counts are social proof).
app.get('/api/v1/stats', async (req, res) => {
    if (profileCors(req, res)) return;
    try {
        if (!redis) return res.json({ success: true, durable: false, stats: null });
        const [flat, rawPurchases] = await Promise.all([
            redis.zrange(PLAYS_ALL_KEY, 0, -1, { withScores: true }),
            readAllPurchaseReceipts(),
        ]);
        let totalPlays = 0;
        let tracksPlayed = 0;
        for (let i = 0; i + 1 < (flat || []).length; i += 2) {
            tracksPlayed += 1;
            totalPlays += Number(flat[i + 1]) || 0;
        }
        const purchases = (Array.isArray(rawPurchases) ? rawPurchases : [])
            .map((item) => {
                try { return typeof item === 'string' ? JSON.parse(item) : item; }
                catch { return null; }
            })
            .filter(Boolean);
        const buyers = new Set(purchases.map((p) => p.buyerWallet).filter(Boolean));
        const totalLamports = purchases.reduce((sum, p) => sum + (Number(p.amountLamports) || 0), 0);
        return res.json({
            success: true,
            durable: true,
            stats: {
                totalPlays,
                tracksPlayed,
                totalBuys: purchases.length,
                uniqueBuyers: buyers.size,
                totalLamports,
                totalSol: totalLamports / 1e9,
            },
        });
    } catch (err) {
        console.error('Stats read failed:', err.message);
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
        // Merge-on-write: don't drop a release another artist published
        // between the guard read and this write.
        const { durable } = await mergeWriteDurableRegistry(manifest);
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
