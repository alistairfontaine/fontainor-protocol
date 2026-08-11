// Live SOL/USD quote for storage-cost and purchase-price display.
// CoinGecko first, Jupiter lite API as fallback; cached for 60s.

const CACHE_MS = 60_000
let cached: { usd: number; at: number } | null = null

const WSOL_MINT = 'So11111111111111111111111111111111111111112'

const FETCH_TIMEOUT_MS = 8_000 // a hung price API must not stall the purchase/publish UI

async function fromCoinGecko(): Promise<number | null> {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) return null
  const j = (await res.json()) as { solana?: { usd?: number } }
  const usd = j.solana?.usd
  return typeof usd === 'number' && usd > 0 ? usd : null
}

async function fromJupiter(): Promise<number | null> {
  const res = await fetch(`https://lite-api.jup.ag/price/v2?ids=${WSOL_MINT}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) return null
  const j = (await res.json()) as { data?: Record<string, { price?: string | number }> }
  const p = Number(j.data?.[WSOL_MINT]?.price)
  return isFinite(p) && p > 0 ? p : null
}

/** USD per 1 SOL, or null when both price sources are unreachable. */
export async function getSolUsd(): Promise<number | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.usd
  for (const source of [fromCoinGecko, fromJupiter]) {
    try {
      const usd = await source()
      if (usd) {
        cached = { usd, at: Date.now() }
        return usd
      }
    } catch {
      /* try next source */
    }
  }
  return null
}

/** Convert a price in USD-pegged units to lamports at the live quote. */
export async function usdToLamports(usdAmount: number): Promise<number | null> {
  const usd = await getSolUsd()
  if (!usd) return null
  return Math.round((usdAmount / usd) * 1e9)
}
