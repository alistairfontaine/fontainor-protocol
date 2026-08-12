// download-service-test.mjs — the foreground download service path.
//
// downloads-test.mjs covers the LEGACY shell (@capacitor/filesystem's
// downloadFile, no cancellation, dies when the process is frozen). This suite
// covers the shell that ships the FontainorDownloads plugin: the transfer runs
// in a foreground service, reports progress as Capacitor events, can be
// cancelled for real, and only commits a file when the transfer finished
// (native side streams to <path>.part and renames).
//
// The fake native side mirrors the Java service faithfully:
//  - `download` resolves immediately; results arrive as events
//  - progress ticks carry bytes/total
//  - a cancel stops the transfer and writes NOTHING
//  - a failing gateway reports downloadFailed, so the JS layer walks the
//    remaining gateways for the same content id
//
// Run: npm run build && node tools/download-service-test.mjs   (exit 0 = pass)
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const PORT = 4184
const BASE = `http://localhost:${PORT}`
const DEPLOYED_ORIGIN = 'https://fontainor-protocol.vercel.app'
const IRYS = 'https://gateway.irys.xyz'
const ARWEAVE = 'https://arweave.net'
const TX = 'h6Fxl3ajxUPAHWFiOX2btof-cQlBKg2fvIjzOho1wdA'

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

