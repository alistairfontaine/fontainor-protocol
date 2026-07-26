import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtTime } from '../lib/registry'
import { usePlayer } from '../state/PlayerContext'
import { Cover } from './Cover'
import { IconClose, IconNext, IconPause, IconPlay, IconPrev, IconQueue, IconShuffle } from './icons'

export function PlayerBar() {
  const { current, playing, pos, cur, dur, hasQueue, shuffle, upNext, toggleShuffle, play, toggle, next, prev, seek, close } =
    usePlayer()
  const barRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const onSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = barRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      seek((e.clientX - rect.left) / rect.width)
    },
    [seek],
  )

  // close the queue panel when playback is closed
  useEffect(() => {
    if (!current) setOpen(false)
  }, [current])

  if (!current) return null

  return (
    <div
      className="fixed inset-x-0 bottom-16 z-40 lg:bottom-0"
      style={{ marginBottom: 'var(--safe-bottom)' }}
      role="region"
      aria-label="Audio player"
    >
      {/* Up-next panel */}
      {open && (
        <div className="pointer-events-none absolute bottom-full inset-x-0 flex justify-center px-3 pb-2 sm:justify-end sm:px-6">
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
                <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Up next</div>
                <ul className="max-h-[42vh] overflow-y-auto pb-2">
                  {upNext.map((rel, i) => (
                    <li key={rel.id}>
                      <button
                        onClick={() => play(rel)}
                        className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-raised"
                      >
                        <span className="w-4 shrink-0 text-[12px] tabular-nums text-faint">{i + 1}</span>
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-chip">
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
              </>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-line bg-surface/95 backdrop-blur">
        {/* seek bar */}
        <div
          ref={barRef}
          onClick={onSeek}
          className="group relative h-1.5 w-full cursor-pointer bg-raised"
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
          <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${pos * 100}%` }} />
        </div>

        <div className="mx-auto flex h-[66px] max-w-[1360px] items-center gap-2 px-3 sm:gap-3.5 sm:px-6">
          <button
            onClick={toggleShuffle}
            disabled={!hasQueue}
            className={`hidden h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised sm:grid ${
              shuffle ? 'text-accent' : 'text-faint hover:text-body'
            } disabled:cursor-default disabled:opacity-40`}
            aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={shuffle}
            title={shuffle ? 'Shuffle on' : 'Shuffle off'}
          >
            <IconShuffle size={18} />
          </button>

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <button
              onClick={prev}
              disabled={!hasQueue}
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-btn text-body transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-40"
              aria-label="Previous track"
            >
              <IconPrev size={19} />
            </button>
            <button
              onClick={toggle}
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-accent-ink transition-colors hover:bg-accent-hi"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
            </button>
            <button
              onClick={next}
              disabled={!hasQueue}
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-btn text-body transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-40"
              aria-label="Next track"
            >
              <IconNext size={19} />
            </button>
          </div>

          <Link to={`/release/${encodeURIComponent(current.id)}`} className="h-11 w-11 shrink-0 overflow-hidden rounded-chip">
            <Cover rel={current} />
          </Link>

          <div className="min-w-0 flex-1">
            <Link to={`/release/${encodeURIComponent(current.id)}`} className="block truncate text-sm font-medium text-ink hover:text-accent">
              {current.title}
            </Link>
            <span className="block truncate text-[13px] text-muted">{current.artist}</span>
          </div>

          <span className="hidden shrink-0 text-[12px] tabular-nums text-muted sm:block">
            {fmtTime(cur)} / {fmtTime(dur)}
          </span>

          <button
            onClick={toggleShuffle}
            disabled={!hasQueue}
            className={`grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised sm:hidden ${
              shuffle ? 'text-accent' : 'text-faint'
            } disabled:cursor-default disabled:opacity-40`}
            aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={shuffle}
          >
            <IconShuffle size={18} />
          </button>

          <button
            onClick={() => setOpen((o) => !o)}
            className={`grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised ${
              open ? 'bg-raised text-accent' : 'text-faint hover:text-body'
            }`}
            aria-label={open ? 'Hide queue' : 'Show queue'}
            aria-pressed={open}
            title="Queue"
          >
            <IconQueue size={19} />
          </button>

          <button
            onClick={close}
            className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-btn text-faint transition-colors hover:bg-raised hover:text-body"
            aria-label="Close player"
          >
            <IconClose size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
