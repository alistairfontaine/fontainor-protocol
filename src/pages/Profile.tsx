import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ReleaseGrid } from '../components/ReleaseCard'
import { IconDisc, IconExternal, IconHeart, IconHistory, IconPublish, IconSpinner, IconWallet } from '../components/icons'
import { Badge, Button, EmptyState, PageHead } from '../components/ui'
import { purchasesForWallet, solscanTx, usePurchases, type PurchaseReceipt } from '../lib/purchase'
import type { Release } from '../lib/registry'
import { shortAddress, useAuth } from '../state/AuthContext'
import { useRegistry } from '../state/RegistryContext'

export default function Profile() {
  const { user, connect, connecting, logout, updateHandle } = useAuth()
  const { releases } = useRegistry()
  usePurchases()
  const purchases = purchasesForWallet(user?.address)
  const [err, setErr] = useState<string | null>(null)
  const [editingHandle, setEditingHandle] = useState(false)
  const [handleDraft, setHandleDraft] = useState('')
  const [handleErr, setHandleErr] = useState<string | null>(null)
  const [handleSaving, setHandleSaving] = useState(false)

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

  // Handle match only when a handle exists — `r.artist === ''` must never
  // claim registry entries with a blank artist field for this profile.
  const mine = releases.filter(
    (r) => r.artistWallet === user.address || (!!user.handle && r.artist === user.handle) || r.artist === user.address,
  )
  // Receipts recovered from the durable server record carry no title/artist —
  // resolve them from the registry by trackId.
  const rows = purchases.map((p) => {
    const rel = releases.find((r) => r.id === p.trackId)
    return { receipt: p, rel, title: p.title || rel?.title || p.trackId, artist: p.artist || rel?.artist || 'unknown artist' }
  })
  const collected = rows.filter((x): x is { receipt: PurchaseReceipt; rel: Release; title: string; artist: string } => !!x.rel)

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

      {/* Wallet-bound username: claimed handles are unique and enforced at
          publish time, so nobody can publish under this name from another wallet. */}
      <div className="mb-6 rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[12px] text-faint">Username</span>
            <p className="mt-1 text-[14px] text-body">
              {user.claimed ? (
                <>
                  {user.handle} <Badge tone="ok">Claimed</Badge>
                </>
              ) : (
                <span className="text-faint">Not claimed — publishes show your wallet address instead of a name.</span>
              )}
            </p>
          </div>
          {!editingHandle && (
            <Button
              size="sm"
              onClick={() => {
                setHandleDraft(user.claimed && user.handle ? user.handle.replace(/^@/, '') : '')
                setHandleErr(null)
                setEditingHandle(true)
              }}
            >
              {user.claimed ? 'Change handle' : 'Claim your @handle'}
            </Button>
          )}
        </div>
        {editingHandle && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              setHandleErr(null)
              setHandleSaving(true)
              const r = await updateHandle(handleDraft)
              setHandleSaving(false)
              if (r.success) setEditingHandle(false)
              else setHandleErr(r.error ?? 'Could not claim that handle.')
            }}
          >
            <div className="flex items-center rounded-md border border-line bg-bg px-2">
              <span className="text-[13px] text-faint">@</span>
              <input
                className="w-40 bg-transparent px-1 py-1.5 text-[13px] text-body outline-none"
                value={handleDraft}
                onChange={(e) => setHandleDraft(e.target.value)}
                placeholder="yourname"
                maxLength={20}
                autoFocus
              />
            </div>
            <Button size="sm" variant="primary" disabled={handleSaving} type="submit">
              {handleSaving ? <IconSpinner size={14} /> : 'Sign & claim'}
            </Button>
            <Button size="sm" type="button" onClick={() => setEditingHandle(false)}>
              Cancel
            </Button>
            <p className="w-full text-[12px] text-faint">
              3–20 characters (a–z, 0–9, _). You sign a message with Phantom — the name is then bound to this wallet and
              nobody else can publish under it.
            </p>
            {handleErr && <p className="w-full text-[12px] text-warn">{handleErr}</p>}
          </form>
        )}
      </div>

      {/* quick links — the sidebar is desktop-only, so surface these here for mobile */}
      <div className="mb-8 grid grid-cols-3 gap-3 lg:hidden">
        <Link
          to="/favorites"
          className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-4 py-3.5 text-sm font-medium text-body transition-colors hover:bg-raised hover:text-ink"
        >
          <IconHeart size={18} className="text-accent" /> Favorites
        </Link>
        <Link
          to="/collection"
          className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-4 py-3.5 text-sm font-medium text-body transition-colors hover:bg-raised hover:text-ink"
        >
          <IconDisc size={18} className="text-accent" /> Collection
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

      <section className="mt-12" aria-label="Your collection">
        <h2 className="mb-4 text-xl font-semibold">Your collection</h2>
        {purchases.length === 0 ? (
          <EmptyState
            icon={<IconDisc size={26} />}
            title="Nothing collected yet"
            body="Collect a supporter edition on any release page — it lands here with its on-chain receipt."
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
      </section>
    </>
  )
}
