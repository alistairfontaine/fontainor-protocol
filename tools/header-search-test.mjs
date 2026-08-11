// header-search-test.mjs — desktop header search UX.
// The header search box now live-filters (debounced) as you type, matching the
// mobile Library box, instead of only reacting to Enter. Enter still navigates
// immediately from any page.
//
// Run: npm run build && npx vite preview --port 4173 & node tools/header-search-test.mjs
import { chromium } from 'playwright';

const EXE = process.env.FONTAINOR_CHROMIUM || undefined;
const BASE = 'http://localhost:4173';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' | ' + extra : ''}`); };

const rel = (id, title, artist, tags = []) => ({
    type: 'release', id, title, artist, tags,
    price: { amount: 5, currency: 'USDC' }, editions: { total: 10 },
    status: 'REGISTERED_ON_FONTAINOR', date: '2026-06-01T00:00:00.000Z',
    audioUri: 'https://example.com/a.mp3', coverUri: null, artistWallet: null,
});
const REGISTRY = [
    rel('FONT-SRCH0001', 'Techno Rain', 'DJ One', ['techno']),
    rel('FONT-SRCH0002', 'Ambient Fog', 'DJ Two', ['ambient']),
    rel('FONT-SRCH0003', 'House Party', 'DJ Three', ['house']),
];

const itemsCount = async (page) => {
    const t = await page.textContent('body');
    const m = t.match(/(\d+)\s+item/);
    return m ? Number(m[1]) : -1;
};

async function main() {
    const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/registry', (r) => r.fulfill({ json: REGISTRY, headers: { 'access-control-allow-origin': '*' } }));
    await page.route('**/api/v1/plays/top**', (r) => r.fulfill({ json: { window: 'week', top: [], durable: false } }));

    // 1) type in the header from home -> lands on /library filtered (no Enter)
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    const box = page.locator("input[aria-label='Search the registry']:visible").first();
    await box.click();
    await box.type('techno', { delay: 40 });
    await page.waitForTimeout(500); // > 200ms debounce
    check('typing in header navigates to filtered library (no Enter)', /#\/library\?q=techno$/.test(page.url()), page.url());
    check('library filtered to the single techno match', (await itemsCount(page)) === 1, `items=${await itemsCount(page)}`);
    check('the matching release is shown', (await page.textContent('body')).includes('Techno Rain'));

    // 2) editing the query live-updates results
    await box.click();
    await box.press('Control+A');
    await box.type('dj', { delay: 40 });
    await page.waitForTimeout(500);
    check('broadening query live-updates to all 3', (await itemsCount(page)) === 3, `items=${await itemsCount(page)}`);

    // 3) clearing the box returns to the full library
    await box.press('Control+A');
    await box.press('Delete');
    await page.waitForTimeout(500);
    check('clearing search resets to /library (no q)', /#\/library$/.test(page.url()), page.url());
    check('all items visible again', (await itemsCount(page)) === 3);

    // 4) Enter still works immediately (from home)
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    const box2 = page.locator("input[aria-label='Search the registry']:visible").first();
    await box2.click();
    await box2.type('ambient', { delay: 20 });
    await box2.press('Enter');
    await page.waitForTimeout(300);
    check('Enter navigates immediately to filtered results', /#\/library\?q=ambient$/.test(page.url()) && (await itemsCount(page)) === 1, page.url());

    await browser.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
