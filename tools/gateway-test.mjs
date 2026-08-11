// gateway-test.mjs — permanent-storage gateway failover at play time.
//
// A published release's audioUri is one gateway's door to content that every
// gateway can serve: gateway.irys.xyz/<id> and arweave.net/<id> are the same
// bytes. Before this, a single unreachable gateway made a permanent catalog
// unplayable AND the failure was disguised — the player started the demo
// simulator, so the playhead moved with no sound.
//
// Verified live 2026-08-11 (curl): a fresh Irys data item is 200 on
// gateway.irys.xyz and 404 on arweave.net until the bundle settles, so the
// PUBLISHED url must be tried first and alternates are a fallback. That
// ordering is asserted here, together with the failure memory that stops a
// dead host from costing every later track a stall.
//
// Run: npm run build && node tools/gateway-test.mjs   (exit 0 = pass)
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const PORT = 4183
const BASE = `http://localhost:${PORT}`
const IRYS = 'https://gateway.irys.xyz'
const ARWEAVE = 'https://arweave.net'
const TX = 'h6Fxl3ajxUPAHWFiOX2btof-cQlBKg2fvIjzOho1wdA' // real 43-char Arweave id shape
const TX2 = 'PDCkfmDM48N6Itj0Rafsps422ffZ_u1DZpan8QOBGjc'

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

const AUDIO = readFileSync(new URL('../public/audio/genesis.mp3', import.meta.url)) // real, decodable, 90s
const COVER = readFileSync(new URL('../public/audio/CREDITS.md', import.meta.url)) // any bytes; cover is cosmetic

const CATALOG = [
  {
    id: 'FONT-GW1',
    title: 'Gateway One',
    artist: 'Failover Choir',
    type: 'release',
    date: '2026-08-01',
    audioUri: `${IRYS}/${TX}`,
    coverUri: '/cover/gw1.jpg',
  },
  {
    id: 'FONT-GW2',
    title: 'Gateway Two',
    artist: 'Failover Choir',
    type: 'release',
    date: '2026-08-02',
    audioUri: `${IRYS}/${TX2}`,
    coverUri: '/cover/gw2.jpg',
  },
  {
    id: 'FONT-DEEP',
    title: 'Deep Path Release',
    artist: 'Failover Choir',
    type: 'release',
    date: '2026-08-03',
    // NOT gateway-addressed content: a deeper path must never be rewritten.
    audioUri: `${ARWEAVE}/collection/2026/track.mp3`,
    coverUri: '/cover/deep.jpg',
  },
]

// ---------- boot vite preview ----------
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite preview did not start in 30s')), 30000)
  const probe = async () => {
    try {
      if ((await fetch(`${BASE}/`)).ok) {
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

/** health: which gateway hosts serve audio right now. */
let health = { irys: false, arweave: false }
let mediaLog = [] // every gateway URL the page asked for (playback GETs), in order
let probeLog = [] // settlement probes (HEAD to arweave.net), in order

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  mediaLog = []
  probeLog = []
  await ctx.route(/https:\/\/(gateway\.irys\.xyz|arweave\.net)\//, async (route) => {
    const url = route.request().url()
    const isProbe = route.request().method() === 'HEAD'
    if (isProbe) probeLog.push(url)
    else mediaLog.push(url)
    const up = url.startsWith(IRYS) ? health.irys : health.arweave
    if (!up) return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'gateway down' })
    if (isProbe) return route.fulfill({ status: 200, headers: { 'content-type': 'audio/mpeg', 'access-control-allow-origin': '*' } })
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' },
      body: AUDIO,
    })
  })
  await ctx.route('**://fontainor-protocol.vercel.app/**', async (route) => {
    const p = new URL(route.request().url()).pathname
    if (p === '/registry') {
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify(CATALOG),
      })
    }
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: '{}' })
  })
  // the app is served from the preview server; registry comes from the route above
  await ctx.route(`${BASE}/registry`, (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(CATALOG) }),
  )
  await ctx.route(/\/cover\//, (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/plain' }, body: COVER }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  return { ctx, page, errors }
}

const playerRegion = (page) => page.locator('[role="region"][aria-label="Audio player"]')
const durText = (page) => playerRegion(page).locator('span.tabular-nums').last()

async function playRelease(page, id) {
  await page.goto(`${BASE}/#/release/${id}`, { waitUntil: 'networkidle' })
  // A hash-only goto does not reload the document; reload so the registry and
  // the gateway routes are exercised for real.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('main').getByRole('button', { name: 'Play', exact: true }).first().click()
  await playerRegion(page).waitFor({ timeout: 5000 })
}

