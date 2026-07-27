// Headless verification for F33 (artist follow + new-release awareness).
// Run: npm run build && npx vite preview --port 4173 & node tools/follows-test.mjs
import { chromium } from 'playwright'

const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell'
const BASE = 'http://localhost:4173'
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`) }

const rel = (id, title, artist, date) => ({
  type: 'release', id, title, artist, date,
  price: { amount: 0.01, currency: 'SOL' }, editions: { total: 10 },
  status: 'REGISTERED_ON_FONTAINOR', audioUri: 'https://example.com/a.mp3', coverUri: null, artistWallet: null,
})

const OLD = [rel('FONT-FLW0000A1', 'Old Cut', 'Follow Artist', '2026-06-01T00:00:00.000Z')]
const WITH_NEW = [
  ...OLD,
  rel('FONT-FLW0000B2', 'Fresh Drop', 'Follow Artist', '2099-01-01T00:00:00.000Z'),
  rel('FONT-FLW0000C3', 'Unrelated', 'Someone Else', '2099-01-01T00:00:00.000Z'),
]

async function main() {
  const browser = await chromium.launch({ executablePath: EXE })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  let registry = OLD
  await page.route('**/registry', (r) => r.fulfill({ json: registry, headers: { 'access-control-allow-origin': '*' } }))
  await page.route('**/api/v1/plays/top**', (r) => r.fulfill({ json: { window: 'week', top: [], durable: false } }))

  // 1) follow an artist on the release page
  await page.goto(`${BASE}/#/release/FONT-FLW0000A1`, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  const followBtn = page.getByRole('button', { name: 'Follow', exact: true })
  check('Follow button visible on release page', await followBtn.isVisible())
  await followBtn.click()
  check('Button flips to Following', await page.getByRole('button', { name: 'Following' }).isVisible())

  // 2) persists across reload
  await page.reload({ waitUntil: 'networkidle' })
  check('Following persists after reload', await page.getByRole('button', { name: 'Following' }).isVisible())

  // 3) no rail on Home while nothing new (baseline set at follow time)
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  check('No rail before a new drop', (await page.locator('section[aria-label="New from artists you follow"]').count()) === 0)

  // 4) new release by the followed artist appears -> rail shows exactly it
  registry = WITH_NEW
  await page.reload({ waitUntil: 'networkidle' })
  const rail = page.locator('section[aria-label="New from artists you follow"]')
  await rail.waitFor({ state: 'visible', timeout: 5000 })
  const railText = await rail.innerText()
  check('Rail appears with the fresh drop', railText.includes('Fresh Drop'))
  check('Unfollowed artist excluded', !railText.includes('Unrelated'))
  check('Old catalog excluded', !railText.includes('Old Cut'))

  // 5) mark seen hides the rail, stays hidden after reload
  await page.getByRole('button', { name: 'Mark all seen' }).click()
  check('Mark all seen hides the rail', (await rail.count()) === 0)
  await page.reload({ waitUntil: 'networkidle' })
  check('Stays hidden after reload', (await page.locator('section[aria-label="New from artists you follow"]').count()) === 0)

  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
