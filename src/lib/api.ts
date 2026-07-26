import { addLocalPublication } from './localPublish'
import { parseRegistryText, type Release } from './registry'

// Same-origin in production (vercel.json rewrites /registry → api function);
// vite dev server proxies to the deployed API.
export const API_BASE = ''

export const UPLOAD_TIMEOUT_MS = 30_000

export type RegistrySource = 'api' | 'file' | 'sample'

export interface RegistryLoad {
  data: unknown
  source: RegistrySource
  repaired: boolean
}

export async function loadRegistry(fallback: unknown): Promise<RegistryLoad> {
  try {
    const res = await fetch(API_BASE + '/registry', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      // An empty live registry (fresh deploy, serverless pointer lost) is not
      // useful to show — fall through to the bundled demo snapshot instead.
      if (out.data != null && !(Array.isArray(out.data) && out.data.length === 0)) {
        return { data: out.data, source: 'api', repaired: out.repaired }
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch('/registry.json', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) return { data: out.data, source: 'file', repaired: out.repaired }
    }
  } catch {
    /* fall through */
  }
  return { data: fallback, source: 'sample', repaired: false }
}

// Demo publish mode: no funded Arweave wallet yet, so publishes are stored in
// the browser (localStorage) and merged into the registry view. Set to false
// once a funded wallet keyfile is configured server-side.
export const DEMO_PUBLISH = true

export type PublishFailure = 'validation' | 'write' | 'timeout' | 'network'

export interface PublishResult {
  ok: boolean
  failure?: PublishFailure
  msg: string
  code?: string
  details?: unknown
  txId: string | null
}

function toRawArray(currentRaw: unknown): unknown[] {
  if (Array.isArray(currentRaw)) return currentRaw.slice()
  const o = currentRaw as Record<string, unknown> | null
  if (o && Array.isArray(o.releases)) return (o.releases as unknown[]).slice()
  if (o && Array.isArray(o.assets)) return (o.assets as unknown[]).slice()
  if (o && typeof o === 'object') return [o]
  return []
}

/** Demo-mode publish: persist to the browser, no chain write. */
export async function publishDemo(newAsset: Record<string, unknown>): Promise<PublishResult> {
  await new Promise((r) => setTimeout(r, 900)) // let the etching state read as deliberate
  try {
    addLocalPublication(newAsset)
  } catch {
    /* storage best-effort */
  }
  return {
    ok: true,
    msg: 'Published in demo mode — saved in this browser, visible across the app. It will move on-chain once an Arweave wallet is funded.',
    txId: 'DEMO_' + Date.now().toString(36).toUpperCase(),
  }
}

/** Append the new asset to the current registry and POST the full manifest. */
export async function publishManifest(newAsset: unknown): Promise<PublishResult> {
  let currentRaw: unknown = []
  try {
    const res = await fetch(API_BASE + '/registry', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (out.data != null) currentRaw = out.data
    }
  } catch {
    /* proceed with empty registry */
  }

  const fullArray = toRawArray(currentRaw)
  fullArray.push(newAsset)
  const payload = JSON.stringify(fullArray)

  // dev/test mock mode: ?mock=ok|writefail|400|timeout
  const mockMode = new URLSearchParams(location.search).get('mock')
  if (mockMode) return mockPublish(mockMode)

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
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status === 400) {
      return {
        ok: false,
        failure: 'validation',
        msg: (body.error as string) || 'Validation rejected.',
        code: '400',
        details: body.details ?? null,
        txId: null,
      }
    }
    if (body.success === false || !res.ok) {
      return {
        ok: false,
        failure: 'write',
        msg: (body.error as string) || `Server returned ${res.status}`,
        code: (body.code as string) || String(res.status),
        txId: null,
      }
    }
    return { ok: true, msg: 'Permanently etched onto Arweave.', txId: (body.txId as string) ?? null }
  } catch (e) {
    const err = e as Error
    if (err?.name === 'AbortError' || /abort/i.test(String(err?.message))) {
      return {
        ok: false,
        failure: 'timeout',
        msg: `The write took longer than ${UPLOAD_TIMEOUT_MS / 1000}s and timed out.`,
        code: 'TIMEOUT',
        txId: null,
      }
    }
    return { ok: false, failure: 'network', msg: 'Network error: ' + (err?.message || e), txId: null }
  }
}

async function mockPublish(mode: string): Promise<PublishResult> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  if (mode === 'ok') {
    await wait(2500)
    return { ok: true, msg: 'Permanently etched onto Arweave.', txId: 'MOCKTX_' + Date.now().toString(36) }
  }
  if (mode === 'writefail') {
    await wait(2500)
    return { ok: false, failure: 'write', msg: 'Mock: write rejected.', code: 'MOCK_WRITE_ERR', txId: null }
  }
  if (mode === '400') {
    await wait(1200)
    return { ok: false, failure: 'validation', msg: 'Mock: validation failed.', code: '400', txId: null }
  }
  await wait(1500)
  return { ok: false, failure: 'timeout', msg: 'Mock timeout.', code: 'TIMEOUT', txId: null }
}

/** Chunked audio upload to the serverless Arweave writer (256KB chunks). */
export async function uploadAudioChunks(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ ok: boolean; audioUri?: string; error?: string }> {
  const CHUNK = 256 * 1024
  const uploadId = 'up_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const buf = new Uint8Array(await file.arrayBuffer())
  const totalChunks = Math.max(1, Math.ceil(buf.length / CHUNK))
  for (let i = 0; i < totalChunks; i++) {
    const slice = buf.slice(i * CHUNK, (i + 1) * CHUNK)
    try {
      const res = await fetch(API_BASE + '/api/v1/upload-audio/chunk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Id': uploadId,
          'X-Chunk-Index': String(i),
          'X-Total-Chunks': String(totalChunks),
        },
        body: slice,
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) return { ok: false, error: (body.message as string) || (body.error as string) || `Chunk ${i} failed (${res.status})` }
      onProgress?.((i + 1) / totalChunks)
      if (i === totalChunks - 1 && body.audioUri) return { ok: true, audioUri: body.audioUri as string }
    } catch (e) {
      return { ok: false, error: 'Network error during upload: ' + ((e as Error)?.message || e) }
    }
  }
  return { ok: false, error: 'Upload finished without a transaction ID.' }
}

export const FALLBACK = {
  assetId: 'FONT-4WHPZ2Q17',
  name: 'Fontainor Genesis',
  artist: 'Alistair Fontaine',
  timestamp: '2026-05-29T08:46:04.538Z',
  equity: { total_copies: 200, price_per_copy: 29.99, secondary_royalty_basis_points: 1000 },
  status: 'REGISTERED_ON_FONTAINOR',
}

export type { Release }
