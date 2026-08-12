// api-fuzz-test.mjs — abuse/robustness + happy-path suite for the real
// api/index.js. Drives every mutating and read endpoint with hostile input
// (malformed JSON, oversized bodies, non-JSON signatures, wrong-length keys,
// type-confused fields, Infinity/negative amounts, XSS in share metadata,
// out-of-range pagination) AND the correct signed happy path using a real
// TweetNaCl keypair, asserting:
//   - client errors are 4xx with JSON, never a 500 that leaks a raw
//     parser/tweetnacl error message;
//   - a valid Ed25519 signature authenticates; a tampered one is 401;
//   - registry-append tamper is 403; share metadata is HTML-escaped.
//
// Run: node tools/api-fuzz-test.mjs   (exit 0 = pass)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { authorizeEntry } from './entry-proof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POINTER_FILE = path.join(__dirname, '..', 'api', 'pointer.json');
try { fs.rmSync(POINTER_FILE, { force: true }); } catch { /* noop */ }

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
    if (cond) { passed++; console.log(`  \u2713 ${name}`); }
    else { failed++; console.error(`  \u2717 ${name} ${detail}`); }
};

// ---- gateway stub for /api/v1/publish manifest fetch ----
// Use one real Ed25519 publisher identity in the fixture so the manifest's
// artistWallet can be cryptographically bound to each publish request.
const publisherKp = nacl.sign.keyPair();
const publisherWallet = bs58.encode(Buffer.from(publisherKp.publicKey));
const rel = (id, title, artist, wallet) => ({
    type: 'release', id, title, artist,
    price: { amount: 5, currency: 'SOL' }, editions: { total: 10 },
    status: 'REGISTERED_ON_FONTAINOR', date: '2026-08-11T00:00:00.000Z',
    audioUri: `https://gateway.irys.xyz/a-${id}`, coverUri: null, artistWallet: wallet,
});
const signedRel = (id, title, artist = 'Fixture Artist') =>
    authorizeEntry(rel(id, title, artist, publisherWallet), publisherKp);
