import React, { useState } from 'react'
import { API_BASE } from '../lib/api.js'

// Render Zod's error.format() output as a short, readable field list.
function ValidationDetails({ details }) {
  if (!details || typeof details !== 'object') return null
  const rows = []
  const walk = (obj, prefix) => {
    for (const key of Object.keys(obj)) {
      if (key === '_errors') {
        if (Array.isArray(obj._errors) && obj._errors.length && prefix) {
          rows.push(prefix + ': ' + obj._errors.join(', '))
        }
      } else if (obj[key] && typeof obj[key] === 'object') {
        walk(obj[key], prefix ? prefix + '.' + key : key)
      }
    }
  }
  walk(details, '')
  if (!rows.length) return null
  return (
    <ul style={{ margin: '8px 0 0', paddingLeft: 16, textAlign: 'left', lineHeight: 1.5 }}>
      {rows.slice(0, 8).map((r, i) => <li key={i} style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r}</li>)}
    </ul>
  )
}

export function AuthModal({ store, mode, setMode, onClose }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const isSignup = mode === 'signup'

  const submit = () => {
    if (!email || email.indexOf('@') < 0) return
    store.signInEmail(email)
    onClose('profile')
  }
  const wallet = () => { store.connectWallet(); onClose('profile') }

  return (
    <div className="modal" onClick={(e) => { if (e.target.classList.contains('modal')) onClose() }}>
      <div className="sheet">
        <button className="mclose" onClick={() => onClose()}>×</button>
        <h2>{isSignup ? 'Create your Fontainor account' : 'Log in to Fontainor'}</h2>
        <p className="msub">{isSignup ? 'Join with email or your wallet.' : 'Welcome back. Continue with email or your wallet.'}</p>
        <div className="field"><label>Email</label>
          <input type="email" placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <div className="field"><label>Password</label>
          <input type="password" placeholder="••••••••" value={pass}
            onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <button className="primary" onClick={submit}>{isSignup ? 'Create account' : 'Continue with email'}</button>
        <div className="ordiv">or</div>
        <button className="wallet" onClick={wallet}><span className="dot" /> Connect wallet (Phantom · Solana)</button>
        <div className="toggle">
          {isSignup
            ? <>Already have an account? <a onClick={() => setMode('login')}>Log in</a></>
            : <>New here? <a onClick={() => setMode('signup')}>Create an account</a></>}
        </div>
        <div className="mnote">Preview build — accounts aren't connected to a server yet. This signs you in locally so you can explore the app.</div>
      </div>
    </div>
  )
}

