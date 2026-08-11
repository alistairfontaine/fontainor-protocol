// mobile-wallet-test.mjs — F37 verification: mobile wallet fallback.
//
// On phones the Phantom extension cannot exist, so the header must swap the
// dead-end "Connect wallet" button for an "Open in Phantom" deep link
// (phantom.app/ul/browse/<current-url>) that loads the site inside Phantom's
// in-app browser. Desktop and Phantom's own in-app browser (mobile UA with an
// injected provider) must keep the normal Connect button.
//
// Self-contained: builds are assumed done (`npm run build`), the test spawns
// `vite preview` itself. External requests are aborted (no network needed).
//
// Run: npm run build && node tools/mobile-wallet-test.mjs (exit 0 = pass)
import { spawn } from 'child_process'
import { chromium } from 'playwright'

// Portable: use Playwright's own resolved browser unless FONTAINOR_CHROMIUM overrides.
const EXE = process.env.FONTAINOR_CHROMIUM || undefined
const PORT = 4179
const BASE = `http://localhost:${PORT}`
const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

let passed = 0, failed = 0
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`) }
    else { failed++; console.error(`  ✗ ${name} ${detail}`) }
}

// ---------- boot vite preview ----------
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite preview did not start in 30s')), 30000)
    const probe = async () => {
        try {
            const res = await fetch(BASE + '/')
            if (res.ok) { clearTimeout(t); resolve() ; return }
        } catch { /* not up yet */ }
        setTimeout(probe, 300)
    }
    probe()
})

async function newPage(browser, { mobile, injectPhantom }) {
    const ctx = await browser.newContext({
        userAgent: mobile ? MOBILE_UA : undefined,
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        hasTouch: mobile,
    })
    // Offline test: kill everything that isn't the preview server.
    await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
    if (injectPhantom) {
        await ctx.addInitScript(() => {
            window.solana = { isPhantom: true, publicKey: null, connect: async () => ({ publicKey: { toString: () => 'FakePk' } }) }
        })
    }
    const page = await ctx.newPage()
    await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })
    return { ctx, page }
}

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
try {
    // ---------- 1. mobile UA, no wallet -> deep link ----------
    console.log('mobile browser without wallet')
    {
        const { ctx, page } = await newPage(browser, { mobile: true, injectPhantom: false })
        const link = page.locator('a[href^="https://phantom.app/ul/browse/"]').first()
        check('header shows "Open in Phantom" deep link', (await link.count()) > 0)
        if ((await link.count()) > 0) {
            const href = await link.getAttribute('href')
            check('deep link targets the current page (encoded)', href.includes(encodeURIComponent(BASE)))
            check('deep link carries ref param', href.includes('?ref=' + encodeURIComponent(BASE)))
            check('link is labeled Open in Phantom', /Open in Phantom/i.test(await link.innerText()))
        }
        check('no dead-end Connect button on mobile', (await page.getByRole('button', { name: /^Connect/ }).count()) === 0)
        await ctx.close()
    }

    // ---------- 2. mobile UA inside Phantom (provider injected) ----------
    console.log('mobile inside Phantom in-app browser')
    {
        const { ctx, page } = await newPage(browser, { mobile: true, injectPhantom: true })
        check('injected provider keeps normal Connect button', (await page.getByRole('button', { name: /^Connect/ }).count()) > 0)
        check('no deep link when wallet is available', (await page.locator('a[href^="https://phantom.app/ul/browse/"]').count()) === 0)
        await ctx.close()
    }

    // ---------- 3. desktop unchanged ----------
    console.log('desktop browser')
    {
        const { ctx, page } = await newPage(browser, { mobile: false, injectPhantom: false })
        check('desktop keeps Connect wallet button', (await page.getByRole('button', { name: /Connect wallet/ }).count()) > 0)
        check('desktop shows no deep link', (await page.locator('a[href^="https://phantom.app/ul/browse/"]').count()) === 0)
        await ctx.close()
    }
} finally {
    await browser.close()
    preview.kill('SIGTERM')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
