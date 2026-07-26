import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtTime } from '../lib/registry'
import { usePlayer } from '../state/PlayerContext'
import { Cover } from './Cover'
import { IconChevronDown, IconNext, IconPause, IconPlay, IconPrev, IconQueue, IconShuffle } from './icons'

/**
 * Fullscreen "Now Playing" view (FSP-01..06).
 * Opens from the player bar; closes via chevron, Escape, or swipe-down.
 * All effects use block bodies — implicit-return effects are forbidden here
 * (see App.tsx ScrollToTop incident).
 */
export function NowPlaying({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { current, playing, pos, cur, dur, hasQueue, shuffle, upNext, toggleShuffle, play, toggle, next, prev, seek } = usePlayer()
  const [queueOpen, setQueueOpen] = useState(false)
  const seekRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef<number | null>(null)
  const [dragY, setDragY] = useState(0)

  // Escape closes (queue panel first, then the overlay)
  const queueOpenRef = useRef(queueOpen)
  useEffect(() => {
    queueOpenRef.current = queueOpen
  }, [queueOpen])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (queueOpenRef.current) setQueueOpen(false)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // reset transient UI whenever we close or the track goes away
  useEffect(() => {
    if (!open) {
      setQueueOpen(false)
      setDragY(0)
    }
  }, [open])

  // playback closed entirely → dismiss the overlay
  useEffect(() => {
    if (open && !current) onClose()
  }, [open, current, onClose])

  const onSeekAt = useCallback(
    (clientX: number) => {
      const el = seekRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      seek((clientX - rect.left) / rect.width)
    },
    [seek],
  )

  // swipe-down to close (drag follows the finger for a native feel)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) setDragY(dy)
  }
  const onTouchEnd = () => {
    if (dragY > 90) {
      onClose()
    }
    setDragY(0)
    touchStartY.current = null
  }

  if (!open || !current) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg"
      style={{
        transform: dragY ? `translateY(${dragY}px)` : undefined,
        transition: dragY ? 'none' : 'transform 180ms ease-out',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
    >
      {/* soft backdrop glow derived from the artwork area */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-1/4 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
      </div>

      {/* header — also a swipe-down handle on touch */}
      <div
        className="relative flex items-center justify-between px-4 py-3 sm:px-6"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button
          onClick={onClose}
          className="grid h-11 w-11 cursor-pointer place-items-center rounded-btn text-body transition-colors hover:bg-raised hover:text-ink"
          aria-label="Close now playing"
        >
          <IconChevronDown size={24} />
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Now playing</span>
        <button
          onClick={() => setQueueOpen((q) => !q)}
          disabled={!hasQueue}
          className={`grid h-11 w-11 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
            queueOpen ? 'bg-raised text-accent' : 'text-body hover:text-ink'
          } disabled:cursor-default disabled:opacity-40`}
          aria-label={queueOpen ? 'Hide queue' : 'Show queue'}
          aria-pressed={queueOpen}
        >
          <IconQueue size={21} />
        </button>
      </div>

      {/* body */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 pb-4 sm:gap-8">
        {queueOpen ? (
          <div className="flex min-h-0 w-full max-w-xl flex-1 flex-col py-2">
            <div className="pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Up next</div>
            <ul className="min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-surface/80">
              {upNext.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nothing queued.</li>}
              {upNext.map((rel, i) => (
                <li key={rel.id}>
                  <button
                    onClick={() => play(rel)}
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised"
                  >
                    <span className="w-4 shrink-0 text-[12px] tabular-nums text-faint">{i + 1}</span>
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-chip">
                      <Cover rel={rel} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{rel.title}</span>
                      <span className="block truncate text-[12px] text-muted">{rel.artist}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="w-full max-w-[min(78vw,42vh)] shrink-0 overflow-hidden rounded-card border border-line shadow-card sm:max-w-[min(46vw,44vh)]">
              <div className="aspect-square">
                <Cover rel={current} />
              </div>
            </div>

            <div className="w-full max-w-xl text-center">
              <Link
                to={`/release/${encodeURIComponent(current.id)}`}
                onClick={onClose}
                className="font-display block truncate text-2xl font-bold text-ink hover:text-accent sm:text-3xl"
              >
                {current.title}
              </Link>
              <p className="mt-1 truncate text-[15px] text-muted">{current.artist}</p>
            </div>
          </>
        )}

        {/* seek */}
        <div className="w-full max-w-xl shrink-0">
          <div
            ref={seekRef}
            onClick={(e) => onSeekAt(e.clientX)}
            className="group relative h-2 w-full cursor-pointer rounded-full bg-raised"
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pos * 100)}
            aria-label="Seek"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') seek(pos + 0.05)
              if (e.key === 'ArrowLeft') seek(pos - 0.05)
            }}
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${pos * 100}%` }} />
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-ink opacity-0 shadow transition-opacity group-hover:opacity-100"
              style={{ left: `calc(${pos * 100}% - 7px)` }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] tabular-nums text-faint">
            <span>{fmtTime(cur)}</span>
            <span>{fmtTime(dur)}</span>
          </div>
        </div>

        {/* transport */}
        <div className="flex shrink-0 items-center justify-center gap-3 sm:gap-5">
          <button
            onClick={toggleShuffle}
            disabled={!hasQueue}
            className={`grid h-12 w-12 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
              shuffle ? 'text-accent' : 'text-faint hover:text-body'
            } disabled:cursor-default disabled:opacity-40`}
            aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={shuffle}
          >
            <IconShuffle size={22} />
          </button>
          <button
            onClick={prev}
            disabled={!hasQueue}
            className="grid h-14 w-14 cursor-pointer place-items-center rounded-btn text-body transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-40"
            aria-label="Previous track"
          >
            <IconPrev size={28} />
          </button>
          <button
            onClick={toggle}
            className="grid h-[72px] w-[72px] cursor-pointer place-items-center rounded-full bg-accent text-accent-ink shadow-glow transition-colors hover:bg-accent-hi"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <IconPause size={30} /> : <IconPlay size={30} />}
          </button>
          <button
            onClick={next}
            disabled={!hasQueue}
            className="grid h-14 w-14 cursor-pointer place-items-center rounded-btn text-body transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-40"
            aria-label="Next track"
          >
            <IconNext size={28} />
          </button>
          <span className="grid h-12 w-12" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
