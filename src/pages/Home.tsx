import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ReleaseCard, ReleaseGrid } from '../components/ReleaseCard'
import { IconArweave, IconEditorial, IconLibrary, IconPublish } from '../components/icons'
import { Banner, Button, EmptyState, GridSkeleton } from '../components/ui'
import { fetchTopPlays, type TopPlay } from '../lib/plays'
import { recommendFor } from '../lib/recommend'
import { fmtDate, type Release } from '../lib/registry'
import { useFavorites, useHistoryLog } from '../state/collections'
import { useRegistry } from '../state/RegistryContext'

/** Trending rail (F32) — weekly play counts from the registry API. Hidden
 *  until at least 3 releases have real plays, so an empty platform never
 *  shows an empty chart. */
function Trending() {
  const { releases } = useRegistry()
  const [top, setTop] = useState<TopPlay[]>([])
  useEffect(() => {
    let alive = true
    void fetchTopPlays('week', 12).then((t) => {
      if (alive) setTop(t)
    })
    return () => {
      alive = false
    }
  }, [])
  const rows = useMemo(() => {
    const byId = new Map(releases.map((r) => [r.id, r]))
    return top
      .map((t) => ({ rel: byId.get(t.id), plays: t.plays }))
      .filter((x): x is { rel: Release; plays: number } => Boolean(x.rel && x.rel.type === 'release'))
      .slice(0, 5)
  }, [top, releases])
  if (rows.length < 3) return null
  return (
    <section className="mt-12" aria-label="Trending this week">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Trending this week</h2>
        <span className="text-[13px] text-faint">Most played across the registry</span>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {rows.map((x) => (
          <ReleaseCard key={x.rel.id} rel={x.rel} note={`${x.plays} play${x.plays === 1 ? '' : 's'} this week`} />
        ))}
      </div>
    </section>
  )
}

/** Personalized rail (F15) — appears once there is any listening/favorites signal. */
function MadeForYou() {
  const { releases } = useRegistry()
  const { ids: favIds } = useFavorites()
  const { ids: histIds } = useHistoryLog()
  const recs = useMemo(() => recommendFor(releases, favIds, histIds, 5), [releases, favIds, histIds])
  if (recs.length === 0) return null
  return (
    <section className="mt-12" aria-label="Made for you">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Made for you</h2>
        <span className="text-[13px] text-faint">From your plays &amp; favorites — kept on this device</span>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {recs.map((r) => (
          <ReleaseCard key={r.rel.id} rel={r.rel} note={r.reason} />
        ))}
      </div>
    </section>
  )
}

function SourceBanner() {
  const { source, repaired } = useRegistry()
  if (source === 'api') return null
  {/* 'file' source is the expected demo mode — no banner, it should feel like the product */}
  if (source === 'sample') return <Banner tone="warn">Could not reach the registry — showing sample data.</Banner>
  if (repaired) return <Banner tone="info">Registry contained a formatting glitch that was auto-repaired.</Banner>
  return null
}

function EditorialStrip({ articles }: { articles: Release[] }) {
  if (articles.length === 0) return null
  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Latest writing</h2>
        <Link to="/editorial" className="text-[13px] text-muted hover:text-accent">
          All editorial →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {articles.slice(0, 3).map((a) => (
          <Link
            key={a.id}
            to={`/editorial/${encodeURIComponent(a.id)}`}
            className="group overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-line-strong"
          >
            {a.coverUrl && (
              <div className="aspect-[3/2] overflow-hidden">
                <img
                  src={a.coverUrl}
                  alt=""
                  loading="lazy" decoding="async"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              </div>
            )}
            <div className="p-5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{fmtDate(a.date) ?? 'Editorial'}</span>
              <h3 className="mt-1.5 line-clamp-2 text-[16px] font-semibold leading-snug text-ink group-hover:text-accent">{a.title}</h3>
              <p className="mt-1.5 line-clamp-2 text-[13px] text-muted">{a.desc || 'Read the full piece.'}</p>
              <span className="mt-3 block text-[13px] text-muted">{a.artist}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function Home() {
  const { music, editorial, loading } = useRegistry()

  return (
    <>
      <SourceBanner />

      {/* hero: expose the content, don't advertise it (FRICT-01) — hero only when empty */}
      {!loading && music.length === 0 ? (
        <section className="rounded-section border border-line bg-surface px-6 py-16 text-center sm:py-20">
          <p className="mx-auto flex w-fit items-center gap-2 rounded-chip bg-raised px-3 py-1 text-[12px] font-medium tracking-wide text-muted">
            <IconArweave size={15} /> PERMANENT · ON ARWEAVE · PAID ON SOLANA
          </p>
          <h1 className="mx-auto mt-6 max-w-2xl text-4xl font-bold leading-[1.1] sm:text-5xl">
            Music that can’t be taken down.
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-[15px] text-muted">
            Fontainor is an artist-owned registry. Publish once, own it forever, keep 98% of every sale.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/publish">
              <Button variant="primary" size="lg">
                <IconPublish size={18} /> Publish your first release
              </Button>
            </Link>
            <Link to="/library">
              <Button size="lg">
                <IconLibrary size={18} /> Browse the registry
              </Button>
            </Link>
          </div>
        </section>
      ) : (
        <section>
          <div className="mb-5 flex items-baseline justify-between">
            <h1 className="text-[28px] font-semibold sm:text-[32px]">New on the registry</h1>
            <Link to="/library" className="hidden text-[13px] text-muted hover:text-accent sm:block">
              Full library →
            </Link>
          </div>
          {loading ? <GridSkeleton count={10} /> : <ReleaseGrid items={music.slice(0, 15)} />}
        </section>
      )}

      {!loading && (
        <>
          <Trending />
          <MadeForYou />
        </>
      )}

      {loading ? null : editorial.length > 0 ? (
        <EditorialStrip articles={editorial} />
      ) : music.length > 0 ? (
        <section className="mt-12">
          <EmptyState
            icon={<IconEditorial size={26} />}
            title="No writing yet"
            body="Editorial pieces published to the registry will appear here."
          />
        </section>
      ) : null}
    </>
  )
}
