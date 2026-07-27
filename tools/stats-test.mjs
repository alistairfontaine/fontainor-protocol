// stats-test.mjs — /api/v1/stats verification against the real Express app
// and a fake Upstash REST server (same protocol shim as plays-test.mjs,
// extended with LPUSH/LRANGE).
// Run: node tools/stats-test.mjs (exit 0 = pass)
import http from 'http';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

const store = { zsets: new Map(), lists: new Map() };
function zset(k) { if (!store.zsets.has(k)) store.zsets.set(k, new Map()); return store.zsets.get(k); }
function list(k) { if (!store.lists.has(k)) store.lists.set(k, []); return store.lists.get(k); }
function runCommand(cmd) {
    const [op, ...args] = cmd;
    switch (String(op).toUpperCase()) {
        case 'ZINCRBY': { const z = zset(args[0]); const v = (z.get(args[2]) ?? 0) + Number(args[1]); z.set(args[2], v); return String(v); }
        case 'EXPIRE': return 1;
        case 'ZRANGE': {
            const z = zset(args[0]);
            const rev = args.some(a => String(a).toUpperCase() === 'REV');
            const withScores = args.some(a => String(a).toUpperCase() === 'WITHSCORES');
            let entries = [...z.entries()].sort((a, b) => a[1] - b[1]);
            if (rev) entries.reverse();
            const stop = Number(args[2]);
            entries = entries.slice(Number(args[1]), stop === -1 ? undefined : stop + 1);
            const out = [];
            for (const [m, s] of entries) { out.push(m); if (withScores) out.push(String(s)); }
            return out;
        }
        case 'LPUSH': { const l = list(args[0]); for (const v of args.slice(1)) l.unshift(v); return l.length; }
        case 'LRANGE': {
            const l = list(args[0]);
            const stop = Number(args[2]);
            return l.slice(Number(args[1]), stop === -1 ? undefined : stop + 1);
        }
        case 'GET': return null;
        default: throw new Error(`fake upstash: unsupported ${op}`);
    }
}
function encodeResult(v, b64) {
    if (!b64 || v === null) return v;
    if (typeof v === 'string') return Buffer.from(v, 'utf8').toString('base64');
    if (Array.isArray(v)) return v.map((x) => encodeResult(x, b64));
    return v;
}
const fakeUpstash = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        try {
            const b64 = req.headers['upstash-encoding'] === 'base64';
            const parsed = JSON.parse(body);
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
await new Promise((r) => fakeUpstash.listen(8799, '127.0.0.1', r));
process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:8799';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const { default: app } = await import('../api/index.js');
const server = await new Promise((r) => { const s = app.listen(8798, '127.0.0.1', () => r(s)); });
const BASE = 'http://127.0.0.1:8798';
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

console.log('stats endpoint');

// Empty state: everything zero.
let r = await fetch(BASE + '/api/v1/stats');
let j = await r.json();
check('empty stats 200 + durable', r.status === 200 && j.success && j.durable === true);
check('empty stats all zero', j.stats.totalPlays === 0 && j.stats.totalBuys === 0 && j.stats.uniqueBuyers === 0 && j.stats.totalLamports === 0);

// Seed plays via the real endpoint: 3 plays across 2 tracks.
await post('/api/v1/plays', { id: 'FONT-AAA111' });
await post('/api/v1/plays', { id: 'FONT-AAA111' });
await post('/api/v1/plays', { id: 'FONT-BBB222' });

// Seed purchases directly into the fake store (verify-payment would need a
// real on-chain signature; stats only reads the receipt list).
const W1 = 'BuyerWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const W2 = 'BuyerWa11etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
for (const p of [
    { trackId: 'FONT-AAA111', signature: 'sig1', buyerWallet: W1, amountLamports: 1000000 },
    { trackId: 'FONT-BBB222', signature: 'sig2', buyerWallet: W1, amountLamports: 2000000 },
    { trackId: 'FONT-AAA111', signature: 'sig3', buyerWallet: W2, amountLamports: 3000000 },
]) runCommand(['LPUSH', 'fontainor:purchases:v1', JSON.stringify(p)]);

r = await fetch(BASE + '/api/v1/stats');
j = await r.json();
check('stats 200', r.status === 200 && j.success);
check('totalPlays = 3', j.stats.totalPlays === 3, `got ${j.stats.totalPlays}`);
check('tracksPlayed = 2', j.stats.tracksPlayed === 2, `got ${j.stats.tracksPlayed}`);
check('totalBuys = 3', j.stats.totalBuys === 3, `got ${j.stats.totalBuys}`);
check('uniqueBuyers = 2', j.stats.uniqueBuyers === 2, `got ${j.stats.uniqueBuyers}`);
check('totalLamports = 6000000', j.stats.totalLamports === 6000000, `got ${j.stats.totalLamports}`);
check('totalSol = 0.006', Math.abs(j.stats.totalSol - 0.006) < 1e-12, `got ${j.stats.totalSol}`);

server.close();
fakeUpstash.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
