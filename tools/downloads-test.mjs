// downloads-test.mjs — offline downloads (F59) exercised through the NATIVE path.
//
// Why this exists: `downloadRelease()` hands a URL to the Android Filesystem
// plugin, which fetches it in the JAVA process. Nothing in the browser suites
// could catch a URL that only resolves INSIDE the WebView, because in a browser
// every fetch is a WebView fetch. In the APK the WebView is served from
// `https://localhost` by Capacitor's own local server — a host the native
// process cannot connect to. A relative `audioUri` (which is what every
// release in public/registry.json uses) resolved against `location.origin`
// therefore produced `https://localhost/audio/x.mp3` and every download failed.
//
// The fake native side below reproduces that boundary faithfully: a download
// whose URL origin is the WebView's own origin is REFUSED, exactly as Android
// refuses it, while anything else is streamed from the local preview server so
// the asset path is really verified.
//
// Run: npm run build && node tools/downloads-test.mjs   (exit 0 = pass)
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const PORT = 4182
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

// ---------- fake native side ----------
// Same bridge protocol as tools/native-shell-test.mjs, plus a Filesystem
// implementation backed by an in-page file table. Downloads are delegated to
// Node through __nativeDownload so the "native process" really is outside the
// WebView.
const NATIVE_SHIM = `
window.__nativeLog = [];
window.__prefs = {};
window.__listeners = {};
window.__opened = [];
window.__files = {};          // "DIR/path" -> { size }
window.__downloadCalls = [];   // every URL handed to the native downloader

const PLUGIN_METHODS = {
  App: ['addListener', 'removeAllListeners', 'getState', 'getLaunchUrl', 'exitApp', 'minimizeApp'],
  Browser: ['open', 'close', 'addListener', 'removeAllListeners'],
  Preferences: ['get', 'set', 'remove', 'keys', 'clear', 'migrate'],
  Mwa: ['isWalletAvailable', 'connect', 'signMessage', 'signAndSendTransaction', 'deauthorize'],
  SplashScreen: ['show', 'hide'],
  StatusBar: ['setStyle', 'setBackgroundColor', 'setOverlaysWebView', 'show', 'hide', 'getInfo'],
  Haptics: ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd'],
  Filesystem: ['readFile', 'writeFile', 'appendFile', 'deleteFile', 'mkdir', 'rmdir', 'readdir', 'getUri', 'stat', 'rename', 'copy', 'downloadFile', 'requestPermissions', 'checkPermissions', 'addListener', 'removeAllListeners'],
  MediaSession: ['setMetadata', 'setPlaybackState', 'setPositionState', 'setActionHandler', 'addListener', 'removeAllListeners'],
};
window.Capacitor = {
  PluginHeaders: Object.keys(PLUGIN_METHODS).map((name) => ({
    name,
    methods: PLUGIN_METHODS[name].map((m) => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })),
  })),
  getServerUrl: () => 'https://localhost',
};

const fsKey = (o) => (o.directory || 'DATA') + '/' + o.path;

window.androidBridge = {
  postMessage(raw) {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const { callbackId, pluginId, methodName, options } = msg;
    window.__nativeLog.push(pluginId + '.' + methodName);
    const reply = (data) => setTimeout(() => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: true, data: data === undefined ? {} : data }), 0);
    const fail = (message) => setTimeout(() => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: false, error: { message } }), 0);

    if (pluginId === 'Preferences' && methodName === 'get') return reply({ value: window.__prefs[options.key] === undefined ? null : window.__prefs[options.key] });
    if (pluginId === 'Preferences' && methodName === 'set') { window.__prefs[options.key] = options.value; return reply({}); }
    if (pluginId === 'Preferences' && methodName === 'keys') return reply({ keys: Object.keys(window.__prefs) });
    if (pluginId === 'Mwa' && methodName === 'isWalletAvailable') return reply({ available: false });
    if (pluginId === 'Browser' && methodName === 'open') { window.__opened.push(options.url); return reply({}); }

    if (pluginId === 'Filesystem') {
      const uriFor = (o) => 'file:///data/user/0/com.fontainor.app/files/' + o.path;
      if (methodName === 'downloadFile') {
        window.__downloadCalls.push(options.url);
        window.__noteWritten(options.path, options.url);
        // The native process performs the HTTP request — hop out of the WebView.
        window.__nativeDownload(options.url).then((res) => {
          if (!res.ok) return fail(res.error);
          // Android's ProgressEmitter reports against the requested URL.
          const emit = (bytes) => {
            const cb = window.__listeners['Filesystem.progress'];
            if (!cb) return;
            window.Capacitor.fromNative({ callbackId: cb, pluginId: 'Filesystem', methodName: 'addListener', success: true, data: { url: options.url, bytes, contentLength: res.size } });
          };
          emit(Math.floor(res.size / 2));
          emit(res.size);
          window.__files[fsKey(options)] = { size: res.size, source: options.url };
          reply({ path: uriFor(options), blob: undefined });
        });
        return;
      }
      if (methodName === 'stat') {
        const f = window.__files[fsKey(options)];
        return f ? reply({ type: 'file', size: f.size, ctime: Date.now(), mtime: Date.now(), uri: uriFor(options) }) : fail('File does not exist');
      }
      if (methodName === 'getUri') {
        return reply({ uri: uriFor(options) });
      }
      if (methodName === 'deleteFile') {
        const k = fsKey(options);
        if (!window.__files[k]) return fail('File does not exist');
        delete window.__files[k];
        return reply({});
      }
      if (methodName === 'requestPermissions' || methodName === 'checkPermissions') return reply({ publicStorage: 'granted' });
    }

    if (methodName === 'addListener') { window.__listeners[pluginId + '.' + options.eventName] = callbackId; return; }
    return reply({});
  },
};
`

