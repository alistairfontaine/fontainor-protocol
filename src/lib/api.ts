import { parseRegistryText, type Release } from './registry'

// The canonical deployed origin. Used as the API host inside the native shell
// and as the base for shareable links so they never point at the device.
export const SITE_ORIGIN = 'https://fontainor-protocol.vercel.app'

/** True when running inside the Capacitor Android/iOS WebView. */
export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).Capacitor
}

// On the web the app is same-origin with the API (vercel.json rewrites
// /registry and /api/* to the serverless function), so a relative base is
// correct. But the native shell serves this bundle from https://localhost, so
// relative URLs resolve to the DEVICE, not the API — every /registry, publish,
// login, purchase-verify, favorites and play-log call would silently fail and
// the app would freeze on the bundled demo snapshot. Point native builds at the
// deployed origin (CORS is `*`, and capacitor allowNavigation lists *.vercel.app).
export const API_BASE = isNativeShell() ? SITE_ORIGIN : ''

/** Origin for user-shareable links. Never the device's https://localhost. */
export function shareOrigin(): string {
  if (isNativeShell()) return SITE_ORIGIN
  if (typeof window !== 'undefined' && !/^https?:\/\/localhost/i.test(window.location.origin)) {
    return window.location.origin
  }
  return SITE_ORIGIN
}

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
