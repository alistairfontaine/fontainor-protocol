import { parseRegistryText } from './registry.js'

// Backend base URL. Dynamically targets the live domain when deployed
export const API_BASE =
  new URLSearchParams(location.search).get('api') ||
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : window.location.origin);


// Storage spec (PROTOCOL_STORAGE_SPEC.md): 30s timeout threshold for a write.
export const UPLOAD_TIMEOUT_MS = 30000

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

  // ---- dev-only mock mode for the UI smoke test (?mock=ok|writefail|400|timeout) ----
  // Returns the EXACT spec response shapes with a realistic delay, flowing through
  // the same branching below — so the smoke test exercises the production logic.
  // Remove before production (like the perf buttons).
  const mockMode = new URLSearchParams(location.search).get('mock')
  const mockFetch = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    if (mockMode === 'ok') {
      await wait(2500)
      return { ok: true, status: 200, json: async () => ({ success: true, txId: 'MOCKTX_' + Date.now().toString(36) + '_devnet' }) }
    }
    if (mockMode === 'writefail') {
      await wait(2500)
      return { ok: false, status: 500, json: async () => ({ success: false, error: 'Mock: Irys node rejected the write.', code: 'MOCK_WRITE_ERR' }) }
    }
    if (mockMode === '400') {
      await wait(1200)
      return { ok: false, status: 400, json: async () => ({ error: 'Mock: payload failed registrySchema.', details: null }) }
    }
    if (mockMode === 'timeout') {
      await wait(UPLOAD_TIMEOUT_MS + 500) // hold Etching for the full 30s window, then abort
      const e = new Error('mock timeout'); e.name = 'AbortError'; throw e
    }
    return null
  }

  // 3) PUSH the full array to /upload
  //    Storage spec (PROTOCOL_STORAGE_SPEC.md):
  //      success: { success:true,  txId:"string" }
  //      failure: { success:false, error:"string", code:"string" }   (write error)
  //      400:     validation rejection (Zod { error, details })
  //      timeout: 30s
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const res = mockMode
      ? await mockFetch()
      : await fetch(API_BASE + '/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: ctrl.signal,
        })
    clearTimeout(timer)

    let body = {}
    try { body = await res.json() } catch (e) { /* server might return text */ }

    // 400 = validation rejection (distinct UX from a write failure)
    if (res.status === 400) {
      return {
        ok: false, failure: 'validation',
        msg: (body && body.error) ? body.error : 'Validation rejected the payload.',
        code: (body && body.code) || '400',
        details: (body && body.details) || null,
        txId: null, fullArray, status: 400,
      }
    }

    // spec write error: { success:false, error, code } (may arrive with 5xx or 200)
    if (body && body.success === false) {
      return {
        ok: false, failure: 'write',
        msg: body.error || 'Write to Arweave failed.',
        code: body.code || String(res.status || 'ERR'),
        txId: null, fullArray, status: res.status,
      }
    }

    // any other non-OK status with no spec body
    if (!res.ok) {
      return {
        ok: false, failure: 'write',
        msg: (body && body.error) ? body.error : ('Upload endpoint returned ' + res.status + '.'),
        code: (body && body.code) || String(res.status),
        txId: null, fullArray, status: res.status,
      }
    }

    // success: spec says { success:true, txId }
    const txId = extractTxId(body)
    return { ok: true, msg: 'Permanently etched onto Arweave.', txId, fullArray }
  } catch (e) {
    clearTimeout(timer)
    // AbortError = we hit the 30s timeout
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) {
      return {
        ok: false, failure: 'timeout',
        msg: 'The write took longer than ' + (UPLOAD_TIMEOUT_MS / 1000) + 's and timed out.',
        code: 'TIMEOUT', txId: null, fullArray,
      }
    }
    return {
      ok: false, failure: 'network',
      msg: 'Could not reach ' + API_BASE + '/upload (' + (e?.message || e) + ').',
      code: 'NETWORK', txId: null, fullArray,
    }
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

/**
 * 🎵 ADAPTIVE SANDBOX GATEWAY RESOLVER 🎵
 * Dynamically intercepts decentralized media addresses inside the interface layer.
 * Maps assets targeting public gateways straight onto local ArLocal nodes during development.
 */
export function resolveAudioUri(uri) {
  if (!uri || typeof uri !== 'string') return '';

  // 🔒 PRODUCTION MAINNET ROUTE: Enforce direct native streaming off public decentralized Arweave node clusters
  return uri;
}




