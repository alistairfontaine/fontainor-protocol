import { Capacitor } from '@capacitor/core'
import { parseRegistryText, type Release } from './registry'

// Where the registry/upload/payment API lives.
// - Web (browser/PWA): same-origin '' — vercel.json rewrites /registry → the
//   serverless function; the vite dev server proxies to the deployed API.
// - Native app (Capacitor): the WebView is served from https://localhost, so
//   there is no same-origin API. Point at the deployed origin instead (CORS is
//   open, verified in api/index.js). Overridable at build time via VITE_API_BASE.
const REMOTE_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'https://fontainor-protocol.vercel.app'

function resolveApiBase(): string {
  try {
    if (Capacitor.isNativePlatform()) return REMOTE_API_BASE
  } catch {
    /* not in a Capacitor runtime — treat as web */
  }
  return ''
}

export const API_BASE = resolveApiBase()

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

/** Fetch the raw live registry array (for appending a new publication). */
export async function loadRawRegistryArray(): Promise<unknown[]> {
  try {
    const res = await fetch(API_BASE + '/registry', { cache: 'no-store' })
    if (res.ok) {
      const out = parseRegistryText(await res.text())
      if (Array.isArray(out.data)) return out.data as unknown[]
      const o = out.data as Record<string, unknown> | null
      if (o && Array.isArray(o.releases)) return o.releases as unknown[]
      if (o && typeof o === 'object') return [o]
    }
  } catch {
    /* empty registry is a valid starting point */
  }
  return []
}

export type PublishFailure = 'validation' | 'write' | 'timeout' | 'network'

export interface PublishResult {
  ok: boolean
  failure?: PublishFailure
  msg: string
  code?: string
  details?: unknown
  txId: string | null
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
