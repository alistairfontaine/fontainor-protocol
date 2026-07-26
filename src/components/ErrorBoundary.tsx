import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i

/** Catches route render errors. Chunk-load failures (stale tab after a
 * redeploy) trigger one automatic reload; anything else gets a styled
 * error screen instead of a dead black page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (CHUNK_ERROR.test(error.message)) {
      const KEY = 'fontainor:chunk-reload'
      if (sessionStorage.getItem(KEY) !== '1') {
        sessionStorage.setItem(KEY, '1')
        window.location.reload()
      }
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <span className="font-display text-[64px] font-bold leading-none text-raised select-none">:(</span>
          <h1 className="font-display text-xl font-semibold text-ink">Something went wrong</h1>
          <p className="max-w-sm text-sm text-muted">
            The page hit an unexpected error. Reloading usually fixes it — your favorites and history are safe.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 cursor-pointer rounded-btn bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hi"
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