const XSS = signedRel('FONT-XSS00001', '"><script>alert(1)</script>', 'Evil');
const BASE_REL = signedRel('FONT-BASE0001', 'Base Track', 'Base Artist');
const manifestsByTx = new Map([
    ['TXBASE0000000000000000000000000000000000001', [BASE_REL]],
    ['TXXSS00000000000000000000000000000000000002', [BASE_REL, XSS]],
    ['TXTAMPER000000000000000000000000000000000003', [{ ...BASE_REL, title: 'HIJACKED' }]],
]);
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const u = String(url);
    // Deterministic SOL/USD quotes for the verify-payment price-floor tests.
    // CoinGecko is deliberately ROGUE (100x): the server takes a median of
    // agreeing sources, so a single broken price API must not be able to lower
    // the underpay floor. The three honest sources quote $200.
    if (u.includes('api.coingecko.com/')) {
        const body = { solana: { usd: 20_000 } };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (u.includes('lite-api.jup.ag/')) {
        if (u.includes('/price/v2')) return { ok: false, status: 404, json: async () => ({}), text: async () => 'Route not found' };
        const body = { So11111111111111111111111111111111111111112: { usdPrice: 200 } };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (u.includes('api.coinbase.com/')) {
        const body = { data: { amount: '200', base: 'SOL', currency: 'USD' } };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (u.includes('api.kraken.com/')) {
        const body = { error: [], result: { SOLUSD: { c: ['200', '1'] } } };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (u.includes('api.mainnet-beta.solana.com')) {
        // Fast deterministic failure for the on-chain lookup: proves a request
        // that clears the price gate still reaches (and fails) chain verification
        // without a live RPC round-trip.
        return {
            ok: true, status: 200,
            json: async () => ({ jsonrpc: '2.0', error: { code: -32602, message: 'stubbed rpc' }, id: 1 }),
            text: async () => JSON.stringify({ jsonrpc: '2.0', error: { code: -32602, message: 'stubbed rpc' }, id: 1 }),
        };
    }
    if (u.includes('arweave.net/') || u.includes('gateway.irys.xyz/')) {
        const seg = u.split('/').pop();
        if (manifestsByTx.has(seg)) return { ok: true, status: 200, json: async () => manifestsByTx.get(seg), text: async () => JSON.stringify(manifestsByTx.get(seg)) };
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
    return realFetch(url, opts);
};

// ---- Upstash REST stub ----
const kv = new Map(); const hashes = new Map(); const sets = new Map(); const zsets = new Map();
const run = (cmd) => {
    const [op, key, ...args] = cmd;
    const U = String(op).toUpperCase();
    switch (U) {
        case 'SET': kv.set(key, args[0]); return 'OK';
        case 'GET': return kv.get(key) ?? null;
        case 'HSETNX': { const h = hashes.get(key) || {}; if (h[args[0]] !== undefined) return 0; h[args[0]] = args[1]; hashes.set(key, h); return 1; }
        case 'HSET': { const h = hashes.get(key) || {}; for (let i = 0; i < args.length; i += 2) h[args[i]] = args[i + 1]; hashes.set(key, h); return 'OK'; }
        case 'HGET': { const h = hashes.get(key) || {}; return h[args[0]] ?? null; }
        case 'HMGET': { const h = hashes.get(key) || {}; return args.map((field) => h[field] ?? null); }
        case 'HDEL': { const h = hashes.get(key) || {}; delete h[args[0]]; return 1; }
        case 'SADD': { const s = sets.get(key) || new Set(); const had = s.has(args[0]); s.add(args[0]); sets.set(key, s); return had ? 0 : 1; }
        case 'ZINCRBY': { const z = zsets.get(key) || new Map(); const m = String(args[1]); z.set(m, (z.get(m) || 0) + Number(args[0])); zsets.set(key, z); return z.get(m); }
        case 'EXPIRE': return 1;
        case 'ZRANGE': {
            const z = zsets.get(key) || new Map();
            const start = Number(args[0]); const stop = Number(args[1]);
            const rev = cmd.some((a) => String(a).toUpperCase() === 'REV');
            const ws = cmd.some((a) => String(a).toUpperCase() === 'WITHSCORES');
            let entries = [...z.entries()].sort((a, b) => rev ? b[1] - a[1] : a[1] - b[1]);
            entries = entries.slice(start, stop < 0 ? undefined : stop + 1);
            const out = []; for (const [m, sc] of entries) { out.push(m); if (ws) out.push(String(sc)); }
            return out;
        }
        default: return null;
    }
};
const upstash = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
        let cmd; try { cmd = JSON.parse(body); } catch { cmd = null; }
        const out = Array.isArray(cmd?.[0]) ? cmd.map((c) => ({ result: run(c) })) : { result: run(cmd ?? []) };
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
    });
});
await new Promise((r) => upstash.listen(0, r));
process.env.UPSTASH_REDIS_REST_URL = `http://localhost:${upstash.address().port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.PLAYS_RATE_LIMIT = '0'; // disable rate-limit noise in fuzz

const { default: app } = await import('../api/index.js');
const srv = app.listen(0);
await new Promise((r) => srv.once('listening', r));
const base = `http://localhost:${srv.address().port}`;

// raw request helper (so we can send deliberately malformed bodies + headers)
const req = (method, p, { body, headers } = {}) => new Promise((resolve) => {
    const u = new URL(base + p);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
        let data = ''; res.on('data', (c) => (data += c));
        res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch { /* non-json */ } resolve({ status: res.statusCode, json, text: data, ctype: res.headers['content-type'] || '', headers: res.headers }); });
    });
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
});
const noLeak = (r) => !/at \/|node:internal|\.js:\d+|SyntaxError:|Unexpected token/.test(r.text || '');

// ============ 1. body parser robustness ============
console.log('body parser');
let r = await req('POST', '/api/v1/publish', { body: '{ this is not json ]' });
check('malformed JSON -> 400 INVALID_JSON (not 500/HTML)', r.status === 400 && r.json?.error === 'INVALID_JSON', `${r.status} ${r.ctype}`);
check('malformed JSON response is JSON and leaks no stack', /json/.test(r.ctype) && noLeak(r));
r = await req('POST', '/api/v1/publish', { body: '"' + 'A'.repeat(6 * 1024 * 1024) + '"' });
check('oversized body -> 413 PAYLOAD_TOO_LARGE', r.status === 413 && r.json?.error === 'PAYLOAD_TOO_LARGE', String(r.status));

