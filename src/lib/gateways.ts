// Permanent-storage gateway failover.
//
// A published release's `audioUri` is ONE gateway's URL for content that is not
// owned by that gateway: `https://gateway.irys.xyz/<id>` and
// `https://arweave.net/<id>` are two doors to the same permanent bytes. The
// registry stores whichever door the publisher used, so a single slow, blocked
// or 5xx-ing gateway made an otherwise permanent catalog unplayable — and the
// player read that network failure as "this release has no audio" and started
// the demo simulator: a moving playhead with no sound.
//
// So: derive the other doors from the content id and try them in turn.
//
// Ordering matters, and not in the obvious way. Verified 2026-08-11 against
// live gateways: a FRESH Irys data item is served by gateway.irys.xyz (200)
// while arweave.net still answers 404 — it only appears there once Irys settles
// the bundle onto Arweave. An older, settled item is served by both. So the
// published URL must stay first (it is the only host guaranteed to have new
// content) and alternates are a fallback, not a load-balancer. What we do
// remember is FAILURE: a gateway that just failed is demoted for a few minutes,
// which is what makes the second track start instantly for a user whose network
// cannot reach that host at all.

const DOWN_KEY = 'fontainor_gateway_down_v1'
const DOWN_TTL = 10 * 60 * 1000 // 10 min: long enough to skip a dead host, short enough to recover

/** Gateways that serve content by id at `/<id>`. */
export const GATEWAYS = ['https://gateway.irys.xyz', 'https://arweave.net'] as const

const ID_RE = /^[A-Za-z0-9_-]{43}$/

function isKnown(o: string): boolean {
  return (GATEWAYS as readonly string[]).includes(o)
}

/** The content id inside a gateway-addressed URL, or null if this is not one. */
export function contentIdOf(uri: string): string | null {
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return null
  }
  const seg = u.pathname.split('/').filter(Boolean)
  if (seg.length !== 1) return null // /<id> only — never rewrite a deeper path
  return ID_RE.test(seg[0]) ? seg[0] : null
}

function originOf(uri: string): string | null {
  try {
    return new URL(uri).origin
  } catch {
    return null
  }
}

function readDown(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(DOWN_KEY) ?? '{}') as Record<string, unknown>
    const now = Date.now()
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && now - v < DOWN_TTL) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeDown(map: Record<string, number>): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(DOWN_KEY)
    else localStorage.setItem(DOWN_KEY, JSON.stringify(map))
  } catch {
    /* best-effort */
  }
}

/** This gateway just failed us: demote it for the next few minutes. */
export function markGatewayDown(uri: string): void {
  const o = originOf(uri)
  if (!o || !isKnown(o)) return
  const map = readDown()
  map[o] = Date.now()
  writeDown(map)
}

/** This gateway just served us: it is not down. */
export function markGatewayUp(uri: string): void {
  const o = originOf(uri)
  if (!o || !isKnown(o)) return
  const map = readDown()
  if (o in map) {
    delete map[o]
    writeDown(map)
  }
}

/** True while `uri`'s gateway is inside its demotion window. */
export function isGatewayDown(uri: string): boolean {
  const o = originOf(uri)
  return !!o && o in readDown()
}

// --- Settled promotion -------------------------------------------------
//
// The two gateways serve the same permanent bytes with wildly different HTTP
// caching (verified live 2026-08-11): arweave.net answers with
// `cache-control: max-age=3153600000` (a hundred years — correct for
// immutable content), while gateway.irys.xyz answers with `max-age=10`.
// Ten seconds. So a catalog that always streams from the published Irys URL
// re-downloads the ENTIRE file on every replay, while the identical content
// one gateway over would be a free browser-cache hit — real money for
// listeners on metered data.
//
// We cannot simply put arweave.net first: a fresh Irys item 404s there until
// the bundle settles. But settlement is one-way — Arweave is permanent, so an
// id seen settled once is settled forever. Hence: after a gateway-addressed
// track plays, a throttled background probe asks arweave.net for the id
// (follow redirects — arweave.net 302s to a sandbox subdomain and the
// redirect itself says nothing; only the FINAL status counts). A settled id
// is remembered in localStorage and from then on arweave.net is preferred
// for it. Demotion still outranks promotion: a host that just failed goes to
// the back regardless.

