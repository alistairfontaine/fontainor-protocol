#!/usr/bin/env node
// Frame-timing harness for the packaged (native-mode) app UI.
//
// Serves the production `dist/` build, opens it in headless Chromium with a
// phone viewport + touch + 4x CPU throttle (approximates a mid-range Android
// WebView), forces native mode via `?native=1`, then drives real scroll /
// tap gestures over CDP while a rAF collector records every frame delta.
//
// Usage:  node scripts/perf-trace.mjs [--label baseline] [--out perf/report.json]
// Output: per-scenario frame stats (avg, p95, worst, % of frames over the
//         60Hz budget) printed as a table and written as JSON evidence.
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const DIST = new URL('../dist', import.meta.url).pathname
const FRAME_BUDGET_MS = 1000 / 60 + 0.5 // 17.2ms: one 60Hz vsync + jitter allowance

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : dflt
}
const LABEL = flag('label', 'run')
const OUT = flag('out', `perf/${LABEL}.json`)
// 4x missed real-device jank once (v4.0.0 device report); default to 8x.
const CPU_THROTTLE = Number(flag('throttle', 8))

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
}

function serveDist() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      let file = join(DIST, path === '/' ? 'index.html' : path)
      let body
      try {
        body = await readFile(file)
      } catch {
        file = join(DIST, 'index.html') // SPA fallback
        body = await readFile(file)
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
  return new Promise((resolve) => server.listen(0, () => resolve({ server, port: server.address().port })))
}

const stats = (deltas) => {
  if (!deltas.length) return null
  const sorted = [...deltas].sort((a, b) => a - b)
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  const over = deltas.filter((d) => d > FRAME_BUDGET_MS).length
  return {
    frames: deltas.length,
    avg_ms: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2),
    p50_ms: +q(0.5).toFixed(2),
    p95_ms: +q(0.95).toFixed(2),
    worst_ms: +Math.max(...deltas).toFixed(2),
    dropped_pct: +((over / deltas.length) * 100).toFixed(1),
  }
}

