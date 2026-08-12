// Headless verification for F27 (musician-pays publish) + F28 (real purchases).
// Run: npm run build && npx vite preview --port 4173 & node tools/real-flows-test.mjs
// Headless verification: musician-pays publish quote + real purchase flow (simulated chain)
import { chromium } from 'playwright'

// Portable: use Playwright's own resolved browser unless FONTAINOR_CHROMIUM overrides.
const EXE = process.env.FONTAINOR_CHROMIUM || undefined
const BASE = 'http://localhost:4173'
const BUYER = '71FvemD53qhyPSbT4abM19PUcFkhkPGCAW85SRZt9eKg'
const ARTIST = 'So11111111111111111111111111111111111111112'
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`) }

const REGISTRY = [
  { type: 'release', id: 'FONT-BUYME1', title: 'Purchasable Track', artist: 'Wallet Artist',
    price: { amount: 0.01, currency: 'SOL' }, editions: { total: 10 }, status: 'REGISTERED_ON_FONTAINOR',
    date: '2026-07-01T00:00:00.000Z', audioUri: 'https://example.com/a.mp3', coverUri: null, artistWallet: ARTIST },
  { type: 'release', id: 'FONT-LEGACY1', title: 'Legacy Track', artist: 'Old Artist',
    price: { amount: 5, currency: 'USDC' }, editions: { total: 10 }, status: 'REGISTERED_ON_FONTAINOR',
    date: '2026-06-01T00:00:00.000Z', audioUri: 'https://example.com/b.mp3', coverUri: null },
]

async function main() {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  // ── stubs ──
  await page.route('**/registry', (r) => r.fulfill({ json: REGISTRY, headers: { 'access-control-allow-origin': '*' } }))
  await page.route('**/api/v1/auth/sovereign-login', (r) =>
    r.fulfill({ json: { success: true, wallet: BUYER, handle: '@71Fv...9eKg' } }))
  let verifyPayload = null
  await page.route('**/api/v1/verify-payment', async (r) => {
    verifyPayload = r.request().postDataJSON()
    await r.fulfill({ json: { success: true, verified: true, receiptStored: false } })
  })
  // The quote is multi-source with a median + outlier rule, so EVERY price
  // source must be pinned — stubbing only CoinGecko let the live Coinbase and
  // Kraken quotes outvote the fixture and moved the displayed USD figure.
  const CORS = { 'access-control-allow-origin': '*' }
  const PINNED_USD = 200
  await page.route('https://api.coingecko.com/**', (r) =>
    r.fulfill({ json: { solana: { usd: PINNED_USD } }, headers: CORS }))
  await page.route('https://lite-api.jup.ag/**', (r) =>
    r.fulfill({ json: { So11111111111111111111111111111111111111112: { usdPrice: PINNED_USD } }, headers: CORS }))
  await page.route('https://api.coinbase.com/**', (r) =>
    r.fulfill({ json: { data: { amount: String(PINNED_USD), base: 'SOL', currency: 'USD' } }, headers: CORS }))
  await page.route('https://api.kraken.com/**', (r) =>
    r.fulfill({ json: { error: [], result: { SOLUSD: { c: [String(PINNED_USD), '1'] } } }, headers: CORS }))
  // simulated Solana JSON-RPC
  // The app resolves a working RPC at runtime (publicnode first, mainnet-beta
  // fallback) — stub BOTH so the simulated chain always answers.
  const rpcHandler = async (r) => {
    const body = r.request().postDataJSON()
    const reply = (result, id) => ({ jsonrpc: '2.0', id, result })
    const one = (m) => {
      if (m.method === 'getLatestBlockhash') return reply({ context: { slot: 1 }, value: { blockhash: BUYER, lastValidBlockHeight: 100 } }, m.id)
      if (m.method === 'getSignatureStatuses') return reply({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 5, err: null, confirmationStatus: 'confirmed' }] }, m.id)
      return reply(null, m.id)
    }
    await r.fulfill({ json: Array.isArray(body) ? body.map(one) : one(body), headers: { 'access-control-allow-origin': '*' } })
  }
  await page.route('https://api.mainnet-beta.solana.com/**', rpcHandler)
  await page.route('https://solana-rpc.publicnode.com/**', rpcHandler)

  // ── Phantom mock ──
  await page.addInitScript(`(() => {
    const pkBytes = new Uint8Array([89,54,255,81,10,71,29,162,33,52,197,168,198,75,228,226,231,27,60,223,70,21,123,161,129,97,105,16,203,164,12,95])
    const pk = { toString: () => '${BUYER}', toBytes: () => pkBytes, toBuffer: () => pkBytes, toBase58: () => '${BUYER}' }
    window.solana = {
      isPhantom: true,
      publicKey: pk,
      connect: async () => ({ publicKey: pk }),
      disconnect: async () => {},
      signMessage: async () => ({ signature: new Uint8Array(64).fill(9) }),
      signAndSendTransaction: async (tx) => {
        window.__lastTx = tx
        return { signature: '5' + 'SimulatedSig'.repeat(6) }
      },
    }
  })()`)

  // ── 1. purchasable release shows Collect CTA with price ──
  await page.goto(BASE + '/#/release/FONT-BUYME1', { waitUntil: 'networkidle' })
  const collectBtn = page.getByRole('button', { name: /Collect ◎0\.01/ })
  check('Collect CTA with SOL price shown', await collectBtn.isVisible().catch(() => false))

  // ── 2. click → confirm state with exact SOL + USD ──
  await collectBtn.click()
  const payBtn = page.getByRole('button', { name: /Pay ◎0\.0100/ })
  await payBtn.waitFor({ timeout: 15000 }).catch(() => {})
  check('Purchase confirm shows Pay ◎0.0100 (≈$2.00)', (await page.textContent('body'))?.includes('≈$2.00'))
  check('98/2 split disclosure shown', (await page.textContent('body'))?.includes('98% goes to Wallet Artist'))

  // ── 3. pay → simulated chain confirm → receipt ──
  await payBtn.click()
  await page.waitForTimeout(4000)
  const bodyTxt = await page.textContent('body')
  check('Purchase completes with on-chain receipt link', bodyTxt.includes('In your collection'))
  check('Server re-verification called with correct split payload',
    !!verifyPayload && verifyPayload.artistWallet === ARTIST && verifyPayload.amountLamports === 10000000 && verifyPayload.trackId === 'FONT-BUYME1',
    JSON.stringify(verifyPayload))
  const tx = await page.evaluate(() => {
    const t = window.__lastTx
    if (!t || !t.instructions) return null
    return t.instructions.map((i) => ({ keys: i.keys.map((k) => k.pubkey.toString()), lamports: i.data ? null : null }))
  })
  check('Transaction has 2 transfer instructions (artist + treasury)', !!tx && tx.length === 2, JSON.stringify(tx))

  // ── 4. receipt persisted → Profile collection ──
  await page.goto(BASE + '/#/profile', { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Your collection').waitFor({ timeout: 10000 }).catch(() => {})
  const profTxt = await page.textContent('body')
  check('Profile shows Your collection with receipt row', profTxt.includes('Your collection') && profTxt.includes('Purchasable Track') && profTxt.includes('◎0.0100'))

  // ── 5. legacy release without artistWallet → honestly unavailable ──
  await page.goto(BASE + '/#/release/FONT-LEGACY1', { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  const unavailable = page.getByRole('button', { name: /Collect — unavailable/ })
  await unavailable.waitFor({ timeout: 10000 }).catch(() => {})
  check('Legacy release (no payout wallet) shows unavailable state',
    await unavailable.isVisible().catch(() => false) && await unavailable.isDisabled().catch(() => false))

  // ── 6. publish: login + form + REAL Irys quote (mainnet price, no charge) ──
  await page.goto(BASE + '/#/publish', { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  const connectBtn = page.getByRole('button', { name: /Connect Phantom/ })
  if (await connectBtn.isVisible().catch(() => false)) {
    await connectBtn.click()
    await page.waitForTimeout(1500)
  }
  await page.getByPlaceholder('Album or track title').waitFor({ timeout: 10000 })
  await page.getByPlaceholder('Album or track title').fill('Quote Test Track')
  check('Artist prefilled from wallet handle', (await page.getByPlaceholder('Name shown on the registry').inputValue()) !== '')
  // stay in URL audio mode (no file) — manifest-only storage quote
  await page.getByRole('button', { name: /Publish to the registry/ }).click()
  const confirmHead = page.getByText('One-time storage cost')
  let quoteOk = false
  try { await confirmHead.waitFor({ timeout: 45000 }); quoteOk = true } catch {}
  const quoteTxt = quoteOk ? await page.textContent('body') : ''
  check('Real Irys storage quote reached confirm screen (lazy chunk + mainnet price)', quoteOk, (quoteTxt.match(/◎[\d.<]+|\$[\d.<]+/g) || []).slice(0, 4).join(' '))
  check('Pay & publish + Back controls present', quoteOk && quoteTxt.includes('Pay & publish') && quoteTxt.includes('Back'))

  // demo-mode banner must be gone
  check('No demo-mode messaging anywhere on publish page', !(await page.textContent('body')).toLowerCase().includes('demo mode'))

  const realErrors = pageErrors.filter((e) => !/ResizeObserver/.test(e))
  check('Zero page errors across all flows', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
