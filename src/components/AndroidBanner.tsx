// Android promo banner — shown only in Android browsers (never in the native
// app), dismissible once, hidden on the /android page itself.
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { dismissBanner, isAndroidBrowser, isBannerDismissed } from '../lib/androidApp'
import { IconClose } from './icons'

export function AndroidBanner() {
  const { pathname } = useLocation()
  const [hidden, setHidden] = useState(() => !isAndroidBrowser() || isBannerDismissed())
  if (hidden || pathname === '/android') return null

  return (
    <div className="mb-5 flex items-center gap-3 rounded-card border border-accent/30 bg-accent/10 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-accent font-display text-[17px] font-bold text-accent-ink">
        F
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-tight text-ink">Fontainor has an Android app</p>
        <p className="mt-0.5 truncate text-[12px] text-muted">Background playback, offline downloads, one-tap wallet.</p>
      </div>
      <Link
        to="/android"
        className="shrink-0 rounded-btn bg-accent px-3.5 py-2 text-[13px] font-semibold text-accent-ink shadow-glow active:translate-y-px"
      >
        Get the app
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 p-1 text-faint transition-colors hover:text-ink"
        onClick={() => {
          dismissBanner()
          setHidden(true)
        }}
      >
        <IconClose className="h-4 w-4" />
      </button>
    </div>
  )
}
