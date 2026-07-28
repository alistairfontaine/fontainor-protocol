// Phantom deeplink provider for the native (Capacitor) app.
//
// Why this exists: inside a WebView there is no injected `window.solana`
// (that only exists in the Phantom in-app browser or the desktop extension).
// So on native we implement Phantom's documented encrypted deeplink protocol
// and expose it behind the SAME provider shape the rest of the app already
// reads (`window.solana`): `connect`, `disconnect`, `signMessage`,
// `signAndSendTransaction`, `publicKey`. Because the shape matches, every
// existing call site (AuthContext login, purchase.ts, irysPublish.ts,
// Support tip jar) works unchanged.
//
// Protocol (https://docs.phantom.com/phantom-deeplinks):
//  - dApp generates an x25519 keypair; sends its public key to Phantom.
//  - Phantom returns its own encryption public key + a nonce + encrypted
//    payload; we derive a shared secret (nacl.box.before) and decrypt.
//  - connect -> { public_key, session }. Subsequent requests are encrypted
//    with the shared secret and carry the opaque `session` token.
//  - Every request names a `redirect_link`; Phantom bounces the result back
//    to `fontainor://onphantom/<method>` which Capacitor's App plugin
//    surfaces via the `appUrlOpen` event.
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Preferences } from '@capacitor/preferences'

const PHANTOM_BASE = 'https://phantom.app/ul/v1'
const CLUSTER = 'mainnet-beta'
const SCHEME = 'fontainor'
const REDIRECT = (method: string) => `${SCHEME}://onphantom/${method}`
const APP_URL = 'https://fontainor-protocol.vercel.app'
const STORE_KEY = 'fontainor_phantom_session_v1'

type Bytes = Uint8Array

interface Session {
  // dApp x25519 keypair (base58) — persisted so a warm session survives
  // an app restart without a fresh approval popup.
  dappPub: string
  dappSec: string
  // Phantom's side, learned on connect.
  sharedSecret?: string // base58
  session?: string // opaque Phantom session token
  walletPubkey?: string // base58 Solana address
}

let state: Session | null = null
let ready: Promise<void> | null = null

// One in-flight deeplink request at a time, keyed by method, resolved when
// the matching `appUrlOpen` redirect arrives.
type Pending = { resolve: (params: URLSearchParams) => void; reject: (e: Error) => void }
const pending = new Map<string, Pending>()

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

async function loadState(): Promise<Session> {
  if (state) return state
  try {
    const { value } = await Preferences.get({ key: STORE_KEY })
    if (value) {
      state = JSON.parse(value) as Session
      return state
    }
  } catch {
    /* fresh keypair below */
  }
  const kp = nacl.box.keyPair()
  state = { dappPub: bs58.encode(kp.publicKey), dappSec: bs58.encode(kp.secretKey) }
  await persist()
  return state
}

async function persist(): Promise<void> {
  if (!state) return
  try {
    await Preferences.set({ key: STORE_KEY, value: JSON.stringify(state) })
  } catch {
    /* non-fatal: session just won't survive a cold start */
  }
}

function decryptPayload(data: string, nonce: string, sharedSecret: string): Record<string, unknown> {
  const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), bs58.decode(sharedSecret))
  if (!decrypted) throw new Error('Could not decrypt Phantom response (shared secret mismatch).')
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>
}

function encryptPayload(payload: unknown, sharedSecret: string): [nonce: string, data: string] {
  const nonce = nacl.randomBytes(24)
  const encoded = new TextEncoder().encode(JSON.stringify(payload))
  const encrypted = nacl.box.after(encoded, nonce, bs58.decode(sharedSecret))
  return [bs58.encode(nonce), bs58.encode(encrypted)]
}

/** Open a Phantom deeplink and wait for the matching redirect back. */
function openAndAwait(method: string, url: string): Promise<URLSearchParams> {
  return new Promise<URLSearchParams>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.has(method)) {
        pending.delete(method)
        reject(new Error('Phantom did not respond. Reopen the app after approving in Phantom, or try again.'))
      }
    }, 180_000)
    const wrapped: Pending = {
      resolve: (params) => {
        clearTimeout(timeout)
        resolve(params)
      },
      reject: (e) => {
        clearTimeout(timeout)
        reject(e)
      },
    }
    pending.set(method, wrapped)
    void Browser.open({ url, presentationStyle: 'popover' }).catch((e) => {
      clearTimeout(timeout)
      pending.delete(method)
      reject(e instanceof Error ? e : new Error(String(e)))
    })
  })
}

