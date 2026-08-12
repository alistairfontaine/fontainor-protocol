// A desktop Phantom account switch/disconnect must invalidate the authenticated
// SPA user immediately. Otherwise wallet B can remain behind wallet A's
// profile, cached session proof, and publisher UI until a manual logout.
import { spawn } from 'child_process';
import { chromium } from 'playwright';

const EXE = process.env.FONTAINOR_CHROMIUM || undefined;
// Self-hosted preview: never assume a shared server on 4173 (CI starts those
// on `localhost`, which is not always reachable as 127.0.0.1 on runners).
const PORT = 4194;
const BASE = `http://localhost:${PORT}`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* ignore */ } });
for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/')).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
}
const WALLET_A = '71FvemD53qhyPSbT4abM19PUcFkhkPGCAW85SRZt9eKg';
const WALLET_B = '7YttLkHDoSgC5c6ayhNHj6xnEQvVf4DqSxYFfcoZkpVx';
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
};

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route('**/registry', (route) => route.fulfill({ json: [] }));
await page.route('**/registry.json', (route) => route.fulfill({ json: [] }));
await page.route('**/api/v1/**', (route) => {
    if (route.request().url().includes('sovereign-login')) {
        return route.fulfill({ json: { success: true, wallet: WALLET_A, handle: '@wallet_a', claimed: true } });
    }
    return route.fulfill({ json: { success: true, durable: true, purchases: [], ids: [] } });
});
await page.addInitScript(({ walletA, walletB }) => {
    const listeners = new Map();
    const bytes = new Uint8Array(32).fill(7);
    const key = (address) => ({ toString: () => address, toBytes: () => bytes });
    const provider = {
        isPhantom: true,
        publicKey: key(walletA),
        connect: async () => ({ publicKey: provider.publicKey }),
        disconnect: async () => {},
        signMessage: async () => ({ signature: new Uint8Array(64).fill(9) }),
        on: (event, listener) => {
            const set = listeners.get(event) ?? new Set();
            set.add(listener);
            listeners.set(event, set);
        },
        off: (event, listener) => listeners.get(event)?.delete(listener),
    };
    window.solana = provider;
    window.__walletEvent = (event, address) => {
        if (event === 'accountChanged') provider.publicKey = address ? key(address) : null;
        for (const listener of listeners.get(event) ?? []) listener(address ? provider.publicKey : null);
    };
    window.__walletB = walletB;
}, { walletA: WALLET_A, walletB: WALLET_B });

await page.goto(`${BASE}/#/profile`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Connect Phantom/i }).click();
await page.getByText('@wallet_a').first().waitFor({ timeout: 10000 });
check('wallet A signs in', (await page.textContent('body')).includes(WALLET_A));

await page.evaluate(() => window.__walletEvent('accountChanged', window.__walletB));
await page.getByRole('button', { name: /Connect Phantom/i }).waitFor({ timeout: 5000 }).catch(() => {});
let state = await page.evaluate(() => ({
    user: localStorage.getItem('fontainor_user_v2'),
    proof: localStorage.getItem('fontainor_session_v2'),
    text: document.body.innerText,
}));
check('accountChanged clears rendered wallet A identity', !state.text.includes(WALLET_A) && /Your wallet is your identity/i.test(state.text), state.text.slice(0, 200));
check('accountChanged removes persisted user + bearer proof', state.user === null && state.proof === null, JSON.stringify(state));

// Re-seed a restored A session and reload, then prove provider disconnect
// invalidates it through the same event boundary.
await page.evaluate((walletA) => {
    localStorage.setItem('fontainor_user_v2', JSON.stringify({ address: walletA, handle: '@wallet_a', claimed: true, via: 'wallet' }));
    localStorage.setItem('fontainor_session_v2', JSON.stringify({
        publicKey: '[]', signature: '[]', message: 'x', wallet: walletA, issuedAt: Date.now(),
    }));
}, WALLET_A);
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => window.__walletEvent('disconnect', null));
await page.getByRole('button', { name: /Connect Phantom/i }).waitFor({ timeout: 5000 }).catch(() => {});
state = await page.evaluate(() => ({
    user: localStorage.getItem('fontainor_user_v2'),
    proof: localStorage.getItem('fontainor_session_v2'),
    text: document.body.innerText,
}));
check('disconnect clears restored identity and proof', state.user === null && state.proof === null && /Your wallet is your identity/i.test(state.text), JSON.stringify(state));

await browser.close();
server.kill();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
