// search-page-test.mjs — the dedicated /search discovery destination.
// Distinct from /library: a big search field with live results, the user's own
// recent searches (localStorage), a browse-by-tag row, and a trending rail.
//
// Run: npm run build && npx vite preview --port 4173 & node tools/search-page-test.mjs
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
    rel('FONT-SR0001', 'Techno Rain', 'DJ One', ['techno', 'night']),
    rel('FONT-SR0002', 'Ambient Fog', 'DJ Two', ['ambient']),
    rel('FONT-SR0003', 'House Party', 'DJ Three', ['house', 'night']),
];
const TOP = { window: 'week', top: [{ id: 'FONT-SR0001', plays: 40 }, { id: 'FONT-SR0003', plays: 22 }, { id: 'FONT-SR0002', plays: 9 }], durable: true };

async function main() {
    const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/registry', (r) => r.fulfill({ json: REGISTRY, headers: { 'access-control-allow-origin': '*' } }));
    await page.route('**/api/v1/plays/top**', (r) => r.fulfill({ json: TOP }));

    // 1) empty query state shows discovery sections (tags + trending), not a list
    await page.goto(`${BASE}/#/search`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    let body = await page.textContent('body');
    check('search page renders heading', body.includes('Search'));
    check('browse-tags section shown when idle', body.includes('Browse tags') && body.includes('night'), 'no tags');
    check('trending rail shown when idle', body.includes('Trending this week'));

    // 2) typing produces live results (no submit)
    const box = page.getByRole('main').getByRole('textbox', { name: 'Search the registry' });
    await box.click();
    await box.type('techno', { delay: 40 });
    await page.waitForTimeout(600);
    body = await page.textContent('body');
    check('typing filters to the matching release', body.includes('Techno Rain') && !body.includes('House Party'), 'filter wrong');
    check('result count line shown', /result/.test(body));
    check('query reflected into the URL (shareable)', /#\/search\?q=techno$/.test(page.url()), page.url());

    // 3) clear returns to discovery + records a recent search
    await page.locator("button[aria-label='Clear search']").click();
    await page.waitForTimeout(600);
    body = await page.textContent('body');
    check('clearing returns to discovery view', body.includes('Trending this week') || body.includes('Browse tags'));
    check('the just-run query is saved under Recent', body.includes('Recent') && body.includes('techno'), 'no recent');

    // 4) clicking a recent chip re-runs the search
    await page.getByText('techno', { exact: true }).first().click();
    await page.waitForTimeout(600);
    body = await page.textContent('body');
    check('recent chip re-runs the query', body.includes('Techno Rain'));

    // 5) deep-link with ?q= lands pre-filtered
    await page.goto(`${BASE}/#/search?q=house`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    body = await page.textContent('body');
    check('deep-link ?q= pre-filters results', body.includes('House Party') && !body.includes('Techno Rain'), 'deep-link fail');

    await browser.close();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
