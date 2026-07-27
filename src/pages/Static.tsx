// Supporting pages (F17): About, Terms, Privacy, Contact, FAQ.
// Static, serverless-friendly — plain routes rendered client-side.
import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconArweave } from '../components/icons'
import { Button, PageHead } from '../components/ui'

function Doc({ title, sub, updated, children }: { title: string; sub?: string; updated?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title={title} sub={sub} />
      {updated && <p className="-mt-4 mb-8 text-[12px] uppercase tracking-wider text-faint">Last updated {updated}</p>}
      <div className="space-y-8 text-[15px] leading-[1.75] text-body">{children}</div>
    </div>
  )
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="mb-2.5 font-display text-[19px] font-semibold text-ink">{children}</h2>
}

// ── About ────────────────────────────────────────────────────

export function About() {
  return (
    <Doc title="About Fontainor" sub="A permanent, artist-owned music registry.">
      <section>
        <H>Why we exist</H>
        <p>
          Streaming catalogs are rented shelf space: releases disappear when platforms fold, licenses lapse, or an
          algorithm changes its mind. Fontainor is built on a different premise — <strong className="text-ink">music as a
          permanent public record</strong>. Every release published here is written to Arweave, a storage network designed
          to keep data readable for centuries, and every sale settles directly between listener and artist on Solana.
        </p>
      </section>
      <section>
        <H>How it works</H>
        <p>
          Artists sign in with their wallet — no email, no password, the signature is the identity. Audio and artwork are
          uploaded once and anchored to a transaction ID that anyone can verify. When a listener collects a release,{' '}
          <strong className="text-ink">98% goes to the artist</strong> and 2% sustains the registry. There are no
          intermediaries holding funds and no takedowns: the record outlives us.
        </p>
      </section>
      <section>
        <H>What Fontainor is not</H>
        <p>
          We are not a streaming service, a label, or a rights broker. We don't own anything you publish. We keep an
          index, we keep it honest, and we keep it up.
        </p>
      </section>
      <div className="flex flex-wrap gap-3 border-t border-line pt-8">
        <Link to="/publish"><Button variant="primary">Publish a release</Button></Link>
        <Link to="/faq"><Button>Read the FAQ</Button></Link>
      </div>
    </Doc>
  )
}

// ── Terms ────────────────────────────────────────────────────

export function Terms() {
  return (
    <Doc title="Terms of Service" updated="July 2026">
      <section>
        <H>1. The service</H>
        <p>
          Fontainor ("the registry") indexes music and writing that creators publish to permanent storage networks. We
          provide the interface and the index; the underlying content lives on Arweave and payments settle on Solana.
          Using the registry means you accept these terms.
        </p>
      </section>
      <section>
        <H>2. Your account</H>
        <p>
          Authentication is a cryptographic signature from a wallet you control. You are responsible for the security of
          your keys — signatures made with your wallet are treated as your actions. We cannot reset, recover, or
          impersonate a wallet.
        </p>
      </section>
      <section>
        <H>3. Publishing</H>
        <p>
          By publishing you confirm you hold the rights to the audio, artwork, and text you submit, and you grant the
          registry a non-exclusive right to index and display it. Because storage is permanent, <strong className="text-ink">
          publication is effectively irreversible</strong> — we can delist an entry from this interface, but we cannot
          erase data from Arweave. Publish deliberately.
        </p>
      </section>
      <section>
        <H>4. Purchases</H>
        <p>
          Sales are peer-to-peer transactions on Solana with a fixed 98/2 artist/registry split enforced on-chain. All
          sales are final; the registry never holds custody of funds and cannot issue refunds.
        </p>
      </section>
      <section>
        <H>5. Acceptable use</H>
        <p>
          Don't publish content you don't own, content that is unlawful, or content intended to deceive. We may delist
          entries that violate these terms from the interface and index.
        </p>
      </section>
      <section>
        <H>6. Liability</H>
        <p>
          The registry is provided "as is". To the maximum extent permitted by law we disclaim warranties of any kind and
          are not liable for losses arising from network outages, wallet compromise, or the actions of third-party
          storage and payment networks.
        </p>
      </section>
    </Doc>
  )
}

// ── Privacy ──────────────────────────────────────────────────

export function Privacy() {
  return (
    <Doc title="Privacy Policy" updated="July 2026">
      <section>
        <H>What we collect</H>
        <p>
          Almost nothing. There are no accounts, emails, or passwords. When you connect a wallet we see its public
          address — that's the identity you choose to present. Favorites and listening history are stored{' '}
          <strong className="text-ink">only in your browser's local storage</strong> and never leave your device.
        </p>
      </section>
      <section>
        <H>What is public by design</H>
        <p>
          Anything you publish — audio, artwork, metadata, and the wallet that signed it — is written to a public,
          permanent network and is visible to anyone. On-chain purchases are likewise public. Treat publication as a
          public act, because it is one.
        </p>
      </section>
      <section>
        <H>What we don't do</H>
        <p>
          We don't run third-party ad trackers, we don't sell data, and we don't profile listeners across the web. Basic
          server logs (IP, user agent) are kept briefly for abuse prevention and then discarded.
        </p>
      </section>
      <section>
        <H>Questions</H>
        <p>
          Privacy questions go to the address on the <Link to="/contact" className="text-accent hover:underline">contact page</Link>.
        </p>
      </section>
    </Doc>
  )
}

