import { Link, useNavigate, useParams } from 'react-router-dom'
import { IconBack, IconEditorial } from '../components/icons'
import { Button, EmptyState, PageHead } from '../components/ui'
import { fmtDate } from '../lib/registry'
import { useRegistry } from '../state/RegistryContext'

export function EditorialList() {
  const { editorial, loading } = useRegistry()

  return (
    <>
      <PageHead title="Editorial" sub="Writing from artists and the Fontainor community — published permanently, like the music." />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton h-28 rounded-card" />
          ))}
        </div>
      ) : editorial.length === 0 ? (
        <EmptyState
          icon={<IconEditorial size={26} />}
          title="No articles yet"
          body="Editorial pieces are journal posts etched into the registry. Publish one from the Publish page."
          action={
            <Link to="/publish?type=editorial">
              <Button variant="primary">Write a post</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {editorial.map((a) => (
            <Link
              key={a.id}
              to={`/editorial/${encodeURIComponent(a.id)}`}
              className="group flex overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-line-strong"
            >
              {a.coverUrl && (
                <div className="hidden w-44 shrink-0 overflow-hidden sm:block md:w-56">
                  <img
                    src={a.coverUrl}
                    alt=""
                    loading="lazy" decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </div>
              )}
              <div className="min-w-0 p-5 sm:p-6">
                <div className="flex items-baseline gap-3 text-[12px] text-faint">
                  <span>{fmtDate(a.date) ?? '—'}</span>
                  <span className="font-medium text-muted">{a.artist}</span>
                </div>
                <h2 className="mt-1.5 text-xl font-semibold text-ink group-hover:text-accent">{a.title}</h2>
                {a.desc && <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted">{a.desc}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

export function EditorialArticle() {
  const { id } = useParams()
  const { releases, loading } = useRegistry()
  const navigate = useNavigate()
  const article = releases.find((r) => r.id === id)

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="skeleton h-9 w-3/4 rounded" />
        <div className="skeleton mt-4 h-4 w-1/3 rounded" />
        <div className="skeleton mt-10 h-64 rounded" />
      </div>
    )
  }

  if (!article) {
    return (
      <EmptyState
        title="Article not found"
        body="It may not be in the registry yet, or the link is stale."
        action={
          <Link to="/editorial">
            <Button>All editorial</Button>
          </Link>
        }
      />
    )
  }

  return (
    <article className="fade-up mx-auto max-w-2xl">
      <button
        onClick={() => navigate(-1)}
        className="mb-8 flex cursor-pointer items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <IconBack size={16} /> Back
      </button>

      <div className="text-[13px] text-faint">
        {fmtDate(article.date) ?? ''} · <span className="font-medium text-muted">{article.artist}</span>
      </div>
      <h1 className="mt-2 text-3xl font-bold leading-[1.15] sm:text-4xl">{article.title}</h1>

      {article.coverUrl && (
        <div className="mt-8 overflow-hidden rounded-card shadow-card">
          <img src={article.coverUrl} alt="" decoding="async" fetchPriority="high" className="aspect-[3/2] w-full object-cover" />
        </div>
      )}

      {/* reading typography: 17px / 170% (TYPE-01) */}
      <div className="mt-8 space-y-5 text-[17px] leading-[1.7] text-body">
        {(article.desc || 'This piece has no body text in the registry.')
          .split(/\n{2,}|\n/)
          .filter(Boolean)
          .map((para, i) => (
            <p key={i}>{para}</p>
          ))}
      </div>

      {article.tags.length > 0 && (
        <div className="mt-10 flex flex-wrap gap-2 border-t border-line pt-6">
          {article.tags.map((t) => (
            <Link key={t} to={`/library?q=${encodeURIComponent(t)}`} className="text-[13px] text-muted hover:text-accent">
              #{t}
            </Link>
          ))}
        </div>
      )}
    </article>
  )
}
