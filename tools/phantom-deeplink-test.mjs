#!/usr/bin/env node
// Unit/integration test for src/lib/phantomDeeplink.ts — drives the real
// encrypted deeplink protocol against a simulated "Phantom side" (own x25519
// keypair, real nacl.box encryption), with Capacitor plugins stubbed via
// esbuild aliases. Covers:
//   - connect handshake end-to-end (decrypt, session persist, warm reuse)
//   - double-tap supersede: old waiter rejects with a USER-class error
//     (PhantomSupersededError) and the live session survives (F64)
//   - signMessage happy path uses the live session without reconnecting
//   - errorCode=4001 -> PhantomUserError; other codes -> PhantomSessionError
//   - session-error self-heal: clearSession + reconnect + retry exactly once
//   - 180s timeout closes the Phantom popover (F66) [fake timers]
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
let failed = 0
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ok  ${name}`) }
  else { failed++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`) }
}

// ---- build the module under test with capacitor stubs ----------------------
const outDir = mkdtempSync(join(root, 'tools', '.pdl-')) // inside repo so the bundle resolves node_modules
const outFile = join(outDir, 'phantomDeeplink.bundle.mjs')
execSync(
  [
    'npx esbuild src/lib/phantomDeeplink.ts',
    '--bundle --format=esm --platform=neutral',
    '--external:tweetnacl --external:bs58',
    `--outfile=${outFile}`,
    '--alias:@capacitor/core=./tools/stubs/cap-core.mjs',
    '--alias:@capacitor/app=./tools/stubs/cap-app.mjs',
    '--alias:@capacitor/browser=./tools/stubs/cap-browser.mjs',
    '--alias:@capacitor/preferences=./tools/stubs/cap-preferences.mjs',
  ].join(' '),
  { cwd: root, stdio: 'pipe' },
)

// ---- runtime shims ----------------------------------------------------------
globalThis.__openedUrls = []
globalThis.__browserCloses = 0
globalThis.window = globalThis // installNativePhantom writes window.solana

// Fake timers: capture scheduled callbacks so the 180s timeout is testable.
const realSetTimeout = globalThis.setTimeout
const fakeTimers = []
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms >= 60_000) { const h = { fn, ms, cleared: false }; fakeTimers.push(h); return h }
  return realSetTimeout(fn, ms, ...a)
}
const realClearTimeout = globalThis.clearTimeout
globalThis.clearTimeout = (h) => {
  if (h && typeof h === 'object' && 'fn' in h) { h.cleared = true; return }
  return realClearTimeout(h)
}

const mod = await import(pathToFileURL(outFile).href)
const { installNativePhantom, PhantomUserError, PhantomSessionError, PhantomSupersededError } = mod

// ---- fake Phantom side -------------------------------------------------------
const phantomKp = nacl.box.keyPair()
const SESSION_TOKEN = 'sess_' + bs58.encode(nacl.randomBytes(12))
const walletKp = nacl.sign.keyPair()
const WALLET = bs58.encode(walletKp.publicKey)
let sharedFromPhantomSide = null

function lastOpened() { return globalThis.__openedUrls[globalThis.__openedUrls.length - 1] }
function openedCount(method) {
  return globalThis.__openedUrls.filter((u) => u.startsWith(`https://phantom.app/ul/v1/${method}?`)).length
}
function paramsOf(url) { return new URLSearchParams(url.slice(url.indexOf('?') + 1)) }

function phantomEncrypt(obj) {
  const nonce = nacl.randomBytes(24)
  const data = nacl.box.after(new TextEncoder().encode(JSON.stringify(obj)), nonce, sharedFromPhantomSide)
  return { nonce: bs58.encode(nonce), data: bs58.encode(data) }
}

async function replyToConnect() {
  const url = lastOpened()
  const dappPub = paramsOf(url).get('dapp_encryption_public_key')
  sharedFromPhantomSide = nacl.box.before(bs58.decode(dappPub), phantomKp.secretKey)
  const { nonce, data } = phantomEncrypt({ public_key: WALLET, session: SESSION_TOKEN })
  const q = new URLSearchParams({
    phantom_encryption_public_key: bs58.encode(phantomKp.publicKey),
    nonce, data,
  })
  globalThis.__appUrlOpen({ url: `fontainor://onphantom/connect?${q}` })
}

function replyToMethod(method, obj) {
  const { nonce, data } = phantomEncrypt(obj)
  globalThis.__appUrlOpen({ url: `fontainor://onphantom/${method}?${new URLSearchParams({ nonce, data })}` })
}

function replyError(method, errorCode, errorMessage) {
  globalThis.__appUrlOpen({
    url: `fontainor://onphantom/${method}?${new URLSearchParams({ errorCode: String(errorCode), errorMessage })}`,
  })
}

const tick = () => new Promise((r) => realSetTimeout(r, 20))

