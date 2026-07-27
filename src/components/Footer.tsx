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
      { to: '/support', label: 'Support us' },
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

const COMMUNITY: Array<{ href: string; label: string }> = [
  { href: 'https://discord.gg/uc4SJbRBH', label: 'Discord' },
  { href: 'https://www.reddit.com/r/fontainor/', label: 'Reddit' },
  { href: 'https://github.com/alistairfontaine/fontainor-protocol', label: 'GitHub' },
]

/**
 * Footer. Compact on phones (per user feedback: the stacked version was way
 * too tall): the three link columns sit side by side in one row and spacing
 * is tightened. Desktop keeps the roomier 4-column layout.
 */
export function Footer() {
  return (
    <footer className="mt-10 border-t border-line pb-6 pt-6 sm:mt-16 sm:pb-10 sm:pt-10">
      <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:gap-10">
        <div className="col-span-3 sm:col-span-1">
          <Link to="/" className="font-display text-[18px] font-bold tracking-tight text-ink sm:text-[20px]">
            fontainor<span className="text-accent">.</span>
          </Link>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted sm:mt-2.5 sm:max-w-[26ch] sm:text-[13px]">
            The permanent music registry. Stored on Arweave, paid on Solana, owned by artists.
          </p>
        </div>
        {COLS.map((c) => (
          <nav key={c.head} aria-label={c.head}>
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-faint sm:text-[12px]">{c.head}</h4>
            <ul className="mt-2 space-y-1.5 sm:mt-3 sm:space-y-2">
              {c.links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-[13px] text-muted transition-colors hover:text-ink sm:text-[14px]">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-4 sm:mt-10 sm:pt-5">
        {COMMUNITY.map((c) => (
          <a
            key={c.href}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-medium text-muted transition-colors hover:text-ink sm:text-[13px]"
          >
            {c.label}
          </a>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-faint sm:mt-4 sm:text-[12px]">
        © {new Date().getFullYear()} Fontainor Protocol · Demo catalog: public-domain / CC0 recordings under fictional
        names, artwork generated for this demo.
      </p>
    </footer>
  )
}
