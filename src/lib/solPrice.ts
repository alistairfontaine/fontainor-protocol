// Live SOL/USD quote for storage-cost and purchase-price display.
//
// This number decides how many lamports a USD-priced listing costs, so a wrong
// quote either overcharges the collector or underpays the artist. Rules:
//   1. Several independent, CORS-open sources are queried in parallel.
//   2. The median of the answers wins, and any source more than
//      MAX_DIVERGENCE off the median is discarded as broken.
//   3. A lone answer is only trusted inside an absolute plausibility band and
//      near the last known good quote.
//   4. If nothing answers, a recent cached quote is served (marked stale)
//      rather than blocking a purchase; beyond STALE_MAX_MS we refuse to quote.
//
// Verified live 2026-08-12: Jupiter's price/v2 endpoint is gone ("Route not
// found"), which had silently left CoinGecko as a single point of failure.

const CACHE_MS = 60_000
/** How long a cached quote may still be served when every source is down. */
const STALE_MAX_MS = 10 * 60_000
const FETCH_TIMEOUT_MS = 8_000 // a hung price API must not stall the purchase/publish UI

/** Absolute sanity band. Outside this, a "price" is a parsing/API accident. */
const MIN_PLAUSIBLE_USD = 1
const MAX_PLAUSIBLE_USD = 100_000
/** A source further than this from the median is discarded. */
const MAX_DIVERGENCE = 0.2
/** A single unconfirmed source may not move the last good quote further than this. */
const MAX_SOLO_DRIFT = 0.35

const WSOL_MINT = 'So11111111111111111111111111111111111111112'

export interface SolQuote {
  usd: number
  /** When the quote was fetched. */
  at: number
  /** Names of the sources that agreed on it. */
  sources: string[]
  /** True when served from cache because no source answered. */
  stale: boolean
}

let cached: SolQuote | null = null

function plausible(n: unknown): number | null {
  const v = Number(n)
  return Number.isFinite(v) && v >= MIN_PLAUSIBLE_USD && v <= MAX_PLAUSIBLE_USD ? v : null
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

interface Source {
  name: string
  read: () => Promise<number | null>
}

const SOURCES: Source[] = [
  {
    name: 'coingecko',
    read: async () => {
      const j = (await getJson('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')) as {
        solana?: { usd?: number }
      }
      return plausible(j?.solana?.usd)
    },
  },
  {
    name: 'jupiter',
    read: async () => {
      // v3 reports `usdPrice`; the retired v2 shape used `price`.
      const j = (await getJson(`https://lite-api.jup.ag/price/v3?ids=${WSOL_MINT}`)) as
        | Record<string, { usdPrice?: number | string; price?: number | string }>
        | { data?: Record<string, { usdPrice?: number | string; price?: number | string }> }
      const row =
        (j as { data?: Record<string, { usdPrice?: number | string; price?: number | string }> })?.data?.[WSOL_MINT] ??
        (j as Record<string, { usdPrice?: number | string; price?: number | string }>)?.[WSOL_MINT]
      return plausible(row?.usdPrice ?? row?.price)
    },
  },
  {
    name: 'coinbase',
    read: async () => {
      const j = (await getJson('https://api.coinbase.com/v2/prices/SOL-USD/spot')) as { data?: { amount?: string } }
      return plausible(j?.data?.amount)
    },
  },
  {
    name: 'kraken',
    read: async () => {
      const j = (await getJson('https://api.kraken.com/0/public/Ticker?pair=SOLUSD')) as {
        result?: Record<string, { c?: string[] }>
      }
      const row = j?.result ? Object.values(j.result)[0] : undefined
      return plausible(row?.c?.[0])
    },
  },
]

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Full quote with provenance. Prefer this when the UI can show freshness. */
export async function getSolQuote(): Promise<SolQuote | null> {
  if (cached && !cached.stale && Date.now() - cached.at < CACHE_MS) return cached

  const settled = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        return { name: s.name, usd: await s.read() }
      } catch {
        return { name: s.name, usd: null }
      }
    }),
  )
  const answers = settled.filter((s): s is { name: string; usd: number } => typeof s.usd === 'number')

  if (answers.length >= 2) {
    const mid = median(answers.map((a) => a.usd))
    const agreeing = answers.filter((a) => Math.abs(a.usd - mid) / mid <= MAX_DIVERGENCE)
    // A single wild source cannot drag the price: it is dropped, and the
    // remaining agreeing sources define the quote.
    const trusted = agreeing.length > 0 ? agreeing : []
    if (trusted.length >= 2) {
      const usd = median(trusted.map((a) => a.usd))
      cached = { usd, at: Date.now(), sources: trusted.map((a) => a.name), stale: false }
      return cached
    }
    // Sources disagree beyond the band with no majority — refuse rather than
    // pick a side, unless a recent good quote can arbitrate.
    if (cached && Date.now() - cached.at < STALE_MAX_MS) {
      const near = answers.filter((a) => Math.abs(a.usd - cached!.usd) / cached!.usd <= MAX_SOLO_DRIFT)
      if (near.length === 1) {
        cached = { usd: near[0].usd, at: Date.now(), sources: [near[0].name], stale: false }
        return cached
      }
      return { ...cached, stale: true }
    }
    return null
  }

  if (answers.length === 1) {
    const only = answers[0]
    const drifted = cached && Date.now() - cached.at < STALE_MAX_MS && Math.abs(only.usd - cached.usd) / cached.usd > MAX_SOLO_DRIFT
    if (drifted) return { ...cached!, stale: true }
    cached = { usd: only.usd, at: Date.now(), sources: [only.name], stale: false }
    return cached
  }

  // Nothing answered: a slightly old quote beats blocking a purchase outright.
  if (cached && Date.now() - cached.at < STALE_MAX_MS) return { ...cached, stale: true }
  return null
}

/** USD per 1 SOL, or null when no source can be trusted. */
export async function getSolUsd(): Promise<number | null> {
  const quote = await getSolQuote()
  return quote ? quote.usd : null
}

/** Convert a price in USD-pegged units to lamports at the live quote. */
export async function usdToLamports(usdAmount: number): Promise<number | null> {
  const usd = await getSolUsd()
  if (!usd || !Number.isFinite(usdAmount) || usdAmount <= 0) return null
  return Math.round((usdAmount / usd) * 1e9)
}

/** Test seam: drop the cached quote. */
export function __resetSolPriceCache(): void {
  cached = null
}
