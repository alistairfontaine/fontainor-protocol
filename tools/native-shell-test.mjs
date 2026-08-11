// native-shell-test.mjs — runs the PRODUCTION bundle as the Android app sees it.
//
// Why this exists: everything native (API base resolution, the Phantom deeplink
// provider installed as window.solana, session persistence) only executes when
// Capacitor reports a native platform, so plain browser tests never touched it.
// An APK could therefore ship with all live data dead and every suite stay
// green — which is exactly the class of bug found in this audit.
//
// How it fakes the shell: @capacitor/core decides the platform by looking for
// `window.androidBridge`. Define it before the bundle loads and the same code
// path the APK runs is active. Plugin calls then travel over Capacitor's real
// bridge protocol (androidBridge.postMessage -> window.Capacitor.fromNative),
// so this file implements a small fake "native side" for Preferences, Browser
// and App — including the ability to deliver a `fontainor://onphantom/...`
// redirect, i.e. a simulated Phantom reply.
//
// Run: npm run build && node tools/native-shell-test.mjs   (exit 0 = pass)
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const PORT = 4181
const BASE = `http://localhost:${PORT}`
const DEPLOYED_ORIGIN = 'https://fontainor-protocol.vercel.app'

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

// ---------- the fake native side, injected before any app script ----------
// Mirrors Capacitor's bridge: the web layer posts {callbackId, pluginId,
// methodName, options} and the native layer answers via Capacitor.fromNative.
// The JAVA side of the bridge, faked. Everything above it is Capacitor's own
// code: android's real native-bridge.js (loaded from node_modules below) runs
// unmodified, so plugin calls take exactly the path they take in the APK.
const NATIVE_SHIM = `
window.__nativeLog = [];
window.__prefs = {};
window.__listeners = {};   // "Plugin.eventName" -> callbackId
window.__opened = [];

// Android's Java bridge advertises which plugins exist; without PluginHeaders
// Capacitor answers '"App" plugin is not implemented on android'.
const PLUGIN_METHODS = {
  App: ['addListener', 'removeAllListeners', 'getState', 'getLaunchUrl', 'exitApp', 'minimizeApp'],
  Browser: ['open', 'close', 'addListener', 'removeAllListeners'],
  Preferences: ['get', 'set', 'remove', 'keys', 'clear', 'migrate'],
  Mwa: ['isWalletAvailable', 'connect', 'signMessage', 'signAndSendTransaction', 'deauthorize'],
  SplashScreen: ['show', 'hide'],
  StatusBar: ['setStyle', 'setBackgroundColor', 'setOverlaysWebView', 'show', 'hide', 'getInfo'],
  Haptics: ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd'],
  Filesystem: ['readFile', 'writeFile', 'appendFile', 'deleteFile', 'mkdir', 'rmdir', 'readdir', 'getUri', 'stat', 'rename', 'copy', 'requestPermissions', 'checkPermissions', 'addListener', 'removeAllListeners'],
  MediaSession: ['setMetadata', 'setPlaybackState', 'setPositionState', 'setActionHandler', 'addListener', 'removeAllListeners'],
};
window.Capacitor = {
  PluginHeaders: Object.keys(PLUGIN_METHODS).map((name) => ({
    name,
    methods: PLUGIN_METHODS[name].map((m) => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })),
  })),
  getServerUrl: () => 'https://localhost',
};

// The Java interface the WebView injects. Capacitor's bridge posts JSON here
// and expects answers back through window.Capacitor.fromNative.
window.androidBridge = {
  postMessage(raw) {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const { callbackId, pluginId, methodName, options } = msg;
    window.__nativeLog.push(pluginId + '.' + methodName);
    const reply = (data) => setTimeout(() => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: true, data: data === undefined ? {} : data }), 0);

    if (pluginId === 'Preferences' && methodName === 'get') return reply({ value: window.__prefs[options.key] === undefined ? null : window.__prefs[options.key] });
    if (pluginId === 'Preferences' && methodName === 'set') { window.__prefs[options.key] = options.value; return reply({}); }
    if (pluginId === 'Preferences' && methodName === 'remove') { delete window.__prefs[options.key]; return reply({}); }
    if (pluginId === 'Preferences' && methodName === 'keys') return reply({ keys: Object.keys(window.__prefs) });
    // No MWA wallet installed here, so these checks exercise the Phantom
    // deeplink fallback path.
    if (pluginId === 'Mwa' && methodName === 'isWalletAvailable') return reply({ available: !!window.__mwaAvailable });
    if (pluginId === 'Browser' && methodName === 'open') { window.__opened.push(options.url); return reply({}); }
    // addListener resolves in JS (Capacitor does not wait for the native side),
    // so answering it would deliver a bogus EVENT to the app's handler — which
    // made the back-button handler fire App.exitApp() during boot. Record only.
    if (methodName === 'addListener') { window.__listeners[pluginId + '.' + options.eventName] = callbackId; return; }
    // Everything else (StatusBar, SplashScreen, Haptics, MediaSession, ...) no-ops.
    return reply({});
  },
};

// Deliver an appUrlOpen event the way the OS does after Phantom bounces back.
window.__deliverUrl = (url) => {
  const cb = window.__listeners['App.appUrlOpen'];
  if (!cb) return false;
  window.Capacitor.fromNative({ callbackId: cb, pluginId: 'App', methodName: 'addListener', success: true, data: { url } });
  return true;
};
`

