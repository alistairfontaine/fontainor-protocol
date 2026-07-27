import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtTime } from '../lib/registry'
import { useFavorites } from '../state/collections'
import { usePlayer } from '../state/PlayerContext'
import { Cover } from './Cover'
import { NowPlaying } from './NowPlaying'
import { IconClose, IconHeart, IconNext, IconPause, IconPlay, IconPrev, IconQueue, IconShuffle } from './icons'

/**
 * Player bar — Spotify-style on both breakpoints.
 *
 * Phones (< sm): floating mini-player card above the bottom nav — cover,
 *   title/artist, play/pause, hairline progress. TAP anywhere or SWIPE UP
 *   opens the fullscreen Now Playing view (like Spotify's mini player).
 * Desktop (>= sm): 3-zone bar — [track info + heart] [transport + seek
 *   between timestamps] [queue · close]. Cover click opens fullscreen.
 */
export function PlayerBar() {
  const {
    current,
    playing,
    pos,
    cur,
    dur,
    hasQueue,
    shuffle,
    upNext,
    queuedCount,
    toggleShuffle,
    play,
    playQueued,
    removeQueued,
    clearQueue,
    toggle,
    next,
    prev,
    seek,
    close,
  } = usePlayer()
  const { ids: favIds, toggle: toggleFav } = useFavorites()
  const seekRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false) // desktop queue popover
  const [expanded, setExpanded] = useState(false) // fullscreen Now Playing

  // Swipe-up on the mobile mini player opens the fullscreen view.
  //
  // Decided at touchEND, not mid-move: opening mid-gesture made any fast
  // upward finger movement over the card (i.e. a fast downward page-scroll
  // flick) misfire. The card is `touch-none`, so gestures starting on it
  // never scroll the page — an upward swipe here can only mean "open".
  // Requirements: dominant vertical direction + (distance OR fling velocity).
  const miniRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ x: number; y: number; t: number; lastY: number; lastT: number } | null>(null)
  const miniRaf = useRef(0)
  const setMiniLift = (dy: number) => {
    cancelAnimationFrame(miniRaf.current)
    miniRaf.current = requestAnimationFrame(() => {
      const el = miniRef.current
      if (!el) return
      // subtle GPU-composited lift while dragging up (no React re-render)
      el.style.transform = dy < 0 ? `translate3d(0, ${Math.max(dy / 3, -14)}px, 0)` : ''
    })
  }
  const onMiniTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    gesture.current = { x: t.clientX, y: t.clientY, t: performance.now(), lastY: t.clientY, lastT: performance.now() }
  }
  const onMiniTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current
    if (!g) return
    const t = e.touches[0]
    g.lastY = t.clientY
    g.lastT = performance.now()
    setMiniLift(t.clientY - g.y)
  }
  const onMiniTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current
    gesture.current = null
    setMiniLift(0)
    if (!g) return
    const t = e.changedTouches[0]
    if (!t) return
    const dy = t.clientY - g.y
    const dx = t.clientX - g.x
    const dt = Math.max(performance.now() - g.t, 1)
    const vy = dy / dt // px/ms, negative = up
    const vertical = Math.abs(dy) > Math.abs(dx) * 1.2
    if (vertical && (dy <= -48 || (dy <= -20 && vy <= -0.45))) setExpanded(true)
  }

  const onSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = seekRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      seek((e.clientX - rect.left) / rect.width)
    },
    [seek],
  )

  // close the queue popover + fullscreen view when playback is closed
  useEffect(() => {
    if (!current) {
      setOpen(false)
      setExpanded(false)
    }
  }, [current])

  if (!current) return null

  const isFav = favIds.includes(current.id)

  return (
    <>
    <div
      className="fixed inset-x-0 bottom-16 z-40 lg:bottom-0"
      style={{ marginBottom: 'var(--safe-bottom)' }}
      role="region"
      aria-label="Audio player"
    >
      {/* Desktop queue popover (Spotify-style: Now playing on top, then Next up) */}
      {open && (
        <div className="pointer-events-none absolute bottom-full inset-x-0 hidden justify-end px-6 pb-2 sm:flex">
          <div
            className="pointer-events-auto w-full max-w-md overflow-hidden rounded-card border border-line bg-surface/97 shadow-card backdrop-blur"
            aria-label="Play queue"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-[15px] font-semibold text-ink">Queue</span>
              <span className={`text-[12px] font-medium ${shuffle ? 'text-accent' : 'text-faint'}`}>
                {shuffle ? 'Shuffle on' : 'Playing in order'}
              </span>
            </div>

            <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Now playing</div>
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-chip">
                <Cover rel={current} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-accent">{current.title}</span>
                <span className="block truncate text-[12px] text-muted">{current.artist}</span>
              </div>
              <span className="text-[11px] tabular-nums text-faint">
                {fmtTime(cur)} / {fmtTime(dur)}
              </span>
            </div>

            {upNext.length > 0 && (
              <>
                <div className="flex items-baseline justify-between px-4 pb-1 pt-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Up next</span>
                  {queuedCount > 0 && (
                    <button onClick={clearQueue} className="cursor-pointer text-[11px] font-medium text-muted hover:text-accent">
                      Clear queue
                    </button>
                  )}
                </div>
                <ul className="max-h-[42vh] overflow-y-auto pb-2">
                  {upNext.map((rel, i) => (
                    <li key={`${rel.id}:${i}`} className="group/qrow flex items-center transition-colors hover:bg-raised">
                      <button
                        onClick={() => (i < queuedCount ? playQueued(i) : play(rel, { keepContext: true }))}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-2 text-left"
                      >
                        <span className="w-4 shrink-0 text-[12px] tabular-nums text-faint">{i + 1}</span>
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-chip">
                          <Cover rel={rel} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{rel.title}</span>
                          <span className="block truncate text-[12px] text-muted">{rel.artist}</span>
                        </div>
                        {i < queuedCount && (
                          <span className="shrink-0 rounded-chip bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                            Queued
                          </span>
                        )}
                      </button>
                      {i < queuedCount && (
                        <button
                          onClick={() => removeQueued(i)}
                          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center text-faint hover:text-accent"
                          aria-label={`Remove ${rel.title} from queue`}
                          title="Remove from queue"
                        >
                          <IconClose size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {/* ============ MOBILE mini player (Spotify floating card) ============ */}
      <div className="px-2 pb-1.5 sm:hidden">
        <div
          ref={miniRef}
          className="relative touch-none overflow-hidden rounded-card border border-line bg-raised/97 shadow-card backdrop-blur will-change-transform"
          onClick={() => setExpanded(true)}
          onTouchStart={onMiniTouchStart}
          onTouchMove={onMiniTouchMove}
          onTouchEnd={onMiniTouchEnd}
          role="button"
          tabIndex={0}
          aria-label="Open fullscreen player (tap or swipe up)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setExpanded(true)
          }}
        >
          <div className="flex items-center gap-3 py-2 pl-2 pr-1">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-chip">
              <Cover rel={current} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-ink">{current.title}</span>
              <span className="block truncate text-[12px] text-muted">{current.artist}</span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleFav(current.id)
              }}
              className={`grid h-11 w-10 shrink-0 cursor-pointer place-items-center ${isFav ? 'text-accent' : 'text-faint'}`}
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFav}
            >
              <IconHeart size={20} filled={isFav} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggle()
              }}
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center text-ink"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <IconPause size={24} /> : <IconPlay size={24} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                close()
              }}
              className="grid h-11 w-9 shrink-0 cursor-pointer place-items-center text-faint"
              aria-label="Close player"
            >
              <IconClose size={17} />
            </button>
          </div>
          {/* hairline progress, Spotify-style */}
          <div className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-line" aria-hidden="true">
            <div className="h-full rounded-full bg-ink" style={{ width: `${pos * 100}%` }} />
          </div>
        </div>
      </div>

      {/* ============ DESKTOP bar (Spotify 3-zone layout) ============ */}
      <div className="hidden border-t border-line bg-surface/95 backdrop-blur sm:block">
        <div className="mx-auto grid h-[84px] max-w-[1360px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 lg:px-6">
          {/* left: track info */}
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setExpanded(true)}
              className="h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-chip transition-transform hover:scale-105"
              aria-label="Open fullscreen player"
              title="Now playing"
            >
              <Cover rel={current} />
            </button>
            <div className="min-w-0">
              <Link
                to={`/release/${encodeURIComponent(current.id)}`}
                className="block truncate text-sm font-medium text-ink hover:text-accent"
              >
                {current.title}
              </Link>
              <span className="block truncate text-[13px] text-muted">{current.artist}</span>
            </div>
            <button
              onClick={() => toggleFav(current.id)}
              className={`grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
                isFav ? 'text-accent' : 'text-faint hover:text-body'
              }`}
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFav}
            >
              <IconHeart size={18} filled={isFav} />
            </button>
          </div>

          {/* center: transport stacked over seek (Spotify) */}
          <div className="flex w-[420px] max-w-[44vw] flex-col items-center gap-1 lg:w-[560px]">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleShuffle}
                disabled={!hasQueue}
                className={`grid h-9 w-9 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
                  shuffle ? 'text-accent' : 'text-faint hover:text-body'
                } disabled:cursor-default disabled:opacity-40`}
                aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
                aria-pressed={shuffle}
                title={shuffle ? 'Shuffle on' : 'Shuffle off'}
              >
                <IconShuffle size={17} />
              </button>
              <button
                onClick={prev}
                disabled={!hasQueue}
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-btn text-body transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-40"
                aria-label="Previous track"
              >
                <IconPrev size={19} />
              </button>
              <button
                onClick={toggle}
                className="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-ink text-bg transition-transform hover:scale-105 active:scale-95"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <IconPause size={19} /> : <IconPlay size={19} />}
              </button>
              <button
                onClick={next}
                disabled={!hasQueue}
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-btn text-body transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-40"
                aria-label="Next track"
              >
                <IconNext size={19} />
              </button>
              <span className="grid h-9 w-9" aria-hidden="true" />
            </div>
            <div className="flex w-full items-center gap-2">
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-faint">{fmtTime(cur)}</span>
              <div
                ref={seekRef}
                onClick={onSeek}
                className="group relative h-1 flex-1 cursor-pointer rounded-full bg-raised"
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
                <div
                  className="h-full rounded-full bg-ink transition-[width] duration-150 group-hover:bg-accent"
                  style={{ width: `${pos * 100}%` }}
                />
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-ink opacity-0 shadow transition-opacity group-hover:opacity-100"
                  style={{ left: `calc(${pos * 100}% - 6px)` }}
                  aria-hidden="true"
                />
              </div>
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-faint">{fmtTime(dur)}</span>
            </div>
          </div>

          {/* right: queue · close */}
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => setOpen((o) => !o)}
              className={`grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
                open ? 'bg-raised text-accent' : 'text-faint hover:text-body'
              }`}
              aria-label={open ? 'Hide queue' : 'Show queue'}
              aria-pressed={open}
              title="Queue"
            >
              <IconQueue size={18} />
            </button>
            <button
              onClick={close}
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-btn text-faint transition-colors hover:bg-raised hover:text-body"
              aria-label="Close player"
            >
              <IconClose size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* rendered outside the z-40 bar so it stacks above the bottom nav */}
    <NowPlaying open={expanded} onClose={() => setExpanded(false)} />
    </>
  )
}
