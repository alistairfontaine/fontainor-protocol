import { useState, useRef, useCallback, useEffect } from 'react';
import { loadRegistry, FALLBACK } from '../lib/api.js';
import { normalize, normalizeOne, buildAsset } from '../lib/registry.js';

export function useStore() {
  const [releases, setReleases] = useState([]);
  const [source, setSource] = useState('');       // api | file | sample
  const [repaired, setRepaired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);         // { name, handle, via }
  const [favVer, setFavVer] = useState(0);        // bump to re-render on fav change
  const [histVer, setHistVer] = useState(0);

  const favorites = useRef(new Set()).current;
  const history = useRef([]).current;             // array of ids, most recent first

  // ---- player state ----
  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);              // 0..1
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const audioRef = useRef(null);
  const simRef = useRef(null);
  const DEMO = 180;

  const reload = useCallback(async () => {
    setLoading(true);
    // Fetches from your backend /registry route (which pulls from Irys)
    const r = await loadRegistry(FALLBACK);
    setReleases(normalize(r.data));
    setSource(r.source);
    setRepaired(r.repaired);
    setLoading(false);
  }, []);

  useEffect(() => { reload() }, [reload]);

  // ---- favorites / history ----
  const toggleFav = useCallback((id) => {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    setFavVer((v) => v + 1);
  }, [favorites]);

  const pushHistory = useCallback((id) => {
    const at = history.indexOf(id); if (at >= 0) history.splice(at, 1);
    history.unshift(id); setHistVer((v) => v + 1);
  }, [history]);

  // ---- player engine ----
  const stopSim = () => { if (simRef.current) { clearInterval(simRef.current); simRef.current = null; } };
  const clearAudio = () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };

  const play = useCallback((rel) => {
    stopSim(); clearAudio();
    setCurrent(rel); pushHistory(rel.id); setPos(0); setCur(0);
    if (rel.audio) {
      const a = new Audio(rel.audio);
      audioRef.current = a;
      a.addEventListener('loadedmetadata', () => setDur(a.duration || 0));
      a.addEventListener('timeupdate', () => {
        setCur(a.currentTime); setDur(a.duration || 0);
        setPos(a.duration ? a.currentTime / a.duration : 0);
      });
      a.addEventListener('ended', () => next());
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(true));
    } else {
      setDur(DEMO);
      let t = 0;
      simRef.current = setInterval(() => {
        t += 0.25; if (t >= DEMO) t = 0;
        setCur(t); setPos(t / DEMO);
      }, 250);
      setPlaying(true);
    }
  }, [pushHistory]);

  const pause = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    stopSim(); setPlaying(false);
  }, []);

  const resume = useCallback(() => {
    if (!current) return;
    if (audioRef.current) { audioRef.current.play(); setPlaying(true); }
    else {
      let t = cur;
      simRef.current = setInterval(() => { t += 0.25; if (t >= dur) t = 0; setCur(t); setPos(dur ? t / dur : 0); }, 250);
      setPlaying(true);
    }
  }, [current, cur, dur]);

  const toggle = useCallback(() => { playing ? pause() : resume() }, [playing, pause, resume]);

  const indexOfCurrent = () => (current ? releases.findIndex((r) => r.id === current.id && r.title === current.title) : -1);
  const next = useCallback(() => {
    if (!releases.length) return;
    const i = indexOfCurrent(); play(releases[(i + 1 + releases.length) % releases.length]);
  }, [releases, current, play]);

  const prev = useCallback(() => {
    if (!releases.length) return;
    const i = indexOfCurrent(); play(releases[(i - 1 + releases.length) % releases.length]);
  }, [releases, current, play]);

  const seek = useCallback((frac) => {
    if (audioRef.current) audioRef.current.currentTime = frac * (audioRef.current.duration || 0);
    else { const t = frac * dur; setCur(t); setPos(frac); }
  }, [dur]);

  useEffect(() => () => { stopSim(); clearAudio() }, []);

  // ---- auth ----
  const signInEmail = useCallback((email) => {
    const name = email.split('@')[0];
    setUser({ name: name.charAt(0).toUpperCase() + name.slice(1), handle: '@' + name, via: 'email' });
  }, []);

  const connectWallet = useCallback(() => {
    const addr = '7xT' + Math.random().toString(36).slice(2, 6) + '...' + Math.random().toString(36).slice(2, 5);
    setUser({ name: addr, handle: '@' + addr.slice(0, 6), via: 'wallet' });
  }, []);

  const logout = useCallback(() => setUser(null), []);

  // ---- support ----
  const support = useCallback((rel, amount) => {
    rel.social = rel.social || { ledger: [], totalTips: 0 };
    rel.social.ledger.push({ sender: user ? user.handle : 'you (preview)', amount, timestamp: new Date().toISOString() });
    rel.social.totalTips = Number(rel.social.totalTips || 0) + amount;
    setReleases((rs) => [...rs]);
  }, [user]);

  // ---- publish (fetch-append-push) ----
  const publish = useCallback(async (form) => {
    try {
      // 1. Fetch current registry from backend
      const res = await fetch('http://localhost:3000/registry');
      let currentRegistry = await res.json();
      if (!Array.isArray(currentRegistry)) currentRegistry = [];

      // 2. Build and normalize
      const newAsset = buildAsset(form);
      const updatedRegistry = [normalizeOne(newAsset), ...currentRegistry];

      // 3. Upload full list
      const uploadRes = await fetch('http://localhost:3000/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedRegistry)
      });

      const result = await uploadRes.json();
      if (result.success) {
        console.log("✅ Success! New Manifest ID (Update .env):", result.txId);
        setReleases(updatedRegistry);
      }
      return result;
    } catch (err) {
      console.error("Publishing failed:", err);
      return { success: false };
    }
  }, []);

  return {
    releases, source, repaired, loading, user,
    favorites, history, favVer, histVer,
    reload, toggleFav, pushHistory,
    current, playing, pos, cur, dur, play, pause, resume, toggle, next, prev, seek,
    signInEmail, connectWallet, logout,
    support, publish,
  };
}
