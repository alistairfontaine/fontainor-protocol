import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Cover } from '../components/Cover'
import { ReleaseCard } from '../components/ReleaseCard'
import { IconArweave, IconBack, IconCheck, IconExternal, IconHeart, IconPause, IconPlay, IconSpinner, IconTag } from '../components/icons'
import { Badge, Button, EmptyState, PageHead } from '../components/ui'
import { hasPurchased, isPurchasable, purchase, quotePurchase, solscanTx, type PurchaseQuote } from '../lib/purchase'
import { similarTo } from '../lib/recommend'
import { edLabel, fmtDate, isSold, priceLabel, prettyStatus, type Release } from '../lib/registry'
import { useAuth } from '../state/AuthContext'
import { useFavorites } from '../state/collections'
import { ensureSeenBaseline, useFollows } from '../state/follows'
import { usePlayer } from '../state/PlayerContext'
import { useRegistry } from '../state/RegistryContext'

export default function ReleaseDetail() {
  const { id } = useParams()
  const { releases, loading } = useRegistry()
  const { play, toggle, current, playing } = usePlayer()
  const { ids, toggle: toggleFav } = useFavorites()
  const { toggle: toggleFollow, isFollowing } = useFollows()
  const navigate = useNavigate()

  const rel = releases.find((r) => r.id === id)

  if (loading) {
    return (
      <div className="grid gap-10 md:grid-cols-[minmax(0,380px)_1fr]">
        <div className="skeleton aspect-square rounded-card" />
        <div>
          <div className="skeleton h-8 w-2/3 rounded" />
          <div className="skeleton mt-3 h-4 w-1/3 rounded" />
          <div className="skeleton mt-8 h-24 w-full rounded" />
        </div>
      </div>
    )
  }

  if (!rel) {
    return (
      <EmptyState
        title="Release not found"
        body="It may not be in the registry yet, or the link is stale."
        action={
          <Link to="/library">
            <Button>Browse the library</Button>
          </Link>
        }
      />
    )
  }

  const fav = ids.includes(rel.id)
  const isCurrent = current?.id === rel.id
  const sold = isSold(rel.editions)

  return (
    <div className="fade-up">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 flex cursor-pointer items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <IconBack size={16} /> Back
      </button>

      <div className="grid gap-10 md:grid-cols-[minmax(0,380px)_1fr]">
        <div className="relative aspect-square max-w-[380px] overflow-hidden rounded-card shadow-pop">
          <Cover rel={rel} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {rel.status && <Badge tone="ok">{prettyStatus(rel.status)}</Badge>}
            {sold && <Badge tone="warn">Sold out</Badge>}
            {fmtDate(rel.date) && <span className="text-[12px] text-faint">{fmtDate(rel.date)}</span>}
          </div>

          <PageHead title={rel.title} />
          <p className="-mt-5 flex flex-wrap items-center gap-x-2 text-[15px] text-muted">
            <span>
              by{' '}
              <Link to={`/library?q=${encodeURIComponent(rel.artist)}`} className="font-medium text-body hover:text-accent">
                {rel.artist}
              </Link>
              {rel.label && <span className="text-faint"> · {rel.label}</span>}
            </span>
            <button
              onClick={() => {
                ensureSeenBaseline()
                toggleFollow(rel.artist)
              }}
              aria-pressed={isFollowing(rel.artist)}
              className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors ${
                isFollowing(rel.artist)
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-line text-muted hover:border-accent/40 hover:text-accent'
              }`}
            >
              {isFollowing(rel.artist) ? 'Following' : 'Follow'}
            </button>
          </p>

          {/* value row: price is the headline (HIER-02) */}
          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="text-2xl font-semibold tabular-nums text-ink">{priceLabel(rel.price)}</div>
              <div className="text-[12px] text-faint">per copy · artist keeps 98%</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums text-ink">{edLabel(rel.editions)}</div>
              <div className="text-[12px] text-faint">edition</div>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={() => (isCurrent ? toggle() : play(rel))}
              aria-label={isCurrent && playing ? 'Pause' : 'Play'}
            >
              {isCurrent && playing ? <IconPause size={18} /> : <IconPlay size={18} />}
              {isCurrent && playing ? 'Pause' : 'Play'}
            </Button>
            <Button size="lg" onClick={() => toggleFav(rel.id)} aria-pressed={fav}>
              <IconHeart size={18} filled={fav} className={fav ? 'text-accent' : undefined} />
              {fav ? 'Saved' : 'Save'}
            </Button>
            <ShareButton id={rel.id} />
            <CollectCta rel={rel} sold={sold} />
          </div>

          {rel.desc && <p className="mt-8 max-w-xl text-[15px] leading-relaxed text-body">{rel.desc}</p>}

          {rel.tags.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <IconTag size={15} className="text-faint" />
              {rel.tags.map((t) => (
                <Link key={t} to={`/library?q=${encodeURIComponent(t)}`} className="text-[13px] text-muted hover:text-accent">
                  #{t}
                </Link>
              ))}
            </div>
          )}

          {/* provenance */}
          <div className="mt-9 rounded-card border border-line bg-surface p-4">
            <div className="flex items-center gap-2 text-[13px] font-medium text-body">
              <IconArweave size={16} className="text-accent" /> Permanent record
            </div>
            <dl className="mt-2.5 space-y-1.5 text-[13px]">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-faint">Registry ID</dt>
                <dd className="truncate tabular-nums text-muted">{rel.id}</dd>
              </div>
              {rel.arweaveTx && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-faint">Arweave TX</dt>
                  <dd className="min-w-0 truncate">
                    <a
                      href={`https://arweave.net/${rel.arweaveTx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 truncate text-muted hover:text-accent"
                    >
                      <span className="truncate">{rel.arweaveTx}</span>
                      <IconExternal size={13} className="shrink-0" />
                    </a>
                  </dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-faint">Storage</dt>
                <dd className="text-muted">Arweave — permanent, uncensorable</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <MoreLikeThis rel={rel} all={releases} />
    </div>
  )
}

