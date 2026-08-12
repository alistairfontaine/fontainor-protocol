#!/usr/bin/env node
// Integration test for src/lib/nativeWallet.ts + src/lib/mwa.ts — the hybrid
// MWA/Phantom router installed as window.solana on native. Capacitor plugins
// stubbed via esbuild aliases; the MWA Java plugin is a swappable fake on
// globalThis.__mwaPlugin (rejections carry `.code` exactly like Capacitor's
// bridge). Covers:
//   - fresh connect prefers MWA, persists backend, exposes pubkey
//   - AUTH_INVALID on fresh authorize = decline -> MwaUserDeclinedError, and
//     NO Phantom deeplink fallback nag (F68; message intentionally has no
//     "declined/reject/cancel" words so the old regex cannot save it)
//   - stale-token self-heal: warm reconnect with revoked token retries ONCE
//     fresh and succeeds (F67)
//   - decline of the self-heal authorize -> MwaUserDeclinedError
//   - sign USER_DECLINED -> MwaUserDeclinedError; AUTH_INVALID mid-session ->
//     clear + reauthorize + retry once (existing withSessionRetry)
//   - WALLET_ERROR on fresh connect falls back to the Phantom deeplink
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
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

const outDir = mkdtempSync(join(root, 'tools', '.pdl-'))
process.on('exit', () => { try { rmSync(outDir, { recursive: true, force: true }) } catch {} })
const outFile = join(outDir, 'nativeWallet.js')
execSync(
  [
    'npx esbuild src/lib/nativeWallet.ts src/lib/mwa.ts',
    '--bundle --format=esm --platform=neutral --splitting',
    '--external:tweetnacl --external:bs58',
    `--outdir=${outDir} --out-extension:.js=.js`,
    '--alias:@capacitor/core=./tools/stubs/cap-core.mjs',
    '--alias:@capacitor/app=./tools/stubs/cap-app.mjs',
    '--alias:@capacitor/browser=./tools/stubs/cap-browser.mjs',
    '--alias:@capacitor/preferences=./tools/stubs/cap-preferences.mjs',
  ].join(' '),
  { cwd: root, stdio: 'pipe' },
)

globalThis.__openedUrls = []
globalThis.__browserCloses = 0
globalThis.window = globalThis

// Node lacks atob/btoa on globalThis in some versions; ensure present.
if (!globalThis.atob) globalThis.atob = (b) => Buffer.from(b, 'base64').toString('binary')
if (!globalThis.btoa) globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64')

const rejectWith = (code, message) => { const e = new Error(message); e.code = code; return Promise.reject(e) }
const walletKp = nacl.sign.keyPair()
const ADDR_B58 = bs58.encode(walletKp.publicKey)
const ADDR_B64 = Buffer.from(walletKp.publicKey).toString('base64')
const tokenGen = (n) => `authtok_${n}`

const mod = await import(pathToFileURL(outFile).href)
const { installNativeWallet } = mod
const mwaMod = await import(pathToFileURL(join(outDir, 'mwa.js')).href).catch(() => mod)
const MwaUserDeclinedError = mod.MwaUserDeclinedError ?? mwaMod.MwaUserDeclinedError

// ---- scenario 1: fresh connect prefers MWA ----------------------------------
let connectCalls = []
globalThis.__mwaPlugin = {
  isWalletAvailable: () => Promise.resolve({ available: true }),
  connect: (opts) => {
    connectCalls.push(opts.authToken)
    return Promise.resolve({ publicKey: ADDR_B64, authToken: tokenGen(connectCalls.length), accountLabel: 'Main', walletUriBase: '' })
  },
  deauthorize: () => Promise.resolve(),
}
check('installNativeWallet returns true under native stub', installNativeWallet() === true)
const provider = globalThis.window.solana
const c1 = await provider.connect()
check('fresh connect uses MWA and returns wallet pubkey', c1.publicKey.toString() === ADDR_B58)
check('provider.publicKey reflects MWA address', provider.publicKey?.toString() === ADDR_B58)
const prefs = globalThis.__prefStore
check('backend persisted as mwa', prefs.get('fontainor_wallet_backend_v1') === 'mwa')

// ---- scenario 2: sign USER_DECLINED maps to MwaUserDeclinedError -------------
globalThis.__mwaPlugin.signMessage = () => rejectWith('USER_DECLINED', 'sign_messages: not signed')
let signErr = null
await provider.signMessage(new TextEncoder().encode('hi')).catch((e) => { signErr = e })
check('sign USER_DECLINED -> MwaUserDeclinedError', signErr instanceof MwaUserDeclinedError,
  `got ${signErr?.constructor?.name}`)

