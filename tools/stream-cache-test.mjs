// stream-cache-test.mjs — the Metrolist-inspired session stream cache (C40).
//
// Contract under test (src/lib/streamCache.ts):
//   - keys canonicalise to the permanent content id, so the SAME bytes reached
//     through gateway.irys.xyz and arweave.net share ONE cache entry;
//   - stashStream fetches once, stores in CacheStorage, materialises a blob
//     URL, and updates the LRU index;
//   - the byte cap (settings-overridable) evicts oldest-touched first and
//     never the entry just written;
//   - oversize items and failed fetches are never cached;
//   - a fresh session (new module instance, same CacheStorage) serves warm
//     hits WITHOUT a network fetch, and prunes index entries whose body is gone;
//   - clearStreamCache wipes cache, index, and blob URLs.
//
// Run: node tools/stream-cache-test.mjs   (exit 0 = pass)
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

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

// --- stubs -------------------------------------------------------------------

const lsMap = new Map()
globalThis.localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => lsMap.set(k, String(v)),
  removeItem: (k) => lsMap.delete(k),
  clear: () => lsMap.clear(),
}

// CacheStorage fake — persists across module instances like the real one.
const cacheStores = new Map()
globalThis.caches = {
  open: async (name) => {
    if (!cacheStores.has(name)) cacheStores.set(name, new Map())
    const m = cacheStores.get(name)
    return {
      match: async (req) => (m.has(req) ? m.get(req).clone() : undefined),
      put: async (req, res) => m.set(req, res),
      delete: async (req) => m.delete(req),
    }
  },
  delete: async (name) => cacheStores.delete(name),
}

// blob URLs — count creations/revocations
let blobSeq = 0
const liveBlobUrls = new Set()
URL.createObjectURL = () => {
  const u = `blob:test/${++blobSeq}`
  liveBlobUrls.add(u)
  return u
}
URL.revokeObjectURL = (u) => liveBlobUrls.delete(u)

// fetch — url → { status, size } plan, with a call log
const fetchLog = []
let fetchPlan = {}
globalThis.fetch = async (url) => {
  fetchLog.push(url)
  const plan = fetchPlan[url] ?? { status: 404, size: 0 }
  if (plan.status !== 200) return new Response(null, { status: plan.status })
  return new Response(new Blob([new Uint8Array(plan.size)]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  })
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10))
}

// --- bundle ------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'streamcache-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `export * from '${process.cwd()}/src/lib/streamCache'\n`)
const outfile = join(dir, 'bundle.mjs')
await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'] })
const freshInstance = (tag) => import(`${pathToFileURL(outfile).href}?i=${tag}`)

const ID_A = 'A'.repeat(43)
const ID_B = 'B'.repeat(43)
const ID_C = 'C'.repeat(43)
const irys = (id) => `https://gateway.irys.xyz/${id}`
const arw = (id) => `https://arweave.net/${id}`

// Small cap so eviction is testable: 1000 bytes.
localStorage.setItem('fontainor_stream_cache_cap_v1', '1000')

let sc = await freshInstance(1)

console.log('1. keys and cold lookups')
check('gateway URL keys to its content id', sc.streamKeyOf(irys(ID_A)) === ID_A)
check('both gateways share one key', sc.streamKeyOf(arw(ID_A)) === sc.streamKeyOf(irys(ID_A)))
check('non-gateway URL keys to itself', sc.streamKeyOf('https://example.com/x/y.mp3') === 'https://example.com/x/y.mp3')
check('cold cache answers null', sc.cachedStreamUrl(irys(ID_A)) === null)

console.log('2. stash → materialised blob URL, shared across gateways')
fetchPlan = { [irys(ID_A)]: { status: 200, size: 400 } }
sc.stashStream(irys(ID_A), irys(ID_A))
await settle()
const urlA = sc.cachedStreamUrl(irys(ID_A))
check('stashed track is served as a blob URL', typeof urlA === 'string' && urlA.startsWith('blob:'))
check('the OTHER gateway URL hits the same entry', sc.cachedStreamUrl(arw(ID_A)) === urlA)
check('exactly one network fetch', fetchLog.length === 1)
check('index carries the byte size', sc.streamCacheBytes() === 400)