/** Route an incoming `fontainor://onphantom/<method>` redirect. */
function handleRedirect(rawUrl: string): void {
  // Parse WITHOUT new URL(): older WebViews treat custom schemes as opaque
  // (host/pathname come back empty or glued together), which silently
  // orphaned the waiter -> 3-minute timeout -> bogus "cancelled" error.
  const m = /^fontainor:\/\/onphantom\/([A-Za-z]+)/.exec(rawUrl)
  if (!m) return
  const method = m[1]
  const qIdx = rawUrl.indexOf('?')
  const params = new URLSearchParams(qIdx === -1 ? '' : rawUrl.slice(qIdx + 1))
  const waiter = pending.get(method)
  if (!waiter) return
  pending.delete(method)
  void Browser.close().catch(() => {})
  const errCode = params.get('errorCode')
  if (errCode) {
    const msg = params.get('errorMessage') || `Phantom returned error ${errCode}.`
    // 4001 = user rejected (Phantom follows EIP-1193 numbering). Everything
    // else is a protocol/session failure and must NOT read as a cancel.
    waiter.reject(errCode === '4001' ? new PhantomUserError(msg) : new PhantomSessionError(msg))
    return
  }
  waiter.resolve(params)
}

export class PhantomUserError extends Error {}
/** Session/protocol failure (stale session token, decrypt mismatch, ...). */
export class PhantomSessionError extends Error {}

let listenerRegistered = false
function ensureListener(): void {
  if (listenerRegistered) return
  listenerRegistered = true
  void App.addListener('appUrlOpen', (event: { url: string }) => {
    if (event?.url?.startsWith(`${SCHEME}://`)) handleRedirect(event.url)
  })
}

// ---- provider methods ------------------------------------------------------

async function connect(): Promise<{ publicKey: PublicKeyLike }> {
  ensureListener()
  const s = await loadState()
  // Warm session: reuse the connected wallet without another approval.
  if (s.walletPubkey && s.sharedSecret && s.session) {
    return { publicKey: makePublicKey(s.walletPubkey) }
  }
  const params = new URLSearchParams({
    dapp_encryption_public_key: s.dappPub,
    cluster: CLUSTER,
    app_url: APP_URL,
    redirect_link: REDIRECT('connect'),
  })
  const res = await openAndAwait('connect', `${PHANTOM_BASE}/connect?${params.toString()}`)
  const phantomPub = res.get('phantom_encryption_public_key')
  const nonce = res.get('nonce')
  const data = res.get('data')
  if (!phantomPub || !nonce || !data) throw new Error('Phantom connect response was incomplete.')
  const shared = nacl.box.before(bs58.decode(phantomPub), bs58.decode(s.dappSec))
  const sharedB58 = bs58.encode(shared)
  const decoded = decryptPayload(data, nonce, sharedB58)
  const walletPubkey = String(decoded.public_key)
  const session = String(decoded.session)
  s.sharedSecret = sharedB58
  s.session = session
  s.walletPubkey = walletPubkey
  await persist()
  return { publicKey: makePublicKey(walletPubkey) }
}

async function disconnect(): Promise<void> {
  const s = state
  if (!s?.sharedSecret || !s.session) {
    await clearSession()
    return
  }
  try {
    const [nonce, payload] = encryptPayload({ session: s.session }, s.sharedSecret)
    const params = new URLSearchParams({
      dapp_encryption_public_key: s.dappPub,
      nonce,
      redirect_link: REDIRECT('disconnect'),
      payload,
    })
    // Fire-and-forget; we don't block logout on the round trip.
    void openAndAwait('disconnect', `${PHANTOM_BASE}/disconnect?${params.toString()}`).catch(() => {})
  } finally {
    await clearSession()
  }
}

async function clearSession(): Promise<void> {
  if (state) {
    state.sharedSecret = undefined
    state.session = undefined
    state.walletPubkey = undefined
    await persist()
  }
}

async function signMessage(message: Bytes, _display: string = 'utf8'): Promise<{ signature: Bytes }> {
  return withFreshSessionRetry(async () => {
    const s = await ensureConnected()
    const payload = { session: s.session, message: bs58.encode(message) }
    const [nonce, data] = encryptPayload(payload, s.sharedSecret!)
    const params = new URLSearchParams({
      dapp_encryption_public_key: s.dappPub,
      nonce,
      redirect_link: REDIRECT('signMessage'),
      payload: data,
    })
    const res = await openAndAwait('signMessage', `${PHANTOM_BASE}/signMessage?${params.toString()}`)
    const decoded = decodeResponse(res, s.sharedSecret!)
    return { signature: bs58.decode(String(decoded.signature)) }
  })
}

