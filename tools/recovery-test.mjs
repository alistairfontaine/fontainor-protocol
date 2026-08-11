// recovery-test.mjs — Irys registry self-heal hardening.
//
// The recovery path (GET /registry with no durable store and no pointer) used
// to trust the single newest Irys manifest tagged Fontainor-Protocol /
// registry-manifest — tags are public, so anyone could cold-start-poison the
// registry with a full-replacement manifest. Recovery now scans the newest
// RECOVERY_SCAN_DEPTH manifests and accepts the newest one that is an
// append-only extension of every older fetched manifest (checkAppendOnly).
//
// Scenarios (global fetch is stubbed; the real api/index.js app runs):
//   1. honest chain            -> newest manifest recovered
//   2. attacker replacement    -> skipped, honest manifest recovered
//   3. attacker edit-in-place  -> skipped, honest manifest recovered
//   4. append-only extension   -> accepted, honest entries intact (documented)
//
// Run: node tools/recovery-test.mjs (exit 0 = pass)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POINTER_FILE = path.join(__dirname, '..', 'api', 'pointer.json');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

// no durable store, no pointer: force the recovery path
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.REGISTRY_MANIFEST;
const clearPointer = () => { try { fs.rmSync(POINTER_FILE, { force: true }); } catch { /* noop */ } };
clearPointer();

// ---------- fetch stub: Irys GraphQL + gateways ----------
const entry = (id, artist = 'Honest Artist', extra = {}) => ({
    id, type: 'release', title: `Track ${id}`, artist,
    price: { amount: 1, currency: 'USD' }, editions: { total: 10 },
    status: 'REGISTERED_ON_FONTAINOR', date: '2026-08-01T00:00:00.000Z',
    artistWallet: 'HonestWallet1111111111111111111111111111111', ...extra,
});

const A = entry('FONT-AAA001');
const B = entry('FONT-BBB002');
const C = entry('FONT-CCC003');

// scenario state, mutated between requests
const scenario = { ids: [], manifests: new Map() };
function setScenario(list) {
    // list: [[txId, manifestArray], ...] newest first
    scenario.ids = list.map(([id]) => id);
    scenario.manifests = new Map(list);
}

const realFetch = global.fetch;
const jsonRes = (obj, ok = true) => ({
    ok, status: ok ? 200 : 404,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
});
global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('uploader.irys.xyz/graphql')) {
        return jsonRes({ data: { transactions: { edges: scenario.ids.map((id) => ({ node: { id } })) } } });
    }
    const seg = u.split('/').pop();
    if (scenario.manifests.has(seg)) return jsonRes(scenario.manifests.get(seg));
    if (u.includes('arweave.net') || u.includes('gateway.irys.xyz')) return jsonRes({ error: 'not found' }, false);
    return realFetch(url, opts);
};

const { default: app } = await import('../api/index.js');
const srv = app.listen(0);
await new Promise((r) => srv.once('listening', r));
const base = `http://localhost:${srv.address().port}`;
const getRegistry = async () => {
    clearPointer(); // force recovery every time (pointer is a warm cache)
    const res = await fetch(`${base}/registry`);
    return res.json();
};
const ids = (reg) => (Array.isArray(reg) ? reg.map((e) => e && e.id) : []);

// ---------- 1. honest chain: newest wins ----------
console.log('honest chain');
setScenario([
    ['TXHONEST3', [A, B, C]],
    ['TXHONEST2', [A, B]],
    ['TXHONEST1', [A]],
]);
let reg = await getRegistry();
check('newest honest manifest recovered (3 entries)', ids(reg).join(',') === 'FONT-AAA001,FONT-BBB002,FONT-CCC003');

// ---------- 2. attacker full replacement: skipped ----------
console.log('attacker full-replacement manifest is newest');
const attackerOnly = [entry('EVIL-000001', 'Attacker', { artistWallet: 'AttackerWallet111111111111111111111111111111' })];
setScenario([
    ['TXEVIL1', attackerOnly],      // drops all honest entries
    ['TXHONEST2', [A, B]],
    ['TXHONEST1', [A]],
]);
reg = await getRegistry();
check('replacement skipped, honest registry recovered', ids(reg).join(',') === 'FONT-AAA001,FONT-BBB002');
check('attacker entry absent', !ids(reg).includes('EVIL-000001'));

// ---------- 3. attacker edits an existing entry (payout hijack): skipped ----------
console.log('attacker payout-hijack manifest is newest');
const hijacked = [entry('FONT-AAA001', 'Honest Artist', { artistWallet: 'AttackerWallet111111111111111111111111111111' }), B];
setScenario([
    ['TXEVIL2', hijacked],          // same ids, artistWallet swapped on A
    ['TXHONEST2', [A, B]],
    ['TXHONEST1', [A]],
]);
reg = await getRegistry();
check('hijack skipped, honest registry recovered', JSON.stringify(reg) === JSON.stringify([A, B]));

// ---------- 4. append-only extension is accepted (spam, not hijack) ----------
console.log('append-only extension (documented acceptance)');
const spamExt = [A, B, entry('SPAM-000001', 'Spammer')];
setScenario([
    ['TXSPAM1', spamExt],
    ['TXHONEST2', [A, B]],
]);
reg = await getRegistry();
check('append-only extension accepted', ids(reg).join(',') === 'FONT-AAA001,FONT-BBB002,SPAM-000001');
check('honest entries unchanged in extension', JSON.stringify(reg.slice(0, 2)) === JSON.stringify([A, B]));

// ---------- 5. nothing consistent: empty registry, no crash ----------
console.log('no consistent manifest');
setScenario([
    ['TXEVILA', [entry('X1', 'a')]],
    ['TXEVILB', [entry('X2', 'b')]],  // disjoint histories — mutual tamper
]);
reg = await getRegistry();
check('newer tamperer skipped; oldest-in-window (trivially consistent) wins', ids(reg).join(',') === 'X2');

clearPointer();
srv.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
