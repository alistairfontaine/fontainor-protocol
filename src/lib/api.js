import { parseRegistryText } from './registry.js'

// Backend base URL. Override at runtime with ?api=http://host:port
export const API_BASE =
  new URLSearchParams(location.search).get('api') || 'http://localhost:3000'

// Try the backend first, then the local file, then signal "sample".
// Returns { data, source: 'api'|'file'|'sample', repaired: bool }
export async function loadRegistry(fallback) {
  // 1) backend API
  try {
    const res = await fetch(API_BASE + '/registry', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) return { data: out.data, source: 'api', repaired: out.repaired }
    }
  } catch (e) {}
  // 2) local registry.json (served via vite/static)
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

// Publish: prefer a globally-exposed triggerUpload(content) if the host page
// provides one (leader's integration); otherwise POST to {API_BASE}/upload.
// Returns { ok, msg }
export async function publishAsset(asset) {
  const payload = JSON.stringify(asset)
  if (typeof window.triggerUpload === 'function') {
    try {
      await window.triggerUpload(payload)
      return { ok: true, msg: 'Sent via triggerUpload().' }
    } catch (e) {
      return { ok: false, msg: 'triggerUpload() failed: ' + (e?.message || e) }
    }
  }
  try {
    const res = await fetch(API_BASE + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
    if (res.ok) return { ok: true, msg: 'Uploaded to ' + API_BASE + '/upload.' }
    return { ok: false, msg: 'Upload endpoint returned ' + res.status + '.' }
  } catch (e) {
    return { ok: false, msg: 'Could not reach ' + API_BASE + '/upload (' + (e?.message || e) + ').' }
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
