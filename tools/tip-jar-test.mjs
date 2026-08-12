// tip-jar-test.mjs — the Support page money path.
//
// The bug this locks down: the tip jar used to render "Tip sent — thank you"
// as soon as Phantom returned a signature. A signature only means an RPC node
// accepted the transaction; a dropped or blockhash-expired transfer never
// lands, so the tipper was thanked for money the artist fund never received.
//
// Every scenario stubs `window.solana` (the shape the wallet router installs
// on native and Phantom injects on desktop) and answers Solana JSON-RPC from
// the test, so no real SOL and no real network are involved.
//
// Run: npm run build && node tools/tip-jar-test.mjs   (exit 0 = pass)
import { spawn } from 'child_process'
import bs58 from 'bs58'
import { chromium } from 'playwright'

const PORT = 4195
const BASE = `http://localhost:${PORT}`
const TIP_WALLET = '6Bh5tpmUAVFWxWUPrMvyLCmSo5CouNVauMptgCumW2Fo'
const WALLET = '71FvemD53qhyPSbT4abM19PUcFkhkPGCAW85SRZt9eKg'
const SIG = '5'.repeat(88)

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

/** Injected wallet stub. Behaviour is driven by window.__wallet, set per scenario. */
const WALLET_SHIM = `
window.__wallet = { mode: 'ok', signCalls: 0 };
window.solana = {
  isPhantom: true,
  publicKey: { toString: () => ${JSON.stringify(WALLET)}, toBase58: () => ${JSON.stringify(WALLET)} },
  connect: async () => ({ publicKey: window.solana.publicKey }),
  disconnect: async () => {},
  on: () => {}, off: () => {}, removeListener: () => {},
  signMessage: async () => ({ signature: new Uint8Array(64) }),
  signAndSendTransaction: async (tx) => {
    window.__wallet.signCalls++;
    window.__wallet.lastTx = {
      feePayer: tx?.feePayer?.toBase58?.() ?? null,
      instructions: (tx?.instructions || []).map((ix) => ({
        program: ix.programId?.toBase58?.() ?? null,
        keys: (ix.keys || []).map((k) => k.pubkey?.toBase58?.() ?? null),
        lamports: (() => { try { return Number(new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getBigUint64(4, true)); } catch { return null; } })(),
      })),
      recentBlockhash: tx?.recentBlockhash ?? null,
    };
    if (window.__wallet.mode === 'decline') throw new Error('User rejected the request.');
    if (window.__wallet.mode === 'poor') throw new Error('Transfer: insufficient lamports 1000, need 50000000');
    if (window.__wallet.mode === 'nosig') return {};
    return { signature: ${JSON.stringify(SIG)} };
  },
};
`

/** Solana JSON-RPC stub. `rpcStatus` is a Node-side value the scenarios set,
 *  so the route handler never has to call back into the page (which deadlocks
 *  while the page is awaiting the very fetch being answered). */
let rpcStatus = null
const BLOCKHASH = bs58.encode(Buffer.alloc(32, 9))

async function stubRpc(page) {
  await page.route((url) => /solana|publicnode|mainnet-beta/.test(url.href), async (route) => {
    let body = {}
    try {
      body = JSON.parse(route.request().postData() || '{}')
    } catch {
      /* ignore */
    }
    const id = body.id ?? 1
    if (body.method === 'getLatestBlockhash') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 100 } } }),
      })
    }
    if (body.method === 'getSignatureStatuses') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot: 2 }, value: [rpcStatus] } }),
      })
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id, result: null }) })
  })
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
  detached: false,
})
process.on('exit', () => { try { server.kill() } catch { /* ignore */ } })

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/')
      if (r.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('preview server never came up')
}
await waitForServer()

const browser = await chromium.launch({ executablePath: process.env.FONTAINOR_CHROMIUM || undefined })