// ---- scenario 3: sign AUTH_INVALID self-heals via reauthorize + retry --------
let signAttempts = 0
globalThis.__mwaPlugin.signMessage = () => {
  signAttempts++
  if (signAttempts === 1) return rejectWith('AUTH_INVALID', 'authorization failed: -1')
  return Promise.resolve({ signature: Buffer.from(nacl.randomBytes(64)).toString('base64') })
}
const healSig = await provider.signMessage(new TextEncoder().encode('hi'))
check('sign AUTH_INVALID heals: reauthorize + retry succeeds',
  healSig.signature.length === 64 && signAttempts === 2, `attempts=${signAttempts}`)

// ---- scenario 4: stale token at CONNECT self-heals (F67) ----------------------
// Simulate app restart: warm mwa backend + stored session with a revoked token.
connectCalls = []
let staleFirst = true
globalThis.__mwaPlugin.connect = (opts) => {
  connectCalls.push(opts.authToken)
  if (staleFirst && opts.authToken) { staleFirst = false; return rejectWith('AUTH_INVALID', 'authorization failed: -1') }
  return Promise.resolve({ publicKey: ADDR_B64, authToken: tokenGen(100 + connectCalls.length), accountLabel: 'Main', walletUriBase: '' })
}
const c2 = await provider.connect()
check('revoked-token reconnect self-heals with one fresh authorize (F67)',
  c2.publicKey.toString() === ADDR_B58 && connectCalls.length === 2 && connectCalls[0] !== undefined && connectCalls[1] === undefined,
  `calls=${JSON.stringify(connectCalls)}`)

// ---- scenario 5: decline on fresh authorize -> MwaUserDeclinedError, no nag (F68)
// Wipe session so connect() takes the fresh-connect branch. Message contains
// NO decline keywords — the old regex-based router would fall through to the
// Phantom deeplink (a second wallet sheet = the nag we're proving gone).
await provider.disconnect()
globalThis.__mwaPlugin.connect = () => rejectWith('AUTH_INVALID', 'authorization failed: -1')
const deeplinksBefore = globalThis.__openedUrls.length
let declineErr = null
// Race with a short timeout: the pre-fix bug FALLS THROUGH to an unanswered
// Phantom deeplink (the connect promise then hangs on the 180s nag sheet).
// Racing turns that regression into a fast FAIL instead of a CI hang.
await Promise.race([
  provider.connect().catch((e) => { declineErr = e }),
  new Promise((r) => setTimeout(r, 4000)),
])
check('fresh-authorize decline -> MwaUserDeclinedError (code-based, F68)',
  declineErr instanceof MwaUserDeclinedError, `got ${declineErr?.constructor?.name}: ${declineErr?.message}`)
check('decline does NOT fall back to Phantom deeplink (no second sheet)',
  globalThis.__openedUrls.length === deeplinksBefore,
  `opened ${globalThis.__openedUrls.slice(deeplinksBefore).join(', ')}`)

// ---- scenario 6: WALLET_ERROR falls back to the Phantom deeplink --------------
globalThis.__mwaPlugin.connect = () => rejectWith('WALLET_ERROR', 'association timed out')
const pFallback = provider.connect()
pFallback.catch(() => {})
await new Promise((r) => setTimeout(r, 30))
const opened = globalThis.__openedUrls.slice(deeplinksBefore)
check('WALLET_ERROR falls back to Phantom deeplink connect',
  opened.some((u) => u.startsWith('https://phantom.app/ul/v1/connect?')), `opened=${opened.join(', ')}`)
// Complete the handshake through the fake Phantom side so backend persists.
{
  const url = opened.find((u) => u.startsWith('https://phantom.app/ul/v1/connect?'))
  const dappPub = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('dapp_encryption_public_key')
  const phantomKp = nacl.box.keyPair()
  const shared = nacl.box.before(bs58.decode(dappPub), phantomKp.secretKey)
  const nonce = nacl.randomBytes(24)
  const data = nacl.box.after(new TextEncoder().encode(JSON.stringify({ public_key: ADDR_B58, session: 'sess_x' })), nonce, shared)
  const q = new URLSearchParams({ phantom_encryption_public_key: bs58.encode(phantomKp.publicKey), nonce: bs58.encode(nonce), data: bs58.encode(data) })
  globalThis.__appUrlOpen({ url: `fontainor://onphantom/connect?${q}` })
}
const cFallback = await pFallback
check('fallback connect resolves via Phantom backend', cFallback.publicKey.toString() === ADDR_B58)
check('backend persisted as phantom after fallback', prefs.get('fontainor_wallet_backend_v1') === 'phantom')

console.log(`\nwallet-router: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
