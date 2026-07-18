import { parseRegistryText } from './registry.js'

// 🔒 PRODUCTION MAINNET ROUTE: Enforce direct native communication with live serverless Vercel function edge networks
export const API_BASE = "https://fontainor-protocol.vercel.app";


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
// 3. UPLOAD the entire updated array to Irys (browser-side, user pays SOL)
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

  // ---- dev-only mock mode for the UI smoke test (?mock=ok|writefail|400|timeout) ----
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
        body = { success: false, error: 'Mock: Irys node rejected the write.', code: 'MOCK_WRITE_ERR' }
      } else if (mockMode === '400') {
        await wait(1200)
        res = { ok: false, status: 400 }
        body = { error: 'Mock: payload failed registrySchema.', details: null }
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
        return { ok: false, failure: 'timeout', msg: 'The write took longer than ' + (UPLOAD_TIMEOUT_MS / 1000) + 's and timed out.', code: 'TIMEOUT', txId: null, fullArray }
      }
      return { ok: false, failure: 'network', msg: 'Mock error: ' + (e?.message || e), code: 'NETWORK', txId: null, fullArray }
    }
  }

  // 3) UPLOAD manifest to Irys via browser
  try {
    const provider = window?.solana || window?.phantom?.solana;
    if (!provider) throw new Error('Wallet not connected. Please connect Phantom first.');

    const { WebIrys } = await import('https://cdn.skypack.dev/@irys/sdk');
    const irys = new WebIrys({
      url: "https://node1.irys.xyz",
      token: "solana",
      wallet: { provider, name: "phantom" }
    });
    await irys.ready();

    const receipt = await irys.upload(payload, {
      tags: [
        { name: "Content-Type", value: "application/json" },
        { name: "App-Name", value: "Fontainor" },
        { name: "Type", value: "registry-manifest" }
      ]
    });

    const txId = receipt.id;

    // Notify server of new manifest
    try {
      await fetch(API_BASE + '/api/v1/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId })
      });
    } catch (e) {
      console.warn('Could not notify server of new manifest:', e);
    }

    return { ok: true, msg: 'Permanently etched onto Arweave.', txId, fullArray };
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('balance') || msg.includes('fund') || msg.includes('insufficient') || msg.includes('not enough')) {
      return { ok: false, failure: 'write', msg: 'Not enough SOL to store the manifest on Arweave. Please add SOL to your wallet.', code: 'FUNDING', txId: null, fullArray };
    }
    if (msg.includes('cancel') || msg.includes('abort') || msg.includes('rejected')) {
      return { ok: false, failure: 'write', msg: 'Upload cancelled by user.', code: 'CANCELLED', txId: null, fullArray };
    }
    return { ok: false, failure: 'write', msg: e.message || 'Irys upload failed.', code: 'IRYS_ERR', txId: null, fullArray };
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




