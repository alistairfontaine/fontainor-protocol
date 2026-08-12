// stall-failover-test.mjs — C21 verification: mid-track failover RESUMES, and
// a silently-hanging gateway is detected by the stall watchdog.
//
// The two bugs this guards against:
//  1. attachNextSource() used to start the alternate gateway at 0:00 — a
//     gateway dying at 2:50 restarted the track from the beginning.
//  2. A gateway that answers headers and then stops sending bytes never fires
//     'error'; playback froze forever with a stuck playhead (no watchdog).
//
// Method: real playback of real mp3 bytes through the app; failures are
// injected exactly at the media-element boundary (an 'error' event mid-play,
// and a 'waiting' event with the position frozen), which is precisely what
// the browser emits in those network conditions.
//
// Run: npm run build && node tools/stall-failover-test.mjs (exit 0 = pass)
import { readFileSync } from 'fs'
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const EXE = process.env.FONTAINOR_CHROMIUM || undefined
const PORT = 4188
const BASE = `http://localhost:${PORT}`
const IRYS = 'https://gateway.irys.xyz'
const ARWEAVE = 'https://arweave.net'
const TX = 'h6Fxl3ajxUPAHWFiOX2btof-cQlBKg2fvIjzOho1wdA'

let passed = 0, failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${detail}`) }
}

const AUDIO = readFileSync(new URL('../public/audio/genesis.mp3', import.meta.url)) // real, decodable, 90s

const CATALOG = [
  { id: 'FONT-STALL1', title: 'Stall One', artist: 'Watchdog Ensemble', type: 'release', date: '2026-08-01', audioUri: `${IRYS}/${TX}`, coverUri: null },
]

// ---------- boot vite preview ----------
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite preview did not start in 30s')), 30000)
  const probe = async () => {
    try { if ((await fetch(`${BASE}/`)).ok) { clearTimeout(t); resolve(); return } } catch { /* not up */ }
    setTimeout(probe, 300)
  }
  probe()
})

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})

let mediaLog = []
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  mediaLog = []
  await ctx.route(/https:\/\/(gateway\.irys\.xyz|arweave\.net)\//, async (route) => {
    const url = route.request().url()
    if (route.request().method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-type': 'audio/mpeg', 'access-control-allow-origin': '*' } })
    mediaLog.push(url)
    return route.fulfill({ status: 200, headers: { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' }, body: AUDIO })
  })
  await ctx.route('**/registry', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(CATALOG) }))
  await ctx.route(/^https?:\/\/(?!localhost)(?!gateway\.irys)(?!arweave\.net)/, (route) => route.abort())
  const page = await ctx.newPage()
  // Track every media element so the test can inject failures on the live one.
  await page.addInitScript(`(() => {
    window.__els = []
    const NativeAudio = window.Audio
    window.Audio = function (...args) {
      const el = new NativeAudio(...args)
      window.__els.push(el)
      return el
    }
    window.Audio.prototype = NativeAudio.prototype
  })()`)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  return { ctx, page, errors }
}

const playerRegion = (page) => page.locator('[role="region"][aria-label="Audio player"]')

// The app's CURRENT element = the last constructed one whose src matches a gateway.
const evalOnCurrent = (page, fn) => page.evaluate(`(() => {
  const els = window.__els.filter((e) => /irys|arweave/.test(e.src))
  const el = els[els.length - 1]
  if (!el) throw new Error('no gateway-bound element')
  return (${fn})(el)
})()`)

try {
  // ---------- 1. mid-play 'error' → failover RESUMES the position ----------
  console.log('stall-failover: mid-play error resumes, not restarts')
  {
    const { ctx, page, errors } = await newPage()
    await page.getByRole('button', { name: 'Play Stall One' }).click()
    await playerRegion(page).waitFor({ timeout: 5000 })
    // let it genuinely play a few seconds
    await page.waitForFunction(() => {
      const els = window.__els.filter((e) => /irys|arweave/.test(e.src))
      return els.length && els[els.length - 1].currentTime > 3
    }, null, { timeout: 15000 })
    const posBefore = await evalOnCurrent(page, '(el) => el.currentTime')
    check('track genuinely played past 3s on the first gateway', posBefore > 3, `pos=${posBefore}`)
    check('first gateway was the published one (irys)', mediaLog[0]?.startsWith(IRYS), mediaLog.join(' | '))

    // Inject the exact event a dying network produces on the media element.
    await evalOnCurrent(page, `(el) => el.dispatchEvent(new Event('error'))`)
    await page.waitForFunction((ar) => {
      const els = window.__els.filter((e) => e.src.startsWith(ar))
      return els.length > 0 && els[els.length - 1].currentTime > 0.5
    }, ARWEAVE, { timeout: 10000 })
    const resumed = await page.evaluate((ar) => {
      const els = window.__els.filter((e) => e.src.startsWith(ar))
      return els[els.length - 1].currentTime
    }, ARWEAVE)
    check('failover went to the alternate gateway', mediaLog.some((u) => u.startsWith(ARWEAVE)), mediaLog.join(' | '))
    check(`failover RESUMED near the death position (~${posBefore.toFixed(1)}s), not 0:00`, resumed >= posBefore - 1 && resumed < posBefore + 15, `resumed=${resumed}`)
    check('the dead gateway is remembered as down', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fontainor_gateway_down_v1') ?? '{}')).some((k) => k.includes('irys'))))
    check('no uncaught errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 2. hanging gateway (no 'error' ever) → watchdog fails over ----------
  console.log('stall-failover: silent hang trips the watchdog')
  {
    const { ctx, page, errors } = await newPage()
    await page.getByRole('button', { name: 'Play Stall One' }).click()
    await playerRegion(page).waitFor({ timeout: 5000 })
    await page.waitForFunction(() => {
      const els = window.__els.filter((e) => /irys|arweave/.test(e.src))
      return els.length && els[els.length - 1].currentTime > 2
    }, null, { timeout: 15000 })
    // Freeze the position (what a starved decoder does) and signal 'waiting'.
    await evalOnCurrent(page, `(el) => {
      const frozen = el.currentTime
      Object.defineProperty(el, 'currentTime', { get: () => frozen, set: () => {}, configurable: true })
      el.dispatchEvent(new Event('waiting'))
    }`)
    // Watchdog window is 12s; give it 15.
    await page.waitForFunction((ar) => {
      const els = window.__els.filter((e) => e.src.startsWith(ar))
      return els.length > 0
    }, ARWEAVE, { timeout: 15000 }).catch(() => {})
    check('watchdog failed over to the alternate gateway', mediaLog.some((u) => u.startsWith(ARWEAVE)), mediaLog.join(' | '))
    const playing = await page.evaluate((ar) => {
      const els = window.__els.filter((e) => e.src.startsWith(ar))
      const el = els[els.length - 1]
      return el ? !el.paused : false
    }, ARWEAVE)
    check('playback continues on the alternate gateway', playing)
    check('no uncaught errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 3. a NORMAL rebuffer does not trip the watchdog ----------
  console.log('stall-failover: recovered rebuffer does NOT fail over')
  {
    const { ctx, page, errors } = await newPage()
    await page.getByRole('button', { name: 'Play Stall One' }).click()
    await playerRegion(page).waitFor({ timeout: 5000 })
    await page.waitForFunction(() => {
      const els = window.__els.filter((e) => /irys|arweave/.test(e.src))
      return els.length && els[els.length - 1].currentTime > 2
    }, null, { timeout: 15000 })
    // 'waiting' followed by recovery ('playing' fires, position moves on).
    await evalOnCurrent(page, `(el) => {
      el.dispatchEvent(new Event('waiting'))
      setTimeout(() => el.dispatchEvent(new Event('playing')), 500)
    }`)
    await page.waitForTimeout(14000) // past the 12s watchdog window
    check('no failover happened for a recovered rebuffer', !mediaLog.some((u) => u.startsWith(ARWEAVE)), mediaLog.join(' | '))
    check('still playing on the original gateway', await evalOnCurrent(page, '(el) => !el.paused'))
    check('no uncaught errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
  preview.kill()
}

console.log(`\nstall-failover: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
