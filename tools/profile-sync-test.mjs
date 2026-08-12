// profile-sync-test.mjs — the wallet-portable profile sync layer.
//
// Why this exists (C38): three latent bugs lived here untested —
//   1. wallet-switch race: an in-flight syncProfile(walletA) merged A's
//      favorites/purchases into local state AFTER the user switched to
//      wallet B, and could then push the polluted replica to the server
//      under B's proof (cross-wallet identity leak);
//   2. write amplification: pullFavorites pushed back whenever ANY unlike
//      tombstone existed — tombstones live 90 days, so every app start did
//      a pointless authenticated POST forever;
//   3. dead-proof retry: a 401/403 never cleared the stored proof, so every
//      like retried a known-dead credential for up to 7 days.
//
// The module is bundled with esbuild together with the real collections
// store and run in Node with stubbed fetch + localStorage — deterministic,
// no live API, no browser.
//
// Run: node tools/profile-sync-test.mjs   (exit 0 = pass)
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
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

// --- stubs installed before the bundle loads --------------------------------

function makeLocalStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
}

// --- bundle: profileSync + the real collections store as ONE instance --------

const dir = mkdtempSync(join(tmpdir(), 'profsync-'))
const entry = join(dir, 'entry.ts')
writeFileSync(
  entry,
  `export * from '${process.cwd()}/src/lib/profileSync'\n` +
    `export { getFavoritesState, mergeFavoritesState } from '${process.cwd()}/src/state/collections'\n` +
    `export { mergePurchases, loadPurchases } from '${process.cwd()}/src/lib/purchase'\n`,
)
// purchase.ts imports phantom.ts (wallet plumbing → @solana/web3.js) only for
// the buy flow, which this suite never exercises. Stub it out so the bundle
// stays browser-free and deterministic.
const phantomStub = join(dir, 'phantom-stub.ts')
writeFileSync(
  phantomStub,
  `export class PhantomError extends Error {}\n` +
    `export function getConnectedPhantom() { throw new PhantomError('stub') }\n` +
    `export async function getWorkingRpc() { throw new PhantomError('stub') }\n`,
)
const stubPhantom = {
  name: 'stub-phantom',
  setup(b) {
    b.onResolve({ filter: /\/phantom$|^\.\/phantom$/ }, () => ({ path: phantomStub }))
  },
}

const outfile = join(dir, 'bundle.mjs')
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  logLevel: 'silent',
  plugins: [stubPhantom],
  external: ['@solana/web3.js'],
  define: { 'import.meta.env.VITE_API_BASE': 'undefined', 'import.meta.env': '{}' },
})

let loads = 0
async function freshModule() {
  globalThis.localStorage = makeLocalStorage()
  globalThis.window = globalThis
  const copy = join(dir, `bundle.${loads++}.mjs`)
  writeFileSync(copy, readFileSync(outfile))
  return import(copy)
}

const enc = (obj) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => obj,
})

function proofFor(wallet) {
  return {
    publicKey: '[1,2,3]',
    signature: '[4,5,6]',
    message: `Fontainor sovereign login :: ${Date.now()}`,
    wallet,
    issuedAt: Date.now(),
  }
}

/** Fetch stub: routes /purchases and /favorites per wallet, records POSTs,
 *  and lets a scenario hold responses until released (deferred). */
function stubFetch(plan) {
  const posts = []
  const held = []
  globalThis.fetch = (url, init) => {
    const u = String(url)
    if (init?.method === 'POST') {
      posts.push({ url: u, body: JSON.parse(init.body) })
      const status = plan.postStatus ?? 200
      return Promise.resolve({
        ok: status < 400,
        status,
        headers: { get: () => null },
        json: async () => plan.postReply ?? { ids: [], likedAt: {}, unlikedAt: {} },
      })
    }
    const wallet = new URL(u, 'https://x.invalid').searchParams.get('wallet')
    const kind = u.includes('/purchases') ? 'purchases' : 'favorites'
    const payload = plan[wallet]?.[kind] ?? (kind === 'purchases' ? { purchases: [] } : { ids: [], likedAt: {}, unlikedAt: {} })
    if (plan.hold) {
      return new Promise((resolve) => held.push(() => resolve(enc(payload))))
    }
    return Promise.resolve(enc(payload))
  }
  return { posts, release: () => held.splice(0).forEach((fn) => fn()) }
}

const tick = () => new Promise((r) => setTimeout(r, 20))

// --- 1. wallet-switch race: stale responses are discarded --------------------

