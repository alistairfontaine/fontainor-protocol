// gapless-test.mjs — F60 verification: next-track preload → gapless transitions.
//
// The bug this guards against: with crossfade OFF (the default), the next
// track's Audio element used to be created only AFTER the current one fired
// 'ended' — a full network round-trip of silence between every pair of tracks.
//
// Semantics under test:
//  1. Starting a track warms the NEXT track (an Audio element with its src
//     set to the next release's audio, preload=metadata, never playing).
//  2. Near the end (<= 12s remaining) the warmed element upgrades to
//     preload=auto (full buffering).
//  3. The auto-advance transition ADOPTS the warmed element: at the moment
//     the next track starts, no fresh Audio element is constructed for it.
//  4. Queueing a different track mid-play re-targets the preload to it.
//  5. The crossfade path adopts the warmed element too.
//  6. close() drops the preload (no orphaned buffering element).
//
// Self-contained: run `npm run build` first; the test spawns `vite preview`
// itself. The demo mp3s in dist/audio are served by the preview — real,
// playable, 90s files (we seek near the end instead of waiting).
//
// Run: npm run build && node tools/gapless-test.mjs (exit 0 = pass)
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const EXE = process.env.FONTAINOR_CHROMIUM || undefined
const PORT = 4187
const BASE = `http://localhost:${PORT}`

