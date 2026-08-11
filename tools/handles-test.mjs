// handles-test.mjs — verification for wallet-bound @handles + registry guard.
//
// 1. Unit tests of api/registryGuard.js (pure functions).
// 2. Endpoint tests of the real Express app against a local fake Upstash REST
//    server (implements GET/SET/HGET/HSET/HDEL/LPUSH over the same protocol),
//    so claim -> login -> impersonation-rejection runs end to end with real
//    ed25519 signatures and zero external services.
//
// Run: node tools/handles-test.mjs   (exits 0 on success, 1 on failure)

import http from 'http';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { canonical, checkAppendOnly, findHandleConflicts, getProtectedOwner, normalizeHandle } from '../api/registryGuard.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

// ---------- 1. Pure guard functions ----------
console.log('registryGuard unit tests');

check('normalizeHandle strips @ and lowercases', normalizeHandle('@Tapiwa_Music') === 'tapiwa_music');
check('normalizeHandle rejects short', normalizeHandle('ab') === null);
check('normalizeHandle rejects bad chars', normalizeHandle('has space') === null && normalizeHandle('a.b.c') === null);
check('normalizeHandle rejects reserved', normalizeHandle('treasury') === null && normalizeHandle('@ADMIN') === null);
check('normalizeHandle allows fontainor (protected, not reserved)', normalizeHandle('@Fontainor') === 'fontainor');
process.env.TREASURY_WALLET = 'TreasuryTestWallet';
check('getProtectedOwner: fontainor -> treasury wallet (env override)', getProtectedOwner('fontainor') === 'TreasuryTestWallet');
check('getProtectedOwner: other names unprotected', getProtectedOwner('tapiwa_music') === null);
check('findHandleConflicts: protected name owned even before claim',
    (await findHandleConflicts([{ id: 'FONT-PROT01', artist: 'Fontainor', artistWallet: 'WalletB' }], async () => null)).length === 1);
check('findHandleConflicts: protected name fine for treasury wallet',
    (await findHandleConflicts([{ id: 'FONT-PROT02', artist: 'fontainor', artistWallet: 'TreasuryTestWallet' }], async () => null)).length === 0);
check('normalizeHandle rejects address-derived fallback shape', normalizeHandle('@4EgH...JJXX') === null);

const e1 = { id: 'FONT-AAA111', title: 'One', artist: 'alice', artistWallet: 'WalletA', price: { amount: 1, currency: 'USD' } };
const e2 = { id: 'FONT-BBB222', title: 'Two', artist: 'bob', artistWallet: 'WalletB', price: { amount: 2, currency: 'USD' } };

check('canonical is key-order independent',
    canonical({ b: 1, a: { d: 2, c: 3 } }) === canonical({ a: { c: 3, d: 2 }, b: 1 }));

let r = checkAppendOnly([e1], [e1, e2]);
check('append-only: appending passes', r.ok && r.newEntries.length === 1 && r.newEntries[0].id === 'FONT-BBB222');

r = checkAppendOnly([e1], [e2]);
check('append-only: dropping an entry rejected', !r.ok && /drops existing/.test(r.error));

r = checkAppendOnly([e1], [{ ...e1, artistWallet: 'WalletEvil' }, e2]);
check('append-only: editing artistWallet rejected', !r.ok && /modifies existing/.test(r.error));

r = checkAppendOnly([e1], [e1, e2, { ...e2 }]);
check('append-only: duplicate ids rejected', !r.ok && /Duplicate/.test(r.error));

r = checkAppendOnly([], [e1, e2]);
check('append-only: empty baseline treats all as new', r.ok && r.newEntries.length === 2);

// key order shouldn't matter for the tamper comparison
const e1Reordered = { artistWallet: 'WalletA', artist: 'alice', title: 'One', id: 'FONT-AAA111', price: { currency: 'USD', amount: 1 } };
r = checkAppendOnly([e1], [e1Reordered, e2]);
check('append-only: identical entry with different key order passes', r.ok);

const lookup = async (h) => (h === 'alice' ? 'WalletA' : null);
let conflicts = await findHandleConflicts([{ id: 'X', artist: '@Alice', artistWallet: 'WalletB' }], lookup);
check('handle conflict: other wallet publishing as claimed @Alice flagged', conflicts.length === 1 && conflicts[0].owner === 'WalletA');
conflicts = await findHandleConflicts([{ id: 'X', artist: 'alice', artistWallet: 'WalletA' }], lookup);
check('handle conflict: owner wallet publishing as own handle passes', conflicts.length === 0);
conflicts = await findHandleConflicts([{ id: 'X', artist: 'Some Free Text Name', artistWallet: 'WalletB' }], lookup);
check('handle conflict: non-handle-shaped artist names stay allowed', conflicts.length === 0);

// ---------- 2. Endpoint tests against fake Upstash ----------
console.log('endpoint tests (fake Upstash + real ed25519 signatures)');

