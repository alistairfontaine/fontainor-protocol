// Headless verification for F29 (wallet-portable profile).
// Part A: real api/index.js app against a local Upstash REST stub, real ed25519 sigs.
// Part B: two browser contexts (= two machines) — likes + collection follow the wallet.
// Run: npm run build && npx vite preview --port 4174 & node tools/portable-profile-test.mjs
import http from 'node:http'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { chromium } from 'playwright'

// Portable: use Playwright's own resolved browser unless FONTAINOR_CHROMIUM overrides.
const EXE = process.env.FONTAINOR_CHROMIUM || undefined
const BASE = 'http://localhost:4174'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`)
}

// ───────────────────────── Part A: backend ─────────────────────────

const kv = new Map() // key -> string | string[]
function upstashStub() {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (payload) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(payload))
      }
      const reply = (result) => send({ result })
      let cmd
      try {
        cmd = JSON.parse(body)
      } catch {
        return reply(null)
      }
      const run = ([op, key, ...args]) => {
        switch (String(op).toUpperCase()) {
          case 'SET': kv.set(key, args[0]); return 'OK'
          case 'GET': return kv.get(key) ?? null
          case 'LPUSH': { const l = kv.get(key) ?? []; l.unshift(...args); kv.set(key, l); return l.length }
          case 'LRANGE': { const l = kv.get(key) ?? []; const s = Number(args[0]); const e = Number(args[1]); return l.slice(s, e === -1 ? undefined : e + 1) }
          default: return null
        }
      }
      // pipeline requests reply with an array of {result} objects
      if (req.url.includes('pipeline') || Array.isArray(cmd[0])) return send(cmd.map((c) => ({ result: run(c) })))
      reply(run(cmd))
    })
  })
}

async function backend() {
  const stub = upstashStub()
  await new Promise((r) => stub.listen(0, r))
  process.env.UPSTASH_REDIS_REST_URL = `http://localhost:${stub.address().port}`
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'

  const { default: app } = await import('../api/index.js')
  const srv = app.listen(0)
  await new Promise((r) => srv.once('listening', r))
  const api = `http://localhost:${srv.address().port}`

  const kp = nacl.sign.keyPair()
  const wallet = bs58.encode(kp.publicKey)
  const other = bs58.encode(nacl.sign.keyPair().publicKey)
  const msg = `Authenticate Fontainor Sovereign Session :: ${Date.now()}`
  const sig = nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey)
  const proof = {
    publicKey: JSON.stringify(Array.from(kp.publicKey)),
    signature: JSON.stringify(Array.from(sig)),
    message: msg,
  }

  // purchases: seed the same durable list verify-payment writes, two buyers
  kv.set('fontainor:purchases:v1', [
    JSON.stringify({ trackId: 'FONT-A1', signature: 'sigA', artistWallet: other, buyerWallet: wallet, amountLamports: 10000000, currency: 'SOL', verifiedAt: '2026-07-27T10:00:00.000Z' }),
    JSON.stringify({ trackId: 'FONT-B1', signature: 'sigB', artistWallet: other, buyerWallet: other, amountLamports: 20000000, currency: 'SOL', verifiedAt: '2026-07-27T11:00:00.000Z' }),
  ])

  let r = await fetch(`${api}/api/v1/purchases?wallet=${wallet}`).then((x) => x.json())
  check('A1 purchases filtered by buyer wallet', r.success === true && r.durable === true && r.purchases.length === 1 && r.purchases[0].trackId === 'FONT-A1')

  r = await fetch(`${api}/api/v1/purchases?wallet=not-a-wallet!`)
  check('A2 invalid wallet rejected (400)', r.status === 400)

  r = await fetch(`${api}/api/v1/favorites`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...proof, ids: ['FONT-A1', 'FONT-Z9'] }),
  }).then((x) => x.json())
  check('A3 signed favorites write accepted', r.success === true && r.durable === true && r.wallet === wallet)

  r = await fetch(`${api}/api/v1/favorites?wallet=${wallet}`).then((x) => x.json())
  check('A4 favorites read back for wallet', r.success === true && JSON.stringify(r.ids) === JSON.stringify(['FONT-A1', 'FONT-Z9']))

  r = await fetch(`${api}/api/v1/favorites?wallet=${other}`).then((x) => x.json())
  check('A5 other wallet unaffected', r.success === true && r.ids.length === 0)

  const badSig = Array.from(sig); badSig[0] = (badSig[0] + 1) % 256
  r = await fetch(`${api}/api/v1/favorites`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...proof, signature: JSON.stringify(badSig), ids: ['FONT-EVIL'] }),
  })
  check('A6 tampered signature rejected (401)', r.status === 401)

  r = await fetch(`${api}/api/v1/favorites?wallet=${wallet}`).then((x) => x.json())
  check('A7 rejected write did not overwrite', JSON.stringify(r.ids) === JSON.stringify(['FONT-A1', 'FONT-Z9']))

  srv.close(); stub.close()
}

// ───────────────────────── Part B: frontend ─────────────────────────

