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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POINTER_FILE = path.join(__dirname, '..', 'api', 'pointer.json');
try { fs.rmSync(POINTER_FILE, { force: true }); } catch { /* noop */ }

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
    if (cond) { passed++; console.log(`  \u2713 ${name}`); }
    else { failed++; console.error(`  \u2717 ${name} ${detail}`); }
};

// ---- gateway stub for /api/v1/publish manifest fetch ----
const rel = (id, title, artist, wallet) => ({
    type: 'release', id, title, artist,
    price: { amount: 5, currency: 'SOL' }, editions: { total: 10 },
    status: 'REGISTERED_ON_FONTAINOR', date: '2026-08-11T00:00:00.000Z',
    audioUri: `https://gateway.irys.xyz/a-${id}`, coverUri: null, artistWallet: wallet,
});
const XSS = rel('FONT-XSS00001', '"><script>alert(1)</script>', 'Evil', 'WalletZZ9999999999999999999999999999999999999');
const manifestsByTx = new Map([
    ['TXBASE0000000000000000000000000000000000001', [rel('FONT-BASE0001', 'Base Track', 'Base Artist', 'WalletBASE111111111111111111111111111111111')]],
    ['TXXSS00000000000000000000000000000000000002', [rel('FONT-BASE0001', 'Base Track', 'Base Artist', 'WalletBASE111111111111111111111111111111111'), XSS]],
    ['TXTAMPER000000000000000000000000000000000003', [rel('FONT-BASE0001', 'HIJACKED', 'Base Artist', 'WalletBASE111111111111111111111111111111111')]],
]);
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const u = String(url);
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
        res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch { /* non-json */ } resolve({ status: res.statusCode, json, text: data, ctype: res.headers['content-type'] || '' }); });
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
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: wallet, amountLamports: 1e309, trackId: 'FONT-BASE0001' } });
check('verify-payment Infinity amount -> 400 (not passed downstream)', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: 'not-a-wallet!!!', amountLamports: 1000, trackId: 'FONT-BASE0001' } });
check('verify-payment bad artistWallet -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: wallet, buyerWallet: 'garbage', amountLamports: 1000, trackId: 'FONT-BASE0001' } });
check('verify-payment bad buyerWallet -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/verify-payment', { body: { signature: 'x'.repeat(88), artistWallet: wallet, amountLamports: 1000, trackId: 'y'.repeat(65) } });
check('verify-payment overlong trackId -> 400', r.status === 400, String(r.status));

// ============ 7. publish + tamper + XSS share ============
console.log('publish + share');
r = await req('POST', '/api/v1/publish', { body: { txId: 'short' } });
check('publish bad txId -> 400', r.status === 400, String(r.status));
r = await req('POST', '/api/v1/publish', { body: { txId: 'TXBASE0000000000000000000000000000000000001' } });
check('publish base manifest -> 200 durable', r.status === 200 && r.json?.durable === true, JSON.stringify(r.json));
r = await req('POST', '/api/v1/publish', { body: { txId: 'TXTAMPER000000000000000000000000000000000003' } });
check('publish that edits an existing entry -> 403 REGISTRY_TAMPER', r.status === 403 && r.json?.code === 'REGISTRY_TAMPER', JSON.stringify(r.json));
r = await req('POST', '/api/v1/publish', { body: { txId: 'TXXSS00000000000000000000000000000000000002' } });
check('publish appending a new entry -> 200', r.status === 200 && r.json?.success === true, JSON.stringify(r.json));
r = await req('GET', '/share/FONT-XSS00001');
check('share renders and HTML-escapes a script-injection title', r.status === 200 && !r.text.includes('<script>alert(1)</script>') && r.text.includes('&lt;script&gt;'), 'unescaped!');
r = await req('GET', '/share/..%2F..%2Fetc%2Fpasswd');
check('share path-traversal id -> 302 redirect (no file read)', r.status === 302, String(r.status));

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