const store = { kv: new Map(), hashes: new Map(), lists: new Map() };
function runCommand(cmd) {
    const [op, ...args] = cmd;
    switch (String(op).toUpperCase()) {
        case 'GET': return store.kv.has(args[0]) ? store.kv.get(args[0]) : null;
        case 'SET': store.kv.set(args[0], args[1]); return 'OK';
        case 'HGET': return store.hashes.get(args[0])?.get(args[1]) ?? null;
        case 'HSET': {
            if (!store.hashes.has(args[0])) store.hashes.set(args[0], new Map());
            const h = store.hashes.get(args[0]);
            let n = 0;
            for (let i = 1; i + 1 < args.length; i += 2) { h.set(args[i], args[i + 1]); n++; }
            return n;
        }
        case 'HSETNX': {
            if (!store.hashes.has(args[0])) store.hashes.set(args[0], new Map());
            const h = store.hashes.get(args[0]);
            if (h.has(args[1])) return 0;
            h.set(args[1], args[2]);
            return 1;
        }
        case 'SADD': {
            if (!store.kv.has('__sets__' + args[0])) store.kv.set('__sets__' + args[0], new Set());
            const s = store.kv.get('__sets__' + args[0]);
            let n = 0;
            for (const m of args.slice(1)) { if (!s.has(m)) { s.add(m); n++; } }
            return n;
        }
        case 'HDEL': {
            const h = store.hashes.get(args[0]);
            let n = 0;
            for (const f of args.slice(1)) if (h?.delete(f)) n++;
            return n;
        }
        case 'LPUSH': {
            if (!store.lists.has(args[0])) store.lists.set(args[0], []);
            store.lists.get(args[0]).unshift(...args.slice(1));
            return store.lists.get(args[0]).length;
        }
        default: throw new Error(`fake upstash: unsupported command ${op}`);
    }
}
// The client may request base64-encoded results via the Upstash-Encoding header.
function encodeResult(v, b64) {
    if (!b64 || v === null) return v;
    if (typeof v === 'string') return Buffer.from(v, 'utf8').toString('base64');
    if (Array.isArray(v)) return v.map((x) => encodeResult(x, b64));
    return v; // numbers / 'OK' status objects stay as-is (OK is a string, handled above)
}
const fakeUpstash = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        try {
            const b64 = req.headers['upstash-encoding'] === 'base64';
            const parsed = JSON.parse(body);
            // single command: ["HGET", ...]; pipeline: [["HGET",...],...]
            const isPipeline = Array.isArray(parsed[0]);
            const out = isPipeline
                ? parsed.map((c) => ({ result: encodeResult(runCommand(c), b64) }))
                : { result: encodeResult(runCommand(parsed), b64) };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
    });
});
await new Promise((resolve) => fakeUpstash.listen(8799, '127.0.0.1', resolve));
process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:8799';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const { default: app } = await import('../api/index.js');
const server = await new Promise((resolve) => { const s = app.listen(8798, '127.0.0.1', () => resolve(s)); });
const BASE = 'http://127.0.0.1:8798';

const A = nacl.sign.keyPair();
const B = nacl.sign.keyPair();
const T = nacl.sign.keyPair(); // stands in for the treasury wallet
const walletA = bs58.encode(A.publicKey);
const walletB = bs58.encode(B.publicKey);
const walletT = bs58.encode(T.publicKey);
process.env.TREASURY_WALLET = walletT;

