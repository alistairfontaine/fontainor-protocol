// queue-test.mjs — F38 verification: user "Add to queue".
//
// Queue semantics under test:
//  - "Add to queue" on a card appends to a user queue that plays BEFORE the
//    catalog order and is consumed as tracks start (Spotify behavior).
//  - Queue popover marks user-queued rows (Queued badge), supports per-row
//    remove and "Clear queue".
//  - Next / track-end consumes the user queue first.
//  - Adding to queue with nothing playing simply starts playback.
//  - Release page has a Queue action too.
//
// Self-contained: run `npm run build` first; the test spawns `vite preview`
// itself and aborts all external requests (no network needed).
//
// Run: npm run build && node tools/queue-test.mjs (exit 0 = pass)
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell'
const PORT = 4181
const BASE = `http://localhost:${PORT}`

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
            if (res.ok) { clearTimeout(t); resolve(); return }
        } catch { /* not up yet */ }
        setTimeout(probe, 300)
    }
    probe()
})

async function newPage(browser) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    // Offline test: kill everything that isn't the preview server.
    await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
    const page = await ctx.newPage()
    await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })
    return { ctx, page }
}

const playerRegion = (page) => page.locator('[role="region"][aria-label="Audio player"]')
const nowPlayingTitle = (page) => playerRegion(page).locator('a[href^="#/release/"]').first()
const addButtons = (page) => page.locator('button[aria-label^="Add "][aria-label$=" to queue"]')
const queuedBadges = (page) => page.locator('[aria-label="Play queue"] >> text=Queued')
const titleFromAria = (aria) => aria.replace(/^Add /, '').replace(/ to queue$/, '')

const browser = await chromium.launch({ executablePath: EXE })
try {
    // ---------- 1. queue while playing, consume via Next ----------
    console.log('queue while playing')
    {
        const { ctx, page } = await newPage(browser)
        await page.locator('button[aria-label^="Play "]').first().click()
        await playerRegion(page).waitFor({ timeout: 5000 })
        const firstTitle = (await nowPlayingTitle(page).innerText()).trim()

        // queue a card that is NOT the one playing
        const adds = addButtons(page)
        const n = await adds.count()
        check('cards expose an Add-to-queue button', n >= 2, `count=${n}`)
        let queuedTitle = ''
        for (let i = 0; i < n; i++) {
            const aria = await adds.nth(i).getAttribute('aria-label')
            const t = titleFromAria(aria)
            if (t !== firstTitle) { queuedTitle = t; await adds.nth(i).click(); break }
        }
        check('queued a different release than now playing', queuedTitle !== '' && queuedTitle !== firstTitle)

        await page.locator('button[aria-label="Show queue"]').click()
        const popover = page.locator('[aria-label="Play queue"]')
        await popover.waitFor({ timeout: 3000 })
        check('popover marks exactly one row as Queued', (await queuedBadges(page).count()) === 1)
        const firstRow = popover.locator('ul li').first()
        check('queued row is first in Up next', (await firstRow.innerText()).includes(queuedTitle))

        await page.locator('button[aria-label="Next track"]').click()
        await page.waitForTimeout(300)
        check('Next plays the queued track first', (await nowPlayingTitle(page).innerText()).trim() === queuedTitle)
        check('queue is consumed after playing', (await queuedBadges(page).count()) === 0)
        await ctx.close()
    }

    // ---------- 2. remove + clear ----------
    console.log('remove and clear queue')
    {
        const { ctx, page } = await newPage(browser)
        await page.locator('button[aria-label^="Play "]').first().click()
        await playerRegion(page).waitFor({ timeout: 5000 })
        const firstTitle = (await nowPlayingTitle(page).innerText()).trim()
        const adds = addButtons(page)
        const n = await adds.count()
        let clicked = 0
        for (let i = 0; i < n && clicked < 2; i++) {
            const t = titleFromAria(await adds.nth(i).getAttribute('aria-label'))
            if (t !== firstTitle) { await adds.nth(i).click(); clicked++ }
        }
        await page.locator('button[aria-label="Show queue"]').click()
        await page.locator('[aria-label="Play queue"]').waitFor({ timeout: 3000 })
        check('two rows queued', (await queuedBadges(page).count()) === 2)
        await page.locator('button[aria-label^="Remove "][aria-label$=" from queue"]').first().click()
        check('per-row remove leaves one queued', (await queuedBadges(page).count()) === 1)
        await page.locator('text=Clear queue').click()
        check('Clear queue empties the user queue', (await queuedBadges(page).count()) === 0)
        await ctx.close()
    }

    // ---------- 3. add-to-queue with nothing playing starts playback ----------
    console.log('queue with nothing playing')
    {
        const { ctx, page } = await newPage(browser)
        check('no player before queueing', (await playerRegion(page).count()) === 0)
        const first = addButtons(page).first()
        const expected = titleFromAria(await first.getAttribute('aria-label'))
        await first.click()
        await playerRegion(page).waitFor({ timeout: 5000 })
        check('adding with empty player starts playback', (await nowPlayingTitle(page).innerText()).trim() === expected)
        await ctx.close()
    }

    // ---------- 4. release page Queue action ----------
    console.log('release page queue button')
    {
        const { ctx, page } = await newPage(browser)
        await page.locator('button[aria-label^="Play "]').first().click()
        await playerRegion(page).waitFor({ timeout: 5000 })
        const firstTitle = (await nowPlayingTitle(page).innerText()).trim()
        // open a different release's detail page
        const cardLinks = page.locator('article a[href^="#/release/"]')
        const m = await cardLinks.count()
        for (let i = 0; i < m; i++) {
            const label = await cardLinks.nth(i).getAttribute('aria-label')
            if (label && label !== firstTitle) { await cardLinks.nth(i).click(); break }
        }
        const qBtn = page.locator('button[aria-label$=" to queue"]', { hasText: /^Queue/ }).first()
        await qBtn.waitFor({ timeout: 5000 })
        await qBtn.click()
        check('release page button flips to Queued', /Queued/.test(await qBtn.innerText()))
        await page.locator('button[aria-label="Show queue"]').click()
        await page.locator('[aria-label="Play queue"]').waitFor({ timeout: 3000 })
        check('release page queues into the same user queue', (await queuedBadges(page).count()) === 1)
        await ctx.close()
    }
} finally {
    await browser.close()
    preview.kill()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
