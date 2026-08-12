// End-to-end authorization checks for permanent registry publishing.
// Exercises the real Express app, real Ed25519 signatures, a fake Irys gateway,
// and a minimal durable Upstash store. No network or wallet funds required.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { authorizeEntry } from './entry-proof.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pointer = path.join(__dirname, '..', 'api', 'pointer.json');
try { fs.rmSync(pointer, { force: true }); } catch { /* noop */ }

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
};

const artist = nacl.sign.keyPair();
const attacker = nacl.sign.keyPair();
const artistWallet = bs58.encode(artist.publicKey);
const attackerWallet = bs58.encode(attacker.publicKey);
const rawEntry = (id, wallet = artistWallet) => ({
    type: 'release',
    id,
    title: `Track ${id}`,
    artist: 'Proof Artist',
    price: { amount: 1, currency: 'SOL' },
    editions: { total: 10 },
    status: 'REGISTERED_ON_FONTAINOR',
    date: '2026-08-12T00:00:00.000Z',
    audioUri: `https://gateway.irys.xyz/audio-${id}`,
    coverUri: null,
    artistWallet: wallet,
});
const A = authorizeEntry(rawEntry('FONT-PROOFA1'), artist);
const B = authorizeEntry(rawEntry('FONT-PROOFB2'), artist);
const FOREIGN = authorizeEntry(rawEntry('FONT-FOREIGN', attackerWallet), attacker);

const manifests = new Map([
    ['TXAUTHA000000000000000000000000000000000001', [A]],
    ['TXAUTHB000000000000000000000000000000000002', [A, B]],
    ['TXFOREIGN0000000000000000000000000000000003', [A, FOREIGN]],
    ['TXUNSIGNED0000000000000000000000000000000004', [A, rawEntry('FONT-NOPROOF')]],
]);
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('arweave.net/') || u.includes('gateway.irys.xyz/')) {
        const manifest = manifests.get(u.split('/').pop());
        return {
            ok: Boolean(manifest),
            status: manifest ? 200 : 404,
            json: async () => manifest ?? {},
            text: async () => JSON.stringify(manifest ?? {}),
        };
    }
    return realFetch(url, opts);
};

let registry = null;
const upstash = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
        const command = JSON.parse(body);
        const one = (cmd) => {
            const [op, key, value] = cmd;
            if (String(op).toUpperCase() === 'GET') return registry;
            if (String(op).toUpperCase() === 'SET') { registry = value; return 'OK'; }
            if (String(op).toUpperCase() === 'HMGET') return cmd.slice(2).map(() => null);
            if (String(op).toUpperCase() === 'HGET') return null;
            throw new Error(`unsupported ${op} ${key}`);
        };
        const out = Array.isArray(command[0])
            ? command.map((cmd) => ({ result: one(cmd) }))
            : { result: one(command) };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(out));
    });
});
await new Promise((resolve) => upstash.listen(0, resolve));
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${upstash.address().port}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';

const { default: app } = await import('../api/index.js');
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const post = async (pathName, body) => {
    const res = await realFetch(base + pathName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};
const listingBody = (txId, keypair, issuedAt = Date.now(), signTxId = txId) => {
    const message = `Fontainor publish manifest: ${signTxId} :: ${issuedAt}`;
    return {
        txId,
        issuedAt,
        publicKey: JSON.stringify(Array.from(keypair.publicKey)),
        signature: JSON.stringify(Array.from(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey))),
    };
};

console.log('publish authorization');
let out = await post('/api/v1/publish', { txId: 'TXAUTHA000000000000000000000000000000000001' });
check('missing signature -> 401 PUBLISH_AUTH_REQUIRED', out.status === 401 && out.body.code === 'PUBLISH_AUTH_REQUIRED', JSON.stringify(out));

out = await post('/api/v1/publish', { txId: 'TXAUTHA000000000000000000000000000000000001', issuedAt: Date.now(), publicKey: 'bad', signature: 'bad' });
check('malformed signature -> 400 PUBLISH_AUTH_INVALID', out.status === 400 && out.body.code === 'PUBLISH_AUTH_INVALID', JSON.stringify(out));

out = await post('/api/v1/publish', listingBody('TXAUTHA000000000000000000000000000000000001', artist, Date.now() - 11 * 60 * 1000));
check('stale signature -> 401 SIGNATURE_STALE', out.status === 401 && out.body.code === 'SIGNATURE_STALE', JSON.stringify(out));

out = await post('/api/v1/publish', listingBody('TXAUTHA000000000000000000000000000000000001', artist, Date.now(), 'TXWRONG000000000000000000000000000000000000'));
check('signature bound to wrong txId -> 401 PUBLISH_AUTH_INVALID', out.status === 401 && out.body.code === 'PUBLISH_AUTH_INVALID', JSON.stringify(out));

out = await post('/api/v1/publish', listingBody('TXAUTHA000000000000000000000000000000000001', artist));
check('valid signer + permanent entry proof -> 200', out.status === 200 && out.body.success, JSON.stringify(out));

out = await post('/api/v1/publish', listingBody('TXAUTHB000000000000000000000000000000000002', attacker));
check('listing signer/artistWallet mismatch -> 403 PUBLISHER_MISMATCH', out.status === 403 && out.body.code === 'PUBLISHER_MISMATCH', JSON.stringify(out));

out = await post('/api/v1/publish', listingBody('TXFOREIGN0000000000000000000000000000000003', artist));
check('mixed manifest foreign new entry -> 403 PUBLISHER_MISMATCH', out.status === 403 && out.body.code === 'PUBLISHER_MISMATCH', JSON.stringify(out));

out = await post('/api/v1/publish', listingBody('TXUNSIGNED0000000000000000000000000000000004', artist));
check('unsigned permanent entry -> 403 ENTRY_AUTH_INVALID', out.status === 403 && out.body.code === 'ENTRY_AUTH_INVALID', JSON.stringify(out));

out = await post('/upload', [A]);
check('retired direct-array bypass -> 410 UPLOAD_RETIRED', out.status === 410 && out.body.code === 'UPLOAD_RETIRED', JSON.stringify(out));

server.close();
upstash.close();
try { fs.rmSync(pointer, { force: true }); } catch { /* noop */ }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