try {
  // ---------- 1. the published gateway is down: fail over, and say nothing false ----------
  console.log('gateway failover: published gateway down')
  {
    health = { irys: false, arweave: true }
    const { ctx, page, errors } = await newPage()
    await playRelease(page, 'FONT-GW1')
    await page.waitForTimeout(2500)

    check('the published (Irys) url is tried first', mediaLog[0] === `${IRYS}/${TX}`, mediaLog.join(' | '))
    check('the same content id is retried on the alternate gateway', mediaLog.includes(`${ARWEAVE}/${TX}`), mediaLog.join(' | '))
    const dur = (await durText(page).innerText()).trim()
    check('the alternate gateway actually plays (real duration, not the 3:00 demo)', dur === '1:30', `dur=${dur}`)
    check('no "can’t reach the audio" state after a successful failover', !(await page.getByText('Can’t reach the audio').count()))
    const down = await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor_gateway_down_v1') ?? '{}'))
    check('the failing gateway is remembered as down', Object.keys(down).includes(IRYS), JSON.stringify(down))
    check('the working gateway is not marked down', !Object.keys(down).includes(ARWEAVE), JSON.stringify(down))
    check('no uncaught errors', errors.length === 0, errors.join(' | '))

    // ---------- 2. the next track skips the known-dead gateway first ----------
    console.log('gateway failover: a dead gateway is demoted for later tracks')
    mediaLog = []
    await playRelease(page, 'FONT-GW2')
    await page.waitForTimeout(2500)
    check('the demoted gateway is no longer tried first', mediaLog[0] === `${ARWEAVE}/${TX2}`, mediaLog.join(' | '))
    check('the demoted gateway is still kept as a last resort', mediaLog.includes(`${IRYS}/${TX2}`) || mediaLog.length === 1, mediaLog.join(' | '))
    const dur2 = (await durText(page).innerText()).trim()
    check('the second track plays without a stall', dur2 === '1:30', `dur=${dur2}`)
    await ctx.close()
  }

  // ---------- 3. every gateway down: an honest error, not a fake playhead ----------
  console.log('gateway failover: everything down')
  {
    health = { irys: false, arweave: false }
    const { ctx, page, errors } = await newPage()
    await playRelease(page, 'FONT-GW1')
    await page.waitForTimeout(3000)

    check('both gateways were attempted', mediaLog.some((u) => u.startsWith(IRYS)) && mediaLog.some((u) => u.startsWith(ARWEAVE)), mediaLog.join(' | '))
    check('the player admits it cannot reach the audio', (await page.getByText('Can’t reach the audio').count()) > 0)
    check('a Retry action is offered', (await page.getByRole('button', { name: 'Retry' }).count()) > 0)
    const posBefore = await playerRegion(page).locator('span.tabular-nums').first().innerText()
    await page.waitForTimeout(1500)
    const posAfter = await playerRegion(page).locator('span.tabular-nums').first().innerText()
    check('the playhead does NOT run on a track with no reachable audio', posBefore.trim() === posAfter.trim(), `${posBefore} -> ${posAfter}`)

    // ---------- 4. Retry once a gateway is back ----------
    console.log('gateway failover: retry')
    health = { irys: true, arweave: false }
    mediaLog = []
    await page.getByRole('button', { name: 'Retry' }).first().click()
    await page.waitForTimeout(2500)
    check('Retry re-attempts the sources', mediaLog.length > 0, mediaLog.join(' | '))
    const dur = (await durText(page).innerText()).trim()
    check('Retry plays once a gateway answers again', dur === '1:30', `dur=${dur}`)
    check('the recovered gateway is no longer marked down', !Object.keys(await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor_gateway_down_v1') ?? '{}'))).includes(IRYS))
    check('no uncaught errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // ---------- 5. a non-gateway url is never rewritten ----------
  console.log('gateway failover: deeper paths are left alone')
  {
    health = { irys: true, arweave: true }
    const { ctx, page } = await newPage()
    await playRelease(page, 'FONT-DEEP')
    await page.waitForTimeout(2000)
    check('the deeper path is requested as published', mediaLog[0] === `${ARWEAVE}/collection/2026/track.mp3`, mediaLog.join(' | '))
    check('no gateway rewrite is attempted for it', mediaLog.every((u) => u.endsWith('/collection/2026/track.mp3')), mediaLog.join(' | '))
    check('no settlement probe for a non-gateway url', probeLog.length === 0, probeLog.join(' | '))
    await ctx.close()
  }

  // ---------- 6. settled promotion: replays become browser-cache hits ----------
  // arweave.net serves settled content with cache-control max-age=3153600000
  // (immutable, correct); gateway.irys.xyz serves the SAME bytes with
  // max-age=10, so replaying from the published URL re-downloads the file
  // every time. Once an id is known settled, arweave.net must come first.
  console.log('gateway promotion: settled content prefers the cacheable gateway')
  {
    health = { irys: true, arweave: true }
    const { ctx, page } = await newPage()
    await playRelease(page, 'FONT-GW1')
    await page.waitForTimeout(2500)

    check('an unsettled id still tries the published (Irys) url first', mediaLog[0] === `${IRYS}/${TX}`, mediaLog.join(' | '))
    check('a settlement probe (HEAD) went to arweave.net', probeLog.some((u) => u === `${ARWEAVE}/${TX}`), probeLog.join(' | '))
    const settled = await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor_gateway_settled_v1') ?? '{}'))
    check('the probe recorded the id as settled', Object.keys(settled).includes(TX), JSON.stringify(settled))

    // replay: the settled id must now stream from the cache-friendly gateway
    mediaLog = []
    probeLog = []
    await playRelease(page, 'FONT-GW1')
    await page.waitForTimeout(2000)
    check('the settled id now streams from arweave.net first', mediaLog[0] === `${ARWEAVE}/${TX}`, mediaLog.join(' | '))
    check('no repeat probe for an already-settled id', probeLog.length === 0, probeLog.join(' | '))
    const dur = (await durText(page).innerText()).trim()
    check('the promoted source actually plays', dur === '1:30', `dur=${dur}`)

    // demotion outranks promotion: a settled-but-failing host goes to the back
    health = { irys: true, arweave: false }
    mediaLog = []
    await playRelease(page, 'FONT-GW1')
    await page.waitForTimeout(2500)
    check('a failing promoted gateway still fails over', mediaLog.includes(`${IRYS}/${TX}`), mediaLog.join(' | '))
    const dur2 = (await durText(page).innerText()).trim()
    check('playback recovers on the fallback', dur2 === '1:30', `dur=${dur2}`)
    mediaLog = []
    await playRelease(page, 'FONT-GW1')
    await page.waitForTimeout(2000)
    check('demotion outranks promotion on the next play', mediaLog[0] === `${IRYS}/${TX}`, mediaLog.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
  preview.kill()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
