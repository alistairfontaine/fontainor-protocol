// recommend-ui-libs-test.mjs — recommend.ts, artColor.ts, announce.ts (C38).
//
// Why this exists: three shipped-untested UI libraries —
//   • recommend.ts: "More like this" admitted a release with NO shared tag
//     and a different artist on freshness alone (0.001 score, empty reason);
//   • artColor.ts: the tint cache was keyed on release id only, so a null
//     from one failing gateway was cached for the whole session and the tint
//     never recovered after the coverUrl promoted to arweave.net;
//   • announce.ts: overlapping announcements within the 30 ms re-announce
//     window wrote the OLDER message into the ARIA live region.
//
// Bundled with esbuild, run in Node with stubbed DOM (Image/canvas/document).
//
// Run: node tools/recommend-ui-libs-test.mjs   (exit 0 = pass)
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

const dir = mkdtempSync(join(tmpdir(), 'reclibs-'))
const entry = join(dir, 'entry.ts')
writeFileSync(
  entry,
  `export * from '${process.cwd()}/src/lib/recommend'\n` +
    `export { dominantColor, BRAND_TINT } from '${process.cwd()}/src/lib/artColor'\n` +
    `export { announce } from '${process.cwd()}/src/lib/announce'\n`,
)
const outfile = join(dir, 'bundle.mjs')
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  logLevel: 'silent',
})

// --- DOM stubs (installed before import) -------------------------------------

/** url → flat RGBA pixel plan (or 'fail'). */
const imagePlan = new Map()
let lastDrawnSrc = null

class FakeImage {
  set src(v) {
    this._src = String(v)
    queueMicrotask(() => {
      if (imagePlan.get(this._src) === 'fail' || !imagePlan.has(this._src)) this.onerror?.()
      else this.onload?.()
    })
  }
  get src() {
    return this._src
  }
}

function solidPixels(r, g, b, count = 24 * 24) {
  const data = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return data
}

const fakeCtx = {
  drawImage(img) {
    lastDrawnSrc = img.src
  },
  getImageData() {
    return { data: imagePlan.get(lastDrawnSrc) }
  },
}

const announcerWrites = [] // every textContent assignment on the live region

function fakeElement(tag) {
  const el = {
    tagName: tag,
    style: {},
    isConnected: true,
    id: '',
    setAttribute() {},
    getContext: (kind) => (kind === '2d' ? fakeCtx : null),
    width: 0,
    height: 0,
  }
  let text = ''
  Object.defineProperty(el, 'textContent', {
    get: () => text,
    set: (v) => {
      text = v
      if (el.id === 'sr-announcer') announcerWrites.push(v)
    },
  })
  return el
}

globalThis.window = globalThis
globalThis.document = {
  createElement: (tag) => fakeElement(tag),
  body: { appendChild() {} },
}
globalThis.Image = FakeImage

const m = await import(outfile)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- recommend.ts -------------------------------------------------------------

const rel = (id, artist, tags, extra = {}) => ({ id, type: 'release', title: `T-${id}`, artist, tags, ...extra })
const CATALOG = [
  rel('a1', 'Ayo', ['afrobeat', 'soul']),
  rel('a2', 'Ayo', ['afrobeat']),
  rel('b1', 'Brill', ['soul', 'jazz']),
  rel('c1', 'Cass', ['techno']),
  rel('d1', 'Dee', ['ambient'], { date: new Date().toISOString() }), // brand new, unrelated
]

console.log('1. recommendFor: cold start and taste profile')
{
  check('cold start returns []', m.recommendFor(CATALOG, [], [], 5).length === 0)
  const recs = m.recommendFor(CATALOG, ['a1'], [], 5)
  check('liking a1 recommends the unheard a2 first', recs[0]?.rel.id === 'a2', JSON.stringify(recs.map((r) => r.rel.id)))
  check('known releases are never recommended', recs.every((r) => r.rel.id !== 'a1'))
  check('reasons are human copy', recs.every((r) => typeof r.reason === 'string' && r.reason.length > 0))
  const viaHistory = m.recommendFor(CATALOG, [], ['b1'], 5)
  check('history alone also builds a profile', viaHistory.length > 0 && viaHistory.every((r) => r.rel.id !== 'b1'))
}

console.log('2. similarTo: freshness is a tiebreaker, never a qualifier')
{
  const sims = m.similarTo(CATALOG[0], CATALOG, 5) // a1: afrobeat+soul by Ayo
  const ids = sims.map((s) => s.rel.id)
  check('shared-tag and same-artist releases qualify', ids.includes('a2') && ids.includes('b1'), JSON.stringify(ids))
  check('unrelated brand-new release (d1) is excluded', !ids.includes('d1'), JSON.stringify(ids))
  check('unrelated genre (c1) is excluded', !ids.includes('c1'))
  check('every pick carries a non-empty reason', sims.every((s) => s.reason.length > 0), JSON.stringify(sims.map((s) => s.reason)))
}

// --- artColor.ts ---------------------------------------------------------------

console.log('3. dominantColor: extraction, failure, and the gateway-promotion cache')
{
  imagePlan.set('https://gw.example/red.png', solidPixels(200, 30, 30))
  const tint = await m.dominantColor({ id: 'r1', coverUrl: 'https://gw.example/red.png' })
  check('red cover yields a red-dominant tint', Array.isArray(tint) && tint[0] > tint[1] && tint[0] > tint[2], JSON.stringify(tint))
  const lum = tint ? (0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2]) / 255 : 0
  check('tint is clamped into the readable band', lum >= 0.3 && lum <= 0.67, `lum=${lum.toFixed(3)}`)

  check('missing cover → null', (await m.dominantColor({ id: 'r2' })) === null)

  imagePlan.set('https://dead-gateway.example/c.png', 'fail')
  const failed = await m.dominantColor({ id: 'r3', coverUrl: 'https://dead-gateway.example/c.png' })
  check('failing gateway → null (graceful)', failed === null)

  // The same release settles and its coverUrl promotes to arweave.net.
  imagePlan.set('https://arweave.net/c.png', solidPixels(30, 60, 220))
  const healed = await m.dominantColor({ id: 'r3', coverUrl: 'https://arweave.net/c.png' })
  check('promoted URL is re-extracted, not served the cached null', Array.isArray(healed) && healed[2] > healed[0], JSON.stringify(healed))

  // And the cache still works per (id, url):
  lastDrawnSrc = null
  const again = await m.dominantColor({ id: 'r3', coverUrl: 'https://arweave.net/c.png' })
  check('repeat call is served from cache (no redraw)', lastDrawnSrc === null && Array.isArray(again))
}

// --- announce.ts -----------------------------------------------------------------

console.log('4. announce: overlapping messages never resurrect the older one')
{
  m.announce('Download A finished')
  await sleep(60)
  check('single announcement lands after the clear', announcerWrites.at(-1) === 'Download A finished', JSON.stringify(announcerWrites))

  announcerWrites.length = 0
  m.announce('OLD message')
  await sleep(5) // second announce inside the 30 ms re-announce window
  m.announce('NEW message')
  await sleep(80)
  check('latest message is announced', announcerWrites.at(-1) === 'NEW message', JSON.stringify(announcerWrites))
  check('older message never written after the newer clear', !announcerWrites.includes('OLD message'), JSON.stringify(announcerWrites))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
