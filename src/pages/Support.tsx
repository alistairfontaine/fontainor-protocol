// "Keep Fontainor running" — donations page (Zero-Dollar Launch Plan §4).
// Posture: WinRAR-style honor system. Full cost transparency (~$0/mo),
// concrete funding target (storage subsidies), never a paywall.
import { useEffect, useState } from 'react'
import { IconCheck, IconExternal, IconSpinner, IconWallet } from '../components/icons'
import { Button, PageHead } from '../components/ui'
import { CHANNELS, TIP_PRESETS, TIP_WALLET, TIP_WALLET_HANDLE } from '../config/support'
import { getPhantom } from '../lib/phantom'

type TipState =
  | { phase: 'idle' }
  | { phase: 'sending'; amount: number }
  | { phase: 'sent'; signature: string }
  | { phase: 'error'; message: string }

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return [copied, copy]
}

/** One-tap SOL tip through Phantom. web3.js loads lazily on click only. */
function TipJar() {
  const [state, setState] = useState<TipState>({ phase: 'idle' })
  const [copied, copy] = useCopy()

  const tip = async (amount: number) => {
    setState({ phase: 'sending', amount })
    try {
      const provider = getPhantom()
      if (!provider) {
        setState({
          phase: 'error',
          message: 'Phantom not detected — you can still copy the address below and send from any wallet.',
        })
        return
      }
      const pubkey = provider.publicKey ?? (await provider.connect()).publicKey
      const { Connection, PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js')
      const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')
      const from = new PublicKey(pubkey.toString())
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: from,
          toPubkey: new PublicKey(TIP_WALLET),
          lamports: Math.round(amount * 1e9),
        }),
      )
      tx.feePayer = from
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
      const { signature } = await provider.signAndSendTransaction(tx)
      setState({ phase: 'sent', signature })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setState({
        phase: 'error',
        message: /reject|denied|cancel/i.test(message)
          ? 'No problem — the tip was cancelled.'
          : `Couldn't send the tip (${message}). You can copy the address below instead.`,
      })
    }
  }

  return (
    <div className="rounded-card border border-line bg-raised p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <IconWallet size={18} className="text-accent" />
        <h2 className="font-display text-[17px] font-semibold text-ink">SOL tip jar</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The most on-brand way to chip in — straight to the protocol wallet, no platform in between, ~0% fees.
      </p>

      {state.phase === 'sent' ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ok">
          <IconCheck size={16} />
          <span>Tip received — thank you for keeping the registry alive.</span>
          <a
            href={`https://solscan.io/tx/${state.signature}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted underline decoration-line underline-offset-2 hover:text-ink"
          >
            View transaction <IconExternal size={13} />
          </a>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {TIP_PRESETS.map((amt) => (
            <Button
              key={amt}
              variant="primary"
              size="sm"
              disabled={state.phase === 'sending'}
              onClick={() => void tip(amt)}
            >
              {state.phase === 'sending' && state.amount === amt ? <IconSpinner size={15} /> : null}
              {amt} SOL
            </Button>
          ))}
          <span className="text-[12px] text-faint">via Phantom, one tap</span>
        </div>
      )}

      {state.phase === 'error' && <p className="mt-3 text-[13px] text-warn">{state.message}</p>}

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-faint">
          Or send any amount to <span className="normal-case tracking-normal text-body">{TIP_WALLET_HANDLE}</span> on Phantom, or directly to
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="max-w-full overflow-x-auto rounded-btn bg-surface px-3 py-2 text-[12px] text-body">
            {TIP_WALLET}
          </code>
          <Button size="sm" onClick={() => copy(TIP_WALLET)}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Supporters wall (opt-in, static JSON — cheap, honest social proof) ──

interface Supporter {
  name: string
  url?: string
  note?: string
}

function SupportersWall() {
  const [supporters, setSupporters] = useState<Supporter[] | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/supporters.json')
      .then((r) => (r.ok ? r.json() : { supporters: [] }))
      .then((d: { supporters?: Supporter[] }) => {
        if (alive) setSupporters(Array.isArray(d.supporters) ? d.supporters : [])
      })
      .catch(() => {
        if (alive) setSupporters([])
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <section>
      <h2 className="mb-2.5 font-display text-[19px] font-semibold text-ink">Supporters</h2>
      {supporters === null ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : supporters.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          This wall is empty — be the first name on it. Tips that include a note (or a quick message to us) get
          listed here, opt-in only.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {supporters.map((s) => (
            <li key={s.name} className="rounded-chip bg-raised px-3 py-1.5 text-[13px] text-body ring-1 ring-line">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-ink">
                  {s.name}
                </a>
              ) : (
                s.name
              )}
              {s.note && <span className="text-faint"> — {s.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Page ─────────────────────────────────────────────────────

export function Support() {
  const liveChannels = CHANNELS.filter((c) => c.live)
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead
        title="Keep Fontainor running"
        sub="Free, open source, zero burn. Here's exactly what your support does."
      />
      <div className="space-y-10 text-[15px] leading-[1.75] text-body">
        <section>
          <h2 className="mb-2.5 font-display text-[19px] font-semibold text-ink">What Fontainor costs to run</h2>
          <p>
            Almost nothing — and that's the point. Hosting, CDN, and the registry index all run on free tiers;
            audio lives on Arweave, paid once by the artist at publish time. A platform with no burn can't be
            starved out. Donations aren't keeping servers on: they buy the things that make the registry better.
          </p>
        </section>
        <section>
          <h2 className="mb-2.5 font-display text-[19px] font-semibold text-ink">What donations fund</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-ink">Storage subsidies for broke artists</strong> — covering the cents-per-track
              Arweave cost for artists who can't, so money is never the reason a record doesn't become permanent.
            </li>
            <li>A real domain, and infrastructure headroom when launch-day traffic spikes.</li>
            <li>Development time on the open-source protocol itself.</li>
          </ul>
        </section>

        <TipJar />

        {liveChannels.length > 0 && (
          <section>
            <h2 className="mb-2.5 font-display text-[19px] font-semibold text-ink">Other ways to support</h2>
            <div className="flex flex-wrap gap-3">
              {liveChannels.map((c) => (
                <a key={c.id} href={c.href} target="_blank" rel="noreferrer">
                  <Button>
                    {c.name} <IconExternal size={14} />
                  </Button>
                </a>
              ))}
            </div>
            <ul className="mt-3 space-y-1 text-[13px] text-muted">
              {liveChannels.map((c) => (
                <li key={c.id}>
                  <strong className="text-body">{c.name}:</strong> {c.blurb}
                </li>
              ))}
            </ul>
          </section>
        )}

        <SupportersWall />

        <section className="border-t border-line pt-8 text-sm text-muted">
          <p>
            Fontainor is AGPL-3.0 open source. No feature here is ever gated behind a donation — if it's useful,
            chip in; if it's not, tell us why. Either one helps.
          </p>
        </section>
      </div>
    </div>
  )
}