/** F28: real edition purchase — 98% to the artist, 2% treasury, paid in SOL via Phantom. */
function CollectCta({ rel, sold }: { rel: Release; sold: boolean }) {
  const { user, connect, connecting } = useAuth()
  type St =
    | { phase: 'idle' }
    | { phase: 'quoting' }
    | { phase: 'confirm'; quote: PurchaseQuote }
    | { phase: 'paying' }
    | { phase: 'done'; signature: string }
    | { phase: 'error'; message: string }
  const [st, setSt] = useState<St>({ phase: 'idle' })
  const owned = useMemo(() => hasPurchased(rel.id), [rel.id, st.phase])

  if (rel.type !== 'release' || rel.price.amount <= 0) return null

  if (!isPurchasable(rel)) {
    return (
      <Button size="lg" disabled title="This release predates on-chain sales — it has no payout wallet on record.">
        Collect — unavailable
      </Button>
    )
  }

  const start = async () => {
    if (!user) {
      if (connecting) return
      const r = await connect()
      if (!r.success) {
        setSt({ phase: 'error', message: r.error ?? 'Connect Phantom to collect.' })
        return
      }
    }
    setSt({ phase: 'quoting' })
    try {
      const quote = await quotePurchase(rel)
      setSt({ phase: 'confirm', quote })
    } catch (e) {
      setSt({ phase: 'error', message: String((e as Error)?.message || e) })
    }
  }

  const pay = async (quote: PurchaseQuote) => {
    setSt({ phase: 'paying' })
    const res = await purchase(rel, quote)
    if (res.ok && res.receipt) setSt({ phase: 'done', signature: res.receipt.signature })
    else setSt({ phase: 'error', message: res.msg })
  }

  const doneSig = st.phase === 'done' ? st.signature : owned?.signature

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {st.phase === 'confirm' ? (
          <>
            <Button variant="primary" size="lg" onClick={() => pay(st.quote)}>
              Pay ◎{st.quote.sol.toFixed(4)}
              {st.quote.usdShown != null && <span className="font-normal opacity-80"> (≈${st.quote.usdShown.toFixed(2)})</span>}
            </Button>
            <Button size="lg" onClick={() => setSt({ phase: 'idle' })}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="lg"
            variant={doneSig ? 'secondary' : 'primary'}
            disabled={sold || st.phase === 'quoting' || st.phase === 'paying'}
            title={sold ? 'This edition is sold out' : undefined}
            onClick={start}
          >
            {st.phase === 'quoting' || st.phase === 'paying' ? <IconSpinner size={18} /> : doneSig ? <IconCheck size={18} /> : null}
            {st.phase === 'paying' ? 'Confirm in Phantom…' : st.phase === 'quoting' ? 'Pricing…' : doneSig ? 'Collect another' : `Collect ${priceLabel(rel.price)}`}
          </Button>
        )}
      </div>
      {st.phase === 'confirm' && (
        <p className="text-[12px] text-faint">One Phantom approval — 98% goes to {rel.artist}, 2% keeps Fontainor running.</p>
      )}
      {st.phase === 'error' && <p className="max-w-md text-[13px] text-warn">{st.message}</p>}
      {doneSig && st.phase !== 'confirm' && st.phase !== 'error' && (
        <a href={solscanTx(doneSig)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-accent">
          In your collection — on-chain receipt <IconExternal size={13} />
        </a>
      )}
    </div>
  )
}

/** F34: copy a crawler-friendly share link (/share/:id serves real OG meta). */
function ShareButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/share/${encodeURIComponent(id)}`
  return (
    <Button
      size="lg"
      aria-label="Copy share link"
      onClick={() => {
        void navigator.clipboard
          .writeText(url)
          .catch(() => {
            /* clipboard blocked — fall through to prompt */
            window.prompt('Copy this link:', url)
          })
          .finally(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          })
      }}
    >
      {copied ? <IconCheck size={18} className="text-accent" /> : <IconExternal size={18} />}
      {copied ? 'Link copied' : 'Share'}
    </Button>
  )
}

/** F15: similar releases by shared tags / same artist. */
function MoreLikeThis({ rel, all }: { rel: Release; all: Release[] }) {
  const recs = useMemo(() => similarTo(rel, all, 5), [rel, all])
  if (recs.length === 0) return null
  return (
    <section className="mt-16" aria-label="More like this">
      <h2 className="mb-4 text-xl font-semibold">More like this</h2>
      <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {recs.map((r) => (
          <ReleaseCard key={r.rel.id} rel={r.rel} note={r.reason} />
        ))}
      </div>
    </section>
  )
}
