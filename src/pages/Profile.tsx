import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ReleaseGrid } from '../components/ReleaseCard'
import { IconPublish, IconSpinner, IconWallet } from '../components/icons'
import { Badge, Button, EmptyState, PageHead } from '../components/ui'
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

  const mine = releases.filter((r) => r.artist === (user.handle ?? '') || r.artist === user.address)

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

      <div className="mb-8 rounded-card border border-line bg-surface p-4">
        <span className="text-[12px] text-faint">Wallet address</span>
        <p className="mt-1 break-all text-[13px] tabular-nums text-body">{user.address}</p>
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
    </>
  )
}
