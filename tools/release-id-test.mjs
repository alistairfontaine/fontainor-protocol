// release-id-test: makeReleaseId() must be collision-safe and validator-compatible.
// Guards against a regression to the old Math.random().toString(36).slice(2, 8)
// scheme, which (a) had ~31 bits of entropy and (b) could emit ids SHORTER
// than the intended 6 chars (0.5 → "0.i" → "FONT-I"). Runs pure in node:
// src/lib/registry.ts has no imports, so we transpile it with esbuild and
// import the real function — no browser needed.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const js = execFileSync('npx', ['esbuild', 'src/lib/registry.ts', '--format=esm'], { encoding: 'utf8' })
const dir = mkdtempSync(join(tmpdir(), 'relid-'))
const mod = join(dir, 'registry.mjs')
writeFileSync(mod, js)
const { makeReleaseId, buildAsset } = await import(pathToFileURL(mod).href)

const N = 5000
const ids = Array.from({ length: N }, () => makeReleaseId())

// 1. Exact shape — never shorter than advertised (the old scheme could be).
const SHAPE = /^FONT-[0-9A-Z]{12}$/
const badShape = ids.filter((id) => !SHAPE.test(id))
check('all ids match FONT-<12 uppercase alphanumerics>', badShape.length === 0, badShape.slice(0, 3).join(','))

// 2. No collisions across 5000 draws (old scheme: ~0.6% odds here; new: ~0).
check(`${N} draws produce ${N} unique ids`, new Set(ids).size === N)

// 3. Entropy sanity: every alphabet character appears somewhere in the pool.
const seen = new Set(ids.join('').replace(/FONT-/g, ''))
const missing = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((c) => !seen.has(c))
check('all 36 alphabet chars appear across the pool', missing.length === 0, 'missing ' + missing.join(''))

// 4. Compatible with the server-side validators the id must pass through.
const SHARE_ID_RE = /^[A-Za-z0-9-]{4,64}$/ // api/index.js /share/:id
const PLAY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/ // api/index.js /api/v1/plays
check('ids pass the share-route validator', ids.every((id) => SHARE_ID_RE.test(id)))
check('ids pass the plays-route validator', ids.every((id) => PLAY_ID_RE.test(id)))

// 5. buildAsset threads the id through unchanged.
const asset = buildAsset({ title: 'T', artist: 'A' })
check('buildAsset id uses the new scheme', SHAPE.test(asset.id), asset.id)

rmSync(dir, { recursive: true, force: true })
console.log(`\nrelease-id: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
