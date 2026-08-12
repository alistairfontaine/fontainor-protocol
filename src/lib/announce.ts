// announce.ts — one polite ARIA live region for the whole app.
//
// Screen-reader users got no signal when a download finished in the
// background, failed, or queued up waiting for Wi-Fi: those states were
// painted, never announced (the app had zero aria-live regions). Any module
// can push a short message here; the region is created on first use and
// reused forever, so there is exactly one announcer in the DOM.
//
// Use sparingly — announcements interrupt what the reader is doing. State
// *transitions* the user asked for (download done / failed / queued) qualify;
// continuous progress (percentages) does not.

let region: HTMLElement | null = null

function liveRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (region && region.isConnected) return region
  region = document.createElement('div')
  region.id = 'sr-announcer'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  // Visually hidden but NOT display:none / visibility:hidden — those silence
  // live regions in every screen reader.
  Object.assign(region.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    margin: '-1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(region)
  return region
}

export function announce(message: string): void {
  const el = liveRegion()
  if (!el) return
  // Clear first so a repeated message (downloading the same track twice)
  // announces again — assistive tech ignores unchanged textContent.
  el.textContent = ''
  window.setTimeout(() => {
    if (el.isConnected) el.textContent = message
  }, 30)
}