async function recordFrames(page, fn, ms = 3500) {
  await page.evaluate(() => {
    window.__ft = []
    window.__ftStop = false
    let last = performance.now()
    const loop = (t) => {
      window.__ft.push(t - last)
      last = t
      if (!window.__ftStop) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  await fn()
  await page.waitForTimeout(ms)
  return page.evaluate(() => {
    window.__ftStop = true
    return window.__ft.slice(1) // drop the first (setup) delta
  })
}

async function swipe(cdp, { x, y, dx = 0, dy = 0, steps = 24, ms = 320 }) {
  const points = Array.from({ length: steps }, (_, i) => ({
    x: x + (dx * (i + 1)) / steps,
    y: y + (dy * (i + 1)) / steps,
  }))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (const p of points) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] })
    await new Promise((r) => setTimeout(r, ms / steps))
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function main() {
  const { server, port } = await serveDist()
  const base = `http://127.0.0.1:${port}`
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
  })
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36',
  })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

  page.setDefaultTimeout(4000) // taps must fail fast, not stall a scenario
  await page.goto(`${base}/?native=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const scrollY = () => page.evaluate(() => window.scrollY)

  const results = { label: LABEL, cpu_throttle: CPU_THROTTLE, budget_ms: +FRAME_BUDGET_MS.toFixed(1), scenarios: {} }
  const run = async (name, fn, settle = 3500) => {
    results.scenarios[name] = stats(await recordFrames(page, fn, settle))
    console.log(name.padEnd(28), JSON.stringify(results.scenarios[name]))
  }

  // Main-thread work counters (script/layout/style) — activation storms from
  // skipped content show up here even when a fast desktop CPU hides them
  // from the rAF frame stats.
  await cdp.send('Performance.enable')
  const perfSnap = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    const get = (n) => metrics.find((m) => m.name === n)?.value ?? 0
    return { script_s: get('ScriptDuration'), layout_count: get('LayoutCount'), style_count: get('RecalcStyleCount') }
  }

  // 1. Home scroll, idle player: repeated flings up and down. The FIRST
  //    downward pass on a cold page is the one that pays any lazy-activation
  //    cost, so scroll work is measured from a fresh load.
  let maxScroll = 0
  const scrollBefore = await perfSnap()
  await run('home-scroll-idle', async () => {
    for (let i = 0; i < 3; i++) {
      await swipe(cdp, { x: 195, y: 640, dy: -420 })
      maxScroll = Math.max(maxScroll, await scrollY())
    }
    for (let i = 0; i < 3; i++) await swipe(cdp, { x: 195, y: 300, dy: 420 })
  })
  results.scroll_moved_px = maxScroll // proof the gestures actually scrolled
  const scrollAfter = await perfSnap()
  results.home_scroll_work = {
    script_ms: +((scrollAfter.script_s - scrollBefore.script_s) * 1000).toFixed(1),
    layouts: scrollAfter.layout_count - scrollBefore.layout_count,
    style_recalcs: scrollAfter.style_count - scrollBefore.style_count,
  }
  console.log('home scroll work:', JSON.stringify(results.home_scroll_work))

  // Start playback via the card play button (aria-label="Play <title>").
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.locator('button[aria-label^="Play "]').first().tap({ force: true }).catch(() => {})
  await page.waitForTimeout(1200)
  // `new Audio()` never enters the DOM — the mini player bar appearing with
  // a Pause button is the observable truth that playback started.
  const playing = await page.evaluate(() => {
    const bar = document.querySelector('[aria-label="Audio player"]')
    return !!bar && !!bar.querySelector('button[aria-label="Pause"]')
  })
  results.playing = playing
  console.log('playback active:', playing)

  // 2. Home scroll WHILE playing — catches progress-tick re-render cost.
  await run('home-scroll-playing', async () => {
    for (let i = 0; i < 3; i++) await swipe(cdp, { x: 195, y: 640, dy: -420 })
    for (let i = 0; i < 3; i++) await swipe(cdp, { x: 195, y: 300, dy: 420 })
  })

  // 3. Horizontal rail fling.
  await run('rail-fling', async () => {
    for (let i = 0; i < 2; i++) await swipe(cdp, { x: 330, y: 560, dx: -260 })
    for (let i = 0; i < 2; i++) await swipe(cdp, { x: 60, y: 560, dx: 260 })
  })

  // 4. Now Playing sheet HELD OPEN while playing — isolates the progress-tick
  //    re-render cost (CDP Performance metrics show script/style/layout work
  //    even when rAF deltas look clean: main-thread churn that a real device's
  //    weaker cores turn into visible player-UI jank).
  await page.locator('button[aria-label^="Open fullscreen player"]').first().tap({ force: true }).catch(async () => {
    const bar = await page.locator('[aria-label="Audio player"]').boundingBox()
    if (bar) await page.touchscreen.tap(bar.x + bar.width * 0.4, bar.y + bar.height * 0.5)
  })
  await page.waitForTimeout(1200)
  const sheetOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Now playing"]'))
  console.log('sheet open for hold test:', sheetOpen)
  const HOLD_S = 10
  const before = await perfSnap()
  const holdFrames = await recordFrames(page, async () => {}, HOLD_S * 1000)
  const after = await perfSnap()
  results.scenarios['nowplaying-hold-playing'] = stats(holdFrames)
  results.tick_cost_over_hold = {
    hold_s: HOLD_S,
    sheet_open: sheetOpen,
    script_ms: +((after.script_s - before.script_s) * 1000).toFixed(1),
    layouts: after.layout_count - before.layout_count,
    style_recalcs: after.style_count - before.style_count,
  }
  console.log('nowplaying-hold-playing      ', JSON.stringify(results.scenarios['nowplaying-hold-playing']))
  console.log('tick cost over hold:', JSON.stringify(results.tick_cost_over_hold))
  await page.locator('button[aria-label="Close now playing"]').first().tap({ force: true }).catch(async () => {
    await swipe(cdp, { x: 195, y: 120, dy: 560 })
  })
  await page.waitForTimeout(800)

  // 5. Now Playing open + close (sheet animation), 2 cycles.
  await run('nowplaying-open-close', async () => {
    for (let i = 0; i < 2; i++) {
      await page.locator('button[aria-label^="Open fullscreen player"]').first().tap({ force: true }).catch(() => {})
      await page.waitForTimeout(800)
      const opened = await page.evaluate(() => !!document.querySelector('[data-nodrag]'))
      if (i === 0) console.log('nowplaying opened:', opened)
      await page.locator('button[aria-label="Close now playing"]').first().tap({ force: true }).catch(async () => {
        await swipe(cdp, { x: 195, y: 120, dy: 560 })
      })
      await page.waitForTimeout(600)
    }
  }, 3200)

  await mkdir(new URL('../perf', import.meta.url).pathname, { recursive: true }).catch(() => {})
  await writeFile(join(process.cwd(), OUT), JSON.stringify(results, null, 2))
  console.log('\nwrote', OUT)

  await browser.close()
  server.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
