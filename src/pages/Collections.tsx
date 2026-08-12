import { Link } from 'react-router-dom'
import { ReleaseGrid } from '../components/ReleaseCard'
import { IconDisc, IconExternal, IconHeart, IconHistory } from '../components/icons'
import { Button, EmptyState, GridSkeleton, PageHead } from '../components/ui'
import { purchasesForWallet, solscanTx, usePurchases, type PurchaseReceipt } from '../lib/purchase'
import type { Release } from '../lib/registry'
import { useAuth } from '../state/AuthContext'
import { useFavorites, useHistoryLog } from '../state/collections'
import { useRegistry } from '../state/RegistryContext'

export function Favorites() {
  const { releases, loading } = useRegistry()
  const { ids } = useFavorites()
  // The store keeps ids in like order (oldest first); render newest first so
  // the heart you just tapped is visible at the top, matching History.
  const items = [...ids]
    .reverse()
    .map((id) => releases.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))

  return (
    <>
      <PageHead title="Favorites" sub="Saved on this device — tap the heart on any release." />
      {loading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconHeart size={26} />}
          title="Nothing saved yet"
          body="Hearts you tap live here, and they survive a refresh."
          action={
            <Link to="/library">
              <Button variant="primary">Find something to save</Button>
            </Link>
          }
        />
      ) : (
        <ReleaseGrid items={items} />
      )}
    </>
  )
}

export function History() {
  const { releases, loading } = useRegistry()
  const { ids, clear } = useHistoryLog()
  const items = ids.map((id) => releases.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r))

  return (
    <>
      <PageHead
        title="History"
        sub="What you've listened to, most recent first."
        right={
          items.length > 0 ? (
            <Button size="sm" onClick={clear}>
              Clear history
            </Button>
          ) : undefined
        }
      />
      {loading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconHistory size={26} />}
          title="No listens yet"
          body="Play anything and it shows up here."
          action={
            <Link to="/">
              <Button variant="primary">Browse new releases</Button>
            </Link>
          }
        />
      ) : (
        <ReleaseGrid items={items} />
      )}
    </>
  )
}

export function Collection() {
  const { releases, loading } = useRegistry()
  const { user } = useAuth()
  // Subscribe to receipt changes, then expose only this wallet's collection.
  // Local storage is browser-wide; receipts from a previous account must not
  // appear after logout/account switch.
  usePurchases()
  const purchases = purchasesForWallet(user?.address)
  // Receipts recovered from the durable server record carry no title/artist —
  // resolve them from the registry by trackId (same rule as the Profile page).
  const rows = purchases.map((p) => {
    const rel = releases.find((r) => r.id === p.trackId)
    return { receipt: p, rel, title: p.title || rel?.title || p.trackId, artist: p.artist || rel?.artist || 'unknown artist' }
  })
  const collected = rows.filter((x): x is { receipt: PurchaseReceipt; rel: Release; title: string; artist: string } => !!x.rel)

  return (
    <>
      <PageHead
        title="Collection"
        sub="Supporter editions you own — every purchase has an on-chain receipt, 98% went to the artist."
      />
      {loading ? (
        <GridSkeleton />
      ) : purchases.length === 0 ? (
        <EmptyState
          icon={<IconDisc size={26} />}
          title={user ? 'Nothing collected yet' : 'Your collection lives here'}
          body={
            user
              ? 'Collect a supporter edition on any release page and it shows up here with its on-chain receipt.'
              : 'Connect your wallet, collect a supporter edition on any release page, and it shows up here with its on-chain receipt.'
          }
          action={
            <Link to="/library">
              <Button variant="primary">Browse the library</Button>
            </Link>
          }
        />
      ) : (
        <>
          {collected.length > 0 && <ReleaseGrid items={collected.map((c) => c.rel)} />}
          <div className="mt-5 space-y-2">
            {rows.map(({ receipt: p, title, artist }) => (
              <a
                key={p.signature}
                href={solscanTx(p.signature)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-[13px] transition-colors hover:bg-raised"
              >
                <span className="min-w-0 truncate text-body">
                  {title} <span className="text-faint">· {artist}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted">
                  ◎{(p.lamports / 1e9).toFixed(4)} <IconExternal size={13} />
                </span>
              </a>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-faint">
            Each row links to the on-chain receipt — 98% of every purchase went straight to the artist.
          </p>
        </>
      )}
    </>
  )
}
