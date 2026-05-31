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

export function PublishModal({ store, onClose }) {
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

  // while the manifest is being committed, show the "etching" state
  if (busy || store.uploadState === 'uploading') {
    return (
      <div className="modal">
        <div className="sheet etching">
          <div className="etch-spinner" />
          <h2>Etching onto the blockchain…</h2>
          <p className="msub">Committing the updated registry to Arweave via Irys. This can take a few moments — please don’t close the tab.</p>
          <div className="etch-steps">
            <div className="estep done">Fetched current registry</div>
            <div className="estep done">Appended your release</div>
            <div className="estep active">Pushing manifest to Arweave…</div>
          </div>
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
              <option>USD</option><option>SOL</option><option>USDC</option>
            </select>
          </div>
          <div style={{ flex: 1 }}><label>Editions</label><input type="number" min="0" step="1" value={form.total} onChange={set('total')} placeholder="0" /></div>
        </div>
        <div className="field"><label>Audio URI (Arweave URL, optional)</label><input value={form.audioUri} onChange={set('audioUri')} placeholder="https://arweave.net/..." /></div>
        <div className="field"><label>Cover URI (image URL, optional)</label><input value={form.coverUri} onChange={set('coverUri')} placeholder="https://arweave.net/..." /></div>
        <button className="primary" disabled={busy} onClick={submit}>{busy ? 'Publishing…' : 'Publish to protocol'}</button>
        {note
          ? <div className={'mnote ' + (note.ok ? 'okmsg' : 'warnmsg')}>
              {note.ok ? '✓ ' : ''}{note.msg}{!note.ok && ' Your release was added to this preview only.'}
              {note.details && <ValidationDetails details={note.details} />}
            </div>
          : <div className="mnote">This sends an array to <code>{API_BASE}/upload</code>, validated against the registry schema. Make sure the server is running.</div>}
      </div>
    </div>
  )
}