const NATIVE_SHIM = `
const __durableFiles = window.__fontainorTestDurable?.files || {};
const __durableSvcCompleted = window.__fontainorTestDurable?.completed || {};
window.__nativeLog = [];
window.__prefs = {};
window.__listeners = {};
window.__files = __durableFiles;
window.__downloadCalls = [];   // Filesystem.downloadFile (the LEGACY path)
window.__svcCalls = [];        // FontainorDownloads.download
window.__svcCancels = [];      // FontainorDownloads.cancel
window.__svcActive = {};
window.__svcCompleted = __durableSvcCompleted;
window.__svcTicks = 3;         // progress ticks before completion

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
  FontainorDownloads: ['download', 'cancel', 'isMetered', 'takeCompleted', 'acknowledgeCompleted', 'addListener', 'removeAllListeners'],
};
window.Capacitor = {
  PluginHeaders: Object.keys(PLUGIN_METHODS).map((name) => ({
    name,
    methods: PLUGIN_METHODS[name].map((m) => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })),
  })),
  getServerUrl: () => 'https://localhost',
};

const fsKey = (o) => (o.directory || 'DATA') + '/' + o.path;

function svcEmit(event, data) {
  const cb = window.__listeners['FontainorDownloads.' + event];
  if (!cb) return;
  window.Capacitor.fromNative({ callbackId: cb, pluginId: 'FontainorDownloads', methodName: 'addListener', success: true, data });
}

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

    if (pluginId === 'FontainorDownloads') {
      if (methodName === 'download') {
        const { id, url, path } = options;
        window.__svcCalls.push({ id, url, path });
        reply({});
        const st = { cancelled: false };
        window.__svcActive[id] = st;
        // The SERVICE performs the request, outside the WebView.
        window.__nativeDownload(url).then(async (res) => {
          if (!res.ok) {
            delete window.__svcActive[id];
            svcEmit('downloadFailed', { id, message: res.error });
            return;
          }
          const total = res.size;
          const ticks = window.__svcTicks;
          for (let i = 1; i <= ticks; i++) {
            await new Promise((r) => setTimeout(r, 300));
            if (st.cancelled) {
              delete window.__svcActive[id];
              svcEmit('downloadCancelled', { id }); // nothing written: the .part file is dropped
              return;
            }
            svcEmit('downloadProgress', { id, bytes: Math.round((total * i) / ticks), total });
          }
          window.__noteWritten(path, url);
          window.__files['DATA/' + path] = { size: total, source: url };
          window.__svcCompleted[id] = { id, path, bytes: total };
          delete window.__svcActive[id];
          svcEmit('downloadComplete', { id, path, bytes: total });
        });
        return;
      }
      if (methodName === 'cancel') {
        window.__svcCancels.push(options && options.id ? options.id : '*');
        const ids = options && options.id ? [options.id] : Object.keys(window.__svcActive);
        ids.forEach((i) => { if (window.__svcActive[i]) window.__svcActive[i].cancelled = true; });
        return reply({});
      }
      if (methodName === 'takeCompleted') {
        window.__takeDurableCompleted().then((entries) => reply({ entries }));
        return;
      }
      if (methodName === 'acknowledgeCompleted') {
        (options.ids || []).forEach((id) => delete window.__svcCompleted[id]);
        window.__ackDurableCompleted(options.ids || []).then(() => reply({}));
        return;
      }
      if (methodName === 'isMetered') return reply({ connected: true, metered: false });
    }

    if (pluginId === 'Filesystem') {
      const uriFor = (o) => 'file:///data/user/0/com.fontainor.app/files/' + o.path;
      if (methodName === 'downloadFile') {
        window.__downloadCalls.push(options.url);
        return fail('the legacy path must not be used when the service exists');
      }
      if (methodName === 'stat') {
        const f = window.__files[fsKey(options)];
        return f ? reply({ type: 'file', size: f.size, ctime: Date.now(), mtime: Date.now(), uri: uriFor(options) }) : fail('File does not exist');
      }
      if (methodName === 'getUri') return reply({ uri: uriFor(options) });
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

const CATALOG = [
  { id: 'FONT-SVC1', title: 'Service Release', artist: 'Test Artist', type: 'release', audioUri: '/audio/genesis.mp3', coverUri: '/covers/genesis.jpg', date: '2026-05-01T00:00:00.000Z' },
  { id: 'FONT-SVC2', title: 'Slow Release', artist: 'Test Artist', type: 'release', audioUri: `${DEPLOYED_ORIGIN}/audio/aerials.mp3`, date: '2026-05-02T00:00:00.000Z' },
  { id: 'FONT-SVCGW', title: 'Gateway Release', artist: 'Test Artist', type: 'release', audioUri: `${IRYS}/${TX}`, date: '2026-05-03T00:00:00.000Z' },
]

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite preview did not start in 30s')), 30000)
  const probe = async () => {
    try {
      if ((await fetch(`${BASE}/`)).ok) return clearTimeout(t), resolve()
    } catch {
      /* not up yet */
    }
    setTimeout(probe, 300)
  }
  probe()
})

const browser = await chromium.launch()
const serviceAttempts = []
const writtenFiles = new Map()
const durableCompleted = {}
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  })
  await ctx.exposeFunction('__noteWritten', (path, url) => writtenFiles.set(path, url))
  await ctx.exposeFunction('__takeDurableCompleted', () => Object.values(durableCompleted))
  await ctx.exposeFunction('__ackDurableCompleted', (ids) => {
    for (const id of ids || []) delete durableCompleted[id]
    return true
  })
  await ctx.exposeFunction('__nativeDownload', async (url) => {
    let u
    try {
      u = new URL(url)
    } catch {
      serviceAttempts.push({ url, ok: false })
      return { ok: false, error: `unsupported url ${url}` }
    }
    if (u.origin === BASE) {
      serviceAttempts.push({ url, ok: false, reason: 'webview-origin' })
      return { ok: false, error: 'Failed to connect to localhost/127.0.0.1:443' }
    }
    // One gateway is down; the other serves the same content id.
    if (u.origin === IRYS) {
      serviceAttempts.push({ url, ok: false, reason: 'http 503' })
      return { ok: false, error: 'The server answered HTTP 503.' }
    }
    const path = u.origin === ARWEAVE ? '/audio/genesis.mp3' : u.pathname
    try {
      const res = await fetch(BASE + path)
      if (!res.ok) {
        serviceAttempts.push({ url, ok: false, reason: `http ${res.status}` })
        return { ok: false, error: `The server answered HTTP ${res.status}.` }
      }
      const size = (await res.arrayBuffer()).byteLength
      serviceAttempts.push({ url, ok: true, size })
      return { ok: true, size }
    } catch (e) {
      serviceAttempts.push({ url, ok: false, reason: String(e) })
      return { ok: false, error: String(e) }
    }
  })

  await ctx.route('**/_capacitor_file_/**', async (route) => {
    const p = new URL(route.request().url()).pathname
    const rel = p.split('/files/')[1] ?? ''
    const written = writtenFiles.get(rel)
    if (!written) return route.fulfill({ status: 404, body: '' })
    const src = new URL(written)
    const res = await fetch(BASE + (src.origin === ARWEAVE ? '/audio/genesis.mp3' : src.pathname))
    const body = Buffer.from(await res.arrayBuffer())
    return route.fulfill({ status: 200, headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'accept-ranges': 'bytes' }, body })
  })

  await ctx.addInitScript(NATIVE_SHIM)
  await ctx.addInitScript(REAL_NATIVE_BRIDGE)
  await ctx.route('**://fontainor-protocol.vercel.app/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/registry') {
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() }, body: JSON.stringify(CATALOG) })
    }
    if (/\.(mp3|jpg|png|svg)$/.test(path)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: Buffer.from([0]) })
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() }, body: '{}' })
  })
  await ctx.route(/https:\/\/(gateway\.irys\.xyz|arweave\.net)\//, (route) => route.fulfill({ status: 503, body: '' })) // WebView-side streaming is not what this suite tests

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const gotoRelease = async (id) => {
    await page.goto(`${BASE}/#/release/${id}`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Download / }).first().waitFor({ timeout: 8000 })
  }

  // ---------- 1. the service, not the in-process downloader ----------
  console.log('download service: the transfer runs in the service')
  await gotoRelease('FONT-SVC1')
  await page.evaluate(() => {
    window.__svcTicks = 8 // ~2.4 s of transfer: enough ticks to observe progress
  })
  await page.getByRole('button', { name: 'Download Service Release' }).click()
  await page.waitForFunction(() => (window.__svcCalls || []).length > 0, null, { timeout: 8000 })
  const call = await page.evaluate(() => window.__svcCalls[0])
  check('the download goes through the foreground service plugin', !!call, JSON.stringify(call))
  check('the legacy in-process downloader is not used', (await page.evaluate(() => window.__downloadCalls.length)) === 0)
  check('the service gets an absolute, network-reachable url', /^https:\/\//.test(call.url) && new URL(call.url).origin === DEPLOYED_ORIGIN, call.url)
  check('the service writes into the Capacitor data dir', call.path === 'downloads/FONT-SVC1.mp3', call.path)

  // ---------- 2. progress events reach the UI ----------
  console.log('download service: progress')
  // Sample the button while the service works: the percentages the user sees
  // must come from the service's own byte counts.
  const seen = []
  for (let i = 0; i < 40; i++) {
    const txt = await page
      .locator('main button', { hasText: /Download|Cancel|Remove/ })
      .first()
      .innerText()
      .catch(() => '')
    const m = /Downloading (\d+)%/.exec(txt)
    if (m) seen.push(Number(m[1]))
    if (/Downloaded/.test(txt)) break
    await page.waitForTimeout(120)
  }
  check('the button reports real percentages while the service works', seen.length > 0 && seen.every((v) => v > 0 && v <= 100), JSON.stringify(seen))
  check('the percentages only move forward', seen.every((v, i) => i === 0 || v >= seen[i - 1]), JSON.stringify(seen))
  await page.getByRole('button', { name: 'Remove Service Release from downloads' }).waitFor({ timeout: 10000 })
  const doneBtn = page.getByRole('button', { name: 'Remove Service Release from downloads' })
  check('completion flips the button to the downloaded state', /Downloaded/.test(await doneBtn.innerText()))
  check('the downloaded state is exposed to assistive tech', (await doneBtn.getAttribute('aria-pressed')) === 'true')
  const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}'))
  check('the download is recorded with real bytes', (idx['FONT-SVC1']?.bytes ?? 0) > 10000, JSON.stringify(idx['FONT-SVC1'] ?? {}))
  check('no uncaught errors', errors.length === 0, errors.join(' | '))

  // ---------- 2b. process death: native completion journal self-heals ----------
  console.log('download service: WebView process-death recovery')
  await page.evaluate(() => {
    // Simulate Android killing the renderer after the service finalized bytes
    // but before JS received/committed downloadComplete.
    const existing = JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')
    delete existing['FONT-SVC1']
    localStorage.setItem('fontainor.downloads.v1', JSON.stringify(existing))
  })
  // Native SharedPreferences and disk survive the renderer. The durable
  // completion store lives outside the page, just like Android's prefs.
  durableCompleted['FONT-SVC1'] = {
    id: 'FONT-SVC1',
    path: 'downloads/FONT-SVC1.mp3',
    bytes: 772547,
  }
  await page.addInitScript(() => {
    window.__files['DATA/downloads/FONT-SVC1.mp3'] = { size: 772547, source: 'recovered' }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Remove Service Release from downloads' }).waitFor({ timeout: 15000 })
  const recovered = await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')['FONT-SVC1'])
  check('a native completion missed by the old WebView is re-indexed after relaunch', !!recovered, JSON.stringify(recovered))
  check('recovered completion retains real bytes', (recovered?.bytes ?? 0) > 10000, JSON.stringify(recovered))

  // ---------- 3. cancellation is real ----------
  console.log('download service: cancel')
  await page.evaluate(() => {
    window.__svcTicks = 20 // ~6 s of transfer, so there is time to cancel
  })
  await gotoRelease('FONT-SVC2')
  await page.getByRole('button', { name: 'Download Slow Release' }).click()
  const cancelBtn = page.getByRole('button', { name: 'Cancel download of Slow Release' })
  await cancelBtn.waitFor({ timeout: 8000 })
  check('an in-flight download offers Cancel', (await cancelBtn.count()) === 1)
  await cancelBtn.click()
  await page.getByRole('button', { name: 'Download Slow Release' }).waitFor({ timeout: 8000 })
  check('cancel reaches the service', (await page.evaluate(() => window.__svcCancels)).includes('FONT-SVC2'))
  const after = await page.evaluate(() => ({
    idx: Object.keys(JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')),
    files: Object.keys(window.__files),
  }))
  check('a cancelled download is not recorded', !after.idx.includes('FONT-SVC2'), JSON.stringify(after.idx))
  check('a cancelled download leaves no file on disk', !after.files.some((f) => f.includes('FONT-SVC2')), JSON.stringify(after.files))
  check('cancelling shows no error state', !/Retry download/.test(await page.getByRole('button', { name: 'Download Slow Release' }).innerText()))

  // ---------- 4. a failing gateway still walks the list ----------
  console.log('download service: gateway failover inside the service path')
  await page.evaluate(() => {
    window.__svcTicks = 2
  })
  await gotoRelease('FONT-SVCGW')
  await page.getByRole('button', { name: 'Download Gateway Release' }).click()
  await page.getByRole('button', { name: 'Remove Gateway Release from downloads' }).waitFor({ timeout: 15000 })
  const urls = (await page.evaluate(() => window.__svcCalls)).map((c) => c.url)
  check('the published gateway was tried first', urls.includes(`${IRYS}/${TX}`), urls.join(' | '))
  check('the alternate gateway saved the download', urls.includes(`${ARWEAVE}/${TX}`), urls.join(' | '))
  const down = await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor_gateway_down_v1') ?? '{}'))
  check('the failing gateway is remembered as down', Object.keys(down).includes(IRYS), JSON.stringify(down))
  check('no uncaught errors', errors.length === 0, errors.join(' | '))

  await ctx.close()
} finally {
  await browser.close()
  preview.kill()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
