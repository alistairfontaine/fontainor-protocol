import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Release } from '../lib/registry'
import { msBindActions, msClear, msSetMetadata, msSetPlaybackState, msSetPosition } from '../lib/mediaSession'
import { postPlay } from '../lib/plays'
import { recordPlay } from '../lib/supportPlays'
import { useRegistry } from './RegistryContext'
import { useHistoryLog } from './collections'

interface PlayerState {
  current: Release | null
  playing: boolean
  /** whether prev/next have somewhere to go */
  hasQueue: boolean
  shuffle: boolean
  repeat: RepeatMode
  toggleRepeat: () => void
  /** next tracks in play order: user-queued first, then catalog order */
  upNext: Release[]
  /** how many entries at the head of upNext were queued by the user */
  queuedCount: number
  toggleShuffle: () => void
  /** play a release; resets any playlist context unless opts.keepContext */
  play: (rel: Release, opts?: { keepContext?: boolean }) => void
  /** play an explicit list (e.g. a playlist) in order, starting at `start` */
  playList: (rels: Release[], start?: number) => void
  /** append to the user queue (plays immediately when nothing is playing) */
  addToQueue: (rel: Release) => void
  /** play the i-th user-queued entry now, consuming it from the queue */
  playQueued: (index: number) => void
  removeQueued: (index: number) => void
  clearQueue: () => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (fraction: number) => void
  close: () => void
}

/**
 * Progress ticks live in their OWN context. pos/cur/dur update 4×/second
 * while anything plays; when they lived in the main context every
 * usePlayer() consumer (each ReleaseCard on a scrolling grid, nav, pages)
 * re-rendered 4×/s for the whole session — measurable scroll jank on
 * Android WebViews. Only the seek bar + timestamps actually need ticks.
 */
interface PlayerProgress {
  /** 0..1 */
  pos: number
  cur: number
  dur: number
}

const Ctx = createContext<PlayerState | null>(null)
const ProgressCtx = createContext<PlayerProgress>({ pos: 0, cur: 0, dur: 0 })

const DEMO_DURATION = 180 // simulated playback when a release has no audioUri
const RESTART_THRESHOLD = 3 // seconds — prev restarts the track past this point (Spotify behavior)

// ── Media session (lock-screen / notification controls) ─────────────────────
// One adapter, two backends: a real Android MediaSession + foreground service
// in the native app (playback survives the screen turning off and gets a
// notification card with transport controls), navigator.mediaSession on web.
function setMediaMetadata(rel: Release) {
  msSetMetadata({ title: rel.title, artist: rel.artist, album: rel.label ?? 'Fontainor', artworkUrl: rel.coverUrl ?? undefined })
}

function setMediaPlaybackState(playing: boolean) {
  msSetPlaybackState(playing)
}

function setMediaPosition(duration: number, position: number) {
  msSetPosition(duration, position)
}

