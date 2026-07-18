import { API_BASE } from '../lib/api.js'
import { useState, useRef, useCallback, useEffect } from 'react'
import { loadRegistry, publishManifest, FALLBACK, resolveAudioUri } from '../lib/api.js'
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

    // Check both standard field shapes: rel.audio and rel.audioUri
    const audioTrackSource = rel.audio || rel.audioUri;

    if (audioTrackSource) {
      // 🎵 RESOLVE LOCAL SANDBOX MEDIA PATHS NATIVELY 🎵
      const targetAudioStreamUrl = resolveAudioUri(audioTrackSource);

      console.log(`🎵 [Media Player] Instantiating hardware pipeline for stream: ${targetAudioStreamUrl}`);
      const a = new Audio(targetAudioStreamUrl)
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
  const connectWallet = useCallback(async () => {
       try {
      console.log('[Fontainor] connectWallet started. window.solana?', !!window?.solana, 'window.phantom?', !!window?.phantom)

      // Firefox/Chrome compatibility: check both injection paths
      let provider = window?.solana;
      if (!provider && window?.phantom?.solana) {
        provider = window.phantom.solana;
      }

      let attempts = 0;
      while (!provider?.isPhantom && attempts < 30) {
        await new Promise(r => setTimeout(r, 100));
        provider = window?.solana || window?.phantom?.solana;
        attempts++;
      }

      if (!provider?.isPhantom) {
        alert("Phantom Wallet not detected. Try refreshing with Phantom unlocked, or use Chrome/Brave.");
        return { success: false, error: "NO_WALLET" };
      }

      window.solana = provider; // normalize

      let publicKey;
      if (window.solana.isConnected && window.solana.publicKey) {
        publicKey = window.solana.publicKey;
      } else {
        const resp = await window.solana.connect();
        publicKey = resp.publicKey;
      }

      const address = publicKey.toString();
      const msg = "Authenticate Fontainor Sovereign Session";
      const encoded = new TextEncoder().encode(msg);
      const signed = await window.solana.signMessage(encoded, "utf8");

      const authRes = await fetch(`${API_BASE}/api/v1/auth/sovereign-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: JSON.stringify(Array.from(publicKey.toBytes())),
          signature: JSON.stringify(Array.from(signed.signature)),
          message: msg
        })
      });

      const authData = await authRes.json();
      if (!authRes.ok || !authData.success) {
        throw new Error(authData.message || "Backend rejected signature");
      }

      setUser({ name: address, handle: authData.handle, via: 'wallet' });
      return { success: true, wallet: address };

    } catch (err) {
      console.error("Wallet auth failed:", err.message);
      return { success: false, error: err.message };
    }
  }, [])

  // ---- Web3 Blockchain Purchase & Support Orchestrator ----
  const support = useCallback(async (rel, amount, currency = 'SOL') => {
    /* 🪙 PART III: ON-CHAIN CRYPTOGRAPHIC PAYMENT SIGNING LOOP 🪙 */
    if (!user || user.via !== 'wallet') {
      alert("Authentication required! Please connect your Solana Web3 wallet to purchase or tip this track.");
      return { success: false, reason: "NOT_AUTHENTICATED" };
    }

    try {
      setUploadState('uploading');
      console.log(`📡 Orchestrating on-chain ${amount} ${currency} payment routing for track asset...`);

      // Initialize the web3 connection layer to talk directly to the Solana network gateway
      const { Connection, Transaction, SystemProgram, PublicKey } = await import('@solana/web3.js');
      const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

      const buyerPubKey = new PublicKey(window.solana.publicKey.toString());


      const artistPubKey = new PublicKey(rel.artistWallet || window.solana.publicKey.toString()); // Fallback to current node if un-assigned

      let txSignature = "";

      const { blockhash } = await connection.getLatestBlockhash();
      const transaction = new Transaction();

      if (currency === 'SOL') {
        const lamports = Math.round(amount * 1_000_000_000);
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: buyerPubKey,
            toPubkey: artistPubKey,
            lamports,
          })
        );
      } else {
        const tokenMintAddressStr = currency === 'USDC'
          ? "Gh9ZwEzd6GtxvnZGo4v5RWwK683v8C65u9m4AAn76W"
          : "Er4vEzd6GtxvnZGo4v5RWwK683v8C65u9m4AAn77X";
        const tokenMintPubKey = new PublicKey(tokenMintAddressStr);

        const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createTransferCheckedInstruction } = await import('@solana/spl-token');

        // Derive Associated Token Accounts (ATA) for both buyer and artist wallets
        const buyerTokenAddress = getAssociatedTokenAddressSync(tokenMintPubKey, buyerPubKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        const artistTokenAddress = getAssociatedTokenAddressSync(tokenMintPubKey, artistPubKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

        // Stablecoins leverage a 6-decimal scale constraint factor instead of lamports (9)
        const rawTokenAmount = Math.round(amount * 1_000_000);

        transaction.add(
          createTransferCheckedInstruction(
            buyerTokenAddress,
            tokenMintPubKey,
            artistTokenAddress,
            buyerPubKey,
            rawTokenAmount,
            6,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }

      transaction.recentBlockhash = blockhash;
      transaction.feePayer = buyerPubKey;

      console.log(`📡 Prompting Phantom wallet to sign and broadcast the on-chain ${currency} transaction payload...`);
      const signedTx = await window.solana.signAndSendTransaction(transaction);
      txSignature = signedTx.signature;


      console.log(`🎯 Transaction successfully broadcast! Network Signature: ${txSignature}`);

      // 📡 FORWARD TRANSACTION DATA DIRECTLY TO THE PROTOCOL BACKEND FOR VERIFICATION 📡
      const paymentPayload = {
        signature: txSignature,
        artistWallet: rel.artistWallet || window.solana.publicKey.toString(),
        amountLamports: Math.round(amount * 1_000_000_000), // Enforce native conversion units
        sender: user.handle,
        currency,
        trackId: rel.id
      };


      const backendResponse = await fetch(`${API_BASE}/api/v1/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentPayload)
      });

      const backendResult = await backendResponse.json();

      if (!backendResponse.ok || !backendResult.success) {
        throw new Error(backendResult.message || "Backend rejected payment verification.");
      }

      // Forward the verified cryptographic transaction hash directly to your server registry tables
      rel.social = backendResult.updatedSocial || rel.social || { ledger: [], totalTips: 0 };
      setReleases((rs) => [...rs]); // Instant high-fidelity re-render

      setUploadState('success');
      setToast({
        kind: 'ok',
        msg: `Transaction finalized! Permanently recorded payment on protocol.`,
        txId: txSignature.slice(0, 8) + '...'
      });

      setTimeout(() => setToast(null), 6000);
      return { success: true, signature: txSignature };
    } catch (paymentErr) {
      console.error("❌ On-chain Solana payment execution rejected:", paymentErr.message);
      setUploadState('error');
      setToast({ kind: 'warn', msg: `Payment workflow cancelled: ${paymentErr.message}`, txId: null });
      setTimeout(() => setToast(null), 6000);
      return { success: false, error: paymentErr.message };
    }
  }, [user, releases])



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
    setReleases((rs) => [normalizeOne(asset), ...rs])

    console.log("📡 [Sovereign Ingress] Prompting client extensions for direct blockchain data etching...");

    // 🔒 NATIVE MAINNET SEEDLESS PASS: Execute publication directly over public gateways
    const res = await publishManifest(asset);


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