// ── Contact ──────────────────────────────────────────────────

export function Contact() {
  const rows = [
    {
      label: 'Everything — support, artists, rights',
      value: 'silentics.org@gmail.com',
      note: 'Bugs, publishing help, catalog migrations, editorial pitches, rights and takedown requests (include the registry ID and proof of ownership). One inbox, read by a human.',
    },
  ]
  const socials = [
    { label: 'Instagram', value: '@fontainor', href: 'https://instagram.com/fontainor' },
    { label: 'X', value: '@fontainor', href: 'https://x.com/fontainor' },
  ]
  return (
    <Doc title="Contact" sub="No ticket systems, no chatbots — email a human.">
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.value} className="rounded-card border border-line bg-surface p-5">
            <span className="text-[12px] font-medium uppercase tracking-wider text-faint">{r.label}</span>
            <a href={`mailto:${r.value}`} className="mt-1 block font-display text-[18px] font-semibold text-ink hover:text-accent">
              {r.value}
            </a>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{r.note}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {socials.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-card border border-line bg-surface px-5 py-3 text-[14px] text-muted transition-colors hover:border-accent/40 hover:text-ink"
          >
            <span className="text-[12px] font-medium uppercase tracking-wider text-faint">{s.label}</span>{' '}
            <span className="ml-1 font-medium text-ink">{s.value}</span>
          </a>
        ))}
      </div>
      <p className="text-[13px] text-muted">
        Before writing in, the <Link to="/faq" className="text-accent hover:underline">FAQ</Link> answers the ten questions
        we get most.
      </p>
    </Doc>
  )
}

// ── FAQ ──────────────────────────────────────────────────────

const FAQS: Array<{ q: string; a: ReactNode }> = [
  { q: 'Do I need a crypto wallet to listen?', a: 'No. Browsing, streaming previews, favorites, and reading the editorial are open to everyone. A wallet is only needed to publish or collect.' },
  { q: 'Which wallets are supported?', a: 'Phantom is supported today, on desktop browsers. More Solana wallets are on the roadmap.' },
  { q: 'What does it cost to publish?', a: 'The registry itself charges nothing to publish. You pay the network cost of permanent storage (typically a few cents per megabyte) at upload time.' },
  { q: 'How do artists get paid?', a: 'Sales settle on Solana in SOL, USDC, or USDT. The split is fixed on-chain: 98% to the artist wallet, 2% to the registry treasury. Payouts are instant — there is no balance to withdraw.' },
  { q: 'Can I take a release down?', a: 'You can delist it from the registry interface, and it will stop appearing in search and feeds. The underlying data on Arweave is permanent and cannot be erased — that permanence is the point, so publish deliberately.' },
  { q: 'What are editions?', a: 'A release can be limited to a fixed number of copies. Once collected out, it is marked SOLD OUT and no further copies can be minted — scarcity is enforced by the protocol, not a promise.' },
  { q: 'Where are my favorites stored?', a: 'In your browser, on your device. We keep no server-side profile of what you play or save.' },
  { q: 'Is the audio on this demo real?', a: 'The demo catalog uses public-domain and CC0-licensed recordings with fictional artist and release names, so you can hear the full product experience.' },
]

export function Faq() {
  return (
    <Doc title="FAQ" sub="Short answers to the questions we actually get.">
      <div className="space-y-2.5">
        {FAQS.map((f) => (
          <details key={f.q} className="group rounded-card border border-line bg-surface open:border-line-strong">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 text-[15px] font-medium text-ink [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="text-faint transition-transform duration-200 group-open:rotate-45">+</span>
            </summary>
            <p className="px-5 pb-4 text-[14px] leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="text-[13px] text-muted">
        Something missing? <Link to="/contact" className="text-accent hover:underline">Ask us directly.</Link>
      </p>
    </Doc>
  )
}

// ── 404 ──────────────────────────────────────────────────────

export function NotFound() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <p className="flex items-center gap-2 rounded-chip bg-raised px-3 py-1 text-[12px] font-medium tracking-wide text-muted">
        <IconArweave size={15} /> 404 — NOT IN THE REGISTRY
      </p>
      <h1 className="mt-6 max-w-md font-display text-3xl font-bold leading-tight sm:text-4xl">
        This page was never etched.
      </h1>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
        The link may be old or mistyped — but nothing published here ever disappears. Try the library.
      </p>
      <div className="mt-7 flex gap-3">
        <Link to="/"><Button variant="primary">Back home</Button></Link>
        <Link to="/library"><Button>Browse the library</Button></Link>
      </div>
    </div>
  )
}
