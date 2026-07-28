import { usePlayer, usePlayerProgress } from '../state/PlayerContext'
import { fmtTime } from '../lib/registry'
import { SeekBar } from './SeekBar'

/**
 * Tick leaves — the ONLY components that subscribe to usePlayerProgress().
 *
 * The progress context updates 4×/s while playing. v4.0.0 subscribed to it at
 * the top of NowPlaying (549-line sheet) and PlayerBar, so both entire trees
 * re-rendered on every tick — measured at 8× CPU throttle as ~295ms of script
 * + 38 layout passes per 10s with the sheet open, i.e. the exact "player UI
 * is laggy" device report. Ticks must only ever reach these leaves.
 */

/** "0:42" current-time label. */
export function TickCur({ className }: { className?: string }) {
  const { cur } = usePlayerProgress()
  return <span className={className}>{fmtTime(cur)}</span>
}

/** "3:07" duration label. */
export function TickDur({ className }: { className?: string }) {
  const { dur } = usePlayerProgress()
  return <span className={className}>{fmtTime(dur)}</span>
}

/** "0:42 / 3:07" compact readout (queue rows). */
export function TickTime({ className }: { className?: string }) {
  const { cur, dur } = usePlayerProgress()
  return (
    <span className={className}>
      {fmtTime(cur)} / {fmtTime(dur)}
    </span>
  )
}

/** Seek bar wired to live position + seek; parent never sees ticks. */
export function LiveSeekBar({ size = 'md', className = '' }: { size?: 'sm' | 'md'; className?: string }) {
  const { seek } = usePlayer()
  const { pos } = usePlayerProgress()
  return <SeekBar pos={pos} onSeek={seek} size={size} className={className} />
}

/** Hairline progress fill (parent renders the track). */
export function TickHairlineFill() {
  const { pos } = usePlayerProgress()
  // Same 4 Hz→continuous glide as SeekBar (see there); transform-only.
  return <div className="h-full w-full origin-left rounded-full bg-ink" style={{ transform: `scaleX(${pos})`, transition: 'transform 260ms linear' }} />
}