/** Open the Support page with the wallet stub and a chosen signature status. */
async function openSupport({ mode = 'ok', status = null } = {}) {
  rpcStatus = status
  const ctx = await browser.newContext()
  await ctx.addInitScript(WALLET_SHIM)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // `/_vercel/insights/script.js` only exists on the deployed origin, so its
  // 404 is preview-only noise — everything else is a real defect.
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/_vercel\/insights|Failed to load resource/.test(t)) return
    errors.push('console: ' + t)
  })
  await stubRpc(page)
  await page.goto(BASE + '/#/support', { waitUntil: 'networkidle' })
  await page.evaluate((m) => { window.__wallet.mode = m }, mode)
  return { ctx, page, errors }
}

async function clickTip(page, label = '0.05 SOL') {
  await page.getByRole('button', { name: label }).click()
}

// web3.js validates the status struct — slot/confirmations/status must be present.
const CONFIRMED = { slot: 2, confirmations: 1, err: null, confirmationStatus: 'confirmed', status: { Ok: null } }

// ── 1. Confirmed tip ───────────────────────────────────────────────────────
{
  const { ctx, page, errors } = await openSupport({ status: CONFIRMED })
  await clickTip(page)
  await page.getByTestId('tip-sent').waitFor({ timeout: 15000 })
  const txt = await page.getByTestId('tip-sent').innerText()
  check('A1 confirmed tip shows the thank-you', /thank you/i.test(txt), txt)
  check('A2 explorer link points at the real signature', (await page.locator(`a[href="https://solscan.io/tx/${SIG}"]`).count()) === 1)
  const tx = await page.evaluate(() => window.__wallet.lastTx)
  check('A3 exactly one transfer instruction was signed', tx.instructions.length === 1, JSON.stringify(tx.instructions))
  check('A4 tip is paid to the protocol wallet', tx.instructions[0]?.keys?.includes(TIP_WALLET), JSON.stringify(tx.instructions[0]?.keys))
  check('A5 lamports match the preset (0.05 SOL)', tx.instructions[0]?.lamports === 50_000_000, String(tx.instructions[0]?.lamports))
  check('A6 fee payer is the connected wallet', tx.feePayer === WALLET, String(tx.feePayer))
  check('A7 blockhash was attached before signing', typeof tx.recentBlockhash === 'string' && tx.recentBlockhash.length > 20)
  check('A8 "Tip again" resets the jar', await page.getByRole('button', { name: 'Tip again' }).isVisible())
  await page.getByRole('button', { name: 'Tip again' }).click()
  check('A9 presets return after reset', await page.getByRole('button', { name: '0.1 SOL' }).isVisible())
  check('A10 no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ── 2. Signature that never confirms — the original bug ────────────────────
{
  const { ctx, page, errors } = await openSupport({ status: null })
  await clickTip(page)
  await page.getByTestId('tip-error').waitFor({ timeout: 60000 })
  const txt = await page.getByTestId('tip-error').innerText()
  check('B1 unconfirmed transfer is NOT reported as sent', (await page.getByTestId('tip-sent').count()) === 0)
  check('B2 unconfirmed message says it has not confirmed', /has(n't| not) confirmed/i.test(txt), txt)
  check('B3 unconfirmed message warns before sending again', /before sending again/i.test(txt), txt)
  check('B4 unconfirmed state still surfaces the transaction id', (await page.locator(`a[href="https://solscan.io/tx/${SIG}"]`).count()) === 1)
  check('B5 no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ── 3. On-chain failure ────────────────────────────────────────────────────
{
  const { ctx, page } = await openSupport({ status: { slot: 2, confirmations: 1, err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: 'processed', status: { Err: { InstructionError: [0, { Custom: 1 }] } } } })
  await clickTip(page)
  await page.getByTestId('tip-error').waitFor({ timeout: 20000 })
  const txt = await page.getByTestId('tip-error').innerText()
  check('C1 on-chain failure is reported as failed', /failed on-chain/i.test(txt), txt)
  check('C2 failed tip is not shown as sent', (await page.getByTestId('tip-sent').count()) === 0)
  check('C3 failed tip links the transaction for checking', (await page.locator(`a[href="https://solscan.io/tx/${SIG}"]`).count()) === 1)
  await ctx.close()
}

// ── 4. User declines ───────────────────────────────────────────────────────
{
  const { ctx, page } = await openSupport({ mode: 'decline', status: CONFIRMED })
  await clickTip(page)
  await page.getByTestId('tip-error').waitFor({ timeout: 15000 })
  const txt = await page.getByTestId('tip-error').innerText()
  check('D1 decline is a calm cancellation, not an error dump', /cancelled/i.test(txt), txt)
  check('D2 decline exposes no transaction link', (await page.locator('a[href^="https://solscan.io/tx/"]').count()) === 0)
  check('D3 presets are usable again after a decline', await page.getByRole('button', { name: '0.05 SOL' }).isEnabled())
  await ctx.close()
}

// ── 5. Not enough SOL ──────────────────────────────────────────────────────
{
  const { ctx, page } = await openSupport({ mode: 'poor', status: CONFIRMED })
  await clickTip(page)
  await page.getByTestId('tip-error').waitFor({ timeout: 15000 })
  const txt = await page.getByTestId('tip-error').innerText()
  check('E1 insufficient funds is explained plainly', /not enough sol/i.test(txt), txt)
  check('E2 insufficient funds is not reported as sent', (await page.getByTestId('tip-sent').count()) === 0)
  await ctx.close()
}

// ── 6. Wallet returns no signature ─────────────────────────────────────────
{
  const { ctx, page } = await openSupport({ mode: 'nosig', status: CONFIRMED })
  await clickTip(page)
  await page.getByTestId('tip-error').waitFor({ timeout: 15000 })
  const txt = await page.getByTestId('tip-error').innerText()
  check('F1 missing transaction id cannot pass as a sent tip', (await page.getByTestId('tip-sent').count()) === 0)
  check('F2 missing transaction id is explained', /can'?t be confirmed|no transaction id/i.test(txt), txt)
  await ctx.close()
}

// ── 7. No wallet at all ────────────────────────────────────────────────────
{
  rpcStatus = null
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await stubRpc(page)
  await page.goto(BASE + '/#/support', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '0.05 SOL' }).click()
  await page.getByTestId('tip-error').waitFor({ timeout: 15000 })
  const txt = await page.getByTestId('tip-error').innerText()
  check('G1 no wallet still offers the copy-the-address path', /copy the address|any wallet/i.test(txt), txt)
  check('G2 the tip wallet address is on the page for manual sends', (await page.getByText(TIP_WALLET, { exact: false }).count()) > 0)
  check('G3 no page errors without a wallet', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ── 8. Double-tap guard ────────────────────────────────────────────────────
{
  const { ctx, page } = await openSupport({ status: CONFIRMED })
  const btn = page.getByRole('button', { name: '0.05 SOL' })
  await btn.click()
  await Promise.all([btn.click({ force: true }).catch(() => {}), btn.click({ force: true }).catch(() => {})])
  await page.getByTestId('tip-sent').waitFor({ timeout: 15000 })
  const calls = await page.evaluate(() => window.__wallet.signCalls)
  check('H1 rapid taps send the tip only once', calls === 1, `signCalls=${calls}`)
  await ctx.close()
}

// ── 9. Clipboard denial must not break the page ─────────────────────────────
{
  const ctx = await browser.newContext()
  await ctx.addInitScript(WALLET_SHIM)
  rpcStatus = null
  await ctx.addInitScript(`
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
      configurable: true,
    });
  `)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await stubRpc(page)
  await page.goto(BASE + '/#/support', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await page.waitForTimeout(500)
  check('I1 denied clipboard raises no page error', errors.length === 0, errors.join(' | '))
  check('I2 address remains visible as the fallback', (await page.getByText(TIP_WALLET, { exact: false }).count()) > 0)
  await ctx.close()
}

await browser.close()
server.kill()
console.log(`\ntip-jar: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
