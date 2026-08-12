// Native wallet router — one `window.solana` provider, two backends.
//
//   1. MWA (Mobile Wallet Adapter) — the Solana-standard native flow on
//      Android: one tap, works with ANY installed MWA wallet (Phantom,
//      Solflare, Backpack, ...). Preferred whenever a compatible wallet app
//      is installed.
//   2. Phantom encrypted deeplinks — fallback for devices where no MWA
//      endpoint answers (or the user's only wallet is an old Phantom build).
//
// The router decides the backend at connect() time and remembers it, so
// sign requests always go to the wallet that authorized the session. The
// provider shape matches what AuthContext / purchase.ts / irysPublish.ts /
// the tip jar already read — app code stays wallet-agnostic.
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import bs58 from 'bs58'
import {
  installNativePhantom,
  nativeReady as phantomReady,
  serializeTransaction,
  type PhantomProviderShim,
  type PublicKeyLike,
} from './phantomDeeplink'
import { mwaAddress, mwaAvailable, mwaConnect, mwaDisconnect, MwaUserDeclinedError, mwaSignAndSendTransaction, mwaSignMessage, mwaStoredSession } from './mwa'

type Backend = 'mwa' | 'phantom'
const BACKEND_KEY = 'fontainor_wallet_backend_v1'

let backend: Backend | null = null
let phantom: PhantomProviderShim | null = null
let bootPromise: Promise<void> | null = null

async function loadBackend(): Promise<Backend | null> {
  try {
    const { value } = await Preferences.get({ key: BACKEND_KEY })
    return value === 'mwa' || value === 'phantom' ? value : null
  } catch {
    return null
  }
}

async function saveBackend(next: Backend | null): Promise<void> {
  backend = next
  try {
    if (next) await Preferences.set({ key: BACKEND_KEY, value: next })
    else await Preferences.remove({ key: BACKEND_KEY })
  } catch {
    /* non-fatal */
  }
}

async function connect(): Promise<{ publicKey: PublicKeyLike }> {
  await bootPromise
  // A remembered session reconnects silently through its own backend.
  if (backend === 'mwa') {
    const stored = await mwaStoredSession()
    if (stored) return mwaConnect() // reauthorize (usually silent-ish, wallet may flash)
  }
  if (backend === 'phantom' && phantom) {
    return phantom.connect()
  }
  // Fresh connect: prefer the standard MWA flow when any wallet answers.
  if (await mwaAvailable()) {
    try {
      const res = await mwaConnect()
      await saveBackend('mwa')
      return res
    } catch (e) {
      // User declined — surface it (falling through would nag the user with
      // a SECOND wallet sheet via the Phantom deeplink). mwaConnect maps
      // decline-class rejection codes (USER_DECLINED / AUTH_INVALID on a
      // fresh authorize) to MwaUserDeclinedError, so this is wallet- and
      // locale-agnostic; the message regex stays as belt-and-braces.
      if (e instanceof MwaUserDeclinedError) throw e
      const msg = e instanceof Error ? e.message : String(e)
      if (/declined|reject|cancel/i.test(msg)) throw e instanceof Error ? e : new Error(msg)
      // else (NO_WALLET / WALLET_ERROR / association timeout): fall through
      // to the Phantom deeplink backend.
    }
  }
  if (!phantom) throw new Error('No wallet available on this device.')
  const res = await phantom.connect()
  await saveBackend('phantom')
  return res
}

async function disconnect(): Promise<void> {
  const active = backend ?? (await loadBackend())
  if (active === 'mwa') await mwaDisconnect()
  else if (phantom) await phantom.disconnect()
  await saveBackend(null)
}

async function signMessage(message: Uint8Array, display: string = 'utf8'): Promise<{ signature: Uint8Array }> {
  await bootPromise
  if (backend === 'mwa') return mwaSignMessage(message)
  if (!phantom) throw new Error('Wallet is not connected.')
  return phantom.signMessage(message, display)
}

async function signAndSendTransaction(tx: unknown): Promise<{ signature: string }> {
  await bootPromise
  if (backend === 'mwa') return mwaSignAndSendTransaction(serializeTransaction(tx))
  if (!phantom) throw new Error('Wallet is not connected.')
  return phantom.signAndSendTransaction(tx)
}

function publicKey(): PublicKeyLike | null {
  if (backend === 'mwa') {
    const address = mwaAddress()
    return address ? { toString: () => address, toBytes: () => bs58.decode(address) } : phantomKeyFallback()
  }
  return phantomKeyFallback()
}

function phantomKeyFallback(): PublicKeyLike | null {
  return phantom?.publicKey ?? null
}

/**
 * Install the hybrid provider as `window.solana` when running natively.
 * Must run BEFORE React renders. Safe no-op on web (returns false).
 */
export function installNativeWallet(): boolean {
  try {
    if (!Capacitor.isNativePlatform()) return false
  } catch {
    return false
  }
  // Build the Phantom deeplink shim (also wires the fontainor:// listener),
  // then REPLACE window.solana with the router that fronts both backends.
  installNativePhantom()
  const w = window as unknown as { solana?: unknown; phantom?: { solana?: unknown } }
  phantom = w.solana as PhantomProviderShim

  bootPromise = (async () => {
    await phantomReady()
    backend = await loadBackend()
    if (backend === 'mwa') await mwaStoredSession() // preload so publicKey() is sync afterwards
  })()

  const provider = {
    isPhantom: true as const, // app code gates on this flag; keep it for compatibility
    isFontainorNative: true as const,
    get publicKey() {
      return publicKey()
    },
    connect,
    disconnect,
    signMessage,
    signAndSendTransaction,
  }
  w.solana = provider
  w.phantom = { solana: provider }
  return true
}
