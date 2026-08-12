// sol-price-test.mjs — the SOL/USD quote that converts USD listings to lamports.
//
// Why this exists: the module used CoinGecko with a Jupiter `price/v2`
// fallback, and v2 was retired (verified live 2026-08-12: "Route not found"),
// leaving one source with no cross-check. A single bad number here overcharges
// a collector or underpays an artist.
//
// The module is bundled with esbuild and run in Node with a stubbed fetch, so
// every scenario is deterministic and no live API is called.
//
// Run: node tools/sol-price-test.mjs   (exit 0 = pass)
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

const dir = mkdtempSync(join(tmpdir(), 'solprice-'))
const outfile = join(dir, 'solPrice.mjs')
await build({
  entryPoints: ['src/lib/solPrice.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'silent',
})

/** Fresh module instance (its own cache) per scenario. */
let loads = 0
async function freshModule() {
  const copy = join(dir, `solPrice.${loads++}.mjs`)
  writeFileSync(copy, (await import('fs')).readFileSync(outfile))
  return import(copy)
}

const COINGECKO = /coingecko/
const JUPITER = /jup\.ag/
const COINBASE = /coinbase/
const KRAKEN = /kraken/

/** Install a fetch stub. `plan` maps a source to a number, 'fail', or 'hang'. */
function stubFetch(plan) {
  const calls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    calls.push(u)
    const pick = COINGECKO.test(u) ? 'coingecko' : JUPITER.test(u) ? 'jupiter' : COINBASE.test(u) ? 'coinbase' : KRAKEN.test(u) ? 'kraken' : 'other'
    const value = plan[pick]
    if (value === undefined || value === 'fail') throw new Error('network down')
    if (value === 'http500') return { ok: false, status: 500, json: async () => ({}) }
    const bodies = {
      coingecko: { solana: { usd: value } },
      jupiter: { So11111111111111111111111111111111111111112: { usdPrice: value } },
      coinbase: { data: { amount: String(value), base: 'SOL', currency: 'USD' } },
      kraken: { error: [], result: { SOLUSD: { c: [String(value), '0.1'] } } },
    }
    return { ok: true, status: 200, json: async () => bodies[pick] ?? {} }
  }
  return calls
}

// ── 1. Healthy: all four sources agree ─────────────────────────────────────
{
  const m = await freshModule()
  const calls = stubFetch({ coingecko: 75.58, jupiter: 75.42, coinbase: 75.43, kraken: 75.47 })
  const q = await m.getSolQuote()
  check('A1 a quote is produced when sources agree', q !== null)
  check('A2 quote is the median of the sources', Math.abs(q.usd - (75.43 + 75.47) / 2) < 1e-9, String(q?.usd))
  check('A3 all four sources are credited', q.sources.length === 4, JSON.stringify(q?.sources))
  check('A4 quote is not marked stale', q.stale === false)
  check('A5 every source was queried in one pass', calls.length === 4, String(calls.length))
  check('A6 jupiter is queried on v3, not the retired v2', calls.some((c) => /price\/v3/.test(c)) && !calls.some((c) => /price\/v2/.test(c)), calls.join(' '))
  const again = await m.getSolQuote()
  check('A7 a fresh quote is cached (no second round of calls)', calls.length === 4 && again.usd === q.usd)
  check('A8 usdToLamports converts at the quote', (await m.usdToLamports(10)) === Math.round((10 / q.usd) * 1e9))
}

// ── 2. One rogue source must not move the price ─────────────────────────────
{
  const m = await freshModule()
  stubFetch({ coingecko: 7558, jupiter: 75.42, coinbase: 75.43, kraken: 75.47 })
  const q = await m.getSolQuote()
  check('B1 a 100x outlier is discarded', q !== null && Math.abs(q.usd - 75.43) < 0.1, JSON.stringify(q))
  check('B2 the outlier is not credited as a source', !q.sources.includes('coingecko'), JSON.stringify(q?.sources))
  const m2 = await freshModule()
  stubFetch({ coingecko: 0.02, jupiter: 75.42, coinbase: 75.43, kraken: 75.47 })
  const q2 = await m2.getSolQuote()
  check('B3 a near-zero outlier is discarded (would have overcharged 3000x)', q2 !== null && Math.abs(q2.usd - 75.43) < 0.1, JSON.stringify(q2))
}

// ── 3. Absolute plausibility band ──────────────────────────────────────────
{
  const m = await freshModule()
  stubFetch({ coingecko: 0.0004, jupiter: 'fail', coinbase: 'fail', kraken: 'fail' })
  check('C1 an implausibly small lone quote is refused', (await m.getSolQuote()) === null)
  const m2 = await freshModule()
  stubFetch({ coingecko: 4_000_000, jupiter: 'fail', coinbase: 'fail', kraken: 'fail' })
  check('C2 an implausibly large lone quote is refused', (await m2.getSolQuote()) === null)
  const m3 = await freshModule()
  stubFetch({ coingecko: 'fail', jupiter: 'fail', coinbase: 'fail', kraken: 'fail' })
  check('C3 no sources and no cache -> no quote (never a guess)', (await m3.getSolQuote()) === null)
  check('C4 usdToLamports refuses without a price', (await m3.usdToLamports(10)) === null)
}

