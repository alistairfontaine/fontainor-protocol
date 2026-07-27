import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { IconArweave, IconCheck, IconPublish, IconSpinner, IconWallet } from '../components/icons'
import { Badge, Banner, Button, Chip, EmptyState, PageHead } from '../components/ui'
import { loadRawRegistryArray, type PublishResult } from '../lib/api'
import { publishReal, quotePublish, type PublishStage, type StorageQuote } from '../lib/irysPublish'
import { buildAsset, type AssetType } from '../lib/registry'
import { useAuth } from '../state/AuthContext'
import { useRegistry } from '../state/RegistryContext'

type Phase = 'form' | 'quoting' | 'confirm' | 'publishing' | 'done'

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

const STAGE_COPY: Record<PublishStage, { title: string; body: string }> = {
  quote: { title: 'Preparing…', body: 'Connecting to the permanent storage network.' },
  funding: { title: 'Approve the storage payment', body: 'Phantom is asking you to fund the exact storage cost — this is the only charge.' },
  audio: { title: 'Uploading audio…', body: 'Your track is being written to the permanent record.' },
  cover: { title: 'Uploading cover art…', body: 'Artwork is being written to the permanent record.' },
  manifest: { title: 'Etching the registry…', body: 'The updated registry manifest is being written on-chain.' },
  listing: { title: 'Listing your release…', body: 'Pointing the live registry at the new manifest.' },
}

