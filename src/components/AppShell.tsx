import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { usePlayer } from '../state/PlayerContext'
import { Footer } from './Footer'
import { IconClose, IconDisc, IconEditorial, IconHeart, IconHistory, IconHome, IconLibrary, IconProfile, IconPublish, IconQueue, IconSearch } from './icons'
import { PlayerBar } from './PlayerBar'
import { SupportNudge } from './SupportNudge'

// ── top bar ─────────────────────────────────────────────────

function SearchBox() {
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  // keep box in sync when landing on /library?q=…
  useEffect(() => {
    if (location.pathname === '/library') {
      const params = new URLSearchParams(location.search)
      setQ(params.get('q') ?? '')
    }
  }, [location])

  // "/" focuses search (desktop convenience)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !/input|textarea/i.test((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const go = (value: string) => {
    navigate(value ? `/library?q=${encodeURIComponent(value)}` : '/library', { replace: location.pathname === '/library' })
  }

  // Live filter as you type (debounced) — matches the mobile Library search box,
  // which already updates results on every keystroke. Enter still navigates
  // immediately (and works from any page). The debounce keeps the URL from
  // churning a history entry per character; replace: on /library so Back isn't
  // buried under intermediate queries.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChange = (value: string) => {
    setQ(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => go(value), 200)
  }
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  return (
    <div className="relative hidden w-full max-w-md sm:block">
      <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (debounceRef.current) clearTimeout(debounceRef.current)
            go(q)
          }
        }}
        placeholder="Search releases, artists, tags…"
        className="h-10 w-full rounded-btn border border-line bg-surface pl-10 pr-4 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
        aria-label="Search the registry"
      />
    </div>
  )
}

/** Mobile search: icon button in the header expands a full-width input row (RESP-01). */
function MobileSearch() {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  // sync with /library?q=… like the desktop box
  useEffect(() => {
    if (location.pathname === '/library') {
      const params = new URLSearchParams(location.search)
      setQ(params.get('q') ?? '')
    }
  }, [location])

  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`grid h-10 w-10 cursor-pointer place-items-center rounded-btn transition-colors hover:bg-raised sm:hidden ${
          open ? 'bg-raised text-ink' : 'text-body'
        }`}
        aria-label={open ? 'Close search' : 'Search'}
        aria-expanded={open}
      >
        {open ? <IconClose size={19} /> : <IconSearch size={19} />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur sm:hidden">
          <div className="relative">
            <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={ref}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  navigate(q ? `/library?q=${encodeURIComponent(q)}` : '/library')
                  setOpen(false)
                }
              }}
              placeholder="Search releases, artists, tags…"
              className="h-11 w-full rounded-btn border border-line bg-surface pl-10 pr-4 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
              aria-label="Search the registry"
            />
          </div>
        </div>
      )}
    </>
  )
}

// ── desktop sidebar ─────────────────────────────────────────

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex h-10 items-center gap-3 rounded-btn px-3 text-sm transition-colors ${
    isActive ? 'bg-raised font-medium text-ink' : 'text-muted hover:bg-raised/60 hover:text-body'
  }`

function Sidebar() {
  return (
    <aside className="sticky top-[65px] hidden h-[calc(100vh-65px)] w-56 shrink-0 flex-col gap-1 overflow-y-auto py-6 pr-4 lg:flex">
      <NavLink to="/" end className={sideLink}>
        {({ isActive }) => (
          <>
            <IconHome size={19} filled={isActive} /> Home
          </>
        )}
      </NavLink>
      <NavLink to="/library" className={sideLink}>
        {({ isActive }) => (
          <>
            <IconLibrary size={19} filled={isActive} /> Library
          </>
        )}
      </NavLink>
      <NavLink to="/editorial" className={sideLink}>
        {({ isActive }) => (
          <>
            <IconEditorial size={19} filled={isActive} /> Editorial
          </>
        )}
      </NavLink>

      <div className="my-3 h-px bg-line" />

      <NavLink to="/favorites" className={sideLink}>
        {({ isActive }) => (
          <>
            <IconHeart size={19} filled={isActive} /> Favorites
          </>
        )}
      </NavLink>
      <NavLink to="/playlists" className={sideLink}>
        <IconQueue size={19} /> Playlists
      </NavLink>
      <NavLink to="/collection" className={sideLink}>
        {({ isActive }) => (
          <>
            <IconDisc size={19} filled={isActive} /> Collection
          </>
        )}
      </NavLink>
      <NavLink to="/history" className={sideLink}>
        <IconHistory size={19} /> History
      </NavLink>

      <div className="mt-6 rounded-card border border-line bg-surface p-4">
        <h4 className="text-sm font-semibold text-ink">Own your catalog</h4>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Publish once. Your music lives on Arweave forever.
        </p>
        <NavLink
          to="/publish"
          className="mt-3.5 flex h-10 items-center justify-center gap-2 rounded-btn bg-accent text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hi"
        >
          <IconPublish size={17} /> Publish
        </NavLink>
      </div>
    </aside>
  )
}

// ── mobile bottom nav (NAV-01..05, LAYOUT-04..06) ───────────

function BottomNav() {
  const tabs = [
    { to: '/', label: 'Home', icon: IconHome, end: true },
    { to: '/library', label: 'Library', icon: IconLibrary },
    { to: '/publish', label: 'Publish', icon: IconPublish, cta: true },
    { to: '/editorial', label: 'Editorial', icon: IconEditorial },
    { to: '/profile', label: 'Profile', icon: IconProfile },
  ]
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      aria-label="Primary"
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch justify-around">
        {tabs.map((t) =>
          t.cta ? (
            <NavLink key={t.to} to={t.to} className="flex min-w-[64px] flex-col items-center justify-center" aria-label={t.label}>
              <span className="grid h-11 w-11 -translate-y-3 place-items-center rounded-full bg-accent text-accent-ink shadow-glow">
                <t.icon size={24} />
              </span>
              <span className="-translate-y-2.5 text-[11px] font-medium text-muted">{t.label}</span>
            </NavLink>
          ) : (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex min-w-[64px] flex-col items-center justify-center gap-1 ${
                  isActive ? 'text-accent' : 'text-muted opacity-90'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <t.icon size={24} filled={isActive} />
                  <span className={`text-[11px] ${isActive ? 'font-semibold' : 'font-normal'}`}>{t.label}</span>
                </>
              )}
            </NavLink>
          ),
        )}
      </div>
    </nav>
  )
}

// ── shell ───────────────────────────────────────────────────

export function AppShell({ children, walletSlot }: { children: ReactNode; walletSlot?: ReactNode }) {
  // Reserve bottom clearance only for chrome that is actually on screen:
  // mobile always has the bottom nav; the player bar clearance is added only
  // while something is playing (otherwise the page ended in a big dead area).
  const { current } = usePlayer()
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-6 px-4 sm:px-6">
          <NavLink to="/" className="font-display text-[22px] font-bold tracking-tight text-ink">
            fontainor<span className="text-accent">.</span>
          </NavLink>
          <SearchBox />
          <div className="ml-auto flex items-center gap-2">
            <MobileSearch />
            {walletSlot}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1360px] gap-6 px-4 sm:px-6">
        <Sidebar />
        <main className={`min-w-0 flex-1 py-7 ${current ? 'pb-40 lg:pb-28' : 'pb-24 lg:pb-8'}`}>
          <SupportNudge />
          {children}
          <Footer />
        </main>
      </div>

      <PlayerBar />
      <BottomNav />
    </div>
  )
}
