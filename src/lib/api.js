import { parseRegistryText } from './registry.js'

// 🔒 PRODUCTION MAINNET ROUTE
export const API_BASE = "https://fontainor-protocol.vercel.app";

export const UPLOAD_TIMEOUT_MS = 30000

export async function loadRegistry(fallback) {
  try {
    const res = await fetch(API_BASE + '/registry', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) return { data: out.data, source: 'api', repaired: out.repaired }
    }
  } catch (e) {}
  try {
    const res = await fetch('./registry.json', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) return { data: out.data, source: 'file', repaired: out.repaired }
    }
  } catch (e) {}
  return { data: fallback, source: 'sample', repaired: false }
}

function toRawArray(currentRaw) {
  if (Array.isArray(currentRaw)) return currentRaw.slice()
  if (currentRaw && Array.isArray(currentRaw.releases)) return currentRaw.releases.slice()
  if (currentRaw && Array.isArray(currentRaw.assets)) return currentRaw.assets.slice()
  if (currentRaw && typeof currentRaw === 'object') return [currentRaw]
  return []
}

export async function publishManifest(newAsset) {
  let currentRaw = []
  try {
    const res = await fetch(API_BASE + '/registry', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) currentRaw = out.data
    }
  } catch (e) {}

  const fullArray = toRawArray(currentRaw)
  fullArray.push(newAsset)

  const payload = JSON.stringify(fullArray)

  // dev-only mock mode (?mock=ok|writefail|400|timeout)
  const mockMode = new URLSearchParams(location.search).get('mock')
  if (mockMode) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    try {
      let res, body = {};
      if (mockMode === 'ok') {
        await wait(2500)
        res = { ok: true, status: 200 }
        body = { success: true, txId: 'MOCKTX_' + Date.now().toString(36) + '_mainnet' }
      } else if (mockMode === 'writefail') {
        await wait(2500)
        res = { ok: false, status: 500 }
        body = { success: false, error: 'Mock: write rejected.', code: 'MOCK_WRITE_ERR' }
      } else if (mockMode === '400') {
        await wait(1200)
        res = { ok: false, status: 400 }
        body = { error: 'Mock: validation failed.', details: null }
      } else if (mockMode === 'timeout') {
        await wait(UPLOAD_TIMEOUT_MS + 500)
        throw Object.assign(new Error('mock timeout'), { name: 'AbortError' })
      }
      if (res.status === 400) {
        return { ok: false, failure: 'validation', msg: body.error || 'Validation rejected.', code: '400', details: body.details || null, txId: null, fullArray, status: 400 }
      }
      if (body && body.success === false) {
        return { ok: false, failure: 'write', msg: body.error || 'Write failed.', code: body.code || 'ERR', txId: null, fullArray, status: res.status }
      }
      if (!res.ok) {
        return { ok: false, failure: 'write', msg: body.error || ('Upload returned ' + res.status), code: String(res.status), txId: null, fullArray, status: res.status }
      }
      return { ok: true, msg: 'Permanently etched onto Arweave.', txId: body.txId || null, fullArray }
    } catch (e) {
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) {
        return { ok: false, failure: 'timeout', msg: 'Timed out after ' + (UPLOAD_TIMEOUT_MS / 1000) + 's.', code: 'TIMEOUT', txId: null, fullArray }
      }
      return { ok: false, failure: 'network', msg: 'Mock error: ' + (e?.message || e), code: 'NETWORK', txId: null, fullArray }
    }
  }

  // Simple server POST — no Irys SDK, no Bundlr
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS)
    const res = await fetch(API_BASE + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const body = await res.json().catch(() => ({}))
    if (res.status === 400) {
      return { ok: false, failure: 'validation', msg: body.error || 'Validation rejected.', code: '400', details: body.details || null, txId: null, fullArray, status: 400 }
    }
    if (body && body.success === false) {
      return { ok: false, failure: 'write', msg: body.error || 'Write failed.', code: body.code || 'ERR', txId: null, fullArray, status: res.status }
    }
    if (!res.ok) {
      return { ok: false, failure: 'write', msg: body.error || ('Server returned ' + res.status), code: String(res.status), txId: null, fullArray, status: res.status }
    }
    return { ok: true, msg: 'Permanently etched onto Arweave.', txId: body.txId || null, fullArray }
  } catch (e) {
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) {
      return { ok: false, failure: 'timeout', msg: 'The write took longer than ' + (UPLOAD_TIMEOUT_MS / 1000) + 's and timed out.', code: 'TIMEOUT', txId: null, fullArray }
    }
    return { ok: false, failure: 'network', msg: 'Network error: ' + (e?.message || e), code: 'NETWORK', txId: null, fullArray }
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

export function resolveAudioUri(uri) {
  if (!uri || typeof uri !== 'string') return '';
  return uri;
}
