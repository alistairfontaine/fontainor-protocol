// Gentle, dismissible support line (launch plan §4 — WinRAR posture).
// Renders as a thin strip above the main content, never over the player,
// never a modal, and playback is never touched.
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { usePlayer } from '../state/PlayerContext'
import { dismissNudge, shouldShowNudge } from '../lib/supportPlays'
import { IconClose } from './icons'

export function SupportNudge() {
  const { current } = usePlayer()
  const { pathname } = useLocation()
  const [visible, setVisible] = useState(false)

  // Re-evaluate when the track changes — recordPlay() has run by then.
  useEffect(() => {
    setVisible(shouldShowNudge())
  }, [current])

  if (!visible || pathname === '/support') return null

  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-btn bg-raised px-3.5 py-2 text-[13px] text-muted ring-1 ring-line">
      <p>
        Fontainor is free and open source. If it's useful,{' '}
        <Link to="/support" className="font-medium text-accent hover:underline">
          chip in
        </Link>
        .
      </p>
      <button
        aria-label="Dismiss"
        className="shrink-0 cursor-pointer text-faint transition-colors hover:text-ink"
        onClick={() => {
          dismissNudge()
          setVisible(false)
        }}
      >
        <IconClose size={15} />
      </button>
    </div>
  )
}
