// Server-clock alignment for signed messages.
//
// Signed auth messages carry the time they were issued and the API rejects
// anything older than its freshness window. That window is measured against
// the SERVER's clock, but the timestamp is stamped by the DEVICE — and phone
// clocks drift (manual time zones, dead battery, no NTP). A device running 15
// minutes behind would sign a message the server reads as already expired, and
// the user would be locked out of sign-in with no way to guess why.
//
// Fix: learn the offset between the two clocks from the `Date` header that
// every HTTP response already carries, and stamp messages with server time.
// No extra request, no new endpoint, and it self-corrects on every API call.

let offsetMs = 0
let learned = false

/** Record the clock offset from any API response. Cheap, call it freely. */
export function noteServerDate(res: Response | { headers: Headers }): void {
  try {
    const header = res.headers.get('date')
    if (!header) return
    const serverMs = Date.parse(header)
    if (!Number.isFinite(serverMs)) return
    // The Date header has 1-second resolution, so treat sub-second deltas as
    // zero rather than chasing rounding noise.
    const delta = serverMs - Date.now()
    offsetMs = Math.abs(delta) < 1000 ? 0 : delta
    learned = true
  } catch {
    /* opaque response or no headers — keep the previous offset */
  }
}

/** True once we've seen a server date and can trust syncedNow(). */
export function clockSynced(): boolean {
  return learned
}

/** Current offset in ms (server − device). Exposed for diagnostics. */
export function clockOffsetMs(): number {
  return offsetMs
}

/** Now, in the server's frame of reference. Use for signed timestamps. */
export function syncedNow(): number {
  return Date.now() + offsetMs
}

/**
 * Learn the offset before signing, if we haven't yet. Uses a HEAD request to
 * an endpoint that is always present; falls back to GET where HEAD is blocked.
 * Never throws — an unreachable API just leaves the device clock in charge.
 */
export async function primeServerClock(apiBase: string): Promise<void> {
  if (learned) return
  const url = `${apiBase}/registry`
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    noteServerDate(res)
    if (learned) return
  } catch {
    /* fall through to GET */
  }
  try {
    noteServerDate(await fetch(url, { cache: 'no-store' }))
  } catch {
    /* offline — device clock it is */
  }
}