export type RepeatMode = 'off' | 'all' | 'one'

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Release | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  // Fresh cur for callbacks (toggle/prev) so THEY don't have to depend on the
  // 4×/s cur state — keeping the main context value referentially stable
  // across ticks is the whole point of the Progress context split.
  const curRef = useRef(0)
  useEffect(() => {
    curRef.current = cur
  }, [cur])
  const playingRef = useRef(false)
  useEffect(() => {
    playingRef.current = playing
  }, [playing])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { push: pushHistory } = useHistoryLog()
  const { music } = useRegistry()
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const repeatRef = useRef<RepeatMode>('off')
  useEffect(() => {
    repeatRef.current = repeat
  }, [repeat])
  const [order, setOrder] = useState<string[] | null>(null) // shuffled id order when shuffle is on
  // Playlist context (F39): when set, the base play order is this explicit
  // list instead of the full catalog. Reset by plain play() and close().
  const [context, setContext] = useState<Release[] | null>(null)

  // Effective queue = shuffled order (if on) else context/registry order. Kept
  // in a ref so the audio 'ended' listener always sees fresh data without re-binding.
  const queue = useMemo(() => {
    const base = context ?? music
    if (!order) return base
    const byId = new Map(base.map((r) => [r.id, r]))
    const inOrder = order.map((id) => byId.get(id)).filter((r): r is Release => !!r)
    // append anything new that wasn't around when shuffle was toggled
    const seen = new Set(order)
    return [...inOrder, ...base.filter((r) => !seen.has(r.id))]
  }, [music, order, context])
  const queueRef = useRef<Release[]>([])
  useEffect(() => {
    queueRef.current = queue
  }, [queue])
  const currentRef = useRef<Release | null>(null)
  useEffect(() => {
    currentRef.current = current
  }, [current])
  const playRef = useRef<(rel: Release) => void>(() => {})

  // User "Add to queue" list (F38). Plays before the catalog order and is
  // consumed as tracks start. Ref mirrors state so audio 'ended' handlers
  // (bound once per track) always see the fresh queue.
  const [manual, setManual] = useState<Release[]>([])
  const manualRef = useRef<Release[]>([])
  const setManualSynced = (next: Release[]) => {
    manualRef.current = next
    setManual(next)
  }

  const stopSim = () => {
    if (simRef.current) {
      clearInterval(simRef.current)
      simRef.current = null
    }
  }

  const clearAudio = () => {
    audioRef.current?.pause()
    audioRef.current = null
  }

  const stepFrom = (offset: 1 | -1, wrap = true): Release | null => {
    const q = queueRef.current
    const c = currentRef.current
    if (!q.length) return null
    const i = c ? q.findIndex((r) => r.id === c.id) : -1
    if (i === -1) return q[0]
    const j = i + offset
    if (!wrap && (j < 0 || j >= q.length)) return null
    return q[(j + q.length) % q.length]
  }

  /** Forward step: consume the user queue first, then follow catalog order. */
  const advance = (opts?: { auto?: boolean }): boolean => {
    const m = manualRef.current
    if (m.length > 0) {
      const [head, ...rest] = m
      manualRef.current = rest
      setManual(rest)
      playRef.current(head)
      return true
    }
    // Auto-advance (track ended): repeat none stops at the end of the queue;
    // repeat all wraps around. A manual "next" tap always wraps.
    const wrap = opts?.auto ? repeatRef.current === 'all' : true
    const n = stepFrom(1, wrap)
    if (n) {
      playRef.current(n)
      return true
    }
    return false
  }

  /** Track finished on its own: honor repeat-one, then the queue. */
  const handleEnded = (): boolean => {
    if (repeatRef.current === 'one' && currentRef.current) {
      playRef.current(currentRef.current)
      return true
    }
    return advance({ auto: true })
  }

  const startSim = useCallback((from: number) => {
    stopSim()
    let t = from
    simRef.current = setInterval(() => {
      t += 0.25
      if (t >= DEMO_DURATION) {
        stopSim()
        t = DEMO_DURATION
        // auto-advance, same as real audio 'ended'
        if (!handleEnded()) setPlaying(false)
        return
      }
      setCur(t)
      setPos(t / DEMO_DURATION)
    }, 250)
  }, [])

  const playNow = useCallback(
    (rel: Release) => {
      stopSim()
      clearAudio()
      setCurrent(rel)
      currentRef.current = rel
      pushHistory(rel.id)
      recordPlay() // support-nudge counter (localStorage, best-effort)
      postPlay(rel.id) // anonymous trending counter (network, fire-and-forget)
      setPos(0)
      setCur(0)

      setMediaMetadata(rel)

      if (rel.audio) {
        const a = new Audio(rel.audio)
        audioRef.current = a
        a.addEventListener('loadedmetadata', () => {
          setDur(a.duration || 0)
          setMediaPosition(a.duration || 0, 0)
        })
        a.addEventListener('timeupdate', () => {
          setCur(a.currentTime)
          setDur(a.duration || 0)
          setPos(a.duration ? a.currentTime / a.duration : 0)
          setMediaPosition(a.duration || 0, a.currentTime)
        })
        a.addEventListener('ended', () => {
          if (!handleEnded()) setPlaying(false)
        })
        a.addEventListener('error', () => {
          // fall back to simulated playback so the UI stays honest but usable
          audioRef.current = null
          setDur(DEMO_DURATION)
          startSim(0)
        })
        void a.play().catch(() => {
          audioRef.current = null
          setDur(DEMO_DURATION)
          startSim(0)
        })
      } else {
        setDur(DEMO_DURATION)
        startSim(0)
      }
      setPlaying(true)
    },
    [pushHistory, startSim],
  )
  useEffect(() => {
    playRef.current = playNow
  }, [playNow])

  /** Public play: a direct pick outside a playlist clears the playlist context. */
  const play = useCallback(
    (rel: Release, opts?: { keepContext?: boolean }) => {
      if (!opts?.keepContext) setContext(null)
      playNow(rel)
    },
    [playNow],
  )

  /** Play an explicit ordered list (playlist). Shuffle resets so order is honest. */
  const playList = useCallback(
    (rels: Release[], start = 0) => {
      if (!rels.length) return
      setShuffle(false)
      setOrder(null)
      setContext(rels)
      playNow(rels[Math.min(Math.max(start, 0), rels.length - 1)])
    },
    [playNow],
  )

  const toggle = useCallback(() => {
    if (!currentRef.current) return
    if (audioRef.current) {
      if (playingRef.current) audioRef.current.pause()
      else void audioRef.current.play()
    } else {
      if (playingRef.current) stopSim()
      else startSim(curRef.current)
    }
    setPlaying((p) => !p)
  }, [startSim])

  // advance() only touches refs + stable setters, so the first instance is safe to capture
  const next = useCallback(() => {
    advance()
  }, [])

  const addToQueue = useCallback(
    (rel: Release) => {
      // Nothing playing → there is no queue UI to see; just start it.
      if (!currentRef.current) {
        playNow(rel)
        return
      }
      setManualSynced([...manualRef.current, rel])
    },
    [playNow],
  )

  const playQueued = useCallback(
    (index: number) => {
      const m = manualRef.current
      const rel = m[index]
      if (!rel) return
      setManualSynced(m.filter((_, i) => i !== index))
      playNow(rel)
    },
    [playNow],
  )

  const removeQueued = useCallback((index: number) => {
    setManualSynced(manualRef.current.filter((_, i) => i !== index))
  }, [])

  const clearQueue = useCallback(() => {
    setManualSynced([])
  }, [])

  const prev = useCallback(() => {
    // Spotify behavior: past a few seconds in, "previous" restarts the track
    if (curRef.current > RESTART_THRESHOLD) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0
        if (playingRef.current) void audioRef.current.play()
      } else {
        setCur(0)
        setPos(0)
        if (playingRef.current) startSim(0)
      }
      return
    }
    // playNow (not play): stepping back must keep any playlist context alive
    const p = stepFrom(-1)
    if (p) playNow(p)
  }, [playNow, startSim])

  const seek = useCallback(
    (fraction: number) => {
      const f = Math.min(1, Math.max(0, fraction))
      if (audioRef.current && dur) {
        audioRef.current.currentTime = f * dur
      } else {
        setCur(f * DEMO_DURATION)
        setPos(f)
        if (playing) startSim(f * DEMO_DURATION)
      }
    },
    [dur, playing, startSim],
  )

  const close = useCallback(() => {
    stopSim()
    clearAudio()
    msClear()
    setCurrent(null)
    currentRef.current = null
    setContext(null) // closing the player leaves any playlist context behind
    setManualSynced([]) // closing the player discards the user queue
    setPlaying(false)
    setPos(0)
    setCur(0)
    setDur(0)
  }, [])

  useEffect(() => () => {
    stopSim()
    clearAudio()
  }, [])

  // media notification play/pause state mirrors ours
  useEffect(() => {
    if (current) setMediaPlaybackState(playing)
  }, [playing, current])

  // Media Session action handlers (notification / lock-screen buttons).
  // Registered once; handlers read the latest callbacks through a ref.
  const actionsRef = useRef({ playing: false, toggle: () => {}, next: () => {}, prev: () => {}, seek: (_f: number) => {}, close: () => {} })
  useEffect(() => {
    actionsRef.current = { playing, toggle, next, prev, seek, close }
  }, [playing, toggle, next, prev, seek, close])
  useEffect(() => {
    const unbind = msBindActions((details) => {
      const a = actionsRef.current
      switch (details.action) {
        case 'play':
          if (!a.playing) a.toggle()
          break
        case 'pause':
          if (a.playing) a.toggle()
          break
        case 'previoustrack':
          a.prev()
          break
        case 'nexttrack':
          a.next()
          break
        case 'stop':
          a.close()
          break
        case 'seekto': {
          const el = audioRef.current
          const d = el?.duration
          if (details.seekTime != null && d && isFinite(d) && d > 0) a.seek(details.seekTime / d)
          break
        }
      }
    })
    return unbind
  }, [])

  useEffect(() => {
    document.body.classList.toggle('has-player', current != null)
  }, [current])

  const toggleRepeat = useCallback(() => {
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
  }, [])

  const toggleShuffle = useCallback(() => {
    setShuffle((on) => {
      if (on) {
        setOrder(null)
        return false
      }
      // Fisher-Yates over the catalog, current track pinned first
      const ids = queueRef.current.map((r) => r.id)
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
      }
      const cid = currentRef.current?.id
      if (cid) {
        const k = ids.indexOf(cid)
        if (k > 0) {
          ids.splice(k, 1)
          ids.unshift(cid)
        }
      }
      setOrder(ids)
      return true
    })
  }, [])

  // User-queued tracks first (all of them), then up to 8 from catalog order.
  const upNext = useMemo(() => {
    const out: Release[] = [...manual]
    if (queue.length) {
      const i = current ? queue.findIndex((r) => r.id === current.id) : -1
      for (let k = 1; k <= Math.min(8, queue.length - 1); k++) {
        out.push(queue[(i + k + queue.length) % queue.length])
      }
    }
    return out
  }, [queue, current, manual])

  const value = useMemo<PlayerState>(
    () => ({
      current,
      playing,
      hasQueue: queue.length > 1 || manual.length > 0,
      shuffle,
      repeat,
      toggleRepeat,
      upNext,
      queuedCount: manual.length,
      toggleShuffle,
      play,
      playList,
      addToQueue,
      playQueued,
      removeQueued,
      clearQueue,
      toggle,
      next,
      prev,
      seek,
      close,
    }),
    [current, playing, queue.length, manual.length, shuffle, repeat, toggleRepeat, upNext, toggleShuffle, play, playList, addToQueue, playQueued, removeQueued, clearQueue, toggle, next, prev, seek, close],
  )

  const progress = useMemo<PlayerProgress>(() => ({ pos, cur, dur }), [pos, cur, dur])

  return (
    <Ctx.Provider value={value}>
      <ProgressCtx.Provider value={progress}>{children}</ProgressCtx.Provider>
    </Ctx.Provider>
  )
}

export function usePlayer(): PlayerState {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlayer outside PlayerProvider')
  return v
}

/** Subscribe to 4×/s playback progress — ONLY where a tick actually renders
 *  (seek bars, timestamps). Everything else should use usePlayer(). */
export function usePlayerProgress(): PlayerProgress {
  return useContext(ProgressCtx)
}
