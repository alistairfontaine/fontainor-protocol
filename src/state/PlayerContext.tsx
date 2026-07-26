import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Release } from '../lib/registry'
import { useHistoryLog } from './collections'

interface PlayerState {
  current: Release | null
  playing: boolean
  /** 0..1 */
  pos: number
  cur: number
  dur: number
  play: (rel: Release) => void
  toggle: () => void
  seek: (fraction: number) => void
  close: () => void
}

const Ctx = createContext<PlayerState | null>(null)

const DEMO_DURATION = 180 // simulated playback when a release has no audioUri

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Release | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { push: pushHistory } = useHistoryLog()

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

  const startSim = useCallback((from: number) => {
    stopSim()
    let t = from
    simRef.current = setInterval(() => {
      t += 0.25
      if (t >= DEMO_DURATION) {
        stopSim()
        setPlaying(false)
        t = DEMO_DURATION
      }
      setCur(t)
      setPos(t / DEMO_DURATION)
    }, 250)
  }, [])

  const play = useCallback(
    (rel: Release) => {
      stopSim()
      clearAudio()
      setCurrent(rel)
      pushHistory(rel.id)
      setPos(0)
      setCur(0)

      if (rel.audio) {
        const a = new Audio(rel.audio)
        audioRef.current = a
        a.addEventListener('loadedmetadata', () => setDur(a.duration || 0))
        a.addEventListener('timeupdate', () => {
          setCur(a.currentTime)
          setDur(a.duration || 0)
          setPos(a.duration ? a.currentTime / a.duration : 0)
        })
        a.addEventListener('ended', () => setPlaying(false))
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

  const toggle = useCallback(() => {
    if (!current) return
    if (audioRef.current) {
      if (playing) audioRef.current.pause()
      else void audioRef.current.play()
    } else {
      if (playing) stopSim()
      else startSim(cur)
    }
    setPlaying((p) => !p)
  }, [current, playing, cur, startSim])

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
    setCurrent(null)
    setPlaying(false)
    setPos(0)
    setCur(0)
    setDur(0)
  }, [])

  useEffect(() => () => {
    stopSim()
    clearAudio()
  }, [])

  useEffect(() => {
    document.body.classList.toggle('has-player', current != null)
  }, [current])

  const value = useMemo<PlayerState>(
    () => ({ current, playing, pos, cur, dur, play, toggle, seek, close }),
    [current, playing, pos, cur, dur, play, toggle, seek, close],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePlayer(): PlayerState {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlayer outside PlayerProvider')
  return v
}