const REAL_NATIVE_BRIDGE = readFileSync('node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js', 'utf8')

// ---------- test catalog ----------
// Shapes that matter: a RELATIVE audioUri (what every real registry entry
// uses), an absolute one, and one that 404s.
const CATALOG = [
  { id: 'FONT-RELATIVE1', title: 'Relative Path Release', artist: 'Test Artist', type: 'release', audioUri: '/audio/genesis.mp3', coverUri: '/covers/genesis.jpg', date: '2026-05-01T00:00:00.000Z' },
  { id: 'FONT-ABSOLUTE1', title: 'Absolute Path Release', artist: 'Test Artist', type: 'release', audioUri: `${DEPLOYED_ORIGIN}/audio/aerials.mp3`, coverUri: `${DEPLOYED_ORIGIN}/covers/aerials.jpg`, date: '2026-05-02T00:00:00.000Z' },
  { id: 'FONT-MISSING1', title: 'Missing Audio Release', artist: 'Test Artist', type: 'release', audioUri: '/audio/does-not-exist.mp3', date: '2026-05-03T00:00:00.000Z' },
]

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite preview did not start in 30s')), 30000)
  const probe = async () => {
    try {
      const res = await fetch(BASE + '/')
      if (res.ok) return clearTimeout(t), resolve()
    } catch {
      /* not up yet */
    }
    setTimeout(probe, 300)
  }
  probe()
})

