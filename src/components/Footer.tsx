import { Link } from 'react-router-dom'

const COLS: Array<{ head: string; links: Array<{ to: string; label: string }> }> = [
  {
    head: 'Registry',
    links: [
      { to: '/library', label: 'Library' },
      { to: '/editorial', label: 'Editorial' },
      { to: '/publish', label: 'Publish' },
    ],
  },
  {
    head: 'Company',
    links: [
      { to: '/about', label: 'About' },
      { to: '/faq', label: 'FAQ' },
      { to: '/contact', label: 'Contact' },
    ],
  },
  {
    head: 'Legal',
    links: [
      { to: '/terms', label: 'Terms of Service' },
      { to: '/privacy', label: 'Privacy Policy' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line pb-10 pt-10">
      <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link to="/" className="font-display text-[20px] font-bold tracking-tight text-ink">
            fontainor<span className="text-accent">.</span>
          </Link>
          <p className="mt-2.5 max-w-[26ch] text-[13px] leading-relaxed text-muted">
            The permanent music registry. Stored on Arweave, paid on Solana, owned by artists.
          </p>
        </div>
        {COLS.map((c) => (
          <nav key={c.head} aria-label={c.head}>
            <h4 className="text-[12px] font-medium uppercase tracking-wider text-faint">{c.head}</h4>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-[14px] text-muted transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <p className="mt-10 border-t border-line pt-5 text-[12px] leading-relaxed text-faint">
        © {new Date().getFullYear()} Fontainor Protocol · Demo catalog: public-domain / CC0 recordings under fictional
        names, artwork generated for this demo.
      </p>
    </footer>
  )
}
