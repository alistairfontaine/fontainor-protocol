import { parseRegistryText } from './registry.js'

// Backend base URL. Override at runtime with ?api=http://host:port
export const API_BASE =
  new URLSearchParams(location.search).get('api') || 'http://localhost:3000'

// ---- read the registry ----
// Try the backend first (resolves REGISTRY_MANIFEST -> Arweave), then the
// local file, then signal "sample". Returns { data, source, repaired }.
export async function loadRegistry(fallback) {
  // 1) backend API (resolves the manifest pointer to the live Arweave ledger)
  try {
    const res = await fetch(API_BASE + '/registry', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) return { data: out.data, source: 'api', repaired: out.repaired }
    }
  } catch (e) {}
  // 2) local registry.json (legacy fallback only)
  try {
    const res = await fetch('./registry.json', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) return { data: out.data, source: 'file', repaired: out.repaired }
    }
  } catch (e) {}
  // 3) embedded sample
  return { data: fallback, source: 'sample', repaired: false }
}

// pull the new manifest TxID out of whatever the server returns
function extractTxId(obj) {
  if (!obj || typeof obj !== 'object') return null
  const keys = ['txId', 'txid', 'id', 'transactionId', 'manifestId', 'manifest', 'tx', 'newManifest', 'registryManifest']
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k].length > 6) return obj[k]
    if (obj[k] && typeof obj[k] === 'object') {
      const nested = extractTxId(obj[k])
      if (nested) return nested
    }
  }
  return null
}

// normalize an array of raw assets into the shape the server expects to store.
// The manifest stores the FULL registry array; we send the whole thing back.
function toRawArray(currentRaw) {
  if (Array.isArray(currentRaw)) return currentRaw.slice()
  if (currentRaw && Array.isArray(currentRaw.releases)) return currentRaw.releases.slice()
  if (currentRaw && Array.isArray(currentRaw.assets)) return currentRaw.assets.slice()
  if (currentRaw && typeof currentRaw === 'object') return [currentRaw]
  return []
}

// ---- Fetch-Append-Push publish (the leader's manifest protocol) ----
// 1. fetch the current registry array from the backend
// 2. append the new asset
// 3. POST the entire updated array to /upload
// Returns { ok, msg, txId, fullArray }
export async function publishManifest(newAsset) {
  // 1) FETCH current registry (raw, un-normalized) so we append to real history
  let currentRaw = []
  try {
    const res = await fetch(API_BASE + '/registry', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) currentRaw = out.data
    }
  } catch (e) { /* if we can't fetch, start a fresh array */ }

  // 2) APPEND
  const fullArray = toRawArray(currentRaw)
  fullArray.push(newAsset)

  const payload = JSON.stringify(fullArray)

  // If the host page exposes triggerUpload(content), prefer it (leader's hook)
  if (typeof window.triggerUpload === 'function') {
    try {
      const r = await window.triggerUpload(payload)
      const txId = extractTxId(r) || null
      return { ok: true, msg: 'Sent via triggerUpload().', txId, fullArray }
    } catch (e) {
      return { ok: false, msg: 'triggerUpload() failed: ' + (e?.message || e), txId: null, fullArray }
    }
  }

  // 3) PUSH the full array to /upload
  try {
    const res = await fetch(API_BASE + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    if (!res.ok) {
      // try to read the validation error body (Zod returns { error, details })
      let details = null, errMsg = 'Upload endpoint returned ' + res.status + '.'
      try {
        const body = await res.json()
        if (body) {
          if (body.error) errMsg = body.error + (res.status === 400 ? ' (400)' : '')
          if (body.details) details = body.details
        }
      } catch (e) {}
      return { ok: false, msg: errMsg, txId: null, fullArray, status: res.status, details }
    }
    let body = {}
    try { body = await res.json() } catch (e) { /* server might return text */ }
    const txId = extractTxId(body)
    return { ok: true, msg: 'Committed to the manifest ledger.', txId, fullArray }
  } catch (e) {
    return { ok: false, msg: 'Could not reach ' + API_BASE + '/upload (' + (e?.message || e) + ').', txId: null, fullArray }
  }
}

export const FALLBACK = {
  assetId: 'FONT-4WHPZ2Q17',
  name: 'Fontainor Genesis',
  artist: 'Alistair Fontaine',
  timestamp: '2026-05-29T08:46:04.538Z',
  equity: { total_copies: 200, price_per_copy: 29.99, secondary_royalty_basis_points: 1000 },
  status: 'REGISTERED_ON_FONTAINOR',
  social_layer: { support_ledger: [], total_tips_received: 0 },
  profile_metadata: { bio: '', banner_url: '', social_links: [] },
}