function signedPayload(kp, message, extra = {}) {
    const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
    return {
        publicKey: JSON.stringify(Array.from(kp.publicKey)),
        signature: JSON.stringify(Array.from(sig)),
        ...extra,
    };
}
async function post(pathname, body) {
    const res = await fetch(BASE + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
}

// login before any claim -> address-derived fallback
let out = await post('/api/v1/auth/sovereign-login', signedPayload(A, 'Authenticate Fontainor Sovereign Session', { message: 'Authenticate Fontainor Sovereign Session' }));
check('login (no claim): fallback handle + claimed=false',
    out.status === 200 && out.data.success && out.data.claimed === false && /^@.{4}\.\.\..{4}$/.test(out.data.handle), JSON.stringify(out));

// claim a handle with wallet A
out = await post('/api/v1/auth/set-handle', signedPayload(A, 'Fontainor handle claim: @tapiwa_music', { handle: '@Tapiwa_Music' }));
check('set-handle: wallet A claims @tapiwa_music', out.status === 200 && out.data.handle === '@tapiwa_music', JSON.stringify(out));

// login again -> claimed handle
out = await post('/api/v1/auth/sovereign-login', signedPayload(A, 'Authenticate Fontainor Sovereign Session', { message: 'Authenticate Fontainor Sovereign Session' }));
check('login (claimed): returns @tapiwa_music + claimed=true',
    out.status === 200 && out.data.handle === '@tapiwa_music' && out.data.claimed === true, JSON.stringify(out));

// wallet B tries to steal the handle -> 409
out = await post('/api/v1/auth/set-handle', signedPayload(B, 'Fontainor handle claim: @tapiwa_music', { handle: 'tapiwa_music' }));
check('set-handle: wallet B stealing claimed handle -> 409', out.status === 409 && out.data.code === 'HANDLE_TAKEN', JSON.stringify(out));

// bad signature -> 401 (B signs but sends A's pubkey)
const badSig = signedPayload(B, 'Fontainor handle claim: @othername', { handle: 'othername' });
badSig.publicKey = JSON.stringify(Array.from(A.publicKey));
out = await post('/api/v1/auth/set-handle', badSig);
check('set-handle: forged signature -> 401', out.status === 401, JSON.stringify(out));

// invalid handle -> 400
out = await post('/api/v1/auth/set-handle', signedPayload(A, 'Fontainor handle claim: @x', { handle: 'x' }));
check('set-handle: invalid handle -> 400', out.status === 400 && out.data.code === 'HANDLE_INVALID', JSON.stringify(out));

// protected handle: non-treasury wallet -> 403, treasury wallet -> 200
out = await post('/api/v1/auth/set-handle', signedPayload(B, 'Fontainor handle claim: @fontainor', { handle: 'fontainor' }));
check('set-handle: non-treasury wallet claiming @fontainor -> 403 HANDLE_PROTECTED', out.status === 403 && out.data.code === 'HANDLE_PROTECTED', JSON.stringify(out));
out = await post('/api/v1/auth/set-handle', signedPayload(T, 'Fontainor handle claim: @fontainor', { handle: '@Fontainor' }));
check('set-handle: treasury wallet claims @fontainor', out.status === 200 && out.data.handle === '@fontainor', JSON.stringify(out));

// seed the registry via /upload with A's legit release
const relA = { type: 'release', id: 'FONT-TESTA1', title: 'Anthem', artist: '@tapiwa_music', price: { amount: 1, currency: 'USD' }, editions: { total: 10 }, status: 'REGISTERED_ON_FONTAINOR', date: new Date().toISOString(), desc: '', audioUri: null, coverUri: null, artistWallet: walletA };
out = await post('/upload', [relA]);
check('upload: owner publishing under own claimed handle succeeds', out.status === 200 && out.data.success && out.data.durable === true, JSON.stringify(out));

// wallet B publishing under A's claimed handle -> 403 HANDLE_OWNED
const fakeB = { ...relA, id: 'FONT-TESTB1', title: 'Impostor', artistWallet: walletB };
out = await post('/upload', [relA, fakeB]);
check('upload: impersonating claimed handle -> 403 HANDLE_OWNED', out.status === 403 && out.data.code === 'HANDLE_OWNED', JSON.stringify(out));

// tampering with A's existing entry (hijack payouts) -> 403 REGISTRY_TAMPER
out = await post('/upload', [{ ...relA, artistWallet: walletB }]);
check('upload: rewriting existing entry -> 403 REGISTRY_TAMPER', out.status === 403 && out.data.code === 'REGISTRY_TAMPER', JSON.stringify(out));

// dropping A's entry -> 403 REGISTRY_TAMPER
out = await post('/upload', [{ ...relA, id: 'FONT-OTHER9', artist: 'someone else', artistWallet: walletB }]);
check('upload: dropping existing entry -> 403 REGISTRY_TAMPER', out.status === 403 && out.data.code === 'REGISTRY_TAMPER', JSON.stringify(out));

// appending a clean new entry by B under an unclaimed free-text name -> OK
out = await post('/upload', [relA, { ...relA, id: 'FONT-TESTB2', title: 'Legit', artist: 'DJ Freetext', artistWallet: walletB }]);
check('upload: appending clean new entry succeeds', out.status === 200 && out.data.success, JSON.stringify(out));

// current registry after the clean append (baseline for the next probes)
const seeded = [relA, { ...relA, id: 'FONT-TESTB2', title: 'Legit', artist: 'DJ Freetext', artistWallet: walletB }];

// publishing under the protected 'fontainor' name with a non-treasury wallet -> 403 even though claimed by T
out = await post('/upload', [...seeded, { ...relA, id: 'FONT-TESTB3', title: 'Fake Official', artist: 'Fontainor', artistWallet: walletB }]);
check('upload: publishing as Fontainor from non-treasury wallet -> 403 HANDLE_OWNED', out.status === 403 && out.data.code === 'HANDLE_OWNED', JSON.stringify(out));

// treasury wallet publishing under 'fontainor' -> OK
out = await post('/upload', [...seeded, { ...relA, id: 'FONT-TESTT1', title: 'Official Drop', artist: '@Fontainor', artistWallet: walletT }]);
check('upload: treasury wallet publishing as Fontainor succeeds', out.status === 200 && out.data.success, JSON.stringify(out));

server.close();
fakeUpstash.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
