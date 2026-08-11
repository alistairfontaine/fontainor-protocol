// playlists-test.mjs — F39 verification: user playlists.
//
// Under test:
//  - /playlists index: create form, empty state, list with counts
//  - Release page "Playlist" dropdown: toggle membership, create-and-add
//  - Playlist detail: reorder (move up/down), remove track, rename,
//    two-step delete
//  - "Play all" plays the playlist in order: Next follows PLAYLIST order
//    (context queue), not catalog order
//  - Playlists persist across a reload (localStorage)
//
// Self-contained: run `npm run build` first; the test spawns `vite preview`
// itself and aborts all external requests (no network needed).
//
// Run: npm run build && node tools/playlists-test.mjs (exit 0 = pass)
import { spawn } from 'child_process'
import { chromium } from 'playwright'

// Portable: use Playwright's own resolved browser unless FONTAINOR_CHROMIUM overrides.
const EXE = process.env.FONTAINOR_CHROMIUM || undefined
const PORT = 4183
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

const playerRegion = (page) => page.locator('[role="region"][aria-label="Audio player"]')
const nowPlayingTitle = async (page) => (await playerRegion(page).locator('a[href^="#/release/"]').first().innerText()).trim()

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort())
const page = await ctx.newPage()

try {
    await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })

    // ---------- 1. index page: nav + empty state + create ----------
    console.log('playlists index')
    await page.locator('aside a', { hasText: 'Playlists' }).click()
    check('sidebar navigates to /playlists', page.url().includes('#/playlists'))
    await page.locator('text=No playlists yet').waitFor({ timeout: 5000 }) // registry skeleton may still be up
    check('empty state before any playlist', (await page.locator('text=No playlists yet').count()) === 1)
    await page.locator('input[aria-label="New playlist name"]').fill('Road Trip')
    await page.locator('button', { hasText: 'Create' }).click()
    await page.waitForTimeout(200)
    check('create lands on the playlist page', /#\/playlists\/pl_/.test(page.url()))
    check('new playlist is empty with CTA', (await page.locator('text=Nothing in here yet').count()) === 1)

    // ---------- 2. release page dropdown: toggle + create-and-add ----------
    console.log('release page playlist menu')
    // A hash-only goto does not reload the document, and `networkidle` resolves
    // immediately — so the PREVIOUS route (a release page, whose "More like
    // this" rail also renders release cards) can still be on screen when we
    // start reading labels. On a slow CI runner that raced: a label was read
    // from the old view and the click landed on the newly mounted home grid, so
    // the test added a DIFFERENT release than it thought. Wait for the home
    // heading, and click by label rather than by index.
    const gotoHome = async () => {
      await page.goto(BASE + '/#/', { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'New on the registry' }).waitFor({ timeout: 8000 })
      await page.locator('article a[aria-label]').first().waitFor({ timeout: 8000 })
    }
    const clickCard = async (label) => {
      await page.locator(`article a[aria-label=${JSON.stringify(label)}]`).first().click()
      await page.getByRole('heading', { name: label, exact: true }).first().waitFor({ timeout: 8000 })
    }
    await gotoHome()
    const cards = page.locator('article a[aria-label]')
    const titleA = await cards.nth(0).getAttribute('aria-label')
    await clickCard(titleA)
    const plBtn = page.locator('button[aria-label^="Save "][aria-label$=" to playlist"]')
    await plBtn.waitFor({ timeout: 5000 })
    await plBtn.click()
    const menu = page.locator('[role="menu"][aria-label="Save to playlist"]')
    await menu.waitFor({ timeout: 3000 })
    await menu.locator('button', { hasText: 'Road Trip' }).click()
    check('toggling membership marks the row', (await menu.locator('button[aria-pressed="true"]', { hasText: 'Road Trip' }).count()) === 1)
    check('button reflects membership count', (await plBtn.innerText()).includes('In 1 playlist'))
    await menu.locator('input[aria-label="New playlist name"]').fill('Focus')
    await menu.locator('button', { hasText: 'Add' }).click()
    check('create-and-add from the menu', (await plBtn.innerText()).includes('In 2 playlists'))

    // add a SECOND (different) track to Road Trip
    await gotoHome()
    let titleB = ''
    const labels = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    for (const t of labels) {
        if (t && t !== titleA) { titleB = t; break }
    }
    check('a second, different release is available to add', !!titleB, JSON.stringify(labels.slice(0, 4)))
    await clickCard(titleB)
    await plBtn.waitFor({ timeout: 5000 })
    await plBtn.click()
    await menu.waitFor({ timeout: 3000 })
    await menu.locator('button', { hasText: 'Road Trip' }).click()
    // Don't navigate until the membership toggle has actually landed — on slow
    // CI runners an immediate goto raced the click and track B was never added.
    await menu.locator('button[aria-pressed="true"]', { hasText: 'Road Trip' }).waitFor({ timeout: 3000 })

    // ---------- 3. playlist detail: order, play all, reorder ----------
    console.log('playlist detail + playback order')
    await page.goto(BASE + '/#/playlists', { waitUntil: 'networkidle' })
    check('index lists playlists with counts', (await page.locator('a', { hasText: 'Road Trip' }).innerText()).includes('2 tracks'))
    await page.locator('a', { hasText: 'Road Trip' }).click()
    const rowTitles = page.locator('ul li a[href^="#/release/"]')
    await rowTitles.first().waitFor({ timeout: 5000 })
    const detailRows = []
    for (let i = 0; i < (await rowTitles.count()); i++) detailRows.push((await rowTitles.nth(i).innerText()).trim())
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fontainor_playlists_v1') ?? '[]'))
    check('detail shows both tracks in add order',
        detailRows[0] === titleA && detailRows[1] === titleB,
        `wanted [${titleA} | ${titleB}] got [${detailRows.join(' | ')}] stored=${JSON.stringify(stored)}`)

    await page.locator(`button[aria-label="Move ${titleB} up"]`).click()
    check('move up reorders the playlist', (await rowTitles.nth(0).innerText()).trim() === titleB)

    await page.locator('button', { hasText: 'Play all' }).click()
    await playerRegion(page).waitFor({ timeout: 5000 })
    check('Play all starts with the first playlist track', (await nowPlayingTitle(page)) === titleB)
    await page.locator('button[aria-label="Next track"]').click()
    await page.waitForTimeout(300)
    check('Next follows playlist order, not catalog order', (await nowPlayingTitle(page)) === titleA)
    await page.locator('button[aria-label="Next track"]').click()
    await page.waitForTimeout(300)
    check('playlist context loops within the playlist', (await nowPlayingTitle(page)) === titleB)

    // ---------- 4. remove, rename, delete ----------
    console.log('remove / rename / delete')
    await page.locator(`button[aria-label="Remove ${titleA} from playlist"]`).click()
    check('remove leaves one track', (await rowTitles.count()) === 1)
    await page.locator('button', { hasText: 'Rename' }).click()
    await page.locator('input[aria-label="Playlist name"]').fill('Desert Drive')
    await page.locator('button', { hasText: 'Save' }).click()
    check('rename updates the title', (await page.locator('h1', { hasText: 'Desert Drive' }).count()) === 1)
    await page.locator('button', { hasText: /^Delete$/ }).click()
    await page.locator('button', { hasText: 'Confirm delete' }).click()
    await page.waitForTimeout(200)
    check('two-step delete returns to the index', page.url().endsWith('#/playlists'))
    check('deleted playlist is gone, other remains',
        (await page.locator('a', { hasText: 'Desert Drive' }).count()) === 0 &&
        (await page.locator('a', { hasText: 'Focus' }).count()) === 1)

    // ---------- 5. persistence across reload ----------
    console.log('persistence')
    await page.reload({ waitUntil: 'networkidle' })
    check('playlists survive a reload', (await page.locator('a', { hasText: 'Focus' }).innerText()).includes('1 track'))
} finally {
    await ctx.close()
    await browser.close()
    preview.kill()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
