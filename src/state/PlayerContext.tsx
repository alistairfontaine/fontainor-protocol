import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Release } from '../lib/registry'
import { streamableAudioUrl } from '../lib/api'
import { dropBrokenDownload, localAudioSrc } from '../lib/downloads'
import { contentIdOf, markGatewayDown, markGatewayUp, markSettled, mediaCandidates, probeSettled } from '../lib/gateways'
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
  /** sleep timer: epoch-ms deadline, 'track' = stop after current track */
  sleepUntil: number | 'track' | null
  /** minutes from now, 'track', or null to cancel */
  setSleepTimer: (v: number | 'track' | null) => void
  /** crossfade window in seconds; 0 = off */
  crossfade: number
  setCrossfade: (sec: number) => void
  /** set when every source for the current release failed — never a silent lie */
  stalled: boolean
  /** re-attempt the current release from the top of its source list */
  retry: () => void
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
const PRELOAD_EAGER_SECONDS = 12 // fully buffer the next track when this close to the end (F60)
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
  const [stalled, setStalled] = useState(false)
  // Source list for the release being played: local download first (if any),
  // then every gateway that can serve the same permanent content.
  const attemptsRef = useRef<{ id: string; list: string[]; idx: number } | null>(null)
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
  // Sleep timer (F46): epoch-ms deadline or 'track'. Ref mirrors state for
  // the once-bound audio 'ended' handler, same pattern as repeat/queue.
  const [sleepUntil, setSleepUntil] = useState<number | 'track' | null>(null)
  const sleepRef = useRef<number | 'track' | null>(null)
  useEffect(() => {
    sleepRef.current = sleepUntil
  }, [sleepUntil])
  // Crossfade (F58): seconds of overlap between tracks, 0 = off. Persisted.
  const [crossfade, setCrossfadeState] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('fontainor.crossfade'))
      return isFinite(v) && v > 0 ? v : 0
    } catch {
      return 0
    }
  })
  const crossfadeRef = useRef(crossfade)
  useEffect(() => {
    crossfadeRef.current = crossfade
  }, [crossfade])
  const setCrossfade = useCallback((sec: number) => {
    setCrossfadeState(sec)
    try {
      localStorage.setItem('fontainor.crossfade', String(sec))
    } catch {
      /* private mode */
    }
  }, [])
  // Active crossfade: the incoming element + its release + the volume ramp.
  const xfadeRef = useRef<{ b: HTMLAudioElement; rel: Release; timer: ReturnType<typeof setInterval> } | null>(null)
  // Gapless preload (F60): the NEXT track's element, warmed before the current
  // one ends so the transition needs no network round-trip. `url` is the exact
  // source string it was created with (element .src is absolutized by the
  // browser, so we compare against this instead).
  const preloadRef = useRef<{ id: string; url: string; el: HTMLAudioElement } | null>(null)
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

  /** Abort an in-flight crossfade: silence the incoming element, restore the outgoing one. */
  const cancelXfade = (restore = true) => {
    const x = xfadeRef.current
    if (!x) return
    xfadeRef.current = null
    clearInterval(x.timer)
    x.b.pause()
    x.b.src = ''
    if (restore && audioRef.current) audioRef.current.volume = 1
  }

  const clearPreload = () => {
    const p = preloadRef.current
    if (!p) return
    preloadRef.current = null
    p.el.pause()
    p.el.removeAttribute('src') // release the media resource without firing 'error'
    p.el.load()
  }

  const clearAudio = () => {
    cancelXfade(false)
    audioRef.current?.pause()
    audioRef.current = null
  }

  /**
   * Best playable source for a release (mirrors playNow's list head): the
   * downloaded copy first, then the strongest gateway.
   */
  const bestSourceFor = (rel: Release): string | null => {
    const local = localAudioSrc(rel.id)
    if (local) return local
    if (!rel.audio) return null
    return mediaCandidates(streamableAudioUrl(rel.audio))[0] ?? streamableAudioUrl(rel.audio)
  }

  /**
   * Gapless preload (F60). Warm the upcoming track so the transition is
   * instant instead of a full network round-trip of silence:
   *   - eager=false → metadata only (headers + first chunk; cheap)
   *   - eager=true  → full buffering (called when the current track nears its end)
   * Re-invoked freely: it no-ops when the right element already exists and
   * quietly replaces it when the queue changed mid-track.
   */
  const preloadNext = (eager = false) => {
    if (sleepRef.current === 'track') return clearPreload() // stopping after this one
    const nxt = peekNext()
    // repeat-one replays the SAME element via playNow; nothing to warm.
    if (!nxt || !nxt.audio || nxt.id === currentRef.current?.id) return clearPreload()
    const url = bestSourceFor(nxt)
    if (!url) return clearPreload()
    const have = preloadRef.current
    if (have && have.id === nxt.id && have.url === url) {
      if (eager && have.el.preload !== 'auto') {
        have.el.preload = 'auto'
        have.el.load()
      }
      return
    }
    clearPreload()
    const el = new Audio()
    el.preload = eager ? 'auto' : 'metadata'
    if (url === localAudioSrc(nxt.id)) el.dataset.localDownload = nxt.id
    el.src = url
    preloadRef.current = { id: nxt.id, url, el }
  }

  /**
   * Hand over the warmed element for `rel` if it is usable. Consumes the slot
   * either way; a preload whose gateway died mid-flight (el.error) is discarded
   * so playNow's source-walk can try the alternatives.
   */
  const takePreloaded = (rel: Release, expectedUrl: string): HTMLAudioElement | null => {
    const p = preloadRef.current
    if (!p || p.id !== rel.id) return null
    preloadRef.current = null
    if (p.url !== expectedUrl || p.el.error) {
      p.el.removeAttribute('src')
      p.el.load()
      return null
    }
    return p.el
  }

  /** What would play after the current track ends — WITHOUT consuming anything. */
  const peekNext = (): Release | null => {
    if (sleepRef.current === 'track') return null
    if (repeatRef.current === 'one') return currentRef.current
    const m = manualRef.current
    if (m.length > 0) return m[0]
    return stepFrom(1, repeatRef.current === 'all')
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

  /** Track finished on its own: honor sleep-after-track, repeat-one, then the queue. */
  const handleEnded = (): boolean => {
    if (sleepRef.current === 'track') {
      sleepRef.current = null
      setSleepUntil(null)
      return false // stop here — the listener asked to fall asleep to this track
    }
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

  /** Wire the standard listeners onto an audio element (used for fresh and adopted elements). */
  const wireAudio = (a: HTMLAudioElement) => {
    const onMeta = () => {
      setDur(a.duration || 0)
      setMediaPosition(a.duration || 0, 0)
      // This source answered: clear any stall and un-demote its gateway.
      if (audioRef.current === a) {
        setStalled(false)
        markGatewayUp(a.src)
        // arweave.net answering IS the settlement proof — no probe needed.
        if (a.src.startsWith('https://arweave.net/')) {
          const id = contentIdOf(a.src)
          if (id) markSettled(id)
        }
      }
    }
    a.addEventListener('loadedmetadata', onMeta)
    // A preloaded element (F60) may have loaded its metadata BEFORE being
    // adopted — the event already fired, so run the handler now.
    if (a.readyState >= 1) onMeta()
    a.addEventListener('timeupdate', () => {
      if (audioRef.current !== a) return // stale element after a swap
      setCur(a.currentTime)
      setDur(a.duration || 0)
      setPos(a.duration ? a.currentTime / a.duration : 0)
      setMediaPosition(a.duration || 0, a.currentTime)
      // Gapless (F60): keep the warmed next-track element in sync with the
      // queue, and buffer it fully once the end is near.
      if (playingRef.current) {
        const rem = isFinite(a.duration) ? a.duration - a.currentTime : Infinity
        preloadNext(rem <= PRELOAD_EAGER_SECONDS)
      }
      maybeBeginXfade(a)
    })
    a.addEventListener('ended', () => {
      if (audioRef.current !== a) return
      if (xfadeRef.current) {
        finishXfade() // the next track is already audible — just complete the swap
        return
      }
      if (!handleEnded()) setPlaying(false)
    })
    a.addEventListener('error', () => {
      if (audioRef.current !== a) return
      const rel = currentRef.current
      // A local downloaded file that no longer decodes must not silently turn
      // into the demo progress bar (a moving playhead with no sound). Forget
      // the download; the remaining sources are gateways.
      if (rel && a.dataset.localDownload === rel.id) void dropBrokenDownload(rel.id)
      else markGatewayDown(a.src)
      if (rel && attemptsRef.current?.id === rel.id && attachNextSource()) return
      // Out of sources. A release that HAS audio must say so instead of
      // pretending to play: the demo simulator is for entries with no audio.
      audioRef.current = null
      stopSim()
      if (rel?.audio) {
        setStalled(true)
        setPlaying(false)
        setMediaPlaybackState(false)
        return
      }
      setDur(DEMO_DURATION)
      startSim(0)
    })
  }

  /**
   * Advance to the next source for the current release, if there is one.
   * Returns false when the list is exhausted.
   */
  const attachNextSource = (): boolean => {
    const at = attemptsRef.current
    const rel = currentRef.current
    if (!at || !rel || at.id !== rel.id) return false
    const next = at.idx + 1
    if (next >= at.list.length) return false
    at.idx = next
    const url = at.list[next]
    const b = new Audio(url)
    if (url === localAudioSrc(rel.id)) b.dataset.localDownload = rel.id
    audioRef.current = b
    wireAudio(b)
    void b.play().catch(() => {
      /* the 'error' listener drives the next step */
    })
    return true
  }

  /** Complete a crossfade: consume the queue like handleEnded would, adopt the incoming element. */
  const finishXfade = () => {
    const x = xfadeRef.current
    if (!x) return
    xfadeRef.current = null
    clearInterval(x.timer)
    // consume exactly what peekNext previewed
    const m = manualRef.current
    if (repeatRef.current !== 'one' && m.length > 0 && m[0].id === x.rel.id) {
      manualRef.current = m.slice(1)
      setManual(m.slice(1))
    }
    audioRef.current?.pause()
    audioRef.current = x.b
    x.b.volume = 1
    wireAudio(x.b)
    setCurrent(x.rel)
    currentRef.current = x.rel
    pushHistory(x.rel.id)
    recordPlay()
    postPlay(x.rel.id)
    setMediaMetadata(x.rel)
    setCur(x.b.currentTime)
    setDur(x.b.duration || 0)
    setPos(x.b.duration ? x.b.currentTime / x.b.duration : 0)
    setPlaying(true)
  }

  /** Near the end of a track, start the next one quietly and ramp (equal-power). */
  const maybeBeginXfade = (a: HTMLAudioElement) => {
    const w = crossfadeRef.current
    if (!w || xfadeRef.current || !playingRef.current) return
    const dur = a.duration
    if (!isFinite(dur) || dur <= w * 2) return // too short to overlap sensibly
    const remaining = dur - a.currentTime
    if (remaining > w) return
    const nxt = peekNext()
    if (!nxt?.audio) return
    const nextLocal = localAudioSrc(nxt.id)
    const url = nextLocal ?? mediaCandidates(streamableAudioUrl(nxt.audio))[0] ?? streamableAudioUrl(nxt.audio)
    // Gapless (F60): the warmed element already holds buffered data — starting
    // it is instant, which is exactly what a crossfade needs.
    const b = takePreloaded(nxt, url) ?? new Audio(url)
    if (nextLocal) b.dataset.localDownload = nxt.id
    b.preload = 'auto'
    b.volume = 0
    const timer = setInterval(() => {
      const x = xfadeRef.current
      if (!x || audioRef.current !== a) return
      const rem = (a.duration || 0) - a.currentTime
      const t = Math.min(Math.max(1 - rem / w, 0), 1)
      // equal-power curves keep perceived loudness constant through the blend
      a.volume = Math.cos((t * Math.PI) / 2) ** 2
      x.b.volume = Math.sin((t * Math.PI) / 2) ** 2
      if (t >= 1) finishXfade()
    }, 60)
    xfadeRef.current = { b, rel: nxt, timer }
    void b.play().catch(() => {
      // incoming element refused to start: abort, let 'ended' advance normally
      if (xfadeRef.current?.b === b) cancelXfade()
    })
  }

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

      setStalled(false)
      if (rel.audio) {
        // Source list, best first: the downloaded copy (offline-safe), then
        // every gateway that serves the same permanent content. One unreachable
        // gateway must not make a permanent release unplayable.
        const local = localAudioSrc(rel.id)
        const list = [...(local ? [local] : []), ...mediaCandidates(streamableAudioUrl(rel.audio))]
        attemptsRef.current = { id: rel.id, list, idx: 0 }
        // Learn (in the background, throttled) whether this content is settled
        // on arweave.net — its immutable cache-control makes replays free.
        probeSettled(streamableAudioUrl(rel.audio))
        // Gapless (F60): adopt the element preloadNext() warmed for this track;
        // its buffer makes the transition instant. Fresh element otherwise.
        const warmed = takePreloaded(rel, list[0])
        const a = warmed ?? new Audio(list[0])
        if (local) a.dataset.localDownload = rel.id
        audioRef.current = a
        wireAudio(a)
        void a.play().catch(() => {
          /* the 'error' listener walks the source list */
        })
      } else {
        attemptsRef.current = null
        setDur(DEMO_DURATION)
        startSim(0)
      }
      setPlaying(true)
      // Start warming whatever follows this track (metadata-only for now).
      queueMicrotask(() => preloadNext(false))
    },
    [pushHistory, startSim],
  )
  useEffect(() => {
    playRef.current = playNow
  }, [playNow])

  /** Public play: a direct pick outside a playlist clears the playlist context. */
  /** Try the current release again from the top of a freshly ordered source list. */
  const retry = useCallback(() => {
    const rel = currentRef.current
    if (!rel) return
    setStalled(false)
    playRef.current(rel)
  }, [])

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
    if (playingRef.current) cancelXfade()
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
    // (never the public play(): that clears playlist context, so one Prev
    // press inside a playlist would dump the session back into catalog order)
    if (p) playNow(p)
  }, [playNow, startSim])

  const seek = useCallback(
    (fraction: number) => {
      cancelXfade()
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
    clearPreload()
    msClear()
    setCurrent(null)
    currentRef.current = null
    setContext(null) // closing the player leaves any playlist context behind
    setManualSynced([]) // closing the player discards the user queue
    setSleepUntil(null) // and the sleep timer
    setPlaying(false)
    setPos(0)
    setCur(0)
    setDur(0)
  }, [])

  useEffect(() => () => {
    stopSim()
    clearAudio()
    clearPreload()
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

  /** Pause without toggling logic — used by the sleep timer deadline. */
  const pauseNow = useCallback(() => {
    cancelXfade()
    if (audioRef.current) audioRef.current.pause()
    else stopSim()
    setPlaying(false)
  }, [])

  const setSleepTimer = useCallback((v: number | 'track' | null) => {
    setSleepUntil(v == null ? null : v === 'track' ? 'track' : Date.now() + v * 60_000)
  }, [])

  // Countdown enforcement: a coarse 1s check while a deadline is set. The
  // check is wall-clock based, so it stays correct through WebView timer
  // throttling (it fires late but never early) and screen-off playback.
  useEffect(() => {
    if (typeof sleepUntil !== 'number') return
    const id = setInterval(() => {
      if (Date.now() >= sleepUntil) {
        setSleepUntil(null)
        pauseNow()
      }
    }, 1000)
    return () => {
      clearInterval(id)
    }
  }, [sleepUntil, pauseNow])

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
      sleepUntil,
      setSleepTimer,
      crossfade,
      setCrossfade,
      stalled,
      retry,
    }),
    [current, playing, queue.length, manual.length, shuffle, repeat, toggleRepeat, upNext, toggleShuffle, play, playList, addToQueue, playQueued, removeQueued, clearQueue, toggle, next, prev, seek, close, sleepUntil, setSleepTimer, crossfade, setCrossfade, stalled, retry],
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
