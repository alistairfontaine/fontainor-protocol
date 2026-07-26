// Client-side error log (F-resilience). Records every uncaught error to
// localStorage so failures on user machines we can't reproduce become
// diagnosable: the error screen shows the details, and the last few errors
// survive reloads. Inspect in DevTools with `window.__fontainorErrors`.

const LOG_KEY = 'fontainor:errlog'
const MAX_ENTRIES = 10

export interface ErrEntry {
  at: string
  route: string
  source: string
  name: string
  message: string
  stack: string
  ua: string
}

export function toEntry(err: unknown, source: string): ErrEntry {
  const e = err instanceof Error ? err : new Error(String(err))
  return {
    at: new Date().toISOString(),
    route: window.location.hash || window.location.pathname,
    source,
    name: e.name,
    message: e.message,
    // first stack frames are enough to locate the throw with sourcemaps
    stack: (e.stack || '').split('\n').slice(0, 8).join('\n'),
    ua: navigator.userAgent,
  }
}

export function recordError(err: unknown, source: string): ErrEntry {
  const entry = toEntry(err, source)
  try {
    const raw = localStorage.getItem(LOG_KEY)
    const list = raw ? (JSON.parse(raw) as ErrEntry[]) : []
    const next = [...(Array.isArray(list) ? list : []), entry].slice(-MAX_ENTRIES)
    localStorage.setItem(LOG_KEY, JSON.stringify(next))
  } catch {
    /* storage blocked/full — details still shown on screen */
  }
  return entry
}

export function formatEntry(entry: ErrEntry): string {
  return `${entry.name}: ${entry.message}\nroute: ${entry.route} (${entry.source}) @ ${entry.at}\n${entry.stack}\n${entry.ua}`
}

declare global {
  interface Window {
    __fontainorErrors?: () => ErrEntry[]
  }
}

// console helper: window.__fontainorErrors()
if (typeof window !== 'undefined') {
  window.__fontainorErrors = () => {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY) || '[]') as ErrEntry[]
    } catch {
      return []
    }
  }
}
