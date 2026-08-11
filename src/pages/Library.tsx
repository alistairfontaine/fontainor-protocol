import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FixedSizeGrid } from 'react-window'
import { Cover } from '../components/Cover'
import { ReleaseCard, ReleaseGrid } from '../components/ReleaseCard'
import { IconClose, IconLibrary, IconSearch } from '../components/icons'
import { clearDownloadError, dismissWaiting, downloadRelease, releaseFromDownload, removeAllDownloads, removeDownload, useDownloads } from '../lib/downloads'
import { hapticThump, hapticTick } from '../lib/haptics'
import { IS_NATIVE } from '../lib/platform'
import { usePlayer } from '../state/PlayerContext'
import { useSettings } from '../state/settings'
import { Chip, EmptyState, GridSkeleton, PageHead } from '../components/ui'
import type { Release } from '../lib/registry'
import { useRegistry } from '../state/RegistryContext'

type SortKey = 'newest' | 'title' | 'artist' | 'price'
type TypeFilter = 'all' | 'release' | 'editorial' | 'downloaded'

const VIRTUALIZE_AT = 60
const GAP = 20
const TEXT_BLOCK = 86

function matches(rel: Release, q: string): boolean {
  const hay = `${rel.title} ${rel.artist} ${rel.label ?? ''} ${rel.tags.join(' ')} ${rel.id}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

function sortItems(items: Release[], sort: SortKey): Release[] {
  const arr = [...items]
  switch (sort) {
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title))
    case 'artist':
      return arr.sort((a, b) => a.artist.localeCompare(b.artist))
    case 'price':
      return arr.sort((a, b) => a.price.amount - b.price.amount)
    default:
      return arr.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }
}

/** Virtualized grid for large catalogs (500+ stays smooth: only visible rows mount). */
function VirtualGrid({ items }: { items: Release[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const cols = width >= 1100 ? 5 : width >= 860 ? 4 : width >= 620 ? 3 : 2
  const colWidth = width > 0 ? Math.floor(width / cols) : 0
  const rowHeight = colWidth - GAP + TEXT_BLOCK + GAP
  const height = Math.min(Math.max(560, window.innerHeight - 320), 780)

  return (
    <div ref={wrapRef}>
      {width > 0 && (
        <FixedSizeGrid
          columnCount={cols}
          columnWidth={colWidth}
          rowCount={Math.ceil(items.length / cols)}
          rowHeight={rowHeight}
          width={width}
          height={height}
          style={{ overflowX: 'hidden' }}
        >
          {({ columnIndex, rowIndex, style }) => {
            const rel = items[rowIndex * cols + columnIndex]
            if (!rel) return null
            return (
              <div style={{ ...style, padding: `0 ${GAP}px ${GAP}px 0` }}>
                <ReleaseCard rel={rel} />
              </div>
            )
          }}
        </FixedSizeGrid>
      )}
    </div>
  )
}

function SettingToggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        hapticTick()
        onChange(!checked)
      }}
      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-[12px] text-faint">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}

/** Native-only download preferences. Lives in the Library because that is where downloads live. */
function DownloadSettings() {
  const { settings, set } = useSettings()
  if (!IS_NATIVE) return null
  return (
    <section className="mb-10" aria-label="Download settings">
      <h2 className="mb-4 text-lg font-semibold text-ink">Download settings</h2>
      <div className="divide-y divide-line rounded-card border border-line bg-surface">
        <SettingToggle
          label="Download over Wi-Fi only"
          hint="On mobile data, downloads wait and start by themselves on Wi-Fi."
          checked={settings.wifiOnlyDownloads}
          onChange={(v) => set('wifiOnlyDownloads', v)}
        />
        <SettingToggle
          label="Auto-download liked releases"
          hint="Liking a release saves it for offline listening."
          checked={settings.autoDownloadLikes}
          onChange={(v) => set('autoDownloadLikes', v)}
        />
      </div>
    </section>
  )
}

function formatBytes(n: number): string {
  if (n <= 0) return '0 MB'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  const mb = n / (1024 * 1024)
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}

function DownloadsSection() {
  const { entries, progress } = useDownloads()
  const { music } = useRegistry()
  const { play } = usePlayer()
  const [confirmClear, setConfirmClear] = useState(false)
  const totalBytes = entries.reduce((sum, e) => sum + (e.bytes > 0 ? e.bytes : 0), 0)
  const byId = new Map(music.map((r) => [r.id, r]))
  // In-flight / failed downloads surface here too (YouTube-style: the shelf
  // shows what's downloading with live %, not only finished items).
  const active = Object.entries(progress)
    .map(([id, p]) => ({ rel: byId.get(id), p }))
    .filter((x): x is { rel: Release; p: (typeof progress)[string] } => !!x.rel)
  if (!IS_NATIVE || (entries.length === 0 && active.length === 0)) return null
  // Index-first: a download the loaded registry does not know about (offline
  // fallback snapshot, withdrawn release) must still be listed, playable and
  // deletable — otherwise its bytes are stranded on the device forever.
  const items = entries.map((e) => byId.get(e.id) ?? releaseFromDownload(e))
  if (!items.length && !active.length) return null
  return (
    <section className="mb-10" aria-label="Downloads">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-ink">Downloads</h2>
        <span className="text-[12px] tabular-nums text-faint">
          {entries.length > 0 ? `${entries.length} · ${formatBytes(totalBytes)} on device` : 'available offline'}
        </span>
      </div>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {active.map(({ rel, p }) => (
          <li key={`dl-${rel.id}`} className="flex items-center gap-3 px-3 py-2.5">
            <span className="h-11 w-11 shrink-0 overflow-hidden rounded-btn opacity-70">
              <Cover rel={rel} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{rel.title}</span>
              {p.state === 'downloading' ? (
                <span className="mt-1 block">
                  <span className="block h-1 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-200"
                      style={{ width: `${p.pct ?? 30}%` }}
                    />
                  </span>
                  <span className="mt-0.5 block text-[11px] tabular-nums text-faint">
                    {p.pct != null ? `Downloading ${p.pct}%` : 'Downloading…'}
                  </span>
                </span>
              ) : p.state === 'waiting' ? (
                <span className="mt-0.5 flex items-center gap-2 text-[12px]">
                  <button
                    onClick={() => {
                      hapticTick()
                      void downloadRelease(rel, { force: true })
                    }}
                    className="cursor-pointer font-medium text-muted hover:text-accent"
                    aria-label={`Download ${rel.title} now`}
                  >
                    Waiting for Wi-Fi — tap to download now
                  </button>
                  <button
                    onClick={() => {
                      hapticTick()
                      dismissWaiting(rel.id)
                    }}
                    className="cursor-pointer text-faint hover:text-ink"
                    aria-label={`Stop waiting for ${rel.title}`}
                  >
                    Dismiss
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => {
                    hapticTick()
                    clearDownloadError(rel.id)
                    void downloadRelease(rel)
                  }}
                  className="mt-0.5 block cursor-pointer text-[12px] font-medium text-warn hover:text-accent"
                >
                  Download failed — tap to retry
                </button>
              )}
            </span>
          </li>
        ))}
        {items.map((rel) => (
          <li key={rel.id} className="flex items-center gap-3 px-3 py-2.5">
            <button
              onClick={() => {
                hapticThump()
                play(rel)
              }}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
              aria-label={`Play ${rel.title} (downloaded)`}
            >
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded-btn">
                <Cover rel={rel} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{rel.title}</span>
                <span className="block truncate text-[12px] text-muted">
                  {rel.artist}
                  {(() => {
                    const bytes = entries.find((e) => e.id === rel.id)?.bytes ?? 0
                    return bytes > 0 ? <span className="tabular-nums text-faint"> · {formatBytes(bytes)}</span> : null
                  })()}
                </span>
              </span>
            </button>
            <button
              onClick={() => {
                hapticTick()
                void removeDownload(rel.id)
              }}
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-btn text-faint transition-colors hover:bg-raised hover:text-ink"
              aria-label={`Remove ${rel.title} from downloads`}
            >
              <IconClose size={16} />
            </button>
          </li>
        ))}
      </ul>
      {entries.length > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {confirmClear ? (
            <>
              <span className="text-[12px] text-muted">Delete all {entries.length} downloads ({formatBytes(totalBytes)})?</span>
              <button
                onClick={() => {
                  hapticThump()
                  setConfirmClear(false)
                  void removeAllDownloads()
                }}
                className="cursor-pointer text-[12px] font-medium text-warn hover:underline"
                aria-label="Confirm remove all downloads"
              >
                Delete all
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="cursor-pointer text-[12px] font-medium text-muted hover:text-ink"
                aria-label="Keep my downloads"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                hapticTick()
                setConfirmClear(true)
              }}
              className="cursor-pointer text-[12px] font-medium text-faint hover:text-warn"
              aria-label="Remove all downloads"
            >
              Remove all
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default function Library() {
  const { releases, loading } = useRegistry()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const { entries, ids: downloadedIds } = useDownloads()

  // The chip hides itself when the last download goes — the filter must not
  // stay stuck on an invisible option.
  useEffect(() => {
    if (type === 'downloaded' && downloadedIds.size === 0) setType('all')
  }, [type, downloadedIds])

  const filtered = useMemo(() => {
    let items = releases
    if (type === 'downloaded') {
      // Index-first, like the shelf: a download the registry no longer knows
      // about must still show up here.
      const known = new Set(items.map((r) => r.id))
      items = [...items.filter((r) => downloadedIds.has(r.id)), ...entries.filter((e) => !known.has(e.id)).map(releaseFromDownload)]
    } else if (type !== 'all') {
      items = items.filter((r) => r.type === type)
    }
    if (q) items = items.filter((r) => matches(r, q))
    return sortItems(items, sort)
  }, [releases, q, type, sort, entries, downloadedIds])

  return (
    <>
      <PageHead
        title="Library"
        sub="Everything etched into the registry — searchable, sortable, permanent."
        right={
          <span className="text-[13px] tabular-nums text-faint">
            {loading ? '…' : `${filtered.length} item${filtered.length === 1 ? '' : 's'}`}
          </span>
        }
      />

      {/* toolbar */}
      <div className="mb-7 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full sm:hidden">
          <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
            placeholder="Search releases, artists, tags…"
            className="h-11 w-full rounded-btn border border-line bg-surface pl-10 pr-4 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
            aria-label="Search the registry"
          />
        </div>
        <Chip active={type === 'all'} onClick={() => setType('all')}>
          All
        </Chip>
        <Chip active={type === 'release'} onClick={() => setType('release')}>
          Releases
        </Chip>
        <Chip active={type === 'editorial'} onClick={() => setType('editorial')}>
          Articles
        </Chip>
        {IS_NATIVE && downloadedIds.size > 0 && (
          <Chip active={type === 'downloaded'} onClick={() => setType('downloaded')}>
            Downloaded
          </Chip>
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="ml-auto h-9 cursor-pointer rounded-chip border border-line bg-surface px-3 text-[13px] text-body focus:outline-none"
          aria-label="Sort library"
        >
          <option value="newest">Newest first</option>
          <option value="title">Title A–Z</option>
          <option value="artist">Artist A–Z</option>
          <option value="price">Price low–high</option>
        </select>
      </div>

      <DownloadsSection />
      <DownloadSettings />

      {q && (
        <p className="mb-5 text-sm text-muted">
          Results for <span className="font-medium text-ink">“{q}”</span>{' '}
          <button onClick={() => setParams({}, { replace: true })} className="ml-1 cursor-pointer text-accent hover:underline">
            clear
          </button>
        </p>
      )}

      {loading ? (
        <GridSkeleton count={10} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={q ? <IconSearch size={26} /> : <IconLibrary size={26} />}
          title={q ? `Nothing matches “${q}”` : 'The library is empty'}
          body={
            q
              ? 'Try fewer or different words — search covers titles, artists, labels, and tags.'
              : 'Releases published to the registry appear here permanently.'
          }
        />
      ) : filtered.length >= VIRTUALIZE_AT ? (
        <VirtualGrid items={filtered} />
      ) : (
        <ReleaseGrid items={filtered} />
      )}
    </>
  )
}
