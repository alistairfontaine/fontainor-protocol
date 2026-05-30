import React, { useState } from 'react'
import { API_BASE } from '../lib/api.js'

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
  const [form, setForm] = useState({ title: '', artist: store.user?.name || '', price: 0, copies: 0, audio: '' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // {ok, msg}
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!form.title.trim() || !form.artist.trim()) return
    setBusy(true); setNote(null)
    const res = await store.publish({
      title: form.title.trim(), artist: form.artist.trim(),
      price: Number(form.price) || 0, copies: Number(form.copies) || 0, audio: form.audio.trim(),
    })
    setBusy(false)
    if (res.ok) { onClose('recent-releases') }
    else setNote(res)
  }

  return (
    <div className="modal" onClick={(e) => { if (e.target.classList.contains('modal')) onClose() }}>
      <div className="sheet">
        <button className="mclose" onClick={() => onClose()}>×</button>
        <h2>Register a release</h2>
        <p className="msub">This commits a new release to the protocol via the backend upload pipeline.</p>
        <div className="field"><label>Title</label><input value={form.title} onChange={set('title')} placeholder="e.g. Midnight Tape" /></div>
        <div className="field"><label>Artist</label><input value={form.artist} onChange={set('artist')} placeholder="Your artist name" /></div>
        <div className="field" style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><label>Price (USD)</label><input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} /></div>
          <div style={{ flex: 1 }}><label>Copies (0 = unlimited)</label><input type="number" min="0" step="1" value={form.copies} onChange={set('copies')} /></div>
        </div>
        <div className="field"><label>Audio URL (Arweave, optional for now)</label><input value={form.audio} onChange={set('audio')} placeholder="https://arweave.net/..." /></div>
        <button className="primary" disabled={busy} onClick={submit}>{busy ? 'Publishing…' : 'Publish to protocol'}</button>
        {note
          ? <div className={'mnote ' + (note.ok ? 'okmsg' : 'warnmsg')}>{note.ok ? '✓ ' : ''}{note.msg}{!note.ok && ' Your release was added to this preview only.'}</div>
          : <div className="mnote">This calls the backend at <code>{API_BASE}/upload</code>. Make sure the server is running.</div>}
      </div>
    </div>
  )
}