// ============ 2. sovereign-login ============
console.log('sovereign-login');
r = await req('POST', '/api/v1/auth/sovereign-login', { body: {} });
check('login missing fields -> 400', r.status === 400);
r = await req('POST', '/api/v1/auth/sovereign-login', { body: { publicKey: 'not-json', signature: 'also-not-json' } });
check('login non-JSON key/sig -> 400 (not 500)', r.status === 400 && noLeak(r), String(r.status));
r = await req('POST', '/api/v1/auth/sovereign-login', { body: { publicKey: JSON.stringify([1, 2, 3]), signature: JSON.stringify(Array(64).fill(0)) } });
check('login wrong-length key -> 400 (not 500 tweetnacl throw)', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/auth/sovereign-login', { body: { publicKey: JSON.stringify(Array(32).fill(0)), signature: JSON.stringify(Array(64).fill(0)) } });
check('login valid-shape but bad signature -> 401', r.status === 401, String(r.status));

// real keypair happy path
const kp = nacl.sign.keyPair();
const wallet = bs58.encode(Buffer.from(kp.publicKey));
const sign = (msg) => JSON.stringify(Array.from(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey)));
const pkArr = JSON.stringify(Array.from(kp.publicKey));
const loginMsg = (ts = Date.now()) => `Authenticate Fontainor Sovereign Session :: ${ts}`;
const publishBody = (txId, keypair = publisherKp, extra = {}) => {
    const issuedAt = Date.now();
    const message = `Fontainor publish manifest: ${txId} :: ${issuedAt}`;
    return {
        txId,
        issuedAt,
        publicKey: JSON.stringify(Array.from(keypair.publicKey)),
        signature: JSON.stringify(Array.from(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey))),
        ...extra,
    };
};
let m = loginMsg();
r = await req('POST', '/api/v1/auth/sovereign-login', { body: { publicKey: pkArr, signature: sign(m), message: m } });
check('login valid signature -> 200 with derived base58 wallet', r.status === 200 && r.json?.wallet === wallet, JSON.stringify(r.json));
// replay protection: signatures go stale
m = 'Authenticate Fontainor Sovereign Session'; // legacy, no timestamp
r = await req('POST', '/api/v1/auth/sovereign-login', { body: { publicKey: pkArr, signature: sign(m), message: m } });
check('login without issue timestamp -> 401 SIGNATURE_STALE', r.status === 401 && r.json?.code === 'SIGNATURE_STALE', String(r.status));
m = loginMsg(Date.now() - 11 * 60 * 1000);
r = await req('POST', '/api/v1/auth/sovereign-login', { body: { publicKey: pkArr, signature: sign(m), message: m } });
check('login signed 11 min ago -> 401 SIGNATURE_STALE (replay window closed)', r.status === 401 && r.json?.code === 'SIGNATURE_STALE', String(r.status));
// A skewed device clock must be recoverable, not a lockout: the rejection has
// to carry the server's own time (and a Date header) so the client can realign.
check('stale rejection reports serverTime so a skewed client can self-correct', Number.isFinite(r.json?.serverTime) && Math.abs(r.json.serverTime - Date.now()) < 60000, JSON.stringify(r.json?.serverTime));
check('every response carries a parseable Date header (clock source)', Number.isFinite(Date.parse(r.headers?.date ?? '')), String(r.headers?.date));
m = loginMsg(Date.now() + 30 * 60 * 1000);
r = await req('POST', '/api/v1/auth/sovereign-login', { body: { publicKey: pkArr, signature: sign(m), message: m } });
check('login timestamped 30 min in the FUTURE -> 401 with a clock-specific message', r.status === 401 && /device clock/i.test(r.json?.message ?? ''), JSON.stringify(r.json?.message));
m = loginMsg(Date.now() + 60 * 1000);
r = await req('POST', '/api/v1/auth/sovereign-login', { body: { publicKey: pkArr, signature: sign(m), message: m } });
check('login 1 min in the future is tolerated (clock-skew allowance)', r.status === 200, String(r.status));

// ============ 3. set-handle ============
console.log('set-handle');
r = await req('POST', '/api/v1/auth/set-handle', { body: { publicKey: pkArr, signature: sign('x'), handle: '@@@' } });
check('set-handle invalid handle -> 400 HANDLE_INVALID', r.status === 400 && r.json?.code === 'HANDLE_INVALID', String(r.status));
r = await req('POST', '/api/v1/auth/set-handle', { body: { publicKey: 'nope', signature: 'nope', handle: 'validname' } });
check('set-handle malformed payload -> 400 (not 500)', r.status === 400 && noLeak(r), String(r.status));
let ts = Date.now();
r = await req('POST', '/api/v1/auth/set-handle', { body: { publicKey: pkArr, signature: sign(`Fontainor handle claim: @fontainor :: ${ts}`), handle: 'fontainor', issuedAt: ts } });
check('set-handle protected name by non-treasury -> 403 HANDLE_PROTECTED', r.status === 403 && r.json?.code === 'HANDLE_PROTECTED', String(r.status));
ts = Date.now();
r = await req('POST', '/api/v1/auth/set-handle', { body: { publicKey: pkArr, signature: sign(`Fontainor handle claim: @coolartist :: ${ts}`), handle: 'coolartist', issuedAt: ts } });
check('set-handle valid claim -> 200', r.status === 200 && r.json?.handle === '@coolartist', JSON.stringify(r.json));
ts = Date.now() - 11 * 60 * 1000;
r = await req('POST', '/api/v1/auth/set-handle', { body: { publicKey: pkArr, signature: sign(`Fontainor handle claim: @oldclaim :: ${ts}`), handle: 'oldclaim', issuedAt: ts } });
check('set-handle stale claim payload -> 401 SIGNATURE_STALE (no replay)', r.status === 401 && r.json?.code === 'SIGNATURE_STALE', String(r.status));

