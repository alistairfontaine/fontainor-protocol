// Mobile Wallet Adapter (MWA) provider — the standard, one-tap native Solana
// wallet flow on Android. Bridges to MwaPlugin.java (Solana Mobile clientlib
// 2.0.8), which runs the local association + authorize/sign session with ANY
// installed MWA wallet (Phantom, Solflare, Backpack, ...).
//
// Exposed behind the same provider shape as the Phantom deeplink shim so the
// rest of the app (AuthContext, purchase.ts, irysPublish.ts, tip jar) never
// has to know which backend did the signing.
import { registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import bs58 from 'bs58'
import type { PublicKeyLike } from './phantomDeeplink'

interface MwaNativePlugin {
  isWalletAvailable(): Promise<{ available: boolean }>
  connect(options: {
    identityUri: string
    iconUri: string
    identityName: string
    cluster: string
    authToken?: string
  }): Promise<{ publicKey: string; authToken: string; accountLabel: string; walletUriBase: string }>
  signMessage(options: {
    message: string
    address: string
    authToken: string
    identityUri: string
    iconUri: string
    identityName: string
  }): Promise<{ signature: string }>
  signAndSendTransaction(options: {
    transaction: string
    authToken: string
    identityUri: string
    iconUri: string
    identityName: string
  }): Promise<{ signature: string }>
  deauthorize(options: { authToken: string }): Promise<void>
}

const Mwa = registerPlugin<MwaNativePlugin>('Mwa')

const IDENTITY = {
  identityUri: 'https://fontainor-protocol.vercel.app',
  iconUri: '/icon-512.png',
  identityName: 'Fontainor',
}
const CLUSTER = 'mainnet-beta'
const STORE_KEY = 'fontainor_mwa_session_v1'

interface MwaSession {
  authToken: string
  /** base58 wallet address */
  address: string
  accountLabel?: string
}

let session: MwaSession | null = null
let loaded = false

const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const bytesToB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))

async function loadSession(): Promise<MwaSession | null> {
  if (loaded) return session
  loaded = true
  try {
    const { value } = await Preferences.get({ key: STORE_KEY })
    if (value) session = JSON.parse(value) as MwaSession
  } catch {
    session = null
  }
  return session
}

async function saveSession(next: MwaSession | null): Promise<void> {
  session = next
  loaded = true
  try {
    if (next) await Preferences.set({ key: STORE_KEY, value: JSON.stringify(next) })
    else await Preferences.remove({ key: STORE_KEY })
  } catch {
    /* session just won't survive a cold start */
  }
}

/** Whether any MWA-compatible wallet app is installed on this device. */
export async function mwaAvailable(): Promise<boolean> {
  try {
    const { available } = await Mwa.isWalletAvailable()
    return available
  } catch {
    return false
  }
}

export async function mwaStoredSession(): Promise<{ address: string } | null> {
  const s = await loadSession()
  return s ? { address: s.address } : null
}

export async function mwaConnect(): Promise<{ publicKey: PublicKeyLike }> {
  const existing = await loadSession()
  const res = await Mwa.connect({ ...IDENTITY, cluster: CLUSTER, authToken: existing?.authToken })
  const address = bs58.encode(b64ToBytes(res.publicKey))
  await saveSession({ authToken: res.authToken, address, accountLabel: res.accountLabel || undefined })
  return { publicKey: makePublicKey(address) }
}

export async function mwaDisconnect(): Promise<void> {
  const s = await loadSession()
  if (s) {
    // best-effort: revoking the token opens the wallet once; never block logout
    void Mwa.deauthorize({ authToken: s.authToken }).catch(() => {})
  }
  await saveSession(null)
}

export async function mwaSignMessage(message: Uint8Array): Promise<{ signature: Uint8Array }> {
  const s = await requireSession()
  const res = await Mwa.signMessage({
    ...IDENTITY,
    message: bytesToB64(message),
    address: bytesToB64(bs58.decode(s.address)),
    authToken: s.authToken,
  })
  return { signature: b64ToBytes(res.signature) }
}

export async function mwaSignAndSendTransaction(serializedTx: Uint8Array): Promise<{ signature: string }> {
  const s = await requireSession()
  const res = await Mwa.signAndSendTransaction({
    ...IDENTITY,
    transaction: bytesToB64(serializedTx),
    authToken: s.authToken,
  })
  // Solana convention: transaction signatures travel as base58 strings.
  return { signature: bs58.encode(b64ToBytes(res.signature)) }
}

export function mwaAddress(): string | null {
  return session?.address ?? null
}

async function requireSession(): Promise<MwaSession> {
  const s = await loadSession()
  if (!s) {
    await mwaConnect()
    if (!session) throw new Error('Wallet connection was declined.')
    return session
  }
  return s
}

function makePublicKey(address: string): PublicKeyLike {
  return {
    toString: () => address,
    toBytes: () => bs58.decode(address),
  }
}