console.log('3. refusals: oversize and failed fetches')
fetchPlan = { [irys(ID_B)]: { status: 200, size: 1200 }, [irys(ID_C)]: { status: 500, size: 0 } }
sc.stashStream(irys(ID_B), irys(ID_B))
sc.stashStream(irys(ID_C), irys(ID_C))
await settle()
check('an item bigger than the cap is refused', sc.cachedStreamUrl(irys(ID_B)) === null)
check('a failed fetch is not cached', sc.cachedStreamUrl(irys(ID_C)) === null)
check('index unchanged after refusals', sc.streamCacheBytes() === 400)

console.log('4. LRU eviction under the cap')
fetchPlan = { [irys(ID_B)]: { status: 200, size: 400 }, [irys(ID_C)]: { status: 200, size: 400 } }
sc.stashStream(irys(ID_B), irys(ID_B))
await settle()
await new Promise((r) => setTimeout(r, 15)) // strictly newer LRU stamps
sc.stashStream(irys(ID_C), irys(ID_C)) // 1200 total > 1000 → evict oldest (A)
await settle()
check('oldest-touched entry (A) was evicted', sc.cachedStreamUrl(irys(ID_A)) === null)
check('newer entry (B) survives', sc.cachedStreamUrl(irys(ID_B)) !== null)
check('the just-written entry (C) is never the victim', sc.cachedStreamUrl(irys(ID_C)) !== null)
check('index total back under the cap', sc.streamCacheBytes() <= 1000)
check("A's blob URL was revoked", !liveBlobUrls.has(urlA))

console.log('5. a new session serves warm hits without the network')
const fetchesBefore = fetchLog.length
const sc2 = await freshInstance(2)
check('new session starts cold in memory', sc2.cachedStreamUrl(irys(ID_B)) === null)
sc2.warmStreamCache(irys(ID_B))
await settle()
const urlB2 = sc2.cachedStreamUrl(irys(ID_B))
check('warm materialises the CacheStorage body', typeof urlB2 === 'string' && urlB2.startsWith('blob:'))
check('no network fetch for a warm hit', fetchLog.length === fetchesBefore)
sc2.stashStream(irys(ID_B), irys(ID_B))
await settle()
check('stash of an already-cached id does not re-fetch', fetchLog.length === fetchesBefore)

console.log('6. stale index entries (body gone) are pruned on warm')
const store = cacheStores.get('fontainor-stream-v1')
store.delete(`/__stream-cache__/${encodeURIComponent(ID_C)}`) // body vanishes (browser pressure-evicted it)
const sc3 = await freshInstance(3)
sc3.warmStreamCache(irys(ID_C))
await settle()
check('warm miss prunes the index entry', !JSON.parse(lsMap.get('fontainor_stream_cache_index_v1')).some((e) => e.key === ID_C))
check('warm miss stays null', sc3.cachedStreamUrl(irys(ID_C)) === null)

console.log('7. clearStreamCache wipes everything')
await sc2.clearStreamCache()
check('index emptied', sc2.streamCacheBytes() === 0)
check('cache store deleted', !cacheStores.has('fontainor-stream-v1'))
check('in-memory URL gone after clear', sc2.cachedStreamUrl(irys(ID_B)) === null)

console.log('8. setStreamCacheCapBytes persists the cap and evicts immediately')
fetchPlan = { [irys(ID_A)]: { status: 200, size: 400 }, [irys(ID_B)]: { status: 200, size: 400 } }
sc2.stashStream(irys(ID_A), irys(ID_A))
await settle()
await new Promise((r) => setTimeout(r, 15)) // strictly newer LRU stamp for B
sc2.stashStream(irys(ID_B), irys(ID_B))
await settle()
check('two entries cached again', sc2.streamCacheBytes() === 800)
await sc2.setStreamCacheCapBytes(500)
check('new cap persisted', lsMap.get('fontainor_stream_cache_cap_v1') === '500')
check('cap getter reflects the new value', sc2.streamCacheCapBytes() === 500)
check('lowering the cap evicts the oldest entry at once', sc2.cachedStreamUrl(irys(ID_A)) === null)
check('the newest entry survives the cap cut', sc2.cachedStreamUrl(irys(ID_B)) !== null)
check('usage back under the new cap', sc2.streamCacheBytes() <= 500)
const usageBefore = sc2.streamCacheBytes()
await sc2.enforceStreamCacheCap()
check('enforce is a no-op when already under the cap', sc2.streamCacheBytes() === usageBefore && sc2.cachedStreamUrl(irys(ID_B)) !== null)
await sc2.setStreamCacheCapBytes(0)
check('an invalid cap restores the default', !lsMap.has('fontainor_stream_cache_cap_v1') && sc2.streamCacheCapBytes() === sc2.STREAM_CACHE_DEFAULT_BYTES)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