export function PublishModal({ store, uploader, onClose }) {
  const [form, setForm] = useState({ title: '', artist: store.user?.name || '', price: 0, currency: 'USD', total: 0, audioUri: '', coverUri: '' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // {ok, msg, details?}
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.title.trim() || !form.artist.trim()) return
    setBusy(true); setNote(null)
    const res = await store.publish({
      title: form.title.trim(), artist: form.artist.trim(),
      price: Number(form.price) || 0, currency: form.currency || 'USD',
      total: Number(form.total) || 0,
      audioUri: form.audioUri.trim(), coverUri: form.coverUri.trim(),
    })
    setBusy(false)
    if (res.ok) { onClose('recent-releases') }   // toast shows the confirmation
    else setNote(res)
  }

  // Intercept the dual-stage loading operations: chunk upload vs manifest commit
  if (busy || uploader.isUploading || store.uploadState === 'uploading') {
    return (
      <div className="modal">
        <div className="sheet etching">
          <div className="etch-spinner" />
          {uploader.isUploading ? (
            <>
              <h2>{!form.audioUri ? "Streaming track bytes to protocol…" : "Streaming cover artwork to protocol…"}</h2>
              <p className="msub">
                {!form.audioUri
                  ? `Slicing audio file into sequential 256KB binary fragments. Progress: `
                  : `Slicing graphic artwork layout into sequential 256KB fragments. Progress: `
                }
                <strong>{uploader.progress}%</strong>
              </p>
              <div style={{ width: '100%', background: 'var(--line)', height: 6, borderRadius: 3, margin: '16px 0', overflow: 'hidden' }}>
                <div style={{ width: `${uploader.progress}%`, background: 'var(--accent)', height: '100%', transition: 'width 0.2s ease' }} />
              </div>
              {uploader.eta > 0 && <p style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>Estimated time remaining: {(uploader.eta / 1000).toFixed(1)}s</p>}
            </>
          ) : (
            <>
              <h2>Etching onto the blockchain…</h2>
              <p className="msub">Committing the updated registry to Arweave via Irys. This can take a few moments — please don’t close the tab.</p>
              <div className="etch-steps">
                <div className="estep done">Audio binary chunk track uploaded</div>
                <div className="estep done">Appended release track to registry</div>
                <div className="estep active">Pushing manifest to Arweave…</div>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }


  return (
    <div className="modal" onClick={(e) => { if (e.target.classList.contains('modal')) onClose() }}>
      <div className="sheet">
        <button className="mclose" onClick={() => onClose()}>×</button>
        <h2>Register a release</h2>
        <p className="msub">This commits a new release to the protocol via the manifest ledger (Fetch → Append → Push).</p>
        <div className="field"><label>Title</label><input value={form.title} onChange={set('title')} placeholder="e.g. Midnight Tape" /></div>
        <div className="field"><label>Artist</label><input value={form.artist} onChange={set('artist')} placeholder="Your artist name" /></div>
        <div className="field" style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 2 }}><label>Price</label><input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} /></div>
          <div style={{ flex: 1 }}><label>Currency</label>
            <select value={form.currency} onChange={set('currency')} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '11px 12px', fontSize: 14, fontFamily: 'var(--sans)' }}>
              <option>USD</option><option>SOL</option><option>USDC</option><option>USDT</option>
            </select>
          </div>

          <div style={{ flex: 1 }}><label>Editions</label><input type="number" min="0" step="1" value={form.total} onChange={set('total')} placeholder="0" /></div>
        </div>
        <div className="field">
          <label>Upload Audio Track File (WAV, FLAC, MP3, OGG)</label>
          <input
            type="file"
            accept="audio/wav,audio/flac,audio/mpeg,audio/ogg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              const result = await uploader.uploadTrack(file);
              setBusy(false);
              if (result.success) {
                setForm(f => ({ ...f, audioUri: result.audioUri }));
              } else {
                alert(`Audio upload failed: ${result.error}`);
              }
            }}
          />
        </div>
        <div className="field"><label>Audio URI (Auto-populated upon selection)</label><input value={form.audioUri} onChange={set('audioUri')} placeholder="Select a file or enter address manually" /></div>
        <div className="field">
          <label>Upload Cover Artwork Image (PNG, JPG, GIF)</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              const result = await uploader.uploadTrack(file);
              setBusy(false);
              if (result.success) {
                setForm(f => ({ ...f, coverUri: result.audioUri }));
                console.log(`📸 [Artwork Engine] Cover successfully etched at: ${result.audioUri}`);
              } else {
                alert(`Artwork upload failed: ${result.error}`);
              }
            }}
          />
        </div>

        <div className="field"><label>Cover URI (Auto-populated upon selection)</label><input value={form.coverUri || ''} onChange={set('coverUri')} placeholder="Select an image file or enter address manually" /></div>
        <button className="primary" disabled={busy || uploader.isUploading} onClick={submit}>
          {busy || uploader.isUploading ? 'Streaming track…' : 'Publish to protocol'}
        </button>
        {note
          ? <div className={'mnote ' + (note.ok ? 'okmsg' : 'warnmsg')}>
              {note.ok ? '✓ ' : ''}{note.msg}{!note.ok && ' Your release was added to this preview only.'}
              {note.details && <ValidationDetails details={note.details} />}
            </div>
          : <div className="mnote">This streams chunks to the server registry system. Make sure the backend is active on port 3000.</div>}

      </div>
    </div>
  )
}

/**
 * 📰 NINA-STYLE JOURNALISTIC EDITORIAL WRITER MODAL 📰
 * Lets authenticated protocol users publish full articles, text posts,
 * and critical reviews directly to the decentralized registry layers.
 */