const fmtSol = (sol: number): string => (sol >= 0.001 ? `◎${sol.toFixed(4)}` : sol > 0 ? '◎<0.001' : '◎0')

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
  const [coverMode, setCoverMode] = useState<'file' | 'uri'>('uri')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverUri, setCoverUri] = useState('')

  const [phase, setPhase] = useState<Phase>('form')
  const [stage, setStage] = useState<PublishStage>('quote')
  const [quote, setQuote] = useState<StorageQuote | null>(null)
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

  const effectiveAudioFile = type === 'release' && audioMode === 'file' ? audioFile : null
  const effectiveCoverFile = type === 'release' && coverMode === 'file' ? coverFile : null

  /** Step 1: price the storage and ask for one clear confirmation. */
  const requestQuote = async () => {
    setResult(null)
    setPhase('quoting')
    try {
      const registry = await loadRawRegistryArray()
      const q = await quotePublish(registry, effectiveAudioFile, effectiveCoverFile)
      setQuote(q)
      setPhase('confirm')
    } catch (e) {
      setResult({ ok: false, failure: 'network', msg: String((e as Error)?.message || e), txId: null })
      setPhase('form')
    }
  }

  /** Step 2: the real musician-pays publish. */
  const submit = async () => {
    setPhase('publishing')
    setStage('quote')
    const registry = await loadRawRegistryArray()
    const asset = buildAsset({
      type,
      title: title.trim(),
      artist: artistValue.trim(),
      desc: desc.trim(),
      price: type === 'release' ? price : 0,
      currency,
      total: type === 'release' ? total : 0,
      audioUri: type === 'release' && audioMode === 'uri' ? audioUri.trim() : '',
      coverUri: type === 'release' && coverMode === 'uri' ? coverUri.trim() : '',
      artistWallet: user.address,
    })
    const res = await publishReal({
      asset,
      audioFile: effectiveAudioFile,
      coverFile: effectiveCoverFile,
      currentRegistry: registry,
      onStage: setStage,
    })
    setResult(res)
    if (res.ok) {
      setPhase('done')
      void reload()
    } else {
      setPhase('form')
    }
  }

  if (phase === 'quoting' || phase === 'publishing') {
    const copy = phase === 'quoting' ? { title: 'Pricing storage…', body: 'Fetching the exact one-time cost for your files.' } : STAGE_COPY[stage]
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-raised text-accent">
          <IconSpinner size={26} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted">{copy.body}</p>
        {phase === 'publishing' && <p className="mt-6 text-[12px] text-faint">Keep this tab open until the etching completes.</p>}
      </div>
    )
  }

  if (phase === 'confirm' && quote) {
    return (
      <div className="fade-up mx-auto max-w-md py-16">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-raised text-accent">
          <IconArweave size={26} />
        </div>
        <h1 className="mt-5 text-center text-2xl font-semibold">One-time storage cost</h1>
        <p className="mt-2 text-center text-sm text-muted">
          Fontainor fronts nothing and takes nothing here — your wallet pays the permanent storage network directly.
        </p>
        <div className="mt-6 rounded-card border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">Permanent storage ({(quote.totalBytes / (1024 * 1024)).toFixed(2)} MB)</span>
            <span className="text-xl font-semibold tabular-nums text-ink">{fmtSol(quote.sol)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between text-[12px] text-faint">
            <span>Paid once from your Phantom wallet · stored forever</span>
            {quote.usd != null && <span>≈ ${quote.usd < 0.01 && quote.usd > 0 ? '<0.01' : quote.usd.toFixed(2)}</span>}
          </div>
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="primary" size="lg" onClick={submit}>
            <IconPublish size={18} /> Pay &amp; publish
          </Button>
          <Button size="lg" onClick={() => setPhase('form')}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'done' && result?.ok) {
    return (
      <div className="fade-up mx-auto max-w-md py-16 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-card bg-ok/10 text-ok">
          <IconCheck size={28} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">Published, permanently.</h1>
        <p className="mt-2 text-sm text-muted">{result.msg}</p>
        {result.txId && (
          <p className="mt-4 break-all rounded-btn bg-surface px-4 py-3 text-[12px] tabular-nums text-muted ring-1 ring-line">
            Manifest {result.txId}
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
              setCoverFile(null)
              setCoverUri('')
              setQuote(null)
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

        <Field
          label={type === 'release' ? 'Artist' : 'Author'}
          hint={
            user?.claimed && user.handle && artistValue.trim().toLowerCase() === user.handle.toLowerCase()
              ? `${user.handle} is bound to your wallet — nobody else can publish under it.`
              : undefined
          }
        >
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
                <Field label="" hint="Written straight to Arweave — you pay the exact storage cost from your wallet, shown before anything is charged.">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                    className="block w-full cursor-pointer text-sm text-muted file:mr-4 file:cursor-pointer file:rounded-btn file:border-0 file:bg-raised file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-body hover:file:bg-overlay"
                  />
                </Field>
              )}
            </div>

            <div className="rounded-card border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-medium text-body">Cover art</span>
                <div className="flex gap-1.5">
                  <Chip active={coverMode === 'uri'} onClick={() => setCoverMode('uri')}>
                    URL
                  </Chip>
                  <Chip active={coverMode === 'file'} onClick={() => setCoverMode('file')}>
                    Upload file
                  </Chip>
                </div>
              </div>
              {coverMode === 'uri' ? (
                <Field label="" hint="Optional — a deterministic generative cover is used when empty.">
                  <input className={inputCls} value={coverUri} onChange={(e) => setCoverUri(e.target.value)} placeholder="https://arweave.net/… or https://…" />
                </Field>
              ) : (
                <Field label="" hint="Optional — small images usually cost a fraction of a cent.">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
                    className="block w-full cursor-pointer text-sm text-muted file:mr-4 file:cursor-pointer file:rounded-btn file:border-0 file:bg-raised file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-body hover:file:bg-overlay"
                  />
                </Field>
              )}
            </div>
          </>
        )}

        <div className="flex items-center justify-between rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-2.5 text-[13px] text-muted">
            <IconArweave size={18} className="text-accent" />
            <span>
              Writes are <span className="font-medium text-body">permanent</span> and public. You pay storage directly — no middleman.
            </span>
          </div>
          <Badge tone="accent">98% to you</Badge>
        </div>

        <Button variant="primary" size="lg" className="w-full" disabled={!valid} onClick={requestQuote}>
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