console.log('1. in-flight sync for wallet A is discarded after the identity is cleared')
{
  const m = await freshModule()
  const plan = {
    hold: true,
    A: { favorites: { ids: ['trackA'], likedAt: { trackA: 100 }, unlikedAt: {} }, purchases: { purchases: [{ trackId: 'tA', signature: 'sigA', artistWallet: 'w', amountLamports: 5, verifiedAt: 'x' }] } },
  }
  const { posts, release } = stubFetch(plan)
  m.saveSessionProof(proofFor('A'))
  const p = m.syncProfile('A')
  m.clearSessionProof() // accountChanged / disconnect while pulls are in flight
  release()
  await p
  await tick()
  check('wallet A favorites NOT merged after clear', !m.getFavoritesState().ids.includes('trackA'), JSON.stringify(m.getFavoritesState().ids))
  check('wallet A purchases NOT merged after clear', !(m.loadPurchases()).some((r) => r.signature === 'sigA'))
  check('nothing pushed to the server', posts.length === 0, `${posts.length} POSTs`)
}

console.log('2. a NEW syncProfile invalidates the previous wallet sync (switch A→B)')
{
  const m = await freshModule()
  const plan = {
    hold: true,
    A: { favorites: { ids: ['trackA'], likedAt: { trackA: 100 }, unlikedAt: {} } },
    B: { favorites: { ids: ['trackB'], likedAt: { trackB: 200 }, unlikedAt: {} } },
  }
  const { release } = stubFetch(plan)
  m.saveSessionProof(proofFor('A'))
  const pA = m.syncProfile('A')
  m.clearSessionProof()
  m.saveSessionProof(proofFor('B'))
  const pB = m.syncProfile('B')
  release()
  await Promise.all([pA, pB])
  await tick()
  const ids = m.getFavoritesState().ids
  check('wallet B favorites merged', ids.includes('trackB'), JSON.stringify(ids))
  check('wallet A favorites discarded', !ids.includes('trackA'), JSON.stringify(ids))
}

// --- 3. write economy: no push when the server is already canonical ----------

console.log('3. pull with tombstones but no local news does NOT push back')
{
  const TOMB = Date.now() - 1000 // recent: ancient tombstones are TTL-pruned on save
  const m = await freshModule()
  const { posts } = stubFetch({
    A: { favorites: { ids: ['x'], likedAt: { x: 100 }, unlikedAt: { y: TOMB } } },
  })
  m.saveSessionProof(proofFor('A'))
  await m.syncProfile('A')
  await tick()
  check('server favorites adopted locally', m.getFavoritesState().ids.includes('x'))
  check('tombstone adopted locally', m.getFavoritesState().unlikedAt.y === TOMB)
  check('no push-back POST (server already canonical)', posts.length === 0, `${posts.length} POSTs`)
}

console.log('4. pull DOES push back when local state has news the server lacks')
{
  const m = await freshModule()
  const { posts } = stubFetch({
    A: { favorites: { ids: ['x'], likedAt: { x: 100 }, unlikedAt: {} } },
  })
  m.saveSessionProof(proofFor('A'))
  m.mergeFavoritesState({ ids: ['localOnly'], likedAt: { localOnly: Date.now() }, unlikedAt: {} })
  await m.syncProfile('A')
  await tick()
  check('push-back POST fired', posts.length === 1, `${posts.length} POSTs`)
  check('pushed replica contains the local-only like', posts.length === 1 && posts[0].body.ids.includes('localOnly'))
}

console.log('5. push-back is suppressed when the stored proof is for another wallet')
{
  const m = await freshModule()
  const { posts } = stubFetch({
    A: { favorites: { ids: ['x'], likedAt: { x: 100 }, unlikedAt: {} } },
  })
  m.saveSessionProof(proofFor('B')) // proof belongs to B, sync ran for A
  m.mergeFavoritesState({ ids: ['localOnly'], likedAt: { localOnly: Date.now() }, unlikedAt: {} })
  await m.syncProfile('A')
  await tick()
  check("no POST under another wallet's proof", posts.length === 0, `${posts.length} POSTs`)
}

// --- 6. dead proof handling ---------------------------------------------------

console.log('6. a 401 on push clears the stored proof (no retry loop with a dead credential)')
{
  const m = await freshModule()
  const { posts } = stubFetch({
    postStatus: 401,
    A: { favorites: { ids: ['x'], likedAt: { x: 100 }, unlikedAt: {} } },
  })
  m.saveSessionProof(proofFor('A'))
  m.mergeFavoritesState({ ids: ['localOnly'], likedAt: { localOnly: Date.now() }, unlikedAt: {} })
  await m.syncProfile('A')
  await tick()
  check('push attempted once', posts.length === 1, `${posts.length} POSTs`)
  check('proof cleared after 401', m.loadSessionProof() === null)
}

console.log('7. expired proofs are dropped on load')
{
  const m = await freshModule()
  stubFetch({})
  const old = proofFor('A')
  old.issuedAt = Date.now() - 8 * 24 * 60 * 60 * 1000 // 8 days > 7-day TTL
  m.saveSessionProof(old)
  check('loadSessionProof returns null for an expired proof', m.loadSessionProof() === null)
  const legacy = proofFor('A')
  delete legacy.issuedAt
  m.saveSessionProof(legacy)
  check('loadSessionProof returns null for a legacy un-timestamped proof', m.loadSessionProof() === null)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
