// Demo publish store (PUB-DEMO-01).
// No funded Arweave wallet exists yet, so "publishing" writes the asset to
// localStorage instead of the chain. Published items are merged into the
// registry view on load, so they appear in Library / Home / Profile like any
// other release — clearly labeled as demo. Swapping to real publishing later
// requires no UI changes: flip DEMO_PUBLISH in lib/api.ts.

const KEY = 'fontainor_local_pubs_v1'

export const DEMO_STATUS = 'DEMO_LOCAL_ONLY'

export function loadLocalPublications(): unknown[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function addLocalPublication(asset: Record<string, unknown>): void {
  const marked = { ...asset, status: DEMO_STATUS }
  const all = [marked, ...loadLocalPublications()]
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50)))
  } catch {
    /* quota / private mode — the item still shows for this session via reload merge */
  }
}
