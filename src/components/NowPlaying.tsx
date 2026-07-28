import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useArtTint } from '../lib/artColor'
import { hapticThump, hapticTick } from '../lib/haptics'
import type { Release } from '../lib/registry'
import { fmtTime } from '../lib/registry'
import { useFavorites } from '../state/collections'
import { usePlayer, usePlayerProgress } from '../state/PlayerContext'
import { Cover } from './Cover'
import { LiveSeekBar, TickCur, TickDur, TickTime } from './PlayerTicks'
import { IconChevronDown, IconClose, IconHeart, IconMoon, IconNext, IconPause, IconPlay, IconPrev, IconQueue, IconRepeat, IconRepeatOne, IconShuffle } from './icons'

/**
 * Fullscreen "Now Playing" view — Spotify-style layout (FSP-01..06, FSP-07).
 *
 * Phones:  gradient header, big centered art, LEFT-aligned title/artist with a
 *          heart, full-width seek, transport with a big light play button.
 *          The queue button swaps the art area for a Spotify-style queue
 *          screen that keeps a "Now playing" section pinned on top — the
 *          queue never covers/hides what is currently playing.
 * Desktop: same main column centered; the queue opens as a SIDE PANEL to the
 *          right (like Spotify's queue), so artwork, controls and queue are
 *          all visible at once.
 *
 * Opens from the player bar (tap or swipe-up); closes via chevron, Escape,
 * or swipe-down. All effects use block bodies — implicit-return effects are
 * forbidden here (see App.tsx ScrollToTop incident).
 */