const BUYER = '71FvemD53qhyPSbT4abM19PUcFkhkPGCAW85SRZt9eKg'
const ARTIST = 'So11111111111111111111111111111111111111112'
const REGISTRY = [
  { type: 'release', id: 'FONT-BUYME1', title: 'Purchasable Track', artist: 'Wallet Artist',
    price: { amount: 0.01, currency: 'SOL' }, editions: { total: 10 }, status: 'REGISTERED_ON_FONTAINOR',
    date: '2026-07-01T00:00:00.000Z', audioUri: 'https://example.com/a.mp3', coverUri: null, artistWallet: ARTIST },
]

// in-memory "server" shared by both machines
const server = { favorites: {}, purchases: [] }

async function wireMachine(ctx) {
  await ctx.route('**/registry', (r) => r.fulfill({ json: REGISTRY }))
  await ctx.route('**/registry.json', (r) => r.fulfill({ json: REGISTRY }))
  await ctx.route('**/api/v1/auth/sovereign-login', (r) =>
    r.fulfill({ json: { success: true, wallet: BUYER, handle: '@71Fv...9eKg' } }))
  await ctx.route('**/api/v1/purchases?*', (r) => {
    const wallet = new URL(r.request().url()).searchParams.get('wallet')
    r.fulfill({ json: { success: true, durable: true, purchases: server.purchases.filter((p) => p.buyerWallet === wallet) } })
  })
  await ctx.route('**/api/v1/favorites*', (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON()
      server.favorites[BUYER] = body.ids
      return r.fulfill({ json: { success: true, durable: true, wallet: BUYER } })
    }
    const wallet = new URL(r.request().url()).searchParams.get('wallet')
    return r.fulfill({ json: { success: true, durable: true, ids: server.favorites[wallet] ?? [] } })
  })
  await ctx.addInitScript(`(() => {
    const pkBytes = new Uint8Array([89,54,255,81,10,71,29,162,33,52,197,168,198,75,228,226,231,27,60,223,70,21,123,161,129,97,105,16,203,164,12,95])
    const pk = { toString: () => '${BUYER}', toBytes: () => pkBytes, toBuffer: () => pkBytes, toBase58: () => '${BUYER}' }
    window.solana = {
      isPhantom: true,
      publicKey: pk,
      connect: async () => ({ publicKey: pk }),
      disconnect: async () => {},
      signMessage: async () => ({ signature: new Uint8Array(64).fill(7) }),
    }
  })()`)
}

async function connectOnProfile(page) {
  await page.goto(`${BASE}/#/profile`)
  await page.reload()
  await page.getByRole('button', { name: /Connect Phantom/i }).click()
  await page.getByText('Connected').waitFor({ timeout: 10000 })
}

async function frontend() {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})

  // ── Machine A: connect, like a track ──
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await wireMachine(ctxA)
  const pageA = await ctxA.newPage()
  await connectOnProfile(pageA)
  await pageA.goto(`${BASE}/#/`)
  await pageA.reload()
  await pageA.getByRole('button', { name: 'Add to favorites' }).first().click()
  await pageA.waitForTimeout(2600) // debounce is 1.5s
  check('B1 like on machine A pushed to server', JSON.stringify(server.favorites[BUYER]) === JSON.stringify(['FONT-BUYME1']),
    JSON.stringify(server.favorites))
  await ctxA.close()

  // purchase happens (durable record exists server-side, as verify-payment writes it)
  server.purchases.push({ trackId: 'FONT-BUYME1', signature: 'realSig111', artistWallet: ARTIST, buyerWallet: BUYER, amountLamports: 10000000, currency: 'SOL', verifiedAt: '2026-07-27T12:00:00.000Z' })

  // ── Machine B: brand-new context (empty localStorage), same wallet ──
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await wireMachine(ctxB)
  const pageB = await ctxB.newPage()
  const empty = await pageB.evaluate(() => localStorage.length).catch(() => 0)
  await connectOnProfile(pageB)

  await pageB.getByText('Your collection').waitFor({ timeout: 10000 })
  const hasTrack = await pageB.getByText('Purchasable Track').count()
  check('B2 collection rebuilt on machine B from wallet', hasTrack > 0, `localStorage was empty at start: ${empty === 0}`)

  await pageB.goto(`${BASE}/#/favorites`)
  await pageB.reload()
  await pageB.getByText('Purchasable Track').first().waitFor({ timeout: 10000 })
  check('B3 likes followed the wallet to machine B', true)

  const persisted = await pageB.evaluate(() => ({
    purchases: JSON.parse(localStorage.getItem('fontainor_purchases_v1') ?? '[]').length,
    favs: (JSON.parse(localStorage.getItem('fontainor_favorites_v2') ?? '{"ids":[]}').ids ?? []),
  }))
  check('B4 machine B local stores hydrated', persisted.purchases === 1 && persisted.favs.includes('FONT-BUYME1'))

  await ctxB.close()
  await browser.close()
}

await backend()
await frontend()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
