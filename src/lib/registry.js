// ---- schema mapping (YOUR registry: assetId/name/equity + social_layer/profile_metadata) ----
function pick(o, ...keys) {
  for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]
  return undefined
}

export function normalizeOne(a) {
  const eq = a.equity || {}
  const priceObj = (a.price && typeof a.price === 'object') ? a.price : {}
  const edObj = (a.editions && typeof a.editions === 'object') ? a.editions : {}
  return {
    id: pick(a, 'assetId', 'id', 'catalogNumber') || '\u2014',
    title: pick(a, 'name', 'title') || 'Untitled',
    artist: pick(a, 'artist', 'creator') || 'Unknown artist',
    label: pick(a, 'label', 'hub', 'publisher') || null,
    tags: Array.isArray(a.tags) ? a.tags : [],
    // new schema: coverUri ; legacy: cover/image/etc
    coverUrl: pick(a, 'coverUri', 'cover', 'coverUrl', 'image', 'image_url', 'artwork') || null,
    // new schema: audioUri ; legacy: audio/audioUrl
    audio: pick(a, 'audioUri', 'audio', 'audioUrl', 'animation_url') || null,
    arweaveTx: pick(a, 'arweaveTx', 'txId', 'tx', 'arweave') || null,
    desc: pick(a, 'description', 'desc') || '',
    bonus: a.bonus || a.bonusMaterial || [],
    status: pick(a, 'status') || null,
    date: pick(a, 'date', 'timestamp', 'createdAt') || null,
    price: {
      // new schema: price.amount/price.currency ; legacy: equity.price_per_copy / flat price
      amount: priceObj.amount ?? pick(eq, 'price_per_copy') ?? (typeof a.price === 'number' ? a.price : 0) ?? 0,
      currency: priceObj.currency || pick(a, 'currency', 'priceCurrency') || 'USD',
    },
    editions: {
      // new schema: editions.total ; legacy: equity.total_copies
      total: edObj.total ?? pick(eq, 'total_copies') ?? pick(a, 'total_copies') ?? 0,
      minted: edObj.minted ?? pick(eq, 'copies_sold', 'sold', 'minted') ?? pick(a, 'minted'),
    },
    royaltyBps: pick(eq, 'secondary_royalty_basis_points') ?? pick(a, 'royaltyBps') ?? 0,
    social: {
      ledger: a.social_layer && Array.isArray(a.social_layer.support_ledger) ? a.social_layer.support_ledger : [],
      totalTips: a.social_layer && a.social_layer.total_tips_received != null ? Number(a.social_layer.total_tips_received) : 0,
    },
    profile: {
      bio: (a.profile_metadata && a.profile_metadata.bio) || '',
      banner: (a.profile_metadata && a.profile_metadata.banner_url) || '',
      links: a.profile_metadata && Array.isArray(a.profile_metadata.social_links) ? a.profile_metadata.social_links : [],
    },
  }
}

export function normalize(raw) {
  let list
  if (Array.isArray(raw)) list = raw
  else if (raw && Array.isArray(raw.releases)) list = raw.releases
  else if (raw && Array.isArray(raw.assets)) list = raw.assets
  else if (raw && typeof raw === 'object') list = [raw]
  else list = []
  return list.map(normalizeOne)
}

// tolerant parse: repairs the `}{` typo by wrapping into an array
export function parseRegistryText(text) {
  try { return { data: JSON.parse(text), repaired: false } } catch (e) {}
  try {
    const joined = text.trim().replace(/\}\s*\{/g, '},{')
    return { data: JSON.parse('[' + joined + ']'), repaired: true }
  } catch (e) {}
  return { data: null, repaired: false }
}

// build a new asset in YOUR registry schema, for the Publish flow
// Build a new asset that EXACTLY matches the backend registrySchema (validator.js):
//   { id, title, artist, price:{amount,currency}, editions:{total}, status, date,
//     audioUri?, coverUri? }
// Anything else gets rejected with a 400 by the Zod gatekeeper.
export function buildAsset({ title, artist, price = 0, currency = 'USD', total = 0, audioUri = '', coverUri = '' }) {
  const asset = {
    id: 'FONT-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    title,
    artist,
    price: { amount: Number(price) || 0, currency: currency || 'USD' },
    editions: { total: Number(total) || 0 },
    status: 'REGISTERED_ON_FONTAINOR',
    date: new Date().toISOString(),
    // Fix: If the string is empty or just whitespace, set it to null.
    // Zod's .nullable() allows null, but .url() crashes on ""
    audioUri: (audioUri && audioUri.trim().length > 0) ? audioUri : null,
    coverUri: (coverUri && coverUri.trim().length > 0) ? coverUri : null,
  }
  return asset
}

// ---- formatters ----
export const priceLabel = (p) => {
  if (!p || p.amount === 0 || p.amount == null) return 'Free'
  const sym = p.currency === 'USD' ? '$' : p.currency === 'SOL' ? '\u25CE' : ''
  return sym + Number(p.amount).toFixed(2) + (p.currency && p.currency !== 'USD' ? ' ' + p.currency : '')
}
export const edLabel = (e) => {
  if (!e) return '\u2014'
  if (!e.total || e.total === 0) return 'Unlimited'
  if (e.minted != null) return e.minted + ' of ' + e.total
  return 'Edition of ' + e.total
}
export const royaltyLabel = (b) => (b ? (b / 100).toFixed(b % 100 ? 1 : 0) + '%' : '0%')
export const fmtTime = (s) => {
  if (!isFinite(s)) s = 0
  const m = Math.floor(s / 60), x = Math.floor(s % 60)
  return m + ':' + String(x).padStart(2, '0')
}
export const fmtDate = (d) => {
  if (!d) return null
  const t = new Date(d)
  return isNaN(t) ? String(d) : t.toISOString().slice(0, 10)
}
export const prettyStatus = (s) => (s ? String(s).toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null)
export const isSold = (e) => e && e.total > 0 && e.minted != null && e.minted >= e.total
export const isFree = (r) => !r.price || r.price.amount === 0 || r.price.amount == null

// ---- generated cover (deterministic from id) ----
function seedFrom(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function mulberry(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function gcd(a, b) { while (b) { [a, b] = [b, a % b] } return a }
function rosette(cx, cy, R, r, d) {
  const g = gcd(R, r), period = 2 * Math.PI * (r / g), st = 0.05, p = []
  for (let t = 0; t <= period; t += st) p.push((cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)).toFixed(1) + ',' + (cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)).toFixed(1))
  return p.join(' ')
}
export function coverSVG(seed) {
  const s = seedFrom(String(seed || 'x')), rnd = mulberry(s), C = 150
  const R = 78 + Math.floor(rnd() * 40), r = 16 + Math.floor(rnd() * 26), d = 22 + Math.floor(rnd() * 34), rot = Math.floor(rnd() * 60)
  return `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"><rect width="300" height="300" fill="#f0f0f3"/><g transform="rotate(${rot} ${C} ${C})" opacity="0.45"><polyline points="${rosette(C, C, R, r, d)}" fill="none" stroke="#2d66f0" stroke-width="0.7"/></g></svg>`
}
export function avatarSVG(seed) {
  const s = seedFrom(String(seed || 'a')), rnd = mulberry(s), hue = Math.floor(rnd() * 360)
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="hsl(${hue},45%,82%)"/><circle cx="50" cy="50" r="22" fill="hsl(${hue},45%,55%)"/></svg>`
}