// ============ 4. favorites ============
console.log('favorites');
const sessionMsg = loginMsg();
const sessionSig = sign(sessionMsg);
const favBody = (extra) => ({ publicKey: pkArr, signature: sessionSig, message: sessionMsg, ...extra });
r = await req('POST', '/api/v1/favorites', { body: favBody({ ids: 'not-an-array' }) });
check('favorites non-array ids -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/favorites', { body: favBody({ ids: Array(501).fill('x') }) });
check('favorites >500 ids -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/favorites', { body: { publicKey: 'bad', signature: 'bad', ids: ['a'] } });
check('favorites malformed payload -> 400 (not 500)', r.status === 400 && noLeak(r), String(r.status));
const expiredMsg = loginMsg(Date.now() - 8 * 24 * 60 * 60 * 1000);
r = await req('POST', '/api/v1/favorites', { body: { publicKey: pkArr, signature: sign(expiredMsg), message: expiredMsg, ids: ['a'] } });
check('favorites with 8-day-old session proof -> 401 SIGNATURE_STALE (bearer token expires)', r.status === 401 && r.json?.code === 'SIGNATURE_STALE', String(r.status));
r = await req('POST', '/api/v1/favorites', { body: favBody({ ids: ['FONT-BASE0001'] }) });
check('favorites valid signature -> 200 durable', r.status === 200 && r.json?.durable === true, JSON.stringify(r.json));

// LWW tombstones: an unlike on device A must survive a stale union push from device B
const t0 = Date.now() - 60000, t1 = Date.now() - 30000;
r = await req('POST', '/api/v1/favorites', { body: favBody({ ids: ['FONT-BASE0001', 'FONT-KEEP01'], likedAt: { 'FONT-BASE0001': t0, 'FONT-KEEP01': t0 } }) });
check('favorites device A likes two tracks', r.status === 200, String(r.status));
r = await req('POST', '/api/v1/favorites', { body: favBody({ ids: ['FONT-KEEP01'], likedAt: { 'FONT-KEEP01': t0 }, unlikedAt: { 'FONT-BASE0001': t1 } }) });
check('favorites device A unlikes one (tombstone recorded)', r.status === 200 && !r.json.ids.includes('FONT-BASE0001'), JSON.stringify(r.json?.ids));
r = await req('POST', '/api/v1/favorites', { body: favBody({ ids: ['FONT-BASE0001', 'FONT-KEEP01'], likedAt: { 'FONT-BASE0001': t0, 'FONT-KEEP01': t0 } }) });
check('favorites stale union from device B does NOT resurrect the unlike', r.status === 200 && !r.json.ids.includes('FONT-BASE0001') && r.json.ids.includes('FONT-KEEP01'), JSON.stringify(r.json?.ids));
r = await req('POST', '/api/v1/favorites', { body: favBody({ ids: ['FONT-BASE0001'], likedAt: { 'FONT-BASE0001': Date.now() } }) });
check('favorites deliberate NEW re-like after the unlike wins (LWW)', r.status === 200 && r.json.ids.includes('FONT-BASE0001'), JSON.stringify(r.json?.ids));
r = await req('GET', `/api/v1/favorites?wallet=${wallet}`);
check('favorites read back persisted id', r.status === 200 && Array.isArray(r.json?.ids) && r.json.ids.includes('FONT-BASE0001'), JSON.stringify(r.json));
r = await req('GET', '/api/v1/favorites?wallet=%20%20%20');
check('favorites read bad wallet -> 400', r.status === 400, String(r.status));

