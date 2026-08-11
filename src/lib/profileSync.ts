// Wallet-portable profile sync — collections and likes follow the Phantom
// wallet across machines instead of living and dying with one browser.
//
// On connect (and on app start with a restored session) we:
//   1. pull the durable purchase records for the wallet and merge them into
//      the local receipt store, so "Your collection" rebuilds anywhere;
//   2. pull server favorites and merge them last-write-wins per id (likes AND
//      unlikes carry timestamps, so an unlike made on another device sticks —
//      the old union merge resurrected it), then push if local state is newer.
// After that, every favorites change is debounced and pushed to the server.
//
// Writes are authenticated with the same TweetNaCl signature the sovereign
// login already produces. The signed message carries its issue timestamp and
// the server rejects proofs older than 7 days, so the stored proof is no
// longer a forever-valid bearer token; we expire it client-side on the same
// clock and ask for one fresh Phantom signature at the next login.
import { getFavoritesState, mergeFavoritesState, subscribeFavorites } from '../state/collections'
import { API_BASE } from './api'
import { mergePurchases, type PurchaseReceipt } from './purchase'
import { noteServerDate, syncedNow } from './serverClock'

const SESSION_KEY = 'fontainor_session_v2' // v1 proofs had no expiry — abandoned
const PUSH_DEBOUNCE_MS = 1500
/** Mirrors the server's SESSION_TTL_MS — expire locally instead of hitting 401s. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SessionProof {
  /** JSON byte-array strings, exactly as /api/v1/auth/sovereign-login consumes them. */
  publicKey: string
  signature: string
  message: string
  wallet: string
  /** ms timestamp embedded in (and signed as part of) the message. */
  issuedAt: number
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
    if (!p || typeof p.publicKey !== 'string' || typeof p.signature !== 'string' || typeof p.wallet !== 'string') return null
    // Expired (or legacy un-timestamped) proofs are useless — the server
    // rejects them. Drop so the caller falls back to read-only sync.
    if (!Number.isFinite(p.issuedAt) || syncedNow() - p.issuedAt > SESSION_TTL_MS) {
      clearSessionProof()
      return null
    }
    return p
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
  noteServerDate(res)
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

interface ServerFavorites {
  ids?: string[]
  likedAt?: Record<string, number>
  unlikedAt?: Record<string, number>
}

async function pushFavoritesNow(proof: SessionProof): Promise<void> {
  try {
    const state = getFavoritesState()
    const res = await fetch(`${API_BASE}/api/v1/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: proof.publicKey,
        signature: proof.signature,
        message: proof.message,
        ids: state.ids.slice(0, 500),
        likedAt: state.likedAt,
        unlikedAt: state.unlikedAt,
      }),
    })
    // The server answers with the canonical merged replica — adopt it so this
    // device also learns about likes/unlikes merged in from elsewhere.
    const data = (await res.json().catch(() => null)) as ServerFavorites | null
    if (res.ok && data && Array.isArray(data.ids)) mergeFavoritesState(data)
  } catch {
    /* offline — local likes remain source of truth until the next sync */
  }
}

async function pullFavorites(wallet: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/favorites?wallet=${encodeURIComponent(wallet)}`)
  noteServerDate(res)
  if (!res.ok) return
  const data = (await res.json().catch(() => null)) as ServerFavorites | null
  if (!data || !Array.isArray(data.ids)) return
  const before = JSON.stringify(data.ids)
  const merged = mergeFavoritesState(data)
  // Local actions the server hasn't seen? Push the merged replica back.
  if (JSON.stringify(merged.ids) !== before || Object.keys(merged.unlikedAt).length > 0) {
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