// ---- 1. install + connect handshake -----------------------------------------
check('installNativePhantom returns true under native stub', installNativePhantom() === true)
const provider = globalThis.window.solana
check('provider installed on window.solana with shim markers',
  !!provider && provider.isPhantom === true && provider.isFontainorNative === true)

const p1 = provider.connect()
await tick()
check('connect opens phantom.app/ul/v1/connect deeplink', openedCount('connect') === 1)
await replyToConnect()
const { publicKey } = await p1
check('connect decrypts wallet pubkey from encrypted payload', publicKey.toString() === WALLET)
check('provider.publicKey reflects connected wallet', provider.publicKey?.toString() === WALLET)

// Warm reuse: second connect must NOT open a new deeplink.
const { publicKey: pk2 } = await provider.connect()
check('warm session reuses wallet without new deeplink', pk2.toString() === WALLET && openedCount('connect') === 1)

// ---- 2. signMessage happy path -----------------------------------------------
const msg = new TextEncoder().encode('fontainor-login-test')
const pSign = provider.signMessage(msg)
await tick()
check('signMessage opens signMessage deeplink using live session', openedCount('signMessage') === 1)
{
  // verify the request payload decrypts on the Phantom side and carries session
  const q = paramsOf(lastOpened())
  const dec = nacl.box.open.after(bs58.decode(q.get('payload')), bs58.decode(q.get('nonce')), sharedFromPhantomSide)
  const body = JSON.parse(new TextDecoder().decode(dec))
  check('signMessage payload encrypted with shared secret + session token',
    body.session === SESSION_TOKEN && body.message === bs58.encode(msg))
}
const FAKE_SIG = bs58.encode(nacl.randomBytes(64))
replyToMethod('signMessage', { signature: FAKE_SIG })
const sigRes = await pSign
check('signMessage resolves decrypted signature bytes', bs58.encode(sigRes.signature) === FAKE_SIG)

// ---- 3. double-tap supersede (F64) -------------------------------------------
let firstErr = null
const first = provider.signMessage(msg)
first.catch((e) => { firstErr = e }) // attach BEFORE supersede fires (unhandled-rejection guard)
await tick()
const second = provider.signMessage(msg)
await tick()
check('superseded waiter rejects immediately', firstErr !== null)
check('superseded rejection is USER-class (PhantomSupersededError), not session-class',
  firstErr instanceof PhantomSupersededError && firstErr instanceof PhantomUserError,
  `got ${firstErr?.constructor?.name}: ${firstErr?.message}`)
// The live (second) request must still complete on the SAME session — no
// clearSession ping-pong, no extra connect deeplink.
const connectsBefore = openedCount('connect')
replyToMethod('signMessage', { signature: FAKE_SIG })
const secondRes = await second
check('live request after double-tap still decrypts (session survived)',
  bs58.encode(secondRes.signature) === FAKE_SIG)
check('no reconnect was triggered by the superseded waiter', openedCount('connect') === connectsBefore)

// ---- 4. error code mapping -----------------------------------------------------
let declineErr = null
const pDecline = provider.signMessage(msg).catch((e) => { declineErr = e })
await tick()
replyError('signMessage', 4001, 'User rejected the request.')
await pDecline
check('errorCode 4001 maps to PhantomUserError (benign cancel)',
  declineErr instanceof PhantomUserError && !(declineErr instanceof PhantomSessionError))

// ---- 5. session-error self-heal -------------------------------------------------
// Non-4001 error -> PhantomSessionError -> withFreshSessionRetry clears the
// session, reconnects, retries ONCE.
const healed = provider.signMessage(msg)
await tick()
check('self-heal test opens signMessage first', lastOpened().includes('/signMessage?'))
replyError('signMessage', -32603, 'Session invalid.')
await tick()
check('session error triggers fresh connect deeplink', lastOpened().includes('/connect?'))
await replyToConnect() // phantom re-issues session over NEW shared secret
await tick()
check('retry re-opens signMessage after reconnect', lastOpened().includes('/signMessage?'))
replyToMethod('signMessage', { signature: FAKE_SIG })
const healedRes = await healed
check('self-heal retry resolves signature', bs58.encode(healedRes.signature) === FAKE_SIG)

// ---- 6. timeout closes the popover (F66) ---------------------------------------
const closesBefore = globalThis.__browserCloses
let timeoutErr = null
const pTimeout = provider.signMessage(msg).catch((e) => { timeoutErr = e })
await tick()
const live = fakeTimers.filter((t) => !t.cleared && t.ms === 180_000)
check('timeout timer armed at 180s', live.length >= 1)
live.forEach((t) => t.fn())
await pTimeout
check('timed-out request rejects with guidance message',
  timeoutErr instanceof Error && /did not respond/i.test(timeoutErr.message))
check('timeout closes the Phantom popover (Browser.close called)',
  globalThis.__browserCloses > closesBefore, `closes ${closesBefore} -> ${globalThis.__browserCloses}`)

rmSync(outDir, { recursive: true, force: true })
console.log(`\nphantom-deeplink: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