// ============ 5. plays ============
console.log('plays');
r = await req('POST', '/api/v1/plays', { body: { id: 'bad id with spaces!' } });
check('plays invalid id -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/plays', { body: { id: 'FONT-BASE0001' } });
check('plays valid id -> 200 durable', r.status === 200 && r.json?.durable === true, JSON.stringify(r.json));
r = await req('GET', '/api/v1/plays/top?window=week&n=999');
check('plays/top n clamped to <=50', r.status === 200 && Array.isArray(r.json?.top) && r.json.top.length <= 50, String(r.json?.top?.length));
r = await req('GET', '/api/v1/plays/top?n=abc');
check('plays/top non-numeric n -> 200 (defaulted)', r.status === 200 && Array.isArray(r.json?.top), String(r.status));

// ============ 6. verify-payment input hardening ============
console.log('verify-payment');
r = await req('POST', '/api/v1/verify-payment', { body: {} });
check('verify-payment missing fields -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: wallet, amountLamports: 1000, trackId: 'FONT-BASE0001' } });
check('verify-payment missing buyerWallet -> 400 BUYER_REQUIRED', r.status === 400 && r.json?.code === 'BUYER_REQUIRED', JSON.stringify(r.json));
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: wallet, buyerWallet: wallet, amountLamports: 1e309, trackId: 'FONT-BASE0001' } });
check('verify-payment Infinity amount -> 400 (not passed downstream)', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: 'not-a-wallet!!!', buyerWallet: wallet, amountLamports: 1000, trackId: 'FONT-BASE0001' } });
check('verify-payment bad artistWallet -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: wallet, buyerWallet: 'garbage', amountLamports: 1000, trackId: 'FONT-BASE0001' } });
check('verify-payment bad buyerWallet -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: wallet, buyerWallet: wallet, amountLamports: 1000, trackId: 'y'.repeat(65) } });
check('verify-payment overlong trackId -> 400', r.status === 400, String(r.status));

// ============ 7. publish + tamper + XSS share ============
console.log('publish + share');
r = await req('POST', '/api/v1/publish', { body: { txId: 'short' } });
check('publish bad txId -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/publish', { body: { txId: 'TXBASE0000000000000000000000000000000000001' } });
check('publish without wallet authorization -> 401', r.status === 401 && r.json?.code === 'PUBLISH_AUTH_REQUIRED', JSON.stringify(r.json));
r = await req('POST', '/api/v1/publish', { body: publishBody('TXBASE0000000000000000000000000000000000001') });
check('publish base manifest -> 200 durable', r.status === 200 && r.json?.durable === true, JSON.stringify(r.json));
r = await req('POST', '/api/v1/publish', { body: publishBody('TXTAMPER000000000000000000000000000000000003') });
check('publish that edits an existing entry -> 403 REGISTRY_TAMPER', r.status === 403 && r.json?.code === 'REGISTRY_TAMPER', JSON.stringify(r.json));
r = await req('POST', '/api/v1/publish', { body: publishBody('TXXSS00000000000000000000000000000000000002') });
check('publish appending a new entry -> 200', r.status === 200 && r.json?.success === true, JSON.stringify(r.json));
r = await req('GET', '/share/FONT-XSS00001');
check('share renders and HTML-escapes a script-injection title', r.status === 200 && !r.text.includes('<script>alert(1)</script>') && r.text.includes('&lt;script&gt;'), 'unescaped!');
r = await req('GET', '/share/..%2F..%2Fetc%2Fpasswd');
check('share path-traversal id -> 302 redirect (no file read)', r.status === 302, String(r.status));

// ============ 7b. verify-payment price/artist binding (C23) ============
// The server must bind trackId → the registry's listed price + payout wallet:
// without it, a 100-lamport self-payment minted a "verified" receipt for a
// $29.99 edition, and a forged artistWallet pocketed the 98% share.
console.log('verify-payment price binding');
{
    const kp2 = nacl.sign.keyPair();
    const otherWallet = bs58.encode(Buffer.from(kp2.publicKey));
    const relPriced = (id, amount, currency) => ({
        type: 'release', id, title: `Priced ${id}`, artist: 'Price Artist',
        price: { amount, currency }, editions: { total: 10 },
        status: 'REGISTERED_ON_FONTAINOR', date: '2026-08-12T00:00:00.000Z',
        audioUri: `https://gateway.irys.xyz/a-${id}`, coverUri: null, artistWallet: wallet,
    });
    // Append-only extension of what the durable registry already holds.
    manifestsByTx.set('TXPRICED000000000000000000000000000000000004', [
        BASE_REL,
        XSS,
        authorizeEntry(relPriced('FONT-PRICEDSOL1', 5, 'SOL'), kp),
        authorizeEntry(relPriced('FONT-PRICEDUSD1', 29.99, 'USDC'), kp),
        authorizeEntry(relPriced('FONT-FREEBIE001', 0, 'USD'), kp),
    ]);
    // The newly appended priced rows name `wallet`, so that wallet must sign
    // this manifest rather than the separate fixture publisher.
    r = await req('POST', '/api/v1/publish', { body: publishBody('TXPRICED000000000000000000000000000000000004', kp) });
    check('publish priced releases -> 200', r.status === 200 && r.json?.success === true, JSON.stringify(r.json));

    const vp = (body) => req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), buyerWallet: wallet, currency: 'SOL', ...body } });
    r = await vp({ artistWallet: wallet, amountLamports: 5_000_000_000, trackId: 'FONT-NOPE99999' });
    check('unknown trackId -> 400 UNKNOWN_TRACK', r.status === 400 && r.json?.code === 'UNKNOWN_TRACK', JSON.stringify(r.json));
    r = await vp({ artistWallet: otherWallet, amountLamports: 5_000_000_000, trackId: 'FONT-PRICEDSOL1' });
    check('forged artistWallet -> 400 ARTIST_MISMATCH', r.status === 400 && r.json?.code === 'ARTIST_MISMATCH', JSON.stringify(r.json));
    r = await vp({ artistWallet: wallet, amountLamports: 1000, trackId: 'FONT-PRICEDSOL1' });
    check('100-lamport "purchase" of a 5 SOL edition -> 400 UNDERPAID', r.status === 400 && r.json?.code === 'UNDERPAID', JSON.stringify(r.json));
    // $29.99 at the stubbed $200/SOL quote → floor ≈ 0.135 SOL; 0.001 SOL must fail.
    r = await vp({ artistWallet: wallet, amountLamports: 1_000_000, trackId: 'FONT-PRICEDUSD1' });
    check('underpaid USD-pegged edition -> 400 UNDERPAID', r.status === 400 && r.json?.code === 'UNDERPAID', JSON.stringify(r.json));
    // The rogue $20,000 CoinGecko quote would put the floor for a $29.99
    // listing at ~1.35M lamports. At the honest $200 median the floor is
    // ~135M, so this amount must still be rejected — one broken price source
    // cannot open an underpayment hole.
    r = await vp({ artistWallet: wallet, amountLamports: 1_400_000, trackId: 'FONT-PRICEDUSD1' });
    check('a single rogue 100x price source cannot lower the underpay floor', r.status === 400 && r.json?.code === 'UNDERPAID', JSON.stringify(r.json));
    // ...and a correct amount at the honest quote still clears the gate.
    r = await vp({ artistWallet: wallet, amountLamports: 140_000_000, trackId: 'FONT-PRICEDUSD1' });
    check('USD-pegged purchase at the honest quote clears the price gate',
        r.status === 400 && !r.json?.code && /on-chain/i.test(String(r.json?.message)), JSON.stringify(r.json));
    r = await vp({ artistWallet: wallet, amountLamports: 1_000_000, trackId: 'FONT-FREEBIE001' });
    check('zero-priced release -> 400 NOT_FOR_SALE', r.status === 400 && r.json?.code === 'NOT_FOR_SALE', JSON.stringify(r.json));
    // Full price clears the gate and proceeds to (stub-failed) chain verification —
    // proves the floor accepts legit amounts rather than rejecting everything.
    r = await vp({ artistWallet: wallet, amountLamports: 5_000_000_000, trackId: 'FONT-PRICEDSOL1' });
    check('full-price purchase clears the price gate (fails only at chain check)',
        r.status === 400 && !r.json?.code && /on-chain/i.test(String(r.json?.message)), JSON.stringify(r.json));
}

// ============ 8. stats shape ============
console.log('stats');
r = await req('GET', '/api/v1/stats');
check('stats -> 200 with numeric aggregates', r.status === 200 && r.json?.durable === true && typeof r.json.stats?.totalPlays === 'number', JSON.stringify(r.json?.stats));

// ============ 9. method / 404 hygiene ============
console.log('method hygiene');
r = await req('GET', '/api/v1/publish');
check('GET on POST-only publish -> 404 (no route)', r.status === 404, String(r.status));

try { fs.rmSync(POINTER_FILE, { force: true }); } catch { /* noop */ }
srv.close(); upstash.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