/**
 * Session errors self-heal: drop the persisted session (it may predate a
 * reinstall/wallet reset — the exact "approved but still cancelled" trap),
 * reconnect fresh, retry the op once. User declines are never retried.
 */
async function withFreshSessionRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
    if (e instanceof PhantomUserError) throw e
    if (!(e instanceof PhantomSessionError) && !/decrypt|session/i.test(e instanceof Error ? e.message : '')) throw e
    await clearSession()
    return op()
  }
}

async function signAndSendTransaction(tx: unknown): Promise<{ signature: string }> {
  const serialized = serializeTransaction(tx)
  return withFreshSessionRetry(async () => {
    const s = await ensureConnected()
    const payload = { session: s.session, transaction: bs58.encode(serialized) }
    const [nonce, data] = encryptPayload(payload, s.sharedSecret!)
    const params = new URLSearchParams({
      dapp_encryption_public_key: s.dappPub,
      nonce,
      redirect_link: REDIRECT('signAndSendTransaction'),
      payload: data,
    })
    const res = await openAndAwait('signAndSendTransaction', `${PHANTOM_BASE}/signAndSendTransaction?${params.toString()}`)
    const decoded = decodeResponse(res, s.sharedSecret!)
    return { signature: String(decoded.signature) }
  })
}

function decodeResponse(res: URLSearchParams, sharedSecret: string): Record<string, unknown> {
  const nonce = res.get('nonce')
  const data = res.get('data')
  if (!nonce || !data) throw new Error('Phantom response was incomplete.')
  return decryptPayload(data, nonce, sharedSecret)
}

async function ensureConnected(): Promise<Session & { sharedSecret: string; session: string }> {
  let s = await loadState()
  if (!s.sharedSecret || !s.session || !s.walletPubkey) {
    await connect()
    s = state!
  }
  return s as Session & { sharedSecret: string; session: string }
}

/** Legacy web3.js Transaction (or VersionedTransaction) -> wire bytes. */
export function serializeTransaction(tx: unknown): Uint8Array {
  const t = tx as {
    serialize?: (opts?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) => Uint8Array
  }
  if (typeof t?.serialize !== 'function') throw new Error('Unsupported transaction object.')
  // Legacy Transaction supports the options; VersionedTransaction.serialize() ignores them.
  try {
    return t.serialize({ requireAllSignatures: false, verifySignatures: false })
  } catch {
    return t.serialize()
  }
}

// ---- PublicKey shim --------------------------------------------------------
// The app reads `publicKey.toString()` and `publicKey.toBytes()`.
export interface PublicKeyLike {
  toString(): string
  toBytes(): Uint8Array
}
function makePublicKey(address: string): PublicKeyLike {
  return {
    toString: () => address,
    toBytes: () => bs58.decode(address),
  }
}

// ---- the injected provider -------------------------------------------------
export interface PhantomProviderShim {
  isPhantom: true
  isFontainorNative: true
  publicKey: PublicKeyLike | null
  connect(): Promise<{ publicKey: PublicKeyLike }>
  disconnect(): Promise<void>
  signMessage(message: Bytes, display?: string): Promise<{ signature: Bytes }>
  signAndSendTransaction(tx: unknown): Promise<{ signature: string }>
}

function buildProvider(): PhantomProviderShim {
  return {
    isPhantom: true,
    isFontainorNative: true,
    get publicKey() {
      return state?.walletPubkey ? makePublicKey(state.walletPubkey) : null
    },
    connect,
    disconnect,
    signMessage,
    signAndSendTransaction,
  }
}

/**
 * Install the deeplink provider as `window.solana` when running natively.
 * Must run BEFORE React renders so AuthContext sees a wallet on first paint.
 * Safe no-op on web (returns false).
 */
export function installNativePhantom(): boolean {
  if (!isNativeApp()) return false
  ensureListener()
  ready = loadState().then(() => undefined)
  const provider = buildProvider()
  const w = window as unknown as { solana?: unknown; phantom?: { solana?: unknown } }
  w.solana = provider
  w.phantom = { solana: provider }
  return true
}

export function nativeReady(): Promise<void> {
  return ready ?? Promise.resolve()
}
