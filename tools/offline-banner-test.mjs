// offline-banner-test.mjs — registry fallback transparency + reconnect refresh.
//
// Bug (C17): when GET /registry failed, the app silently fell back to the
// bundled snapshot ('file' source) with NO indication — users browsed stale
// data thinking it was live. And nothing listened for the browser 'online'
// event, so after connectivity returned the app stayed stale until a manual
// full reload.
//
// Contract under test:
//   1. API down            -> "Offline — showing your last saved copy" banner
//   2. API ok but empty    -> demo mode, NO offline banner (silent, by design)
//   3. API healthy w/ data -> no banner
//   4. 'online' event      -> auto reload: banner clears, live data appears
//
// Run: npm run build && npx vite preview --port 4173 & node tools/offline-banner-test.mjs
import { chromium } from 'playwright'

const EXE = process.env.FONTAINOR_CHROMIUM || undefined
const BASE = process.env.FONTAINOR_BASE || 'http://localhost:4173'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`)
}

const LIVE = [
  { type: 'release', id: 'FONT-LIVE001', title: 'Live Wire Track', artist: 'Live Artist',
    price: { amount: 1, currency: 'USD' }, editions: { total: 10 }, status: 'REGISTERED_ON_FONTAINOR',
    date: '2026-08-01T00:00:00.000Z', audioUri: 'https://example.com/l.mp3', coverUri: null,
    artistWallet: 'So11111111111111111111111111111111111111112' },
]

const BANNER_TEXT = 'Offline — showing your last saved copy'

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => console.error('pageerror:', String(e)))
  return page
}

async function bannerVisible(page) {
  return page.getByText(BANNER_TEXT, { exact: false }).isVisible().catch(() => false)
}

async function main() {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})

  // ── 1. API down -> offline banner ──
  {
    const page = await newPage(browser)
    await page.route('**/registry', (r) => r.abort('connectionfailed'))
    await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    check('api-down shows offline banner', await bannerVisible(page))
    // The banner must also be HEARD: warn banners carry role=alert so screen
    // readers announce the offline state instead of silently painting it.
    const alertText = await page.getByRole('alert').innerText().catch(() => '')
    check('offline banner is a live region (role=alert)', alertText.includes(BANNER_TEXT), alertText)
    // stale content still usable: bundled snapshot rendered
    const cards = await page.locator('main a[href*="#/"]').count()
    check('api-down still renders the saved snapshot', cards > 0, `links=${cards}`)
    await page.close()
  }

  // ── 2. API reachable but empty -> demo mode, silent ──
  {
    const page = await newPage(browser)
    await page.route('**/registry', (r) =>
      r.fulfill({ json: [], headers: { 'access-control-allow-origin': '*' } }))
    await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    check('api-empty (demo mode) shows NO offline banner', !(await bannerVisible(page)))
    await page.close()
  }

  // ── 3. API healthy -> no banner, live data shown ──
  {
    const page = await newPage(browser)
    await page.route('**/registry', (r) =>
      r.fulfill({ json: LIVE, headers: { 'access-control-allow-origin': '*' } }))
    await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    check('healthy api shows NO banner', !(await bannerVisible(page)))
    check('healthy api renders live registry', await page.getByText('Live Wire Track').first().isVisible().catch(() => false))
    await page.close()
  }

  // ── 4. reconnect: 'online' event triggers reload, banner clears ──
  {
    const page = await newPage(browser)
    let apiUp = false
    await page.route('**/registry', (r) => {
      if (!apiUp) return r.abort('connectionfailed')
      return r.fulfill({ json: LIVE, headers: { 'access-control-allow-origin': '*' } })
    })
    await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    check('reconnect precondition: banner shown while down', await bannerVisible(page))
    apiUp = true
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.waitForTimeout(1200)
    check('online event clears the banner (auto reload)', !(await bannerVisible(page)))
    check('online event pulls fresh live data', await page.getByText('Live Wire Track').first().isVisible().catch(() => false))
    await page.close()
  }

  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
