// Registry data contract + normalizers.
// The backend registrySchema (api/validator.js, Zod) is LOCKED:
//   { id, title, artist, price:{amount,currency}, editions:{total}, status,
//     date, audioUri?, coverUri? } + type: 'release' | 'editorial'
// Do not change the wire shape without a backend spec change.

export type AssetType = 'release' | 'editorial'

export interface Price {
  amount: number
  currency: string
}

export interface Editions {
  total: number
  minted?: number | null
}

export interface Release {
  type: AssetType
  id: string
  title: string
  artist: string
  label: string | null
  tags: string[]
  coverUrl: string | null
  audio: string | null
  arweaveTx: string | null
  desc: string
  status: string | null
  date: string | null
  price: Price
  editions: Editions
  royaltyBps: number
  /** Payout wallet (base58) — present on releases published with wallet auth. */
  artistWallet: string | null
}

type Raw = Record<string, unknown>

function pick(o: Raw, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = o?.[k]
    if (v != null && v !== '') return v
  }
  return undefined
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : v != null ? String(v) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)

export function normalizeOne(a: Raw): Release {
  const eq = (a.equity ?? {}) as Raw
  const priceObj = (a.price && typeof a.price === 'object' ? a.price : {}) as Raw
  const edObj = (a.editions && typeof a.editions === 'object' ? a.editions : {}) as Raw
  const audio = str(pick(a, 'audioUri', 'audio', 'audioUrl', 'animation_url'))
  const type: AssetType = a.type === 'editorial' || (!a.type && !audio) ? 'editorial' : 'release'

  return {
    type,
    id: str(pick(a, 'assetId', 'id', 'catalogNumber')) ?? '—',
    title: str(pick(a, 'name', 'title')) ?? 'Untitled',
    artist: str(pick(a, 'artist', 'creator')) ?? 'Unknown artist',
    label: str(pick(a, 'label', 'hub', 'publisher')),
    tags: Array.isArray(a.tags) ? (a.tags as unknown[]).map(String) : [],
    coverUrl: str(pick(a, 'coverUri', 'cover', 'coverUrl', 'image', 'image_url', 'artwork')),
    audio,
    arweaveTx: str(pick(a, 'arweaveTx', 'txId', 'tx', 'arweave')),
    desc: str(pick(a, 'description', 'desc')) ?? '',
    status: str(pick(a, 'status')),
    artistWallet: str(pick(a, 'artistWallet', 'artist_wallet', 'payoutWallet')),
    date: str(pick(a, 'date', 'timestamp', 'createdAt')),
    price: {
      amount:
        num(priceObj.amount) ??
        num(pick(eq, 'price_per_copy')) ??
        (typeof a.price === 'number' ? a.price : 0),
      currency: str(priceObj.currency) ?? str(pick(a, 'currency', 'priceCurrency')) ?? 'USD',
    },
    editions: {
      total: num(edObj.total) ?? num(pick(eq, 'total_copies')) ?? num(a.total_copies) ?? 0,
      minted: num(edObj.minted) ?? num(pick(eq, 'copies_sold', 'sold', 'minted')) ?? num(a.minted),
    },
    royaltyBps: num(pick(eq, 'secondary_royalty_basis_points')) ?? num(a.royaltyBps) ?? 0,
  }
}

export function normalize(raw: unknown): Release[] {
  let list: unknown[]
  if (Array.isArray(raw)) list = raw
  else if (raw && Array.isArray((raw as Raw).releases)) list = (raw as Raw).releases as unknown[]
  else if (raw && Array.isArray((raw as Raw).assets)) list = (raw as Raw).assets as unknown[]
  else if (raw && typeof raw === 'object') list = [raw]
  else list = []
  return list.map((x) => normalizeOne(x as Raw))
}

/** Tolerant parse: repairs the `}{` concatenation typo by wrapping into an array. */
export function parseRegistryText(text: string): { data: unknown; repaired: boolean } {
  try {
    return { data: JSON.parse(text), repaired: false }
  } catch {
    /* fall through */
  }
  try {
    const joined = text.trim().replace(/\}\s*\{/g, '},{')
    return { data: JSON.parse('[' + joined + ']'), repaired: true }
  } catch {
    /* fall through */
  }
  return { data: null, repaired: false }
}

/** Build a new asset EXACTLY matching the backend registrySchema (validator.js). */
export function buildAsset(input: {
  type?: AssetType
  title: string
  artist: string
  price?: number | string
  currency?: string
  total?: number | string
  audioUri?: string
  coverUri?: string
  desc?: string
  artistWallet?: string
}) {
  return {
    type: input.type ?? 'release',
    id: 'FONT-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    title: input.title,
    artist: input.artist,
    price: { amount: Number(input.price) || 0, currency: input.currency || 'USD' },
    editions: { total: Number(input.total) || 0 },
    status: 'REGISTERED_ON_FONTAINOR',
    date: new Date().toISOString(),
    desc: input.desc ?? '',
    audioUri: input.audioUri?.trim() ? input.audioUri : null,
    coverUri: input.coverUri?.trim() ? input.coverUri : null,
    artistWallet: input.artistWallet?.trim() ? input.artistWallet : null,
  }
}

// ── formatters ──────────────────────────────────────────────

export const priceLabel = (p: Price | null | undefined): string => {
  if (!p || !p.amount) return 'Free'
  const sym =
    p.currency === 'USD' || p.currency === 'USDC' ? '$' : p.currency === 'USDT' ? '₮' : p.currency === 'SOL' ? '◎' : ''
  const suffix = sym === '' ? ' ' + p.currency : ''
  return sym + Number(p.amount).toFixed(2) + suffix
}

export const edLabel = (e: Editions | null | undefined): string => {
  if (!e || !e.total) return 'Unlimited'
  if (e.minted != null) return `${e.minted} of ${e.total}`
  return `Edition of ${e.total}`
}

export const fmtTime = (s: number): string => {
  if (!isFinite(s)) s = 0
  const m = Math.floor(s / 60)
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0')
}

export const fmtDate = (d: string | null): string | null => {
  if (!d) return null
  const t = new Date(d)
  return isNaN(t.getTime()) ? d : t.toISOString().slice(0, 10)
}

export const prettyStatus = (s: string | null): string | null =>
  s ? s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null

export const isSold = (e: Editions): boolean => e.total > 0 && e.minted != null && e.minted >= e.total

// ── deterministic generative cover (rosette, recolored to tokens) ──

function seedFrom(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

function rosette(cx: number, cy: number, R: number, r: number, d: number): string {
  const g = gcd(R, r)
  const period = 2 * Math.PI * (r / g)
  const p: string[] = []
  for (let t = 0; t <= period; t += 0.05) {
    p.push(
      (cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)).toFixed(1) +
        ',' +
        (cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)).toFixed(1),
    )
  }
  return p.join(' ')
}

export function coverSVG(seed: string): string {
  const s = seedFrom(seed || 'x')
  const rnd = mulberry(s)
  const C = 150
  const R = 78 + Math.floor(rnd() * 40)
  const r = 16 + Math.floor(rnd() * 26)
  const d = 22 + Math.floor(rnd() * 34)
  const rot = Math.floor(rnd() * 60)
  const hueShift = rnd()
  const stroke = hueShift > 0.66 ? '#f7b733' : hueShift > 0.33 ? '#8b93a5' : '#5f6b85'
  return `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"><rect width="300" height="300" fill="#151924"/><g transform="rotate(${rot} ${C} ${C})" opacity="0.55"><polyline points="${rosette(C, C, R, r, d)}" fill="none" stroke="${stroke}" stroke-width="0.7"/></g></svg>`
}
