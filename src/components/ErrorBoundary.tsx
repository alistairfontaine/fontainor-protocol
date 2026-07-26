import { Component, type ReactNode } from 'react'
import { formatEntry, recordError, type ErrEntry } from '../lib/errlog'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  entry: ErrEntry | null
  retrying: boolean
  copied: boolean
}

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i
const RETRY_KEY = 'fontainor:err-retry-at'
const RELOAD_KEY = 'fontainor:chunk-reload-at'

/** Catches render errors and recovers automatically (RESILIENCE-01).
 *
 * Recovery ladder — users should never need to click anything:
 *   1. First failure: silently re-render once after a tick (transient
 *      races self-heal invisibly).
 *   2. Failure again within 10s: one automatic reload (guarded to once
 *      per 15s so a persistent crash can't loop).
 *   3. Still failing: styled error screen WITH the actual error details
 *      (copyable) so failures we can't reproduce are diagnosable. Every
 *      catch is also recorded to localStorage — see src/lib/errlog.ts.
 *   4. Navigating to another page always resets the boundary.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, entry: null, retrying: false, copied: false }
  private retryTimer: number | null = null

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error) {
    const entry = recordError(error, 'boundary')
    this.setState({ entry })

    if (CHUNK_ERROR.test(error.message)) {
      this.guardedReload()
      return
    }

    const now = Date.now()
    const lastRetry = Number(sessionStorage.getItem(RETRY_KEY) || 0)
    if (now - lastRetry > 10_000) {
      // step 1: silent re-render retry
      sessionStorage.setItem(RETRY_KEY, String(now))
      this.setState({ retrying: true })
      this.retryTimer = window.setTimeout(() => {
        this.setState({ error: null, entry: null, retrying: false })
      }, 150)
      return
    }
    // step 2: one automatic reload (no-op if reloaded <15s ago → step 3 screen)
    this.guardedReload()
  }

  private guardedReload() {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last > 15_000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
      window.location.reload()
    }
  }

  private onHashChange = () => {
    // step 4: navigation resets the boundary so other pages stay reachable
    if (this.state.error) this.setState({ error: null, entry: null, retrying: false, copied: false })
  }

  componentDidMount() {
    window.addEventListener('hashchange', this.onHashChange)
  }

  componentWillUnmount() {
    window.removeEventListener('hashchange', this.onHashChange)
    if (this.retryTimer) window.clearTimeout(this.retryTimer)
  }

  private copyDetails = () => {
    const { entry } = this.state
    if (!entry) return
    void navigator.clipboard
      ?.writeText(formatEntry(entry))
      .then(() => this.setState({ copied: true }))
      .catch(() => {})
  }

  render() {
    if (this.state.error && this.state.retrying) {
      // brief blank while the silent retry re-renders — never a dead page
      return <div className="min-h-[60vh]" aria-busy="true" />
    }
    if (this.state.error) {
      const { entry, copied } = this.state
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="font-display text-[64px] font-bold leading-none text-raised select-none">:(</span>
          <h1 className="font-display text-xl font-semibold text-ink">Something went wrong</h1>
          <p className="max-w-sm text-sm text-muted">
            The page hit an unexpected error and automatic recovery didn’t take. Your favorites and history are safe.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="mt-2 cursor-pointer rounded-btn bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hi"
            >
              Reload page
            </button>
            <button
              onClick={this.copyDetails}
              className="mt-2 cursor-pointer rounded-btn border border-line px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {copied ? 'Copied ✓' : 'Copy details'}
            </button>
          </div>
          {entry && (
            <pre className="mt-2 max-h-40 max-w-full overflow-auto rounded-btn border border-line bg-surface p-3 text-left text-[11px] leading-relaxed text-faint">
              {formatEntry(entry)}
            </pre>
          )}
        </div>
      )
    }
    return this.props.children
  }
}