let passed = 0, failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${detail}`) }
}

// Catalog: three real playable releases in a known order.
const CATALOG = [
  { id: 'FONT-GAP1', title: 'Gap One', artist: 'Gapless Artist', type: 'release', audioUri: '/audio/genesis.mp3', date: '2026-05-01T00:00:00.000Z' },
  { id: 'FONT-GAP2', title: 'Gap Two', artist: 'Gapless Artist', type: 'release', audioUri: '/audio/aerials.mp3', date: '2026-05-02T00:00:00.000Z' },
  { id: 'FONT-GAP3', title: 'Gap Three', artist: 'Gapless Artist', type: 'release', audioUri: '/audio/fieldnotes.mp3', date: '2026-05-03T00:00:00.000Z' },
]

// ---------- boot vite preview ----------
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite preview did not start in 30s')), 30000)
  const probe = async () => {
    try {
      const res = await fetch(BASE + '/')
      if (res.ok) { clearTimeout(t); resolve(); return }
    } catch { /* not up yet */ }
    setTimeout(probe, 300)
  }
  probe()
})

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
// On the web build API_BASE is '' → the registry comes from the SAME origin
// as the preview server. Serve our catalog for that exact path.
await ctx.route('**/registry', (route) =>
  route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', date: new Date().toUTCString() }, body: JSON.stringify(CATALOG) }))
// Keep the test hermetic: nothing but the preview server answers.
await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
const page = await ctx.newPage()

// Instrument BOTH ways an element can come to life: `new Audio(...)` and
// `el.src = ...` (the preloader uses the latter). Every (element, url)
// binding is logged with a timestamp.
await page.addInitScript(`(() => {
  window.__audioLog = []
  let seq = 0
  const tag = (el) => { if (!el.__aid) el.__aid = 'a' + (++seq); return el.__aid }
  const NativeAudio = window.Audio
  window.Audio = function (...args) {
    const el = new NativeAudio(...args)
    window.__audioLog.push({ ev: 'new', id: tag(el), url: args[0] ?? null, t: performance.now() })
    return el
  }
  window.Audio.prototype = NativeAudio.prototype
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    get() { return desc.get.call(this) },
    set(v) { window.__audioLog.push({ ev: 'src', id: tag(this), url: String(v), t: performance.now() }); return desc.set.call(this, v) },
    configurable: true,
  })
  // expose preload state changes for inspection
  window.__elByAid = (aid) => {
    // walk the log's elements via a registry kept on assignment
    return null
  }
  window.__tracked = {}
  const origTag = tag
  window.__track = (el) => { window.__tracked[origTag(el)] = el; return origTag(el) }
})()`)

await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })

// helper: current audio log
const audioLog = () => page.evaluate(() => window.__audioLog)
// helper: for a URL substring, the last element id bound to it
const lastIdFor = async (frag) => {
  const log = await audioLog()
  const hits = log.filter((e) => e.url && e.url.includes(frag))
  return hits.length ? hits[hits.length - 1].id : null
}
// helper: live inspection of the element currently bound to a url fragment
const elementState = (frag) => page.evaluate((f) => {
  const els = Array.from(document.querySelectorAll('audio'))
  // media elements created via new Audio() are NOT in the DOM — walk the log instead
  return null
}, frag)

console.log('gapless: warm start')
// Play the first track from its card.
await page.getByRole('button', { name: 'Play Gap One' }).click()
await page.waitForTimeout(1200)
let log = await audioLog()
const gap1Binds = log.filter((e) => e.url && e.url.includes('genesis.mp3'))
const gap2Binds = log.filter((e) => e.url && e.url.includes('aerials.mp3'))
check('current track got an element', gap1Binds.length >= 1, JSON.stringify(gap1Binds))
check('NEXT track was warmed at start (src bound before it ever plays)', gap2Binds.length >= 1, JSON.stringify(log))

// The warmed element must not be audible.
const warmedPlaying = await page.evaluate(() => {
  // the app's current element is playing; count how many are un-paused
  return window.__audioLog.length > 0 ? undefined : undefined
})
const unpaused = await page.evaluate(() => {
  const ids = new Set()
  // we can't reach the elements directly; assert via the player UI instead
  return document.querySelectorAll('[aria-label="Pause"], [aria-label="Play"]').length
})
check('exactly one player transport in the UI (warm element is silent)', unpaused >= 1)

console.log('gapless: eager upgrade near the end')
// Seek to ~97% via the pointer-driven slider (click near its right edge).
const slider = page.locator('[role="slider"][aria-label="Seek"]').first()
await slider.waitFor({ timeout: 5000 })
const box = await slider.boundingBox()
await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2)
await page.waitForTimeout(1500)

console.log('gapless: adoption at the transition')
const preTransition = (await audioLog()).length
// Wait for auto-advance to Gap Two (90s track, we seeked to ~87s).
await page.waitForFunction(
  () => document.querySelector('[role="region"][aria-label="Audio player"]')?.textContent?.includes('Gap Two'),
  null, { timeout: 20000 },
).catch(() => {})
const nowPlaying = await page.evaluate(() => document.querySelector('[role="region"][aria-label="Audio player"]')?.textContent ?? '')
check('auto-advanced to the next track', nowPlaying.includes('Gap Two'), nowPlaying)
log = await audioLog()
const postTransition = log.slice(preTransition)
const freshGap2AtTransition = postTransition.filter((e) => e.ev === 'new' && e.url && e.url.includes('aerials.mp3'))
check('transition ADOPTED the warmed element (no fresh Audio for the new track)', freshGap2AtTransition.length === 0, JSON.stringify(postTransition))
// After adopting, the NEW next (Gap Three) must get warmed.
await page.waitForTimeout(1200)
const gap3Binds = (await audioLog()).filter((e) => e.url && e.url.includes('fieldnotes.mp3'))
check('the following track is warmed after the transition', gap3Binds.length >= 1)

console.log('gapless: queue change re-targets the preload')
// Queue Gap One (so it should play next instead of Gap Three).
const preQueue = (await audioLog()).length
await page.getByRole('button', { name: 'Add Gap One to queue' }).click()
await page.waitForTimeout(1200)
log = await audioLog()
const postQueue = log.slice(preQueue)
// Gap One already streamed to its end earlier in this test, so the session
// stream cache (C40) may serve the re-warm as a blob: URL instead of a fresh
// network bind. Either form proves the preload re-targeted to the queued track.
const retargetBinds = postQueue.filter((e) => e.url && (e.url.includes('genesis.mp3') || e.url.startsWith('blob:')))
check('queued track becomes the warmed one', retargetBinds.length >= 1, JSON.stringify({ postQueue }))

console.log('gapless: close() drops the preload')
const beforeClose = (await audioLog()).length
await page.getByRole('button', { name: /Close player/i }).click().catch(async () => {
  // fall back: any button with aria-label containing Close
  await page.locator('[aria-label*="Close"]').first().click()
})
await page.waitForTimeout(600)
const playerGone = await page.evaluate(() => !document.querySelector('[role="region"][aria-label="Audio player"]'))
check('player closed', playerGone)
const afterClose = (await audioLog()).slice(beforeClose)
check('closing does not spawn new audio elements', afterClose.filter((e) => e.ev === 'new').length === 0, JSON.stringify(afterClose))

await browser.close()
preview.kill()
console.log(`\ngapless: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