const SETTLED_KEY = 'fontainor_gateway_settled_v1'
const SETTLED_MAX = 500 // ids; oldest dropped first (recency, not correctness)
const PROBE_TTL = 24 * 60 * 60 * 1000 // failed probes retry at most daily
const probeInFlight = new Set<string>()
const probeFailedAt = new Map<string, number>()

function readSettled(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTLED_KEY) ?? '{}') as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (ID_RE.test(k) && typeof v === 'number') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeSettled(map: Record<string, number>): void {
  try {
    const keys = Object.keys(map)
    if (keys.length > SETTLED_MAX) {
      // drop the oldest entries; the ids stay settled, we just forget the hint
      keys
        .sort((a, b) => map[a] - map[b])
        .slice(0, keys.length - SETTLED_MAX)
        .forEach((k) => delete map[k])
    }
    localStorage.setItem(SETTLED_KEY, JSON.stringify(map))
  } catch {
    /* best-effort */
  }
}

/** True when this content id is known to be settled onto Arweave. */
export function isSettled(id: string): boolean {
  return id in readSettled()
}

/** Record a settled id (exported for the player, which learns it for free
 *  whenever arweave.net successfully serves a track). */
export function markSettled(id: string): void {
  if (!ID_RE.test(id) || isSettled(id)) return
  const map = readSettled()
  map[id] = Date.now()
  writeSettled(map)
}

/**
 * Background settlement probe: a bare HEAD (no custom headers, so no CORS
 * preflight; no body, so no data cost), throttled, fire-and-forget. Call it
 * when a gateway-addressed track starts playing; it makes the NEXT play of
 * that track cache-friendly.
 */
export function probeSettled(uri: string): void {
  const id = contentIdOf(uri)
  if (!id || isSettled(id) || probeInFlight.has(id)) return
  const failed = probeFailedAt.get(id)
  if (failed && Date.now() - failed < PROBE_TTL) return
  probeInFlight.add(id)
  fetch(`https://arweave.net/${id}`, {
    method: 'HEAD',
    redirect: 'follow', // the 302 to the sandbox subdomain proves nothing
  })
    .then((r) => {
      if (r.ok) markSettled(id)
      else probeFailedAt.set(id, Date.now())
    })
    .catch(() => {
      probeFailedAt.set(id, Date.now())
    })
    .finally(() => {
      probeInFlight.delete(id)
    })
}

/**
 * Every URL worth trying for this media, best first.
 *
 * - Not gateway-addressed (a relative `/audio/x.mp3`, an S3 link, a deeper
 *   gateway path) → exactly the original URL, untouched.
 * - Gateway-addressed → published URL first, then the other known gateways,
 *   with any gateway inside its demotion window moved to the back (still tried:
 *   a demoted host is better than no audio).
 * - Once the id is known settled, arweave.net moves to the front: its
 *   hundred-year `cache-control` makes every replay a free cache hit, where
 *   the Irys gateway's `max-age=10` re-downloads the file every time.
 */
export function mediaCandidates(uri: string): string[] {
  if (!uri) return []
  const id = contentIdOf(uri)
  if (!id) return [uri]
  const ordered: string[] = [uri]
  for (const g of GATEWAYS) {
    const u = `${g}/${id}`
    if (!ordered.includes(u)) ordered.push(u)
  }
  if (isSettled(id)) {
    const arw = `https://arweave.net/${id}`
    const i = ordered.indexOf(arw)
    if (i > 0) {
      ordered.splice(i, 1)
      ordered.unshift(arw)
    }
  }
  const down = readDown()
  const live = ordered.filter((u) => {
    const o = originOf(u)
    return !o || !(o in down)
  })
  const demoted = ordered.filter((u) => !live.includes(u))
  return [...live, ...demoted]
}
