import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { IconArweave, IconCheck, IconPublish, IconSpinner, IconWallet } from '../components/icons'
import { Badge, Banner, Button, Chip, EmptyState, PageHead } from '../components/ui'
import { DEMO_PUBLISH, publishDemo, publishManifest, uploadAudioChunks, type PublishResult } from '../lib/api'
import { buildAsset, type AssetType } from '../lib/registry'
import { useAuth } from '../state/AuthContext'
import { useRegistry } from '../state/RegistryContext'

type Phase = 'form' | 'uploading' | 'etching' | 'done'

const inputCls =
  'h-11 w-full rounded-btn border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-body">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-faint">{hint}</span>}
    </label>
  )
}

export default function Publish() {
  const { user, connect, connecting } = useAuth()
  const { reload } = useRegistry()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [type, setType] = useState<AssetType>(params.get('type') === 'editorial' ? 'editorial' : 'release')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [desc, setDesc] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('USDC')
  const [total, setTotal] = useState('')
  const [audioMode, setAudioMode] = useState<'file' | 'uri'>('uri')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [audioUri, setAudioUri] = useState('')
  const [coverUri, setCoverUri] = useState('')

  const [phase, setPhase] = useState<Phase>('form')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [connectErr, setConnectErr] = useState<string | null>(null)

  // pre-fill artist from wallet handle (FRICT: pre-fill what we can guess)
  const artistValue = artist || user?.handle || ''

  const valid = useMemo(() => {
    if (!title.trim() || !artistValue.trim()) return false
    if (type === 'release' && audioMode === 'file' && !audioFile) return false
    return true
  }, [title, artistValue, type, audioMode, audioFile])

  if (!user) {
    return (
      <EmptyState
        icon={<IconWallet size={26} />}
        title="Sign in to publish"
        body="Publishing writes to the permanent registry under your identity. Your Solana wallet is your login — no email, no password."
        action={
          <div className="flex flex-col items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={connecting}
              onClick={async () => {
                setConnectErr(null)
                const r = await connect()
                if (!r.success) setConnectErr(r.error ?? 'Could not connect.')
              }}
            >
              {connecting ? <IconSpinner size={18} /> : <IconWallet size={18} />} Connect Phantom
            </Button>
            {connectErr && <p className="max-w-sm text-[13px] text-warn">{connectErr}</p>}
          </div>
        }
      />
    )
  }

  const submit = async () => {
    setResult(null)
    let finalAudioUri = audioUri.trim()

    if (type === 'release' && audioMode === 'file' && audioFile) {
      if (DEMO_PUBLISH) {
        // demo mode: no Arweave writer — play the file from this session's memory
        finalAudioUri = URL.createObjectURL(audioFile)
      } else {
        setPhase('uploading')
        setProgress(0)
        const up = await uploadAudioChunks(audioFile, setProgress)
        if (!up.ok) {
          setPhase('form')
          setResult({ ok: false, failure: 'write', msg: up.error ?? 'Audio upload failed.', txId: null })
          return
        }
        finalAudioUri = up.audioUri ?? ''
      }
    }

    setPhase('etching')
    const asset = buildAsset({
      type,
      title: title.trim(),
      artist: artistValue.trim(),
      desc: desc.trim(),
      price: type === 'release' ? price : 0,
      currency,
      total: type === 'release' ? total : 0,
      audioUri: type === 'release' ? finalAudioUri : '',
      coverUri: coverUri.trim(),
    })
    const res = DEMO_PUBLISH ? await publishDemo(asset) : await publishManifest(asset)
    setResult(res)
    if (res.ok) {
      setPhase('done')
      void reload()
    } else {
      setPhase('form')
    }
  }

  if (phase === 'uploading' || phase === 'etching') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-raised text-accent">
          <IconSpinner size={26} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">
          {phase === 'uploading' ? 'Uploading audio…' : DEMO_PUBLISH ? 'Adding to the registry…' : 'Etching onto Arweave…'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {phase === 'uploading'
            ? 'Streaming your track in 256KB chunks to the permanent store.'
            : DEMO_PUBLISH
              ? 'Demo mode — recording your release locally. No chain write happens yet.'
              : 'Committing the updated registry manifest. This can take a few moments — keep the tab open.'}
        </p>
        {phase === 'uploading' && (
          <div className="mx-auto mt-6 h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    )
  }

  if (phase === 'done' && result?.ok) {
    return (
      <div className="fade-up mx-auto max-w-md py-16 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-ok/10 text-ok">
          <IconCheck size={28} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">{DEMO_PUBLISH ? 'Published — demo mode.' : 'Published, permanently.'}</h1>
        <p className="mt-2 text-sm text-muted">{result.msg}</p>
        {result.txId && (
          <p className="mt-4 break-all rounded-btn bg-surface px-4 py-3 text-[12px] tabular-nums text-muted ring-1 ring-line">
            TX {result.txId}
          </p>
        )}
        <div className="mt-7 flex justify-center gap-3">
          <Button variant="primary" onClick={() => navigate(type === 'editorial' ? '/editorial' : '/library')}>
            See it in the {type === 'editorial' ? 'editorial' : 'library'}
          </Button>
          <Button
            onClick={() => {
              setPhase('form')
              setTitle('')
              setDesc('')
              setAudioFile(null)
              setAudioUri('')
              setCoverUri('')
              setResult(null)
            }}
          >
            Publish another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHead
        title="Publish"
        sub="One write, permanent record. Your release is stored on Arweave and listed in the registry."
      />

      {DEMO_PUBLISH && (
        <Banner tone="info">
          Demo mode: no Arweave wallet is funded yet, so publishes are saved in this browser and appear across the app —
          they are not written on-chain. Everything moves to real permanent storage once a wallet is configured.
        </Banner>
      )}

      {result && !result.ok && (
        <Banner tone="warn">
          {result.failure === 'validation' ? 'The registry rejected the data: ' : ''}
          {result.msg}
          {result.failure === 'timeout' ? ' Your write may still confirm — check the library before retrying.' : ''}
        </Banner>
      )}

      <div className="mb-6 flex gap-2">
        <Chip active={type === 'release'} onClick={() => setType('release')}>
          Music release
        </Chip>
        <Chip active={type === 'editorial'} onClick={() => setType('editorial')}>
          Editorial post
        </Chip>
      </div>

      <div className="space-y-5">
        <Field label="Title">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'release' ? 'Album or track title' : 'Article headline'} />
        </Field>

        <Field label={type === 'release' ? 'Artist' : 'Author'}>
          <input className={inputCls} value={artistValue} onChange={(e) => setArtist(e.target.value)} placeholder="Name shown on the registry" />
        </Field>

        <Field label={type === 'release' ? 'Description' : 'Body'} hint={type === 'editorial' ? 'Plain text; blank lines split paragraphs.' : undefined}>
          <textarea
            className={`${inputCls} h-auto min-h-[110px] py-2.5 leading-relaxed`}
            rows={type === 'editorial' ? 8 : 4}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={type === 'release' ? 'Liner notes, credits, context…' : 'Write your piece…'}
          />
        </Field>

        {type === 'release' && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Price per copy">
                <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0 = free" />
              </Field>
              <Field label="Currency">
                <select className={`${inputCls} cursor-pointer`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option>USDC</option>
                  <option>USDT</option>
                  <option>SOL</option>
                  <option>USD</option>
                </select>
              </Field>
              <Field label="Edition size">
                <input className={inputCls} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0 = unlimited" />
              </Field>
            </div>

            <div className="rounded-card border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-medium text-body">Audio</span>
                <div className="flex gap-1.5">
                  <Chip active={audioMode === 'uri'} onClick={() => setAudioMode('uri')}>
                    Arweave TX / URL
                  </Chip>
                  <Chip active={audioMode === 'file'} onClick={() => setAudioMode('file')}>
                    Upload file
                  </Chip>
                </div>
              </div>
              {audioMode === 'uri' ? (
                <Field label="" hint="Paste an existing Arweave URL (https://arweave.net/<txid>) or any direct audio URL. Optional.">
                  <input className={inputCls} value={audioUri} onChange={(e) => setAudioUri(e.target.value)} placeholder="https://arweave.net/…" />
                </Field>
              ) : (
                <Field
                  label=""
                  hint={
                    DEMO_PUBLISH
                      ? 'Demo mode: the file plays from this session only and won\u2019t survive a reload — paste a hosted audio URL for something that persists.'
                      : 'Uploaded in 256KB chunks and written to Arweave by the registry node.'
                  }
                >
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                    className="block w-full cursor-pointer text-sm text-muted file:mr-4 file:cursor-pointer file:rounded-btn file:border-0 file:bg-raised file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-body hover:file:bg-overlay"
                  />
                </Field>
              )}
            </div>

            <Field label="Cover art URL" hint="Optional — a deterministic generative cover is used when empty.">
              <input className={inputCls} value={coverUri} onChange={(e) => setCoverUri(e.target.value)} placeholder="https://arweave.net/… or https://…" />
            </Field>
          </>
        )}

        <div className="flex items-center justify-between rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-2.5 text-[13px] text-muted">
            <IconArweave size={18} className="text-accent" />
            <span>
              {DEMO_PUBLISH ? (
                <>
                  Demo publish — stored <span className="font-medium text-body">in this browser</span>, not on-chain.
                </>
              ) : (
                <>
                  Writes are <span className="font-medium text-body">permanent</span> and public.
                </>
              )}
            </span>
          </div>
          <Badge tone="accent">98% to you</Badge>
        </div>

        <Button variant="primary" size="lg" className="w-full" disabled={!valid} onClick={submit}>
          <IconPublish size={18} /> Publish to the registry
        </Button>
        {!valid && <p className="text-center text-[12px] text-faint">Title and {type === 'release' ? 'artist' : 'author'} are required{type === 'release' && audioMode === 'file' ? '; choose an audio file or switch to URL' : ''}.</p>}
        <p className="text-center text-[12px] text-faint">
          Something wrong? <Link to="/library" className="text-muted hover:text-accent">Check the library</Link> before retrying a timed-out write.
        </p>
      </div>
    </div>
  )
}
