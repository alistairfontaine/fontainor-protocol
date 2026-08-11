// Phantom wallet auth — sovereign login (signature verified server-side
// at /api/v1/auth/sovereign-login, TweetNaCl). Same flow as upstream,
// incl. the Firefox service-worker workarounds.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { API_BASE } from '../lib/api'
import { isMobileDevice } from '../lib/phantom'
import { clearSessionProof, saveSessionProof, startFavoritesAutoPush, syncProfile } from '../lib/profileSync'

export interface User {
  address: string
  handle?: string
  /** true when `handle` is a claimed username (not the address-derived fallback) */
  claimed?: boolean
  via: 'wallet'
}

interface PhantomProvider {
  isPhantom?: boolean
  publicKey?: { toString(): string; toBytes(): Uint8Array } | null
  connect(): Promise<{ publicKey: { toString(): string; toBytes(): Uint8Array } }>
  disconnect?(): Promise<void>
  signMessage(msg: Uint8Array, encoding: string): Promise<{ signature: Uint8Array }>
}

declare global {
  interface Window {
    solana?: PhantomProvider
    phantom?: { solana?: PhantomProvider }
  }
}

interface AuthState {
  user: User | null
  connecting: boolean
  hasWallet: boolean
  connect: () => Promise<{ success: boolean; error?: string }>
  /** Claim or change the wallet-bound @handle (signs a claim message with Phantom). */
  updateHandle: (handle: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
}

const Ctx = createContext<AuthState | null>(null)
const USER_KEY = 'fontainor_user_v2'

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    const parsed = raw ? (JSON.parse(raw) as User) : null
    return parsed && typeof parsed.address === 'string' ? parsed : null
  } catch {
    return null
  }
}

async function getProvider(): Promise<PhantomProvider | null> {
  let provider = window.solana ?? window.phantom?.solana ?? null
  let attempts = 0
  while (!provider?.isPhantom && attempts < 30) {
    await new Promise((r) => setTimeout(r, 100))
    provider = window.solana ?? window.phantom?.solana ?? null
    attempts++
  }
  return provider?.isPhantom ? provider : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadUser)
  const [connecting, setConnecting] = useState(false)
  const hasWallet = typeof window !== 'undefined' && Boolean(window.solana?.isPhantom || window.phantom?.solana?.isPhantom)

  const connect = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setConnecting(true)
    try {
      const provider = await getProvider()
      if (!provider) {
        return {
          success: false,
          error: isMobileDevice()
            ? 'No wallet in this mobile browser — tap "Open in Phantom" in the header to load Fontainor inside the Phantom app.'
            : 'Phantom wallet not detected. Install the Phantom extension (phantom.com), unlock it, and refresh.',
        }
      }

      // Firefox workaround: publicKey may exist without connect()
      let publicKey = provider.publicKey ?? null
      if (!publicKey) {
        try {
          publicKey = (await provider.connect()).publicKey
        } catch {
          publicKey = provider.publicKey ?? null
          if (!publicKey) {
            return {
              success: false,
              error: 'Phantom is not responding. Unlock the extension from your toolbar and try again.',
            }
          }
        }
      }

      const address = publicKey.toString()
      const msg = 'Authenticate Fontainor Sovereign Session'
      let signed: { signature: Uint8Array }
      try {
        signed = await provider.signMessage(new TextEncoder().encode(msg), 'utf8')
      } catch {
        return { success: false, error: 'Signature cancelled. Approve the signature request in Phantom to sign in.' }
      }

      const res = await fetch(`${API_BASE}/api/v1/auth/sovereign-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: JSON.stringify(Array.from(publicKey.toBytes())),
          signature: JSON.stringify(Array.from(signed.signature)),
          message: msg,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; handle?: string; message?: string }
      if (!res.ok || !data.success) {
        return { success: false, error: data.message || 'The registry rejected the signature. Try again.' }
      }

      const u: User = { address, handle: data.handle, claimed: Boolean((data as { claimed?: boolean }).claimed), via: 'wallet' }
      setUser(u)
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(u))
      } catch {
        /* private mode */
      }
      // Keep the verified signature for the session so favorites sync can
      // authenticate writes without extra Phantom popups, then rebuild the
      // wallet's collection + likes from the durable server records.
      saveSessionProof({
        publicKey: JSON.stringify(Array.from(publicKey.toBytes())),
        signature: JSON.stringify(Array.from(signed.signature)),
        message: msg,
        wallet: address,
      })
      void syncProfile(address)
      return { success: true }
    } catch (e) {
      // Never let a network failure escape as an unhandled rejection — every
      // caller treats { success:false } as the inline-error path.
      return {
        success: false,
        error: 'Could not reach the registry to verify the signature (' + String((e as Error)?.message || e) + '). Check your connection and try again.',
      }
    } finally {
      setConnecting(false)
    }
  }, [])

  // Wallet-portable profile: push likes while a session exists, and re-sync
  // restored sessions on app start (fresh machine → collection follows the wallet).
  useEffect(() => {
    startFavoritesAutoPush()
    if (user?.address) void syncProfile(user.address)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  const updateHandle = useCallback(
    async (handle: string): Promise<{ success: boolean; error?: string }> => {
      const bare = handle.trim().replace(/^@/, '').toLowerCase()
      if (!/^[a-z0-9_]{3,20}$/.test(bare)) {
        return { success: false, error: 'Handles are 3–20 characters: letters, numbers, underscores.' }
      }
      const provider = await getProvider()
      if (!provider) return { success: false, error: 'Phantom wallet not detected. Unlock the extension and try again.' }

      let publicKey = provider.publicKey ?? null
      if (!publicKey) {
        try {
          publicKey = (await provider.connect()).publicKey
        } catch {
          return { success: false, error: 'Phantom is not responding. Unlock the extension and try again.' }
        }
      }
      if (user && publicKey.toString() !== user.address) {
        return { success: false, error: 'Phantom is on a different wallet than this session. Switch accounts and retry.' }
      }

      let signed: { signature: Uint8Array }
      try {
        signed = await provider.signMessage(new TextEncoder().encode(`Fontainor handle claim: @${bare}`), 'utf8')
      } catch {
        return { success: false, error: 'Signature cancelled. Approve the request in Phantom to claim the handle.' }
      }

      const res = await fetch(`${API_BASE}/api/v1/auth/set-handle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: JSON.stringify(Array.from(publicKey.toBytes())),
          signature: JSON.stringify(Array.from(signed.signature)),
          handle: bare,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; handle?: string; message?: string }
      if (!res.ok || !data.success || !data.handle) {
        return { success: false, error: data.message || 'The registry rejected the handle. Try another one.' }
      }

      setUser((prev) => {
        const next: User = prev
          ? { ...prev, handle: data.handle, claimed: true }
          : { address: publicKey.toString(), handle: data.handle, claimed: true, via: 'wallet' }
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(next))
        } catch {
          /* private mode */
        }
        return next
      })
      return { success: true }
    },
    [user],
  )

  const logout = useCallback(() => {
    setUser(null)
    clearSessionProof()
    try {
      localStorage.removeItem(USER_KEY)
    } catch {
      /* noop */
    }
    void (window.solana?.disconnect?.() ?? window.phantom?.solana?.disconnect?.())
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, connecting, hasWallet, connect, updateHandle, logout }),
    [user, connecting, hasWallet, connect, updateHandle, logout],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

export const shortAddress = (a: string): string => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a)
