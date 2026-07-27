// share-test.mjs — F34 verification: /share/:id OG cards against the real
// Express app + fake Upstash REST (durable registry via GET).
// Run: node tools/share-test.mjs (exit 0 = pass)
import http from 'http';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
}

const DURABLE = [
    {
        type: 'release', id: 'FONT-SHARE001', title: 'Quiet "Storm" <edit>', artist: "D'Angelo & Co",
        price: { amount: 4.99, currency: 'USDC' }, editions: { total: 1000 },
        status: 'REGISTERED_ON_FONTAINOR', date: '2026-07-01T00:00:00.000Z',
        coverUri: '/covers/storm.jpg', audioUri: 'https://example.com/a.mp3',
    },
    {
        type: 'release', id: 'FONT-SHARE002', title: 'Sol Cut', artist: 'Wallet Artist',
        price: { amount: 0.05, currency: 'SOL' }, editions: { total: 10 },
        status: 'REGISTERED_ON_FONTAINOR', date: '2026-07-02T00:00:00.000Z',
        coverUri: 'https://cdn.example.com/abs.jpg', audioUri: 'https://example.com/b.mp3',
    },
];

function runCommand(cmd) {
    const [op, ...args] = cmd;
    switch (String(op).toUpperCase()) {
        case 'GET': return args[0] === 'fontainor:registry:v1' ? JSON.stringify(DURABLE) : null;
        default: return null;
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
        const b64 = req.headers['upstash-encoding'] === 'base64';
        const parsed = JSON.parse(body);
        const isPipeline = Array.isArray(parsed[0]);
        const out = isPipeline
            ? parsed.map((c) => ({ result: encodeResult(runCommand(c), b64) }))
            : { result: encodeResult(runCommand(parsed), b64) };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
    });
});
await new Promise((r) => fakeUpstash.listen(8799, '127.0.0.1', r));
process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:8799';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const { default: app } = await import('../api/index.js');
const server = await new Promise((r) => { const s = app.listen(8798, '127.0.0.1', () => r(s)); });
const BASE = 'http://127.0.0.1:8798';
const get = (path) => fetch(BASE + path, { redirect: 'manual' });

console.log('share cards');

let r = await get('/share/FONT-SHARE001');
let html = await r.text();
check('known id -> 200 html', r.status === 200 && (r.headers.get('content-type') || '').includes('text/html'));
check('og:title has title + artist', html.includes('property="og:title"') && html.includes('Quiet &quot;Storm&quot; &lt;edit&gt;') && html.includes('D&#39;Angelo &amp; Co'));
check('description has price + edition', html.includes('$4.99 USDC') && html.includes('edition of 1000'));
check('relative cover made absolute', html.includes('https://127.0.0.1:8798/covers/storm.jpg'));
check('injection escaped (no raw <edit> tag)', !html.includes('<edit>') && !html.includes('"Storm"'));
check('redirects human to hash route', html.includes('/#/release/FONT-SHARE001'));

r = await get('/share/FONT-SHARE002');
html = await r.text();
check('absolute cover passed through', html.includes('https://cdn.example.com/abs.jpg'));
check('SOL price rendered', html.includes('\u25CE0.05 SOL'));

r = await get('/share/FONT-NOPE404');
check('unknown id -> 302 to app route', r.status === 302 && (r.headers.get('location') || '').includes('/#/release/FONT-NOPE404'));

r = await get('/share/..%2Fevil%20id');
check('invalid id -> 302 to origin, no reflection', r.status === 302 && !(r.headers.get('location') || '').includes('evil'));

server.close(); fakeUpstash.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
