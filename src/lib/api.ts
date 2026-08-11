import { Capacitor } from '@capacitor/core'
import { parseRegistryText, type Release } from './registry'

// Where the registry/upload/payment API lives.
// - Web (browser/PWA): same-origin '' — vercel.json rewrites /registry → the
//   serverless function; the vite dev server proxies to the deployed API.
// - Native app (Capacitor): the WebView serves this bundle from
//   https://localhost, so relative URLs resolve to the DEVICE, not the API —
//   every /registry, publish, login, purchase-verify, favorites and play-log
//   call would silently fail and the app would freeze on the bundled demo
//   snapshot. Point native builds at the deployed origin (CORS is `*`, and
//   capacitor allowNavigation lists *.vercel.app).
// Overridable at build time via VITE_API_BASE.
export const SITE_ORIGIN = (import.meta.env.VITE_API_BASE as string | undefined) || 'https://fontainor-protocol.vercel.app'

/**
 * True only inside the Capacitor Android/iOS WebView.
 * Uses Capacitor.isNativePlatform() rather than a bare `window.Capacitor`
 * presence check: the web build bundles @capacitor/core too, so presence alone
 * is truthy on the WEBSITE and would push every web request cross-origin.
 */
export function isNativeShell(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    /* not in a Capacitor runtime — treat as web */
    return false
  }
}

function resolveApiBase(): string {
  return isNativeShell() ? SITE_ORIGIN : ''
}

export const API_BASE = resolveApiBase()

/** Origin for user-shareable links. Never the device's https://localhost. */
export function shareOrigin(): string {
  if (isNativeShell()) return SITE_ORIGIN
  if (typeof window !== 'undefined' && !/^https?:\/\/localhost/i.test(window.location.origin)) {
    return window.location.origin
  }
  return SITE_ORIGIN
}

/**
 * Absolute URL for a registry media path that the NATIVE process fetches by
 * itself — offline downloads (Java HttpURLConnection) and notification artwork.
 *
 * The registry stores relative paths (`/audio/x.mp3`). Resolving those against
 * `location.origin` is correct in a browser but WRONG in the app: Capacitor
 * serves the WebView from its own in-process origin (`https://localhost`),
 * which no native code can connect to. Downloads failed 100% of the time for
 * every release in the registry because of exactly that. Always resolve through
 * a host that exists on the network.
 */
export function nativeFetchableUrl(path: string): string {
  if (/^https?:/i.test(path)) return path
  return new URL(path, shareOrigin()).href
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
