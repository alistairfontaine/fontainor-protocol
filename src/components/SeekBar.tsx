import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag-to-seek progress bar (pointer events, Spotify-feel).
 *
 * - Tap anywhere: seek there.
 * - Press + drag: the fill and thumb FOLLOW THE FINGER without seeking, the
 *   audio position only commits on release (scrubbing the actual audio on
 *   every move stutters, especially through the WebView).
 * - Keyboard: arrow keys nudge ±5%.
 *
 * Height/hit-target: the visible track is thin, but the interactive strip is
 * a taller invisible band so fingers can actually grab it (44px min target).
 */
export function SeekBar({
  pos,
  onSeek,
  size = 'md',
  className = '',
}: {
  /** committed playback position, 0..1 */
  pos: number
  onSeek: (fraction: number) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragFrac, setDragFrac] = useState<number | null>(null)
  const draggingRef = useRef(false)

  const fracFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // primary button / touch only
      if (e.pointerType === 'mouse' && e.button !== 0) return
      draggingRef.current = true
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      setDragFrac(fracFromClientX(e.clientX))
    },
    [fracFromClientX],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      setDragFrac(fracFromClientX(e.clientX))
    },
    [fracFromClientX],
  )

  const finishDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      const f = fracFromClientX(e.clientX)
      setDragFrac(null)
      onSeek(f)
    },
    [fracFromClientX, onSeek],
  )

  const cancelDrag = useCallback(() => {
    draggingRef.current = false
    setDragFrac(null)
  }, [])

  // If the component unmounts mid-drag, drop the capture state cleanly.
  // Block body + explicit cleanup — repo rule: no implicit-return effects.
  useEffect(() => {
    return () => {
      cancelDrag()
    }
  }, [cancelDrag])

  const shown = dragFrac ?? pos
  const pct = `${shown * 100}%`
  const trackH = size === 'sm' ? 'h-1' : 'h-1.5'

  return (
    <div
      className={`group relative flex w-full cursor-pointer touch-none items-center py-2.5 ${className}`}
      data-nodrag
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={cancelDrag}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      aria-label="Seek"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(1, pos + 0.05))
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, pos - 0.05))
      }}
    >
      <div ref={trackRef} className={`relative w-full overflow-visible rounded-full bg-raised ${trackH}`}>
        <div
          className={`${trackH} rounded-full ${dragFrac != null ? 'bg-accent' : 'bg-ink group-hover:bg-accent'}`}
          style={{ width: pct }}
        />
        <div
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-ink shadow transition-[opacity,transform] duration-150 ${
            dragFrac != null ? 'scale-110 opacity-100' : 'scale-90 opacity-0 group-hover:opacity-100'
          }`}
          style={{ left: `calc(${pct} - 7px)` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
