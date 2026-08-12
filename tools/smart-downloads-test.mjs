// smart-downloads-test.mjs — Wi-Fi-only downloads, auto-download on like,
// and the Downloaded library filter (v4.4, Metrolist-inspired).
//
// The fake native side is the download-service shim plus a network model:
// `isMetered` answers from window.__net and the test flips connectivity by
// emitting `networkStatusChanged`, exactly what DownloaderPlugin's
// registerDefaultNetworkCallback does on device.
//
// Run: npm run build && node tools/smart-downloads-test.mjs   (exit 0 = pass)
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const PORT = 4186
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

const NATIVE_SHIM = `
window.__nativeLog = [];
window.__prefs = {};
window.__listeners = {};
window.__files = {};
window.__downloadCalls = [];   // Filesystem.downloadFile (legacy path — must stay empty)
window.__svcCalls = [];        // FontainorDownloads.download
window.__svcActive = {};
window.__net = { connected: true, metered: true };  // starts on MOBILE DATA
window.__meteredAsks = 0;

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
  FontainorDownloads: ['download', 'cancel', 'isMetered', 'addListener', 'removeAllListeners'],
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
// The test flips the network with this (what the plugin's NetworkCallback does).
window.__setNetwork = (connected, metered) => {
  window.__net = { connected, metered };
  svcEmit('networkStatusChanged', { connected, metered });
};

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
      if (methodName === 'isMetered') { window.__meteredAsks++; const st = { connected: window.__net.connected, metered: window.__net.metered }; if (window.__meteredDelay) { setTimeout(() => reply(st), window.__meteredDelay); return; } return reply(st); }
      if (methodName === 'download') {
        const { id, url, path } = options;
        window.__svcCalls.push({ id, url, path, netAtStart: { ...window.__net } });
        reply({});
        const st = { cancelled: false };
        window.__svcActive[id] = st;
        window.__nativeDownload(url).then(async (res) => {
          if (!res.ok) {
            delete window.__svcActive[id];
            svcEmit('downloadFailed', { id, message: res.error });
            return;
          }
          const total = res.size;
          await new Promise((r) => setTimeout(r, 150));
          if (st.cancelled) {
            delete window.__svcActive[id];
            svcEmit('downloadCancelled', { id });
            return;
          }
          svcEmit('downloadProgress', { id, bytes: total, total });
          window.__noteWritten(path, url);
          window.__files['DATA/' + path] = { size: total, source: url };
          delete window.__svcActive[id];
          svcEmit('downloadComplete', { id, path, bytes: total });
        });
        return;
      }
      if (methodName === 'cancel') {
        const ids = options && options.id ? [options.id] : Object.keys(window.__svcActive);
        ids.forEach((i) => { if (window.__svcActive[i]) window.__svcActive[i].cancelled = true; });
        return reply({});
      }
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
  { id: 'FONT-SMART1', title: 'Metered Release', artist: 'Test Artist', type: 'release', audioUri: '/audio/genesis.mp3', coverUri: '/covers/genesis.jpg', date: '2026-05-01T00:00:00.000Z' },
  { id: 'FONT-SMART2', title: 'Liked Release', artist: 'Test Artist', type: 'release', audioUri: '/audio/aerials.mp3', date: '2026-05-02T00:00:00.000Z' },
  { id: 'FONT-SMART3', title: 'Quiet Release', artist: 'Test Artist', type: 'release', audioUri: '/audio/kumasi.mp3', date: '2026-05-03T00:00:00.000Z' },
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
const writtenFiles = new Map()
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  })
  await ctx.exposeFunction('__noteWritten', (path, url) => writtenFiles.set(path, url))
  await ctx.exposeFunction('__nativeDownload', async (url) => {
    let u
    try {
      u = new URL(url)
    } catch {
      return { ok: false, error: `unsupported url ${url}` }
    }
    if (u.origin === BASE) return { ok: false, error: 'Failed to connect to localhost/127.0.0.1:443' }
    try {
      const res = await fetch(BASE + u.pathname)
      if (!res.ok) return { ok: false, error: `The server answered HTTP ${res.status}.` }
      const size = (await res.arrayBuffer()).byteLength
      return { ok: true, size }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

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
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() }, body: JSON.stringify(CATALOG) })
    }
    if (/\.(mp3|jpg|png|svg)$/.test(path)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: Buffer.from([0]) })
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() }, body: '{}' })
  })

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  // ---------- 1. settings exist, default OFF, persist ----------
  console.log('smart-downloads: settings')
  await page.goto(`${BASE}/#/library`, { waitUntil: 'networkidle' })
  const settingsSection = page.locator('section[aria-label="Download settings"]')
  await settingsSection.waitFor({ timeout: 8000 })
  check('the Library offers download settings in the native shell', (await settingsSection.count()) === 1)
  const wifiToggle = page.getByRole('switch', { name: 'Download over Wi-Fi only' })
  const likeToggle = page.getByRole('switch', { name: 'Auto-download liked releases' })
  check('Wi-Fi only defaults to OFF', (await wifiToggle.getAttribute('aria-checked')) === 'false')
  check('auto-download likes defaults to OFF', (await likeToggle.getAttribute('aria-checked')) === 'false')
  await wifiToggle.click()
  check('toggling Wi-Fi only flips the switch', (await wifiToggle.getAttribute('aria-checked')) === 'true')
  await page.reload({ waitUntil: 'networkidle' })
  await settingsSection.waitFor({ timeout: 8000 })
  check('the setting survives a relaunch', (await wifiToggle.getAttribute('aria-checked')) === 'true')

  // ---------- 2. Wi-Fi only + metered ⇒ waiting, nothing on the modem ----------
  console.log('smart-downloads: metered gate')
  await page.goto(`${BASE}/#/release/FONT-SMART1`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  const dlBtn = page.getByRole('button', { name: 'Download Metered Release' })
  await dlBtn.waitFor({ timeout: 8000 })
  await dlBtn.click()
  await page.getByRole('button', { name: 'Download Metered Release now' }).waitFor({ timeout: 8000 })
  check('on mobile data the download WAITS instead of starting', /Waiting for Wi-Fi/.test(await page.getByRole('button', { name: 'Download Metered Release now' }).innerText()))
  check('no bytes were requested from the service', (await page.evaluate(() => window.__svcCalls.length)) === 0)
  check('the metered state was actually consulted', (await page.evaluate(() => window.__meteredAsks)) > 0)
  // Queuing is announced: a silent "nothing happened" after tapping Download
  // is indistinguishable from a broken button for a screen-reader user.
  await page.waitForTimeout(200)
  const queuedMsg = await page.evaluate(() => document.getElementById('sr-announcer')?.textContent ?? '')
  check('the Wi-Fi wait is announced to screen readers', /Metered Release will download when Wi-Fi is available/.test(queuedMsg), JSON.stringify(queuedMsg))

  // ---------- 3. Wi-Fi arrives ⇒ the queue drains by itself ----------
  console.log('smart-downloads: auto-resume on Wi-Fi')
  await page.evaluate(() => window.__setNetwork(true, false))
  await page.getByRole('button', { name: /Remove Metered Release/ }).waitFor({ timeout: 10000 })
  check('the queued download started when Wi-Fi arrived', (await page.evaluate(() => window.__svcCalls.length)) === 1)
  check('it completed and is recorded', await page.evaluate(() => 'FONT-SMART1' in JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')))
  // Covers legitimately use Filesystem.downloadFile (cosmetic, no service run);
  // AUDIO must always go through the service.
  check('no audio went through the legacy Filesystem path', (await page.evaluate(() => window.__downloadCalls.filter((u) => u.endsWith('.mp3')).length)) === 0)

  // ---------- 4. "download now" override beats the setting ----------
  console.log('smart-downloads: user override')
  await page.evaluate(() => window.__setNetwork(true, true)) // back on mobile data
  await page.goto(`${BASE}/#/release/FONT-SMART3`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  const dl3 = page.getByRole('button', { name: 'Download Quiet Release' })
  await dl3.waitFor({ timeout: 8000 })
  await dl3.click()
  const now3 = page.getByRole('button', { name: 'Download Quiet Release now' })
  await now3.waitFor({ timeout: 8000 })
  await now3.click() // second tap = download now anyway
  await page.getByRole('button', { name: /Remove Quiet Release/ }).waitFor({ timeout: 10000 })
  check('tapping the waiting button forces the download on mobile data', await page.evaluate(() => window.__svcCalls.some((c) => c.id === 'FONT-SMART3' && c.netAtStart.metered)))

  // ---------- 5. the waiting row in the Library can be dismissed ----------
  console.log('smart-downloads: dismiss from the shelf')
  await page.goto(`${BASE}/#/release/FONT-SMART2`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  const dl2 = page.getByRole('button', { name: 'Download Liked Release' })
  await dl2.waitFor({ timeout: 8000 })
  await dl2.click()
  await page.getByRole('button', { name: 'Download Liked Release now' }).waitFor({ timeout: 8000 })
  await page.goto(`${BASE}/#/library`, { waitUntil: 'networkidle' })
  const shelf = page.locator('section[aria-label="Downloads"]')
  await shelf.waitFor({ timeout: 8000 })
  check('a waiting download is visible on the shelf', /Waiting for Wi-Fi/.test(await shelf.innerText()), await shelf.innerText())
  await shelf.getByRole('button', { name: 'Stop waiting for Liked Release' }).click()
  await page.waitForTimeout(400)
  check('dismissing removes it from the queue', !/Waiting for Wi-Fi/.test(await shelf.innerText().catch(() => '')))
  check('dismiss did not start a download', !(await page.evaluate(() => window.__svcCalls.some((c) => c.id === 'FONT-SMART2'))))

  // ---------- 6. auto-download on like ----------
  console.log('smart-downloads: auto-download on like')
  // Setting OFF: liking must NOT download.
  await page.goto(`${BASE}/#/release/FONT-SMART2`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(600)
  check('with the setting OFF a like downloads nothing', !(await page.evaluate(() => window.__svcCalls.some((c) => c.id === 'FONT-SMART2'))))
  await page.getByRole('button', { name: 'Saved', exact: true }).click() // un-like again
  // Setting ON, on Wi-Fi: liking downloads.
  await page.evaluate(() => window.__setNetwork(true, false))
  await page.goto(`${BASE}/#/library`, { waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: 'Auto-download liked releases' }).click()
  await page.goto(`${BASE}/#/release/FONT-SMART2`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: /Remove Liked Release/ }).waitFor({ timeout: 10000 })
  check('with the setting ON a like downloads the release', await page.evaluate(() => window.__svcCalls.some((c) => c.id === 'FONT-SMART2')))
  // Un-liking must not delete the file (a like is not the download's owner).
  await page.getByRole('button', { name: 'Saved', exact: true }).click()
  await page.waitForTimeout(400)
  check('un-liking keeps the download', await page.evaluate(() => 'FONT-SMART2' in JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')))

  // ---------- 7. auto-download respects the Wi-Fi-only gate ----------
  await page.evaluate(() => window.__setNetwork(true, true)) // mobile data
  await page.goto(`${BASE}/#/release/FONT-SMART1`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  // FONT-SMART1 is already downloaded from step 3 — remove it first so the like has work to do.
  await page.getByRole('button', { name: /Remove Metered Release from downloads/ }).click()
  await page.getByRole('button', { name: 'Download Metered Release', exact: true }).waitFor({ timeout: 8000 })
  const callsBefore = await page.evaluate(() => window.__svcCalls.length)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Download Metered Release now' }).waitFor({ timeout: 8000 })
  check('an auto-download on mobile data lands in the waiting queue', (await page.evaluate(() => window.__svcCalls.length)) === callsBefore)

  // ---------- 8. Downloaded filter in the Library ----------
  console.log('smart-downloads: Downloaded filter')
  await page.goto(`${BASE}/#/library`, { waitUntil: 'networkidle' })
  const chip = page.getByRole('button', { name: 'Downloaded', exact: true })
  await chip.waitFor({ timeout: 8000 })
  check('a Downloaded chip appears once something is downloaded', (await chip.count()) === 1)
  await chip.click()
  await page.waitForTimeout(400)
  // The Downloads shelf uses buttons, so release LINKS exist only in the grid.
  const gridIds = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('a[href*="/release/"]')].map((a) => (a.getAttribute('href') ?? '').split('/release/')[1]))],
  )
  check('the filter shows every downloaded release', gridIds.includes('FONT-SMART2') && gridIds.includes('FONT-SMART3'), JSON.stringify(gridIds))
  check('the filter hides not-downloaded releases', !gridIds.includes('FONT-SMART1'), JSON.stringify(gridIds))

  // ---------- 9. storage overview + Remove all ----------
  console.log('smart-downloads: storage + remove all')
  const shelf2 = page.locator('section[aria-label="Downloads"]')
  await shelf2.waitFor({ timeout: 8000 })
  const shelfHead = await shelf2.innerText()
  check('the shelf shows a storage total', /\d+(\.\d+)? (KB|MB) on device/.test(shelfHead), shelfHead.split('\n')[0])
  check('per-item sizes are shown', /Test Artist · \d+(\.\d+)? (KB|MB)/.test(shelfHead), shelfHead)
  // Remove all is a two-step action: it must never fire on a single tap.
  await shelf2.getByRole('button', { name: 'Remove all downloads' }).click()
  await page.waitForTimeout(200)
  check('remove-all asks before deleting', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')).length >= 2))
  await shelf2.getByRole('button', { name: 'Keep my downloads' }).click()
  await page.waitForTimeout(200)
  check('Keep aborts the deletion', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')).length >= 2))
  await shelf2.getByRole('button', { name: 'Remove all downloads' }).click()
  await shelf2.getByRole('button', { name: 'Confirm remove all downloads' }).click()
  await page.waitForTimeout(600)
  const afterClear = await page.evaluate(() => ({
    idx: Object.keys(JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}')),
    files: Object.keys(window.__files).filter((k) => k.includes('downloads/')),
  }))
  check('confirming deletes every download and its files', afterClear.idx.length === 0 && afterClear.files.length === 0, JSON.stringify(afterClear))
  check('the Downloaded chip disappears with the last download', (await page.getByRole('button', { name: 'Downloaded', exact: true }).count()) === 0)

  // ---------- 9b. a double-tap cannot start two transfers ----------
  // The metered check is async: before the sync in-flight guard, a second
  // tap that landed while the first was still awaiting isMetered() started a
  // SECOND concurrent transfer to the same file path (F70). The shim's
  // __meteredDelay holds the check open so the race window is deterministic.
  console.log('smart-downloads: double-tap race')
  await page.evaluate(() => window.__setNetwork(true, false)) // drain any leftover queue
  await page.waitForTimeout(800)
  await page.goto(`${BASE}/#/release/FONT-SMART1`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  const removeLeft = page.getByRole('button', { name: /Remove Metered Release from downloads/ })
  if (await removeLeft.count()) {
    await removeLeft.click()
    await page.getByRole('button', { name: 'Download Metered Release', exact: true }).waitFor({ timeout: 8000 })
  }
  // The reload re-ran the init script, which resets __net to MOBILE DATA —
  // flip to Wi-Fi again or the tap under test just parks in the waiting queue.
  await page.evaluate(() => window.__setNetwork(true, false))
  const raceBase = await page.evaluate(() => window.__svcCalls.filter((c) => c.id === 'FONT-SMART1').length)
  await page.evaluate(() => { window.__meteredDelay = 600 })
  const raceBtn = page.getByRole('button', { name: 'Download Metered Release', exact: true })
  await raceBtn.waitFor({ timeout: 8000 })
  // Two synchronous DOM clicks in ONE task: guaranteed both land before the
  // (600ms-delayed) metered check resolves — Playwright's sequential clicks
  // were too slow/uncertain to sit reliably inside the race window.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Download Metered Release')
    btn.click()
    btn.click()
  })
  try {
    await page.getByRole('button', { name: /Remove Metered Release/ }).waitFor({ timeout: 15000 })
  } catch (e) {
    console.log('DEBUG body:', (await page.evaluate(() => document.body.innerText)).slice(0, 1200))
    console.log('DEBUG svcCalls:', await page.evaluate(() => JSON.stringify(window.__svcCalls)))
    console.log('DEBUG meteredAsks:', await page.evaluate(() => window.__meteredAsks))
    console.log('DEBUG dlcalls:', await page.evaluate(() => JSON.stringify(window.__downloadCalls)))
    console.log('DEBUG idx:', await page.evaluate(() => localStorage.getItem('fontainor.downloads.v1')))
    throw e
  }
  await page.waitForTimeout(800)
  const raceCalls = await page.evaluate(() => window.__svcCalls.filter((c) => c.id === 'FONT-SMART1').length)
  check('a double-tap starts exactly one transfer', raceCalls - raceBase === 1, `calls ${raceBase} -> ${raceCalls}`)
  // Pre-fix, the second entry raced past the async metered check, then died in
  // serviceDownload's own dedupe — whose catch DELETED the file the first
  // transfer was writing and left an error badge over a successful download.
  const raceState = await page.evaluate(() => ({
    idx: 'FONT-SMART1' in JSON.parse(localStorage.getItem('fontainor.downloads.v1') ?? '{}'),
    file: Object.keys(window.__files).some((k) => k.includes('downloads/FONT-SMART1.mp3')),
    body: document.body.innerText,
  }))
  check('the surviving transfer is recorded with its file intact', raceState.idx && raceState.file, JSON.stringify({ idx: raceState.idx, file: raceState.file }))
  check('no error badge is left over the successful download', !/already running|Retry download/i.test(raceState.body))
  await page.evaluate(() => { window.__meteredDelay = 0 })

  // ---------- 10. no crashes ----------
  const realErrors = errors.filter((e) => !/Failed to load resource|net::ERR|favicon|Autoplay|play\(\) failed/i.test(e))
  check('no uncaught errors during smart downloads', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  preview.kill()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