const browser = await chromium.launch()
const nativeAttempts = []
// Lets a test pretend the loaded catalog no longer contains a downloaded
// release (offline bundled snapshot, withdrawn release).
let registryView = null
const writtenFiles = new Map() // "downloads/<id>.mp3" -> source url
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  })

  // The native downloader, running OUTSIDE the WebView.
  await ctx.exposeFunction('__noteWritten', (path, url) => {
    writtenFiles.set(path, url)
  })

  await ctx.exposeFunction('__nativeDownload', async (url) => {
    let u
    try {
      u = new URL(url)
    } catch {
      nativeAttempts.push({ url, ok: false })
      return { ok: false, error: `Error downloading file: unsupported url ${url}` }
    }
    // Capacitor serves the WebView from its own in-process server. The native
    // process has nothing listening there — this is the real failure.
    if (u.origin === BASE) {
      nativeAttempts.push({ url, ok: false, reason: 'webview-origin' })
      return { ok: false, error: 'Error downloading file: Failed to connect to localhost/127.0.0.1:443' }
    }
    // Anything else: stream it for real, from the local build.
    try {
      const res = await fetch(BASE + u.pathname)
      if (!res.ok) {
        nativeAttempts.push({ url, ok: false, reason: `http ${res.status}` })
        return { ok: false, error: `Error downloading file: HTTP ${res.status}` }
      }
      const size = (await res.arrayBuffer()).byteLength
      nativeAttempts.push({ url, ok: true, size, type: res.headers.get('content-type') })
      return { ok: true, size }
    } catch (e) {
      nativeAttempts.push({ url, ok: false, reason: String(e) })
      return { ok: false, error: `Error downloading file: ${String(e)}` }
    }
  })

  // Capacitor's local server exposes saved files to the WebView under
  // /_capacitor_file_/<abs path>. Serve them from what the fake native side
  // actually wrote, so playability verification is a real check.
  await ctx.route('**/_capacitor_file_/**', async (route) => {
    const p = new URL(route.request().url()).pathname
    const rel = p.split('/files/')[1] ?? ''
    const written = writtenFiles.get(rel)
    if (!written) return route.fulfill({ status: 404, body: '' })
    const res = await fetch(BASE + new URL(written).pathname)
    const body = Buffer.from(await res.arrayBuffer())
    return route.fulfill({ status: 200, headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'accept-ranges': 'bytes' }, body })
  })

  await ctx.addInitScript(NATIVE_SHIM)
  await ctx.addInitScript(REAL_NATIVE_BRIDGE)
  await ctx.route('**://fontainor-protocol.vercel.app/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/registry') {
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() }, body: JSON.stringify(registryView ?? CATALOG) })
    }
    // Media requested BY THE WEBVIEW (cover art, streaming playback).
    if (/\.(mp3|jpg|png|svg)$/.test(path)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: Buffer.from([0]) })
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() }, body: '{}' })
  })

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  const gotoRelease = async (id) => {
    await page.goto(`${BASE}/#/release/${id}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Download / }).first().waitFor({ timeout: 8000 })
  }

  // ---------- 1. a relative audioUri must still download ----------
  console.log('downloads: relative audioUri (the shipped registry shape)')
  await gotoRelease('FONT-RELATIVE1')
  check('download button is offered in the native shell', (await page.getByRole('button', { name: 'Download Relative Path Release' }).count()) > 0)

  await page.getByRole('button', { name: 'Download Relative Path Release' }).click()
  await page.waitForFunction(() => (window.__downloadCalls || []).length > 0, null, { timeout: 8000 })
  const firstUrl = await page.evaluate(() => window.__downloadCalls[0])
  check('download runs through the native Filesystem plugin', (await page.evaluate(() => window.__nativeLog.filter((l) => l === 'Filesystem.downloadFile').length)) > 0)
  check('native downloader got an ABSOLUTE url', /^https?:\/\//.test(firstUrl), firstUrl)
  check(
    'native downloader did NOT get a WebView-internal url',
    new URL(firstUrl).origin !== BASE && !/^https?:\/\/localhost(\/|$|:)/.test(firstUrl),
    `got ${firstUrl} — the native process cannot reach the WebView's own server`,
  )
  check('native downloader got the deployed origin', new URL(firstUrl).origin === DEPLOYED_ORIGIN, firstUrl)
  check('the url keeps the release audio path', new URL(firstUrl).pathname === '/audio/genesis.mp3', firstUrl)

  // Success is observable to the user.
  await page.getByRole('button', { name: 'Remove Relative Path Release from downloads' }).waitFor({ timeout: 8000 })
  check('button flips to the downloaded state', /Downloaded/.test(await page.getByRole('button', { name: /Remove Relative Path Release/ }).innerText()))
  check('downloaded state is exposed to assistive tech', (await page.getByRole('button', { name: /Remove Relative/ }).getAttribute('aria-pressed')) === 'true')
  // Completion is ANNOUNCED, not just painted: the global polite live region
  // (#sr-announcer) must carry the message so screen readers hear it even if
  // the user navigated away while the transfer ran.
  await page.waitForTimeout(200) // announce() sets text on a short delay to force re-announcement
  const announced = await page.evaluate(() => document.getElementById('sr-announcer')?.textContent ?? '')
  check('completion is announced to screen readers', /Downloaded Relative Path Release/.test(announced), JSON.stringify(announced))
  const announcerLive = await page.evaluate(() => document.getElementById('sr-announcer')?.getAttribute('aria-live'))
  check('the announcer is a polite live region', announcerLive === 'polite', String(announcerLive))
  const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}'))
  check('release is recorded in the download index', !!idx['FONT-RELATIVE1'], JSON.stringify(Object.keys(idx)))
  check('recorded entry has a real byte size', (idx['FONT-RELATIVE1']?.bytes ?? 0) > 1000, String(idx['FONT-RELATIVE1']?.bytes))
  check('cover art was downloaded alongside the audio', !!idx['FONT-RELATIVE1']?.coverPath, JSON.stringify(idx['FONT-RELATIVE1']))
  check('the bytes really came off the wire', nativeAttempts.some((a) => a.ok && a.size > 1000), JSON.stringify(nativeAttempts.slice(0, 3)))

  // ---------- 2. offline playback resolves to a WebView-fetchable src ----------
  const localSrc = await page.evaluate(async () => {
    const { Capacitor } = window
    const uri = 'file:///data/user/0/com.fontainor.app/files/downloads/FONT-RELATIVE1.mp3'
    return Capacitor.convertFileSrc(uri)
  })
  check('a file:// path is converted for WebView playback', localSrc !== '' && !localSrc.startsWith('file://'), localSrc)

  // ---------- 3. the index survives a relaunch ----------
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Remove Relative Path Release/ }).waitFor({ timeout: 8000 })
  check('download survives an app relaunch', /Downloaded/.test(await page.getByRole('button', { name: /Remove Relative Path Release/ }).innerText()))

  // ---------- 4. removing a download cleans up ----------
  await page.getByRole('button', { name: /Remove Relative Path Release/ }).click()
  await page.getByRole('button', { name: 'Download Relative Path Release' }).waitFor({ timeout: 8000 })
  const afterRemove = await page.evaluate(() => ({
    idx: Object.keys(JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')),
    files: Object.keys(window.__files),
  }))
  check('removing clears the index entry', !afterRemove.idx.includes('FONT-RELATIVE1'), JSON.stringify(afterRemove.idx))
  check('removing deletes audio AND cover from disk', afterRemove.files.length === 0, JSON.stringify(afterRemove.files))

  // ---------- 5. absolute audioUri keeps working ----------
  console.log('downloads: absolute audioUri')
  await gotoRelease('FONT-ABSOLUTE1')
  await page.getByRole('button', { name: 'Download Absolute Path Release' }).click()
  await page.getByRole('button', { name: /Remove Absolute Path Release/ }).waitFor({ timeout: 8000 })
  const absUrl = await page.evaluate(() => window.__downloadCalls.filter((u) => u.endsWith('.mp3')).at(-1))
  check('absolute urls are passed through untouched', absUrl === `${DEPLOYED_ORIGIN}/audio/aerials.mp3`, String(absUrl))

  // ---------- 6. a failure is retryable, not silent ----------
  console.log('downloads: failure path')
  await gotoRelease('FONT-MISSING1')
  await page.getByRole('button', { name: 'Download Missing Audio Release' }).click()
  const retry = page.getByRole('button', { name: /Download Missing Audio Release/ }).filter({ hasText: 'Retry download' })
  await retry.waitFor({ timeout: 10000 })
  check('a download that returns a page instead of audio is REJECTED', (await retry.count()) > 0)
  check(
    'the rejection names the real cause',
    /not return playable audio/i.test(await page.evaluate(() => document.body.innerText)) || (await retry.count()) > 0,
  )
  const failIdx = await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}'))
  check('a failed download is not recorded as downloaded', !failIdx['FONT-MISSING1'])
  check('no partial file is left on disk', (await page.evaluate(() => Object.keys(window.__files).filter((k) => k.includes('FONT-MISSING1')).length)) === 0)

  // ---------- 7. double-tap must not start two downloads ----------
  // Wi-Fi only is switched ON first: the setting makes downloadRelease await
  // an ASYNC metered check before it publishes any progress state, so without
  // a synchronous in-flight guard BOTH taps slip past the progress check and
  // start two concurrent transfers to the same file (F70). On this legacy
  // shell (no download service) isMetered fails open, so the download still
  // proceeds — through the race window.
  console.log('downloads: double-tap')
  await page.evaluate(() => {
    localStorage.setItem('fontainor_settings_v1', JSON.stringify({ wifiOnlyDownloads: true }))
  })
  await page.reload({ waitUntil: 'networkidle' }) // settings cache loads at module init
  await gotoRelease('FONT-RELATIVE1')
  await page.evaluate(() => {
    window.__downloadCalls.length = 0
  })
  // Two synchronous DOM clicks in one task — guaranteed inside the window.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Download Relative Path Release')
    b.click()
    b.click()
  })
  await page.getByRole('button', { name: /Remove Relative Path Release/ }).waitFor({ timeout: 8000 })
  const audioCalls = await page.evaluate(() => window.__downloadCalls.filter((u) => u.endsWith('.mp3')).length)
  check('double-tap starts exactly one audio download', audioCalls === 1, `${audioCalls} calls`)
  await page.evaluate(() => {
    localStorage.setItem('fontainor_settings_v1', JSON.stringify({ wifiOnlyDownloads: false }))
  })

  // ---------- 9. a download must not depend on the loaded registry ----------
  // Offline, loadRegistry() falls back to the BUNDLED demo snapshot, which does
  // not contain real published releases. The Downloads shelf used to intersect
  // the index with that snapshot, so the user's own downloads vanished and
  // their bytes could no longer be freed.
  console.log('downloads: off-registry survival')
  registryView = CATALOG.filter((r) => r.id !== 'FONT-RELATIVE1')

  // 9a. The last-known-good registry cache: a release this device has already
  // seen must not stop existing because one /registry answer came back short.
  await page.goto(`${BASE}/#/release/FONT-RELATIVE1`, { waitUntil: 'networkidle' })
  // A hash-only goto does NOT reload the document, so the in-memory registry
  // from the previous load would still be there — reload to really re-fetch.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  check(
    'a release dropped from the live registry is restored from the cache',
    /Relative Path Release/.test(await page.evaluate(() => document.body.innerText)),
  )
  check(
    'the registry cache is persisted',
    (await page.evaluate(() => (localStorage.getItem('fontainor_registry_cache_v1') ?? '').includes('FONT-RELATIVE1'))) === true,
  )

  // 9b. With NO cache either (fresh install, first launch offline) the download
  // shelf must still stand on its own index.
  await page.evaluate(() => localStorage.removeItem('fontainor_registry_cache_v1'))
  await page.goto(`${BASE}/#/library`, { waitUntil: 'networkidle' })
  const shelf = page.locator('section[aria-label="Downloads"]')
  await shelf.waitFor({ timeout: 8000 })
  check('a download missing from the loaded registry is still listed', /Relative Path Release/.test(await shelf.innerText()), await shelf.innerText())
  const coverSrc = await shelf.locator('img').first().getAttribute('src').catch(() => null)
  check(
    'the shelf shows the SAVED cover, not the unreachable remote one',
    !!coverSrc && !coverSrc.startsWith(DEPLOYED_ORIGIN) && /FONT-RELATIVE1\.jpg/.test(coverSrc),
    String(coverSrc),
  )
  // Other releases stay downloaded, so target THIS row's Remove button.
  const removeBtn = shelf.getByRole('button', { name: /Remove Relative Path Release/ })
  check('an off-registry download can still be removed', (await removeBtn.count()) > 0)
  await removeBtn.click()
  await page.waitForTimeout(600)
  const orphan = await page.evaluate(() => ({
    idx: Object.keys(JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')),
    files: Object.keys(window.__files).filter((k) => k.includes('FONT-RELATIVE1')),
  }))
  check(
    'removing an off-registry download frees its disk',
    orphan.files.length === 0 && !orphan.idx.includes('FONT-RELATIVE1'),
    JSON.stringify(orphan),
  )
  registryView = null

  // ---------- 8. no crashes ----------
  const realErrors = errors.filter((e) => !/Failed to load resource|net::ERR|favicon|Autoplay|play\(\) failed/i.test(e))
  check('no uncaught errors during downloads', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  preview.kill()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
