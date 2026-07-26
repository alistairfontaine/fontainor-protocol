import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { shortAddress, useAuth } from '../state/AuthContext'
import { IconSpinner, IconWallet } from './icons'

export function WalletButton() {
  const { user, connect, connecting } = useAuth()
  const navigate = useNavigate()
  const [err, setErr] = useState<string | null>(null)

  if (user) {
    return (
      <button
        onClick={() => navigate('/profile')}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-btn border border-line bg-surface px-3.5 text-[13px] font-medium text-body transition-colors hover:border-line-strong hover:text-ink"
      >
        <span className="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
        {user.handle ?? shortAddress(user.address)}
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={async () => {
          setErr(null)
          const r = await connect()
          if (r.success) navigate('/profile')
          else setErr(r.error ?? 'Could not connect.')
        }}
        disabled={connecting}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-btn bg-accent px-4 text-[13px] font-semibold text-accent-ink transition-colors hover:bg-accent-hi disabled:opacity-60"
      >
        {connecting ? <IconSpinner size={16} /> : <IconWallet size={16} />}
        <span className="hidden sm:inline">Connect wallet</span>
        <span className="sm:hidden">Connect</span>
      </button>
      {err && (
        <div className="absolute right-0 top-12 z-50 w-72 rounded-card border border-line bg-raised p-3 text-[12px] leading-relaxed text-body shadow-pop">
          {err}
          <button onClick={() => setErr(null)} className="mt-2 block cursor-pointer text-muted underline hover:text-ink">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
