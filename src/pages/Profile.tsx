import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ReleaseGrid } from '../components/ReleaseCard'
import { IconExternal, IconHeart, IconHistory, IconPublish, IconSpinner, IconWallet } from '../components/icons'
import { Badge, Button, EmptyState, PageHead } from '../components/ui'
import { loadPurchases, solscanTx, type PurchaseReceipt } from '../lib/purchase'
import type { Release } from '../lib/registry'
import { shortAddress, useAuth } from '../state/AuthContext'
import { useRegistry } from '../state/RegistryContext'

export default function Profile() {
  const { user, connect, connecting, logout } = useAuth()
  const { releases } = useRegistry()
  const [err, setErr] = useState<string | null>(null)

  if (!user) {
    return (
      <EmptyState
        icon={<IconWallet size={26} />}
        title="Your wallet is your identity"
        body="No email, no password, no account database. Connect Phantom to publish, collect, and manage your catalog."
        action={
          <div className="flex flex-col items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={connecting}
              onClick={async () => {
                setErr(null)
                const r = await connect()
                if (!r.success) setErr(r.error ?? 'Could not connect.')
              }}
            >
              {connecting ? <IconSpinner size={18} /> : <IconWallet size={18} />} Connect Phantom
            </Button>
            {err && <p className="max-w-sm text-[13px] text-warn">{err}</p>}
            <p className="text-[12px] text-faint">
              No wallet yet? Get Phantom at{' '}
              <a href="https://phantom.com" target="_blank" rel="noreferrer" className="text-muted underline hover:text-accent">
                phantom.com
              </a>
            </p>
          </div>
        }
      />
    )
  }

  const mine = releases.filter(
    (r) => r.artistWallet === user.address || r.artist === (user.handle ?? '') || r.artist === user.address,
  )
  const purchases = loadPurchases()
  const collected = purchases
    .map((p) => ({ receipt: p, rel: releases.find((r) => r.id === p.trackId) }))
    .filter((x): x is { receipt: PurchaseReceipt; rel: Release } => !!x.rel)

  return (
    <>
      <PageHead
        title={user.handle ?? shortAddress(user.address)}
        sub="Sovereign session — authenticated by wallet signature."
        right={
          <div className="flex items-center gap-3">
            <Badge tone="ok">Connected</Badge>
            <Button size="sm" onClick={logout}>
              Log out
            </Button>
          </div>
        }
      />

      <div className="mb-6 rounded-card border border-line bg-surface p-4">
        <span className="text-[12px] text-faint">Wallet address</span>
        <p className="mt-1 break-all text-[13px] tabular-nums text-body">{user.address}</p>
      </div>

      {/* quick links — the sidebar is desktop-only, so surface these here for mobile */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:hidden">
        <Link
          to="/favorites"
          className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-4 py-3.5 text-sm font-medium text-body transition-colors hover:bg-raised hover:text-ink"
        >
          <IconHeart size={18} className="text-accent" /> Favorites
        </Link>
        <Link
          to="/history"
          className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-4 py-3.5 text-sm font-medium text-body transition-colors hover:bg-raised hover:text-ink"
        >
          <IconHistory size={18} className="text-accent" /> History
        </Link>
      </div>

      <h2 className="mb-4 text-xl font-semibold">Your publications</h2>
      {mine.length === 0 ? (
        <EmptyState
          icon={<IconPublish size={26} />}
          title="Nothing published yet"
          body="Your releases and articles will show up here once they're in the registry."
          action={
            <Link to="/publish">
              <Button variant="primary">
                <IconPublish size={17} /> Publish your first release
              </Button>
            </Link>
          }
        />
      ) : (
        <ReleaseGrid items={mine} />
      )}

      {purchases.length > 0 && (
        <section className="mt-12" aria-label="Your collection">
          <h2 className="mb-4 text-xl font-semibold">Your collection</h2>
          {collected.length > 0 && <ReleaseGrid items={collected.map((c) => c.rel)} />}
          <div className="mt-5 space-y-2">
            {purchases.map((p) => (
              <a
                key={p.signature}
                href={solscanTx(p.signature)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-[13px] transition-colors hover:bg-raised"
              >
                <span className="min-w-0 truncate text-body">
                  {p.title} <span className="text-faint">· {p.artist}</span>
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
        </section>
      )}
    </>
  )
}