export function NowPlaying({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { current, playing, hasQueue, shuffle, repeat, toggleRepeat, upNext, queuedCount, toggleShuffle, play, playQueued, removeQueued, toggle, next, prev, sleepUntil, setSleepTimer, crossfade, setCrossfade } = usePlayer()
  const { ids: favIds, toggle: toggleFav } = useFavorites()
  const tint = useArtTint(current)
  const [queueOpen, setQueueOpen] = useState(false)
  const [sleepOpen, setSleepOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; t: number; lastDy: number } | null>(null)
  const dragRaf = useRef(0)

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

  // reset transient UI whenever we close
  useEffect(() => {
    if (!open) {
      setQueueOpen(false)
      setSleepOpen(false)
      drag.current = null
      const el = rootRef.current
      if (el) {
        el.style.transition = ''
        el.style.transform = ''
      }
    }
  }, [open])

  // playback closed entirely → dismiss the overlay
  useEffect(() => {
    if (open && !current) onClose()
  }, [open, current, onClose])

  // Swipe-down to close — attached to the whole sheet, Spotify-style.
  // The drag writes transform directly to the DOM inside rAF (GPU-composited,
  // zero React re-renders — the old setState-per-touchmove approach re-rendered
  // the entire tree every frame and was visibly janky on Android).
  // Touches that start on the scrollable queue list or the seek slider are
  // ignored so scrolling/seeking still work.
  const applyDrag = (dy: number) => {
    cancelAnimationFrame(dragRaf.current)
    dragRaf.current = requestAnimationFrame(() => {
      const el = rootRef.current
      if (!el) return
      el.style.transition = 'none'
      el.style.transform = `translate3d(0, ${Math.max(dy, 0)}px, 0)`
    })
  }
  const settleBack = () => {
    cancelAnimationFrame(dragRaf.current)
    const el = rootRef.current
    if (!el) return
    el.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)'
    el.style.transform = 'translate3d(0, 0, 0)'
  }
  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-nodrag]')) return
    drag.current = { y: e.touches[0].clientY, t: performance.now(), lastDy: 0 }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const g = drag.current
    if (!g) return
    g.lastDy = e.touches[0].clientY - g.y
    applyDrag(g.lastDy)
  }
  const onTouchEnd = () => {
    const g = drag.current
    drag.current = null
    if (!g) return
    const dt = Math.max(performance.now() - g.t, 1)
    const vy = g.lastDy / dt // px/ms, positive = down
    if (g.lastDy > 110 || (g.lastDy > 40 && vy > 0.5)) onClose()
    else settleBack()
  }

  // ── swipe the ARTWORK horizontally to change track (Spotify gesture) ──
  // data-nodrag on the artwork opts it out of the sheet's vertical drag;
  // the horizontal drag writes GPU transforms directly (no re-renders) and
  // commits on release distance/velocity, exactly like the sheet gesture.
  const artRef = useRef<HTMLDivElement>(null)
  const artDrag = useRef<{ x: number; t: number; lastDx: number } | null>(null)
  const artRaf = useRef(0)
  const applyArtDrag = (dx: number) => {
    cancelAnimationFrame(artRaf.current)
    artRaf.current = requestAnimationFrame(() => {
      const el = artRef.current
      if (!el) return
      el.style.transition = 'none'
      el.style.transform = `translate3d(${dx * 0.85}px, 0, 0) rotate(${dx / 60}deg)`
    })
  }
  const settleArt = () => {
    cancelAnimationFrame(artRaf.current)
    const el = artRef.current
    if (!el) return
    el.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0, 1)'
    el.style.transform = 'translate3d(0, 0, 0)'
  }
  const onArtTouchStart = (e: React.TouchEvent) => {
    artDrag.current = { x: e.touches[0].clientX, t: performance.now(), lastDx: 0 }
  }
  const onArtTouchMove = (e: React.TouchEvent) => {
    const g = artDrag.current
    if (!g) return
    g.lastDx = e.touches[0].clientX - g.x
    applyArtDrag(g.lastDx)
  }
  const onArtTouchEnd = () => {
    const g = artDrag.current
    artDrag.current = null
    if (!g) return
    const dt = Math.max(performance.now() - g.t, 1)
    const vx = g.lastDx / dt // px/ms
    const commit = Math.abs(g.lastDx) > 70 || (Math.abs(g.lastDx) > 24 && Math.abs(vx) > 0.5)
    if (commit && hasQueue) {
      hapticThump()
      settleArt()
      if (g.lastDx < 0) next()
      else prev()
    } else {
      settleArt()
    }
  }

  if (!open || !current) return null

  const isFav = favIds.includes(current.id)

  return (
    <div
      ref={rootRef}
      className="rise-in fixed inset-0 z-50 flex flex-col bg-bg will-change-transform"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Living color: the wash is derived from the ACTUAL cover art
          (saturation-weighted average, luminance-clamped — lib/artColor),
          falling back to brand amber. Same trick Spotify uses to make every
          track feel like its own place. */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        aria-hidden="true"
        style={{
          background: `linear-gradient(to bottom, rgba(${tint[0]},${tint[1]},${tint[2]},0.30), rgba(${tint[0]},${tint[1]},${tint[2]},0.10) 38%, transparent 72%)`,
        }}
      />

      {/* header */}
      <div className="relative flex shrink-0 items-center justify-between px-3 py-3 sm:px-6">
        <button
          onClick={() => {
            if (queueOpen) setQueueOpen(false)
            else onClose()
          }}
          className="grid h-11 w-11 cursor-pointer place-items-center rounded-btn text-body transition-colors hover:bg-raised hover:text-ink"
          aria-label={queueOpen ? 'Back to now playing' : 'Close now playing'}
        >
          <IconChevronDown size={24} />
        </button>
        <div className="min-w-0 px-2 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
            {queueOpen ? 'Queue' : 'Playing from Fontainor'}
          </div>
          <div className="truncate text-[12px] font-semibold text-ink">{queueOpen ? 'Up next' : current.artist}</div>
        </div>
        <button
          onClick={() => setSleepOpen((v) => !v)}
          className={`grid h-11 w-11 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
            sleepUntil != null || sleepOpen ? 'text-accent' : 'text-body hover:text-ink'
          }`}
          aria-label="Sleep timer"
          aria-pressed={sleepUntil != null}
        >
          <IconMoon size={19} />
        </button>
        <button
          onClick={() => setQueueOpen((q) => !q)}
          disabled={!hasQueue}
          className={`grid h-11 w-11 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
            queueOpen ? 'text-accent' : 'text-body hover:text-ink'
          } disabled:cursor-default disabled:opacity-40`}
          aria-label={queueOpen ? 'Hide queue' : 'Show queue'}
          aria-pressed={queueOpen}
        >
          <IconQueue size={20} />
        </button>
      </div>

      {/* sleep timer panel */}
      {sleepOpen && (
        <div data-nodrag className="absolute right-3 top-16 z-10 w-56 overflow-hidden rounded-card border border-line bg-surface shadow-pop sm:right-6">
          <div className="border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Sleep timer</div>
          <ul className="py-1">
            {([5, 15, 30, 45, 60] as const).map((m) => (
              <li key={m}>
                <button
                  onClick={() => {
                    hapticTick()
                    setSleepTimer(m)
                    setSleepOpen(false)
                  }}
                  className="w-full cursor-pointer px-4 py-2.5 text-left text-sm text-body transition-colors hover:bg-raised hover:text-ink"
                >
                  {m} minutes
                </button>
              </li>
            ))}
            <li>
              <button
                onClick={() => {
                  hapticTick()
                  setSleepTimer('track')
                  setSleepOpen(false)
                }}
                className="w-full cursor-pointer px-4 py-2.5 text-left text-sm text-body transition-colors hover:bg-raised hover:text-ink"
              >
                End of this track
              </button>
            </li>
            {sleepUntil != null && (
              <li className="border-t border-line">
                <button
                  onClick={() => {
                    hapticTick()
                    setSleepTimer(null)
                    setSleepOpen(false)
                  }}
                  className="w-full cursor-pointer px-4 py-2.5 text-left text-sm font-medium text-accent transition-colors hover:bg-raised"
                >
                  Turn off timer
                </button>
              </li>
            )}
            <li className="border-t border-line">
              <button
                onClick={() => {
                  hapticTick()
                  // cycle Off → 3s → 6s → 12s → Off
                  setCrossfade(crossfade === 0 ? 3 : crossfade === 3 ? 6 : crossfade === 6 ? 12 : 0)
                }}
                className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm text-body transition-colors hover:bg-raised hover:text-ink"
              >
                <span>Crossfade</span>
                <span className={crossfade ? 'font-medium text-accent' : 'text-faint'}>{crossfade ? `${crossfade}s` : 'Off'}</span>
              </button>
            </li>
          </ul>
        </div>
      )}

      {/* body: main column + (desktop) queue side panel */}
      <div className="relative flex min-h-0 flex-1 items-stretch justify-center gap-6 px-4 pb-4 sm:px-8 sm:pb-6">
        {/* main column */}
        <div className="flex min-h-0 w-full max-w-xl flex-1 flex-col lg:max-w-2xl">
          {/* artwork — hidden on phones while the queue screen is open */}
          <div
            className={`min-h-0 flex-1 flex-col items-center justify-center ${queueOpen ? 'hidden lg:flex' : 'flex'}`}
          >
            <div
              ref={artRef}
              data-nodrag
              onTouchStart={onArtTouchStart}
              onTouchMove={onArtTouchMove}
              onTouchEnd={onArtTouchEnd}
              className={`np-art w-full max-w-[min(85vw,44vh)] touch-pan-y overflow-hidden rounded-card border border-line shadow-card will-change-transform lg:max-w-[min(40vw,46vh)] ${
                playing ? '' : 'is-paused'
              }`}
            >
              <div key={current.id} className="fade-up aspect-square">
                <Cover rel={current} />
              </div>
            </div>
          </div>

          {/* phone queue screen — Spotify-style: Now playing pinned on top, then Up next */}
          {queueOpen && (
            <div className="flex min-h-0 flex-1 flex-col py-1 lg:hidden">
              <QueueList current={current} upNext={upNext} queuedCount={queuedCount} shuffle={shuffle} play={play} playQueued={playQueued} removeQueued={removeQueued} />
            </div>
          )}

          {/* track info — left-aligned like Spotify, heart on the right */}
          <div className={`items-center gap-3 pt-4 ${queueOpen ? 'hidden lg:flex' : 'flex'}`}>
            <div className="min-w-0 flex-1">
              <Link
                to={`/release/${encodeURIComponent(current.id)}`}
                onClick={onClose}
                className="font-display block truncate text-left text-[22px] font-bold leading-tight text-ink hover:text-accent sm:text-2xl"
              >
                {current.title}
              </Link>
              <p className="truncate text-left text-[15px] text-muted">{current.artist}</p>
            </div>
            <button
              onClick={() => {
                hapticTick()
                toggleFav(current.id)
              }}
              className={`grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
                isFav ? 'text-accent' : 'text-faint hover:text-body'
              }`}
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isFav}
            >
              <IconHeart size={22} filled={isFav} />
            </button>
          </div>

          {/* seek */}
          <div className="w-full shrink-0 pt-3">
            <LiveSeekBar />
            <div className="mt-1.5 flex justify-between text-[12px] tabular-nums text-faint">
              <TickCur />
              {sleepUntil != null && <SleepChip sleepUntil={sleepUntil} />}
              <TickDur />
            </div>
          </div>

          {/* transport — shuffle · prev · big light play · next · queue */}
          <div className="flex shrink-0 items-center justify-between pb-2 pt-1 sm:justify-center sm:gap-6">
            <button
              onClick={() => {
                hapticTick()
                toggleShuffle()
              }}
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
              onClick={() => {
                hapticThump()
                prev()
              }}
              disabled={!hasQueue}
              className="grid h-13 w-13 cursor-pointer place-items-center rounded-btn text-ink transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-40"
              aria-label="Previous track"
            >
              <IconPrev size={30} />
            </button>
            <button
              onClick={() => {
                hapticThump()
                toggle()
              }}
              className="grid h-16 w-16 cursor-pointer place-items-center rounded-full bg-ink text-bg shadow-card transition-transform hover:scale-105 active:scale-95"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <IconPause size={28} /> : <IconPlay size={28} />}
            </button>
            <button
              onClick={() => {
                hapticThump()
                next()
              }}
              disabled={!hasQueue}
              className="grid h-13 w-13 cursor-pointer place-items-center rounded-btn text-ink transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-40"
              aria-label="Next track"
            >
              <IconNext size={30} />
            </button>
            <button
              onClick={() => {
                hapticTick()
                toggleRepeat()
              }}
              className={`grid h-12 w-12 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
                repeat !== 'off' ? 'text-accent' : 'text-faint hover:text-body'
              }`}
              aria-label={repeat === 'off' ? 'Enable repeat' : repeat === 'all' ? 'Enable repeat one' : 'Disable repeat'}
              aria-pressed={repeat !== 'off'}
            >
              {repeat === 'one' ? <IconRepeatOne size={22} /> : <IconRepeat size={22} />}
            </button>
          </div>
        </div>

        {/* desktop queue side panel — sits BESIDE the player, covers nothing */}
        {queueOpen && (
          <aside data-nodrag className="hidden min-h-0 w-[360px] shrink-0 flex-col overflow-hidden rounded-card border border-line bg-surface/80 lg:flex">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-[15px] font-semibold text-ink">Queue</span>
              <span className={`text-[12px] font-medium ${shuffle ? 'text-accent' : 'text-faint'}`}>
                {shuffle ? 'Shuffle on' : 'In order'}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-1 py-2">
              <QueueList current={current} upNext={upNext} queuedCount={queuedCount} shuffle={shuffle} play={play} playQueued={playQueued} removeQueued={removeQueued} />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

/** Spotify-style queue: "Now playing" pinned on top, then "Next up". */
function QueueList({
  current,
  upNext,
  queuedCount,
  shuffle,
  play,
  playQueued,
  removeQueued,
}: {
  current: Release
  upNext: Release[]
  queuedCount: number
  shuffle: boolean
  play: (rel: Release, opts?: { keepContext?: boolean }) => void
  playQueued: (index: number) => void
  removeQueued: (index: number) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Now playing</div>
      <div className="flex shrink-0 items-center gap-3 px-3 py-2">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-chip">
          <Cover rel={current} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-accent">{current.title}</span>
          <span className="block truncate text-[12px] text-muted">{current.artist}</span>
        </div>
        <TickTime className="shrink-0 text-[11px] tabular-nums text-faint" />
      </div>

      <div className="flex shrink-0 items-baseline justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Next up</span>
        <span className={`text-[11px] font-medium lg:hidden ${shuffle ? 'text-accent' : 'text-faint'}`}>
          {shuffle ? 'Shuffle on' : 'In order'}
        </span>
      </div>
      <ul data-nodrag className="min-h-0 flex-1 overflow-y-auto">
        {upNext.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing queued.</li>}
        {upNext.map((rel, i) => (
          <li key={`${rel.id}:${i}`} className="flex items-center rounded-chip transition-colors hover:bg-raised">
            <button
              onClick={() => (i < queuedCount ? playQueued(i) : play(rel, { keepContext: true }))}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-left"
            >
              <span className="w-4 shrink-0 text-[12px] tabular-nums text-faint">{i + 1}</span>
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-chip">
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
                className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center text-faint hover:text-accent"
                aria-label={`Remove ${rel.title} from queue`}
                title="Remove from queue"
              >
                <IconClose size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Sleep-timer countdown chip — subscribes to ticks so the remaining time
 *  counts down (the parent no longer re-renders per tick, on purpose). */
function SleepChip({ sleepUntil }: { sleepUntil: number | 'track' }) {
  usePlayerProgress() // tick subscription = periodic refresh while playing
  return (
    <span className="rounded-chip bg-accent/10 px-2 font-medium text-accent">
      {sleepUntil === 'track' ? 'Sleeps after this track' : `Sleep · ${fmtTime(Math.max(0, Math.round((sleepUntil - Date.now()) / 1000)))}`}
    </span>
  )
}
