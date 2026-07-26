import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { IconAlert, IconCheck, IconSpinner } from './icons'

// ── Buttons ─────────────────────────────────────────────────
// DEPTH-03: accent lives on primary actions only.

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink font-semibold hover:bg-accent-hi active:translate-y-px shadow-glow',
  secondary:
    'bg-raised text-ink border border-line-strong hover:border-faint active:translate-y-px',
  ghost: 'text-body hover:text-ink hover:bg-raised',
  danger: 'bg-warn/15 text-warn border border-warn/40 hover:bg-warn/25',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-9 px-3.5 text-[13px]', md: 'h-11 px-5 text-sm', lg: 'h-12 px-6 text-[15px]' }
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-btn transition-colors disabled:pointer-events-none disabled:opacity-45 ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

// ── Chips / tags ────────────────────────────────────────────

export function Chip({ children, active = false, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-8 cursor-pointer items-center rounded-chip px-3 text-[13px] transition-colors ${
        active
          ? 'bg-accent/15 font-medium text-accent ring-1 ring-accent/40'
          : 'bg-raised text-muted ring-1 ring-line hover:text-body hover:ring-line-strong'
      }`}
    >
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'accent' }) {
  const tones = {
    neutral: 'bg-raised text-muted ring-line',
    ok: 'bg-ok/10 text-ok ring-ok/30',
    warn: 'bg-warn/10 text-warn ring-warn/30',
    accent: 'bg-accent/10 text-accent ring-accent/30',
  }
  return (
    <span className={`inline-flex items-center rounded-chip px-2 py-0.5 text-[11px] font-medium tracking-wide ring-1 ${tones[tone]}`}>
      {children}
    </span>
  )
}

// ── Empty / error / loading states (STATE rules: explain + next action) ──

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="fade-up mx-auto flex max-w-md flex-col items-center py-16 text-center">
      {icon && <div className="mb-4 grid h-14 w-14 place-items-center rounded-card bg-raised text-faint">{icon}</div>}
      <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1.5 text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-muted">
      <IconSpinner size={18} />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

// ── Banners ─────────────────────────────────────────────────

export function Banner({ tone, children }: { tone: 'ok' | 'warn' | 'info'; children: ReactNode }) {
  const tones = {
    ok: 'bg-ok/8 text-ok ring-ok/25',
    warn: 'bg-warn/8 text-warn ring-warn/25',
    info: 'bg-raised text-muted ring-line',
  }
  return (
    <div className={`mb-5 flex items-center gap-2.5 rounded-btn px-3.5 py-2.5 text-[13px] ring-1 ${tones[tone]}`}>
      {tone === 'ok' ? <IconCheck size={15} /> : tone === 'warn' ? <IconAlert size={15} /> : null}
      <span className="text-body">{children}</span>
    </div>
  )
}

// ── Page header (HIER-04: one max-emphasis element per screen) ──

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold sm:text-[32px]">{title}</h1>
        {sub && <p className="mt-1 max-w-xl text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

// ── Skeletons ───────────────────────────────────────────────

export function CardSkeleton() {
  return (
    <div>
      <div className="skeleton aspect-square rounded-card" />
      <div className="skeleton mt-3 h-3.5 w-3/4 rounded" />
      <div className="skeleton mt-2 h-3 w-1/2 rounded" />
    </div>
  )
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}