export function PostModal({ store, onClose }) {
  const [form, setForm] = useState({ title: '', artist: store.user?.name || '', body: '', tags: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.title.trim() || !form.body.trim()) return
    setBusy(true); setError(null)

    // Format text posts inside the shared schema matrix structure with explicit type labels
    const postAsset = {
      type: 'editorial',
      id: 'FONT-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      title: form.title.trim(),
      artist: form.artist.trim(),
      desc: form.body.trim(),
      tags: form.tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0),
      price: { amount: 0, currency: 'USD' },
      editions: { total: 0 },
      status: 'REGISTERED_ON_FONTAINOR',
      date: new Date().toISOString()
    }

    const res = await store.publish(postAsset)
    setBusy(false)

    if (res.ok) {
      onClose('recent-posts')
    } else {
      setError(res.msg || "Failed to commit article payload to network.")
    }
  }

  if (busy || store.uploadState === 'uploading') {
    return (
      <div className="modal">
        <div className="sheet etching">
          <div className="etch-spinner" />
          <h2>Etching journal entry onto protocol…</h2>
          <p className="msub">Committing your editorial text directly to Arweave. Please don’t close this window.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="modal" onClick={(e) => { if (e.target.classList.contains('modal')) onClose() }}>
      <div className="sheet" style={{ maxWidth: 650 }}>
        <button className="mclose" onClick={() => onClose()}>×</button>
        <h2>Write an Editorial Post</h2>
        <p className="msub">Publish text articles, audio reviews, and picks directly to the decentralized network layer.</p>

        {error && <div className="loadnote warn" style={{ margin: '0 0 14px' }}>{error}</div>}

        <div className="field"><label>Article Title</label><input value={form.title} onChange={set('title')} placeholder="e.g. Exploring the Emo Shoegaze Revival" /></div>
        <div className="field"><label>Author / Pen Name</label><input value={form.artist} onChange={set('artist')} placeholder="Your author handle" /></div>

        <div className="field">
          <label>Article Body Content</label>
          <textarea
            value={form.body}
            onChange={set('body')}
            placeholder="Write your journalistic article, full-length critique, or community picks here..."
            style={{ width: '100%', minHeight: 180, border: '1px solid var(--line)', borderRadius: 7, padding: '11px 12px', fontSize: 14, fontFamily: 'var(--sans)', resize: 'vertical' }}
          />
        </div>

        <div className="field"><label>Tags (Comma-separated)</label><input value={form.tags} onChange={set('tags')} placeholder="e.g. ambient, review, lofi" /></div>

        <button className="primary" onClick={submit} disabled={!form.title.trim() || !form.body.trim()}>
          Publish Article to Protocol
        </button>
      </div>
    </div>
  )
}
/></div>
        <div className="field">
          <label>Upload Cover Artwork Image (PNG, JPG, GIF)</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              // Reuse your verified binary chunk uploader loop to store artwork bytes on the blockchain
              const result = await uploader.uploadTrack(file);
              setBusy(false);
              if (result.success) {
                // Ensure the generated transaction ID string maps onto the cover field cleanly
                setForm(f => ({ ...f, coverUri: result.audioUri }));
                console.log(`📸 [Artwork Engine] Cover successfully etched at: ${result.audioUri}`);
              } else {
                alert(`Artwork upload failed: ${result.error}`);
              }
            }}
          />
        </div>

        <div className="field">
          <label>Cover URI (Auto-populated upon selection)</label>
          <input value={form.coverUri || ''} onChange={set('coverUri')} placeholder="Select an image file or enter address manually" />
        </div>

        <button className="primary" disabled={busy || uploader.isUploading} onClick={submit}>


          {busy || uploader.isUploading ? 'Streaming track…' : 'Publish to protocol'}
        </button>
        {note
          ? <div className={'mnote ' + (note.ok ? 'okmsg' : 'warnmsg')}>
              {note.ok ? '✓ ' : ''}{note.msg}{!note.ok && ' Your release was added to this preview only.'}
              {note.details && <ValidationDetails details={note.details} />}
            </div>
          : <div className="mnote">This streams chunks to the server registry system. Make sure the backend is active on port 3000.</div>}

      </div>
    </div>
  )
}

/**
 * 📰 NINA-STYLE JOURNALISTIC EDITORIAL WRITER MODAL 📰
 * Lets authenticated protocol users publish full articles, text posts,
 * and critical reviews directly to the decentralized registry layers.
 */
export function PostModal({ store, onClose }) {
  const [form, setForm] = useState({ title: '', artist: store.user?.name || '', body: '', tags: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.title.trim() || !form.body.trim()) return
    setBusy(true); setError(null)

    // Format text posts inside the shared schema matrix structure
    const postAsset = {
      id: 'FONT-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      title: form.title.trim(),
      artist: form.artist.trim(),
      desc: form.body.trim(), // Article text mapped onto standard description fields
      tags: form.tags.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0),
      price: { amount: 0, currency: 'USD' }, // Journalistic texts remain open and free access
      editions: { total: 0 },
      status: 'REGISTERED_ON_FONTAINOR',
      date: new Date().toISOString()
    }

    const res = await store.publish(postAsset)
    setBusy(false)

    if (res.ok) {
      onClose('recent-posts')
    } else {
      setError(res.msg || "Failed to commit article payload to network.")
    }
  }

  if (busy || store.uploadState === 'uploading') {
    return (
      <div className="modal">
        <div className="sheet etching">
          <div className="etch-spinner" />
          <h2>Etching journal entry onto protocol…</h2>
          <p className="msub">Committing your editorial text directly to Arweave. Please don’t close this window.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="modal" onClick={(e) => { if (e.target.classList.contains('modal')) onClose() }}>
      <div className="sheet" style={{ maxWidth: 650 }}>
        <button className="mclose" onClick={() => onClose()}>×</button>
        <h2>Write an Editorial Post</h2>
        <p className="msub">Publish text articles, audio reviews, and picks directly to the decentralized network layer.</p>

        {error && <div className="loadnote warn" style={{ margin: '0 0 14px' }}>{error}</div>}

        <div className="field"><label>Article Title</label><input value={form.title} onChange={set('title')} placeholder="e.g. Exploring the Emo Shoegaze Revival" /></div>
        <div className="field"><label>Author / Pen Name</label><input value={form.artist} onChange={set('artist')} placeholder="Your author handle" /></div>

        <div className="field">
          <label>Article Body Content</label>
          <textarea
            value={form.body}
            onChange={set('body')}
            placeholder="Write your journalistic article, full-length critique, or community picks here..."
            style={{ width: '100%', minHeight: 180, border: '1px solid var(--line)', borderRadius: 7, padding: '11px 12px', fontSize: 14, fontFamily: 'var(--sans)', resize: 'vertical' }}
          />
        </div>

        <div className="field"><label>Tags (Comma-separated)</label><input value={form.tags} onChange={set('tags')} placeholder="e.g. ambient, review, lofi" /></div>

        <button className="primary" onClick={submit} disabled={!form.title.trim() || !form.body.trim()}>
          Publish Article to Protocol
        </button>
      </div>
    </div>
  )
}

