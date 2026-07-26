// Phantom wallet auth — sovereign login (signature verified server-side
// at /api/v1/auth/sovereign-login, TweetNaCl). Same flow as upstream,
// incl. the Firefox service-worker workarounds.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { API_BASE } from '../lib/api'

export interface User {
  address: string
  handle?: string
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
          error: 'Phantom wallet not detected. Install the Phantom extension (phantom.com), unlock it, and refresh.',
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

      const u: User = { address, handle: data.handle, via: 'wallet' }
      setUser(u)
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(u))
      } catch {
        /* private mode */
      }
      return { success: true }
    } finally {
      setConnecting(false)
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    try {
      localStorage.removeItem(USER_KEY)
    } catch {
      /* noop */
    }
    void (window.solana?.disconnect?.() ?? window.phantom?.solana?.disconnect?.())
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, connecting, hasWallet, connect, logout }),
    [user, connecting, hasWallet, connect, logout],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

export const shortAddress = (a: string): string => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a)
