import { useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { fmtTime } from '../lib/registry'
import { usePlayer } from '../state/PlayerContext'
import { Cover } from './Cover'
import { IconClose, IconNext, IconPause, IconPlay, IconPrev } from './icons'

export function PlayerBar() {
  const { current, playing, pos, cur, dur, hasQueue, toggle, next, prev, seek, close } = usePlayer()
  const barRef = useRef<HTMLDivElement>(null)

  const onSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = barRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      seek((e.clientX - rect.left) / rect.width)
    },
    [seek],
  )

  if (!current) return null

  return (
    <div
      className="fixed inset-x-0 bottom-16 z-40 border-t border-line bg-surface/95 backdrop-blur lg:bottom-0"
      style={{ marginBottom: 'var(--safe-bottom)' }}
      role="region"
      aria-label="Audio player"
    >
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

      <div className="mx-auto flex h-[66px] max-w-[1360px] items-center gap-3.5 px-4 sm:px-6">
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
          onClick={close}
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-btn text-faint transition-colors hover:bg-raised hover:text-body"
          aria-label="Close player"
        >
          <IconClose size={18} />
        </button>
      </div>
    </div>
  )
}
