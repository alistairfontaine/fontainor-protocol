// a11y-test.mjs — axe-core WCAG 2.0 A/AA gate over the built app.
//
// Serious/critical violations fail the suite. This exists because the launch
// palette shipped --color-faint at 3.5-3.9:1 (WCAG AA needs 4.5:1) and inline
// links relied on color alone; both were only caught by a manual audit.
//
// Usage: node tools/a11y-test.mjs   (expects a vite preview on PORT or 4173)
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const axeSource = fs.readFileSync(
  path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);

const PORT = process.env.PORT || 4173;
const BASE = `http://localhost:${PORT}`;
const ROUTES = ['/#/', '/#/search', '/#/android', '/#/support', '/#/library', '/#/editorial', '/#/faq', '/#/contact'];

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

for (const route of ROUTES) {
  await page.goto(BASE + route);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.evaluate(axeSource);
  const res = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }));
  const serious = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  const detail = serious
    .map((v) => `${v.id} (${v.nodes.length} nodes, e.g. ${v.nodes[0]?.target?.[0]})`)
    .join('; ');
  check(`${route} has no serious/critical WCAG A/AA violations`, serious.length === 0, detail);
}

await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
