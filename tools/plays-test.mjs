// plays-test.mjs — F32 verification: play counts + trending endpoints against
// the real Express app and a fake Upstash REST server (same protocol shim as
// handles-test.mjs, extended with ZINCRBY/ZRANGE/EXPIRE).
// Run: node tools/plays-test.mjs (exit 0 = pass)
import http from 'http';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

const store = { zsets: new Map() };
function zset(k) { if (!store.zsets.has(k)) store.zsets.set(k, new Map()); return store.zsets.get(k); }
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
            entries = entries.slice(Number(args[1]), Number(args[2]) + 1);
            const out = [];
            for (const [m, s] of entries) { out.push(m); if (withScores) out.push(String(s)); }
            return out;
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
await new Promise((r) => fakeUpstash.listen(8797, '127.0.0.1', r));
process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:8797';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const { default: app } = await import('../api/index.js');
const server = await new Promise((r) => { const s = app.listen(8796, '127.0.0.1', () => r(s)); });
const BASE = 'http://127.0.0.1:8796';
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

console.log('plays endpoints');
let r = await post('/api/v1/plays', { id: 'FONT-AAA111' });
check('valid play accepted, durable', r.status === 200 && (await r.json()).durable === true);
await post('/api/v1/plays', { id: 'FONT-AAA111' });
await post('/api/v1/plays', { id: 'FONT-AAA111' });
await post('/api/v1/plays', { id: 'FONT-BBB222' });

r = await post('/api/v1/plays', { id: 'bad id!!' });
check('invalid id -> 400', r.status === 400);
r = await post('/api/v1/plays', {});
check('missing id -> 400', r.status === 400);

r = await fetch(BASE + '/api/v1/plays/top?window=week&n=10');
const d = await r.json();
check('top returns 200 durable', r.status === 200 && d.durable === true);
check('top ordered by plays desc', d.top.length === 2 && d.top[0].id === 'FONT-AAA111' && d.top[0].plays === 3 && d.top[1].plays === 1, JSON.stringify(d.top));
r = await fetch(BASE + '/api/v1/plays/top?window=all&n=1');
const d2 = await r.json();
check('n cap respected', d2.top.length === 1 && d2.top[0].id === 'FONT-AAA111', JSON.stringify(d2.top));

server.close(); fakeUpstash.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