// Capacitor's own Android bridge, byte-for-byte what the APK's WebView loads.
const REAL_NATIVE_BRIDGE = readFileSync('node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js', 'utf8')

// ---------- boot vite preview ----------
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite preview did not start in 30s')), 30000)
  const probe = async () => {
    try {
      const res = await fetch(BASE + '/')
      if (res.ok) {
        clearTimeout(t)
        resolve()
        return
      }
    } catch {
      /* not up yet */
    }
    setTimeout(probe, 300)
  }
  probe()
})

const browser = await chromium.launch()
let apiCalls = []
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  })
  await ctx.addInitScript(NATIVE_SHIM)
  await ctx.addInitScript(REAL_NATIVE_BRIDGE)

  // Record (and stub) every request to the deployed origin: the point is to see
  // WHERE the native build sends its API traffic, without touching production.
  await ctx.route('**://fontainor-protocol.vercel.app/**', async (route) => {
    const url = route.request().url()
    apiCalls.push(url)
    const path = new URL(url).pathname
    if (path === '/registry') {
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() },
        body: JSON.stringify([
          {
            id: 'FONT-NATIVE01',
            title: 'Native Shell Probe',
            artist: 'Test Artist',
            type: 'single',
            audioUrl: `${BASE}/audio/aurora-drift.mp3`,
            coverUrl: `${BASE}/covers/aurora-drift.svg`,
          },
        ]),
      })
    }
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() },
      body: '{}',
    })
  })

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  console.log('native shell boot')
  await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })

  // ---------- 1. the shell is actually detected as native ----------
  const platform = await page.evaluate(() => {
    const c = window.Capacitor
    return { platform: c?.getPlatform?.() ?? 'unknown', native: c?.isNativePlatform?.() ?? false }
  })
  check('Capacitor reports the android platform (shell emulated)', platform.platform === 'android', JSON.stringify(platform))
  check('Capacitor.isNativePlatform() is true', platform.native === true)

  // ---------- 2. API traffic goes to the deployed origin, not the device ----------
  const registryCalls = apiCalls.filter((u) => u.endsWith('/registry'))
  check('native build fetched /registry from the DEPLOYED origin', registryCalls.length > 0, JSON.stringify(apiCalls.slice(0, 5)))
  const localRegistry = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /^https?:\/\/localhost.*\/registry$/.test(e.name)).length)
  check('native build made NO same-origin (device) /registry call', localRegistry === 0, String(localRegistry))

  // The live catalog must actually render — the cycle-4 failure mode was a
  // silent fall back to the bundled demo snapshot.
  const liveTitle = page.locator('text=Native Shell Probe')
  await liveTitle.first().waitFor({ timeout: 8000 }).catch(() => {})
  check('live registry data rendered in the native shell', (await liveTitle.count()) > 0)

  // ---------- 3. the deeplink provider is installed as window.solana ----------
  const provider = await page.evaluate(() => {
    const s = window.solana
    return {
      present: !!s,
      isPhantom: !!s?.isPhantom,
      native: !!s?.isFontainorNative,
      hasConnect: typeof s?.connect === 'function',
      hasSignMessage: typeof s?.signMessage === 'function',
      hasSignAndSend: typeof s?.signAndSendTransaction === 'function',
      publicKey: s?.publicKey ?? null,
    }
  })
  check('window.solana shim installed in the native shell', provider.present && provider.isPhantom && provider.native, JSON.stringify(provider))
  check('shim exposes connect/signMessage/signAndSendTransaction', provider.hasConnect && provider.hasSignMessage && provider.hasSignAndSend)
  check('no wallet is connected before the user acts', provider.publicKey === null)
  check('header shows a real Connect button (not the web "Open in Phantom" fallback)', (await page.getByRole('button', { name: /^Connect/ }).count()) > 0)

  // ---------- 4. connect() opens a well-formed Phantom deeplink ----------
  await page.evaluate(() => {
    window.__connectPromise = window.solana.connect().then((r) => ({ ok: true, key: r.publicKey.toString() }), (e) => ({ ok: false, err: String(e?.message || e) }))
  })
  await page.waitForFunction(() => (window.__opened || []).length > 0, null, { timeout: 8000 })
  const opened = await page.evaluate(() => window.__opened[0])
  const durl = new URL(opened)
  check('connect opened phantom.app/ul/v1/connect', durl.origin + durl.pathname === 'https://phantom.app/ul/v1/connect', opened.slice(0, 80))
  check('deeplink carries a dapp x25519 public key', (durl.searchParams.get('dapp_encryption_public_key') ?? '').length >= 32)
  check('deeplink targets mainnet-beta', durl.searchParams.get('cluster') === 'mainnet-beta')
  check('deeplink redirects back to the fontainor:// scheme', durl.searchParams.get('redirect_link') === 'fontainor://onphantom/connect')
  check('deeplink app_url is the deployed site (not localhost)', durl.searchParams.get('app_url') === DEPLOYED_ORIGIN, String(durl.searchParams.get('app_url')))

  // ---------- 5. a user rejection reads as a cancel, not a protocol failure ----------
  await page.evaluate(() => window.__deliverUrl('fontainor://onphantom/connect?errorCode=4001&errorMessage=User%20rejected%20the%20request.'))
  const rejected = await page.evaluate(() => window.__connectPromise)
  check('Phantom error 4001 surfaces as a user rejection', rejected.ok === false && /rejected/i.test(rejected.err), JSON.stringify(rejected))

  // ---------- 6. REGRESSION: double-tap must not hang the first request ----------
  // Two connect() calls in a row: the first used to be orphaned until a 180s
  // timeout, freezing the button's spinner with no way to retry.
  await page.evaluate(() => {
    window.__first = window.solana.connect().then(() => ({ settled: 'resolved' }), (e) => ({ settled: 'rejected', err: String(e?.message || e) }))
    window.__second = window.solana.connect().then(() => ({ settled: 'resolved' }), (e) => ({ settled: 'rejected', err: String(e?.message || e) }))
  })
  const first = await Promise.race([
    page.evaluate(() => window.__first),
    new Promise((r) => setTimeout(() => r({ settled: 'hung' }), 6000)),
  ])
  check('double-tap: the superseded connect settles fast instead of hanging', first.settled === 'rejected', JSON.stringify(first))
  check('superseded connect explains itself', /superseded/i.test(first.err ?? ''), JSON.stringify(first))
  // The newest request is still live and still wins.
  const delivered = await page.evaluate(() => window.__deliverUrl('fontainor://onphantom/connect?errorCode=4001&errorMessage=User%20rejected%20the%20request.'))
  check('the newest request is still routable after the older one was dropped', delivered === true)
  const second = await page.evaluate(() => window.__second)
  check('the newest request receives the redirect', second.settled === 'rejected' && /rejected/i.test(second.err), JSON.stringify(second))

  // ---------- 7. session material is persisted through the native store ----------
  const prefs = await page.evaluate(() => Object.keys(window.__prefs))
  check('dapp keypair persisted via the Preferences plugin (warm reconnects)', prefs.includes('fontainor_phantom_session_v1'), JSON.stringify(prefs))
  const storedKeys = await page.evaluate(() => Object.keys(JSON.parse(window.__prefs['fontainor_phantom_session_v1'] ?? '{}')))
  check('persisted session has the dapp keypair but no wallet yet', storedKeys.includes('dappPub') && storedKeys.includes('dappSec') && !storedKeys.includes('walletPubkey'), JSON.stringify(storedKeys))

  // ---------- 8. no crashes anywhere in the native path ----------
  const realErrors = errors.filter((e) => !/Failed to load resource|net::ERR|favicon/i.test(e))
  check('no uncaught errors in the native shell', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  preview.kill()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
