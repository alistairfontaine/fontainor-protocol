// Wallet-portable profile sync — collections and likes follow the Phantom
// wallet across machines instead of living and dying with one browser.
//
// On connect (and on app start with a restored session) we:
//   1. pull the durable purchase records for the wallet and merge them into
//      the local receipt store, so "Your collection" rebuilds anywhere;
//   2. pull server favorites, union them with local likes, and push the
//      union back so likes made offline propagate too.
// After that, every favorites change is debounced and pushed to the server.
//
// Writes are authenticated with the same TweetNaCl signature the sovereign
// login already produces — stored for the session, so liking a track never
// triggers an extra Phantom popup.
import { getFavoriteIds, mergeFavoriteIds, subscribeFavorites } from '../state/collections'
import { API_BASE } from './api'
import { mergePurchases, type PurchaseReceipt } from './purchase'

const SESSION_KEY = 'fontainor_session_v1'
const PUSH_DEBOUNCE_MS = 1500

export interface SessionProof {
  /** JSON byte-array strings, exactly as /api/v1/auth/sovereign-login consumes them. */
  publicKey: string
  signature: string
  message: string
  wallet: string
}

export function saveSessionProof(proof: SessionProof): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(proof))
  } catch {
    /* private mode — sync becomes read-only for this session */
  }
}

export function loadSessionProof(): SessionProof | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    const p = raw ? (JSON.parse(raw) as SessionProof) : null
    return p && typeof p.publicKey === 'string' && typeof p.signature === 'string' && typeof p.wallet === 'string' ? p : null
  } catch {
    return null
  }
}

export function clearSessionProof(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* noop */
  }
}

// --- purchases -------------------------------------------------------------

interface ServerPurchase {
  trackId?: string
  signature?: string
  artistWallet?: string
  buyerWallet?: string
  amountLamports?: number
  verifiedAt?: string
}

async function pullPurchases(wallet: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/purchases?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return
  const data = (await res.json().catch(() => null)) as { purchases?: ServerPurchase[] } | null
  if (!data || !Array.isArray(data.purchases)) return
  const receipts: PurchaseReceipt[] = data.purchases
    .filter((p) => typeof p.signature === 'string' && typeof p.trackId === 'string')
    .map((p) => ({
      trackId: String(p.trackId),
      // Title/artist live in the registry — Profile resolves them by trackId.
      title: '',
      artist: '',
      artistWallet: String(p.artistWallet ?? ''),
      signature: String(p.signature),
      lamports: Number(p.amountLamports) || 0,
      buyerWallet: wallet,
      at: String(p.verifiedAt ?? ''),
      serverVerified: true,
    }))
  mergePurchases(receipts)
}

// --- favorites -------------------------------------------------------------

let pushTimer: ReturnType<typeof setTimeout> | null = null

function pushFavoritesSoon(): void {
  const proof = loadSessionProof()
  if (!proof) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void pushFavoritesNow(proof)
  }, PUSH_DEBOUNCE_MS)
}

async function pushFavoritesNow(proof: SessionProof): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/v1/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: proof.publicKey,
        signature: proof.signature,
        message: proof.message,
        ids: getFavoriteIds().slice(0, 500),
      }),
    })
  } catch {
    /* offline — local likes remain source of truth until the next sync */
  }
}

async function pullFavorites(wallet: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/favorites?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return
  const data = (await res.json().catch(() => null)) as { ids?: string[] } | null
  if (!data || !Array.isArray(data.ids)) return
  const merged = mergeFavoriteIds(data.ids)
  // Local-only likes exist? Propagate the union back to the server.
  if (merged.length !== data.ids.length) {
    const proof = loadSessionProof()
    if (proof) void pushFavoritesNow(proof)
  }
}

// --- orchestration ----------------------------------------------------------

let autoPushStarted = false

/** Subscribe once: any favorites change while a session exists is pushed (debounced). */
export function startFavoritesAutoPush(): void {
  if (autoPushStarted) return
  autoPushStarted = true
  subscribeFavorites(pushFavoritesSoon)
}

/** Pull purchases + favorites for the wallet. Safe to call repeatedly; best-effort. */
export async function syncProfile(wallet: string): Promise<void> {
  await Promise.allSettled([pullPurchases(wallet), pullFavorites(wallet)])
}
