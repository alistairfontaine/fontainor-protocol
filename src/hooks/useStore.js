import { useState, useRef, useCallback, useEffect } from 'react'
import { loadRegistry, publishManifest, FALLBACK } from '../lib/api.js'
import { normalize, normalizeOne, buildAsset } from '../lib/registry.js'

export function useStore() {
  const [releases, setReleases] = useState([])
  const [source, setSource] = useState('')        // api | file | sample
  const [repaired, setRepaired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)          // { name, handle, via }
  const [favVer, setFavVer] = useState(0)          // bump to re-render on fav change
  const [histVer, setHistVer] = useState(0)
  // ---- mint / upload status (for the Minting UX) ----
  const [uploadState, setUploadState] = useState('idle') // idle | uploading | success | error
  const [lastTx, setLastTx] = useState(null)             // last manifest TxID
  const [toast, setToast] = useState(null)               // { kind:'ok'|'warn', msg, txId } | null

  const favorites = useRef(new Set()).current
  const history = useRef([]).current               // array of ids, most recent first

  // ---- player state ----
  const [current, setCurrent] = useState(null)     // rel or null
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)                // 0..1
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const audioRef = useRef(null)
  const simRef = useRef(null)
  const DEMO = 180

  const reload = useCallback(async () => {
    setLoading(true)
    const r = await loadRegistry(FALLBACK)
    setReleases(normalize(r.data))
    setSource(r.source)
    setRepaired(r.repaired)
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  // ---- favorites / history ----
  const toggleFav = useCallback((id) => {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id)
    setFavVer((v) => v + 1)
  }, [favorites])
  const pushHistory = useCallback((id) => {
    const at = history.indexOf(id); if (at >= 0) history.splice(at, 1)
    history.unshift(id); setHistVer((v) => v + 1)
  }, [history])

  // ---- player engine ----
  const stopSim = () => { if (simRef.current) { clearInterval(simRef.current); simRef.current = null } }
  const clearAudio = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null } }

  const play = useCallback((rel) => {
    stopSim(); clearAudio()
    setCurrent(rel); pushHistory(rel.id); setPos(0); setCur(0)
    if (rel.audio) {
      const a = new Audio(rel.audio)
      audioRef.current = a
      a.addEventListener('loadedmetadata', () => setDur(a.duration || 0))
      a.addEventListener('timeupdate', () => {
        setCur(a.currentTime); setDur(a.duration || 0)
        setPos(a.duration ? a.currentTime / a.duration : 0)
      })
      a.addEventListener('ended', () => next())
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(true))
    } else {
      setDur(DEMO)
      let t = 0
      simRef.current = setInterval(() => {
        t += 0.25; if (t >= DEMO) t = 0
        setCur(t); setPos(t / DEMO)
      }, 250)
      setPlaying(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushHistory])

  const pause = useCallback(() => {
    if (audioRef.current) audioRef.current.pause()
    stopSim(); setPlaying(false)
  }, [])

  const resume = useCallback(() => {
    if (!current) return
    if (audioRef.current) { audioRef.current.play(); setPlaying(true) }
    else {
      let t = cur
      simRef.current = setInterval(() => { t += 0.25; if (t >= dur) t = 0; setCur(t); setPos(dur ? t / dur : 0) }, 250)
      setPlaying(true)
    }
  }, [current, cur, dur])

  const toggle = useCallback(() => { playing ? pause() : resume() }, [playing, pause, resume])

  const indexOfCurrent = () => (current ? releases.findIndex((r) => r.id === current.id && r.title === current.title) : -1)
  const next = useCallback(() => {
    if (!releases.length) return
    const i = indexOfCurrent(); play(releases[(i + 1 + releases.length) % releases.length])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releases, current, play])
  const prev = useCallback(() => {
    if (!releases.length) return
    const i = indexOfCurrent(); play(releases[(i - 1 + releases.length) % releases.length])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releases, current, play])

  const seek = useCallback((frac) => {
    if (audioRef.current) audioRef.current.currentTime = frac * (audioRef.current.duration || 0)
    else { const t = frac * dur; setCur(t); setPos(frac) }
  }, [dur])

  useEffect(() => () => { stopSim(); clearAudio() }, [])

  // ---- auth ----
  const signInEmail = useCallback((email) => {
    const name = email.split('@')[0]
    setUser({ name: name.charAt(0).toUpperCase() + name.slice(1), handle: '@' + name, via: 'email' })
  }, [])
  const connectWallet = useCallback(() => {
    const addr = '7xT' + Math.random().toString(36).slice(2, 6) + '...' + Math.random().toString(36).slice(2, 5)
    setUser({ name: addr, handle: '@' + addr.slice(0, 6), via: 'wallet' })
  }, [])
  const logout = useCallback(() => setUser(null), [])

  // ---- support (pay-what-you-want), optimistic ----
  const support = useCallback((rel, amount) => {
    rel.social = rel.social || { ledger: [], totalTips: 0 }
    rel.social.ledger.push({ sender: user ? user.handle : 'you (preview)', amount, timestamp: new Date().toISOString() })
    rel.social.totalTips = Number(rel.social.totalTips || 0) + amount
    setReleases((rs) => [...rs])  // trigger re-render
  }, [user])

  // ---- publish: Fetch-Append-Push (manifest protocol) with Mint UX ----
const publish = useCallback(async (form) => {
    // --- DEBUGGING LOGS ---
    console.log("DEBUG: Raw Form Input:", form);
    const asset = buildAsset(form);
    console.log("DEBUG: Asset structure after buildAsset:", asset);

    // Check if the asset has the required fields
    if (!asset.title || !asset.artist || !asset.id) {
       console.error("DEBUG: Asset is missing required fields!");
    }
    // -----------------------

    setUploadState('uploading')
    setToast(null)
    // optimistic: show it immediately so work isn't lost
    setReleases((rs) => [normalizeOne(asset), ...rs])

    const res = await publishManifest(asset)

    if (res.ok) {
      setUploadState('success')
      if (res.txId) setLastTx(res.txId)
      setToast({
        kind: 'ok',
        msg: res.txId ? 'Permanently etched onto Arweave.' : 'Committed to the manifest ledger.',
        txId: res.txId || null,
      })
      setTimeout(() => reload(), 1500)
      setTimeout(() => setToast(null), 9000)
    } else {
      setUploadState('error')
      let msg
      if (res.failure === 'validation') {
        msg = res.msg + ' (kept in this preview — not submitted).'
      } else if (res.failure === 'timeout') {
        msg = 'Etch timed out — not saved to Arweave. Your release is kept in this preview; try again.'
      } else if (res.failure === 'write' || res.failure === 'network') {
        msg = (res.msg || 'Write failed.') + ' Not saved to Arweave — kept in this preview.'
      } else {
        msg = (res.msg || 'Something went wrong.') + ' Saved to this preview only.'
      }
      setToast({ kind: 'warn', msg, txId: null, code: res.code || null })
      setTimeout(() => setToast(null), 12000)
    }
    return res
  }, [reload])

  const dismissToast = useCallback(() => setToast(null), [])

  return {
    releases, source, repaired, loading, user,
    favorites, history, favVer, histVer,
    reload, toggleFav, pushHistory,
    // player
    current, playing, pos, cur, dur, play, pause, resume, toggle, next, prev, seek,
    // auth
    signInEmail, connectWallet, logout,
    // actions
    support, publish,
    // mint UX
    uploadState, lastTx, toast, dismissToast,
  }
}
