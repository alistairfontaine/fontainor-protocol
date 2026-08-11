// csp-test.mjs — the security headers in vercel.json, applied to the real build.
//
// Production served no CSP, no X-Content-Type-Options and no frame-ancestors
// (verified with curl against fontainor-protocol.vercel.app on 2026-08-11).
// For a site where people connect a wallet and press Buy, being iframeable and
// having no script-src is worth fixing — but a CSP that breaks the app is worse
// than none, and nobody notices until production.
//
// So this suite reads the policy OUT of vercel.json (never a copy of it),
// applies it to the document exactly as Vercel would, proves the browser is
// really enforcing it, and then walks the app: home, release + playback,
// search, library, playlists, publish. Any violation is a failure.
//
// Run: npm run build && node tools/csp-test.mjs   (exit 0 = pass)
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const PORT = 4185
const BASE = `http://localhost:${PORT}`

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

// ---------- the policy that actually ships ----------
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const catchAll = (vercel.headers ?? []).filter((h) => h.source === '/(.*)')
const shipped = new Map()
for (const block of catchAll) for (const h of block.headers) shipped.set(h.key.toLowerCase(), h.value)
const csp = shipped.get('content-security-policy') ?? ''

console.log('security headers from vercel.json')
check('a Content-Security-Policy is configured', csp.length > 0)
check('the site cannot be framed', /frame-ancestors 'none'/.test(csp), csp)
check("scripts are restricted to 'self'", /script-src 'self'(;|$)/.test(csp), csp)
check('no unsafe-eval is granted', !/unsafe-eval/.test(csp), csp)
check('inline scripts are not allowed', !/script-src[^;]*unsafe-inline/.test(csp), csp)
check('MIME sniffing is off', shipped.get('x-content-type-options') === 'nosniff')
check('a Referrer-Policy is set', (shipped.get('referrer-policy') ?? '').length > 0)
check('a Permissions-Policy is set', (shipped.get('permissions-policy') ?? '').length > 0)
check('media and images may load from https gateways', /media-src[^;]*https:/.test(csp) && /img-src[^;]*https:/.test(csp), csp)
check('the API and RPC endpoints stay reachable', /connect-src[^;]*'self'[^;]*https:/.test(csp), csp)

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
const violations = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  // Serve the document with the shipped headers, exactly as Vercel does.
  await ctx.route(`${BASE}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const res = await fetch(route.request().url())
    const body = Buffer.from(await res.arrayBuffer())
    const headers = { 'content-type': res.headers.get('content-type') ?? 'text/html' }
    for (const [k, v] of shipped) headers[k] = v
    return route.fulfill({ status: res.status, headers, body })
  })
  // Everything off-box is unreachable in this suite; the point is the policy.
  await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())

  const page = await ctx.newPage()
  page.on('console', (m) => {
    const t = m.text()
    if (/Content Security Policy|Refused to/i.test(t)) violations.push(t)
  })

  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })

  // Prove the browser is really enforcing it. NOT via eval: Playwright evaluates
  // through CDP, which bypasses CSP. An inline <script> inserted into the
  // document IS subject to the policy, so it must never run.
  const inlineRan = await page.evaluate(() => {
    const s = document.createElement('script')
    s.textContent = 'window.__inlineRan = true'
    document.head.appendChild(s)
    return Boolean(window.__inlineRan)
  })
  check('the policy is really being enforced (an inline script is refused)', inlineRan === false)
  check(
    'the refusal was reported',
    violations.some((v) => /inline script violates|Refused to execute inline script/i.test(v)),
    violations.join(' | '),
  )
  violations.length = 0 // that violation was ours

  // ---------- walk the app under the policy ----------
  console.log('the app under the shipped policy')
  const heading = page.getByRole('heading', { name: 'New on the registry' })
  await heading.waitFor({ timeout: 8000 })
  check('the home page renders under the policy', await heading.isVisible())
  const cardCount = await page.locator('article a[aria-label]').count()
  check('the registry grid renders', cardCount > 0, `cards=${cardCount}`)

  const label = await page.locator('article a[aria-label]').first().getAttribute('aria-label')
  await page.locator(`article a[aria-label=${JSON.stringify(label)}]`).first().click()
  await page.getByRole('heading', { name: label, exact: true }).first().waitFor({ timeout: 8000 })
  check('a release page renders', true)

  await page.getByRole('main').getByRole('button', { name: 'Play', exact: true }).first().click()
  await page.locator('[role="region"][aria-label="Audio player"]').waitFor({ timeout: 8000 })
  check('playback starts (media-src allows the local file)', true)
  await page.waitForTimeout(1200)

  for (const [route, name] of [
    ['/#/search?q=a', 'search'],
    ['/#/library', 'library'],
    ['/#/playlists', 'playlists'],
    ['/#/publish', 'publish'],
    ['/#/favorites', 'favorites'],
  ]) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    check(`${name} renders with no policy violation`, violations.length === 0, violations.slice(0, 3).join(' | '))
  }

  // Generative cover art is an inline <svg> data URL + inline style attributes:
  // the classic thing a naive CSP breaks.
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const remoteFonts = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"]')]
      .map((l) => l.getAttribute('href') ?? '')
      .filter((h) => /^https?:\/\//.test(h)),
  )
  check('no third-party font/stylesheet host is used', remoteFonts.length === 0, remoteFonts.join(' | '))
  const fontsLoaded = await page.evaluate(async () => {
    await document.fonts.ready
    return { inter: document.fonts.check('16px Inter'), display: document.fonts.check('600 16px "Space Grotesk"') }
  })
  check('the self-hosted body font is actually available', fontsLoaded.inter, JSON.stringify(fontsLoaded))
  check('the self-hosted display font is actually available', fontsLoaded.display, JSON.stringify(fontsLoaded))
  const covers = await page.locator('article img, article svg').count()
  check('cover art still renders (img-src data:/blob:)', covers > 0, `covers=${covers}`)
  check('no CSP violations anywhere in the walk', violations.length === 0, violations.slice(0, 5).join(' | '))

  await ctx.close()
} finally {
  await browser.close()
  preview.kill()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