// ── 4. Single surviving source ──────────────────────────────────────────────
{
  const m = await freshModule()
  stubFetch({ coingecko: 'fail', jupiter: 'fail', coinbase: 75.5, kraken: 'http500' })
  const q = await m.getSolQuote()
  check('D1 a lone plausible source still quotes (purchases keep working)', q !== null && q.usd === 75.5, JSON.stringify(q))
  check('D2 the surviving source is named', q.sources.join() === 'coinbase', JSON.stringify(q?.sources))
  check('D3 an HTTP-error source is not credited', !q.sources.includes('kraken'), JSON.stringify(q?.sources))
}

// ── 5. Lone source that jumped far from the last good quote ────────────────
{
  const m = await freshModule()
  stubFetch({ coingecko: 75.5, jupiter: 75.4, coinbase: 75.45, kraken: 75.48 })
  const good = await m.getSolQuote()
  const realNow = Date.now
  try {
    // Two minutes on: the quote needs refreshing, and now a single source
    // answers with a 5x number (bad API deploy / wrong field).
    Date.now = () => realNow() + 2 * 60_000
    stubFetch({ coingecko: 380, jupiter: 'fail', coinbase: 'fail', kraken: 'fail' })
    const q = await m.getSolQuote()
    check('E1 a wild lone source cannot replace the last agreed quote', q !== null && q.usd === good.usd, JSON.stringify(q))
    check('E2 that fallback is flagged stale rather than presented as live', q.stale === true, JSON.stringify(q))
    // A lone source close to the last quote is accepted as a normal refresh.
    stubFetch({ coingecko: 78.9, jupiter: 'fail', coinbase: 'fail', kraken: 'fail' })
    const q2 = await m.getSolQuote()
    check('E3 a lone source near the last quote refreshes normally', q2.usd === 78.9 && q2.stale === false, JSON.stringify(q2))
  } finally {
    Date.now = realNow
  }
}

// ── 6. Every source down after a good quote -> bounded stale service ───────
{
  const m = await freshModule()
  stubFetch({ coingecko: 75.5, jupiter: 75.4, coinbase: 75.45, kraken: 75.48 })
  const good = await m.getSolQuote()
  const realNow = Date.now
  try {
    // 3 minutes later: cache expired for freshness, still inside the stale window.
    Date.now = () => realNow() + 3 * 60_000
    stubFetch({ coingecko: 'fail', jupiter: 'fail', coinbase: 'fail', kraken: 'fail' })
    const q = await m.getSolQuote()
    check('F1 a recent quote is served when all sources are down', q !== null && q.usd === good.usd, JSON.stringify(q))
    check('F2 the served quote is flagged stale', q.stale === true)
    // 20 minutes later: too old to price money with.
    Date.now = () => realNow() + 20 * 60_000
    check('F3 an old quote is refused once past the stale window', (await m.getSolQuote()) === null)
  } finally {
    Date.now = realNow
  }
}

// ── 7. Shape tolerance ─────────────────────────────────────────────────────
{
  const m = await freshModule()
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (/jup\.ag/.test(u)) {
      // retired v2 shape, still parsed if the endpoint ever answers it
      return { ok: true, status: 200, json: async () => ({ data: { So11111111111111111111111111111111111111112: { price: '75.44' } } }) }
    }
    if (/coinbase/.test(u)) return { ok: true, status: 200, json: async () => ({ data: { amount: '75.46' } }) }
    if (/kraken/.test(u)) return { ok: true, status: 200, json: async () => ({ error: [], result: { XSOLZUSD: { c: ['75.5', '1'] } } }) }
    throw new Error('down')
  }
  const q = await m.getSolQuote()
  check('G1 legacy jupiter shape and string prices parse', q !== null, JSON.stringify(q))
  check('G2 kraken pair key is read positionally, not by a hardcoded name', q.sources.includes('kraken'), JSON.stringify(q?.sources))
  check('G3 three agreeing sources produce the median', Math.abs(q.usd - 75.46) < 1e-9, String(q?.usd))
}

// ── 8. Malformed bodies ────────────────────────────────────────────────────
{
  const m = await freshModule()
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (/coingecko/.test(u)) return { ok: true, status: 200, json: async () => ({ solana: {} }) }
    if (/jup\.ag/.test(u)) return { ok: true, status: 200, json: async () => ({}) }
    if (/coinbase/.test(u)) return { ok: true, status: 200, json: async () => ({ data: { amount: 'not-a-number' } }) }
    if (/kraken/.test(u)) return { ok: true, status: 200, json: async () => ({ error: ['EGeneral:Invalid'], result: {} }) }
    throw new Error('down')
  }
  check('H1 missing/garbage fields never become a price', (await m.getSolQuote()) === null)
}

console.log(`\nsol-price: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
