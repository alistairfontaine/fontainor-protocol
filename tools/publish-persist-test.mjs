// publish-persist-test.mjs — end-to-end server proof of the publish → durable
// registry → cross-device read → share-card chain (the F11-critical backend).
//
// What it exercises with REAL api/index.js code (only the mainnet Irys upload —
// which costs SOL — is simulated by stubbing the gateway fetch that returns the
// manifest the client "uploaded"):
//   1. Empty registry starts at [].
//   2. Artist A publishes → POST /api/v1/publish {txId} → server validates the
//      manifest resolves, repoints, writes the durable store.
//   3. GET /registry returns A's release (durable persistence).
//   4. GET /share/<id> serves real per-release OG meta (crawler findability).
//   5. Artist B append-publishes → both releases present (append-only merge).
//   6. A "fresh device" (new GET /registry, no local state) sees both.
//   7. A tampering manifest that drops/edits an existing entry → 403.
//
// Run: node tools/publish-persist-test.mjs (exit 0 = pass)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POINTER_FILE = path.join(__dirname, '..', 'api', 'pointer.json');
try { fs.rmSync(POINTER_FILE, { force: true }); } catch { /* noop */ }

let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
};

const rel = (id, title, artist, wallet, extra = {}) => ({
    type: 'release', id, title, artist,
    price: { amount: 12, currency: 'USDC' }, editions: { total: 100 },
    status: 'REGISTERED_ON_FONTAINOR', date: '2026-08-11T00:00:00.000Z',
    audioUri: `https://gateway.irys.xyz/audio-${id}`, coverUri: null, artistWallet: wallet,
});

const A = rel('FONT-REALAAA1', 'First Real Track', 'Artist A', 'WalletAAAA1111111111111111111111111111111111');
const B = rel('FONT-REALBBB2', 'Second Real Track', 'Artist B', 'WalletBBBB2222222222222222222222222222222222');

// ---- manifests the "Irys upload" produced, keyed by fake txId ----
const manifestsByTx = new Map([
    ['TXA0000000000000000000000000000000000000001', [A]],
    ['TXB0000000000000000000000000000000000000002', [A, B]],
    ['TXTAMPER00000000000000000000000000000000003', [{ ...A, artistWallet: 'HijackWallet9999999999999999999999999999999' }, B]],
]);

// ---- gateway fetch stub: /api/v1/publish fetches the manifest to validate it ----
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('arweave.net/') || u.includes('gateway.irys.xyz/')) {
        const seg = u.split('/').pop();
        if (manifestsByTx.has(seg)) {
            return { ok: true, status: 200, json: async () => manifestsByTx.get(seg), text: async () => JSON.stringify(manifestsByTx.get(seg)) };
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
    // Upstash REST goes to localhost — let it through to the stub server below.
    return realFetch(url, opts);
};

// ---- minimal Upstash REST stub (SET/GET on the registry key) ----
const kv = new Map(); const hashes = new Map();
const run = ([op, key, ...args]) => {
    switch (String(op).toUpperCase()) {
        case 'SET': kv.set(key, args[0]); return 'OK';
        case 'GET': return kv.get(key) ?? null;
        case 'HMGET': { const h = hashes.get(key) || {}; return args.map((field) => h[field] ?? null); }
        default: return null;
    }
};
const upstash = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        let cmd; try { cmd = JSON.parse(body); } catch { cmd = null; }
        const out = Array.isArray(cmd?.[0]) ? cmd.map((c) => ({ result: run(c) })) : { result: run(cmd ?? []) };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(out));
    });
});
await new Promise((r) => upstash.listen(0, r));
process.env.UPSTASH_REDIS_REST_URL = `http://localhost:${upstash.address().port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const { default: app } = await import('../api/index.js');
const srv = app.listen(0);
await new Promise((r) => srv.once('listening', r));
const base = `http://localhost:${srv.address().port}`;

const getJson = async (p) => { const r = await realFetch(base + p); return { status: r.status, body: await r.json().catch(() => null) }; };
const publish = async (txId) => {
    const r = await realFetch(base + '/api/v1/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txId }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
};

// ── 1. empty registry ──
console.log('starting state');
let reg = await getJson('/registry');
check('registry starts empty', Array.isArray(reg.body) && reg.body.length === 0);

// ── 2 + 3. Artist A publishes, persists durably ──
console.log('artist A publishes');
let pub = await publish('TXA0000000000000000000000000000000000000001');
check('publish A -> 200 success', pub.status === 200 && pub.body?.success === true, JSON.stringify(pub.body));
check('publish A -> durable:true', pub.body?.durable === true);
reg = await getJson('/registry');
check('registry now contains A', reg.body?.length === 1 && reg.body[0].id === A.id);

// ── 4. share card for A (crawler findability) ──
console.log('share card');
const share = await realFetch(base + `/share/${A.id}`);
const shareHtml = await share.text();
check('share/A -> 200', share.status === 200);
check('share/A has real og:title (title — artist)', shareHtml.includes(`${A.title} \u2014 ${A.artist}`));
check('share/A og:type music.song', shareHtml.includes('music.song'));
const badShare = await realFetch(base + '/share/FONT-NOSUCHID99', { redirect: 'manual' });
check('share unknown id -> 3xx redirect (no fake meta)', badShare.status >= 300 && badShare.status < 400);

// ── 5 + 6. Artist B append-publishes; fresh device sees both ──
console.log('artist B append-publishes');
pub = await publish('TXB0000000000000000000000000000000000000002');
check('publish B (append) -> 200', pub.status === 200 && pub.body?.success === true, JSON.stringify(pub.body));
reg = await getJson('/registry');
const ids = (reg.body || []).map((e) => e.id);
check('registry has BOTH A and B (append-only merge)', ids.includes(A.id) && ids.includes(B.id), JSON.stringify(ids));
check("A's original payout wallet intact after B published", reg.body.find((e) => e.id === A.id)?.artistWallet === A.artistWallet);
// "fresh device" = a brand-new GET with no local state; server is the source of truth
const fresh = await getJson('/registry');
check('fresh device read sees both releases', fresh.body?.length === 2);

// ── 7. tamper rejection ──
console.log('tamper attempt');
const tamper = await publish('TXTAMPER00000000000000000000000000000000003');
check('publish that hijacks A payout -> 403 REGISTRY_TAMPER', tamper.status === 403 && tamper.body?.code === 'REGISTRY_TAMPER', JSON.stringify(tamper.body));
reg = await getJson('/registry');
check("registry unchanged after tamper (A's wallet still honest)", reg.body.find((e) => e.id === A.id)?.artistWallet === A.artistWallet);

try { fs.rmSync(POINTER_FILE, { force: true }); } catch { /* noop */ }
srv.close();
upstash.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
