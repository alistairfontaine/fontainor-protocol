// F39: user playlists — create, curate, reorder, play in order.
// Zero-backend: playlists live in localStorage (see src/state/playlists.ts).
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Cover } from '../components/Cover'
import { IconChevronDown, IconChevronUp, IconClose, IconPlay, IconPlus, IconQueue } from '../components/icons'
import { Button, EmptyState, GridSkeleton, PageHead } from '../components/ui'
import type { Release } from '../lib/registry'
import { usePlaylists, type Playlist } from '../state/playlists'
import { usePlayer } from '../state/PlayerContext'
import { useRegistry } from '../state/RegistryContext'

export function Playlists() {
  const { releases, loading } = useRegistry()
  const { lists, create } = usePlaylists()
  const [name, setName] = useState('')
  const navigate = useNavigate()

  const onCreate = () => {
    const pl = create(name)
    if (pl) {
      setName('')
      navigate(`/playlists/${encodeURIComponent(pl.id)}`)
    }
  }

  return (
    <>
      <PageHead title="Playlists" sub="Made on this device — group anything, reorder it, play it straight through." />

      <form
        className="mb-8 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate()
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New playlist name"
          aria-label="New playlist name"
          className="h-11 min-w-0 flex-1 rounded-btn border border-line bg-surface px-4 text-sm text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
          maxLength={80}
        />
        <Button variant="primary" type="submit" disabled={!name.trim()}>
          <IconPlus size={16} /> Create
        </Button>
      </form>

      {loading ? (
        <GridSkeleton />
      ) : lists.length === 0 ? (
        <EmptyState
          icon={<IconQueue size={26} />}
          title="No playlists yet"
          body="Name one above, then add tracks from any release page — or start from something you love in the library."
          action={
            <Link to="/library">
              <Button variant="primary">Browse the library</Button>
            </Link>
          }
        />
      ) : (
        <ul className="max-w-2xl space-y-2">
          {lists.map((pl) => {
            const first = pl.ids.map((id) => releases.find((r) => r.id === id)).find((r): r is Release => !!r)
            return (
              <li key={pl.id}>
                <Link
                  to={`/playlists/${encodeURIComponent(pl.id)}`}
                  className="flex items-center gap-4 rounded-card border border-line bg-surface p-3 transition-colors hover:border-accent/40"
                >
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-chip bg-raised text-faint">
                    {first ? <Cover rel={first} /> : <IconQueue size={22} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">{pl.name}</span>
                    <span className="block text-[13px] text-muted">
                      {pl.ids.length} {pl.ids.length === 1 ? 'track' : 'tracks'}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function PlaylistDetail() {
  const { id } = useParams()
  const { releases, loading } = useRegistry()
  const { lists, rename, remove, removeTrack, moveTrack } = usePlaylists()
  const { playList } = usePlayer()
  const navigate = useNavigate()

  const pl = lists.find((p) => p.id === id)

  if (loading) return <GridSkeleton />
  if (!pl) {
    return (
      <EmptyState
        icon={<IconQueue size={26} />}
        title="Playlist not found"
        body="It may have been deleted on this device."
        action={
          <Link to="/playlists">
            <Button variant="primary">All playlists</Button>
          </Link>
        }
      />
    )
  }

  // Resolve ids through the registry; ids that resolve keep their playlist order.
  const rows = pl.ids
    .map((relId, idx) => ({ relId, idx, rel: releases.find((r) => r.id === relId) }))
    .filter((x): x is { relId: string; idx: number; rel: Release } => !!x.rel)
  const missing = pl.ids.length - rows.length
  const playable = rows.map((x) => x.rel)

  return (
    <>
      <PageHead
        title={pl.name}
        sub={`${pl.ids.length} ${pl.ids.length === 1 ? 'track' : 'tracks'} · saved on this device`}
        right={<HeaderActions pl={pl} rename={rename} onDelete={() => {
          remove(pl.id)
          navigate('/playlists')
        }} />}
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <Button variant="primary" size="lg" disabled={playable.length === 0} onClick={() => playList(playable, 0)}>
          <IconPlay size={18} /> Play all
        </Button>
      </div>

      {missing > 0 && (
        <p className="mb-4 text-[13px] text-muted">
          {missing} {missing === 1 ? 'track is' : 'tracks are'} not in the registry right now and will be skipped.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconQueue size={26} />}
          title="Nothing in here yet"
          body="Open any release and use “Playlist” to add it."
          action={
            <Link to="/library">
              <Button variant="primary">Find something to add</Button>
            </Link>
          }
        />
      ) : (
        <ul className="max-w-2xl space-y-1">
          {rows.map(({ rel, idx }, i) => (
            <li key={`${rel.id}:${idx}`} className="group flex items-center gap-3 rounded-card px-2 py-2 transition-colors hover:bg-raised">
              <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-faint">{i + 1}</span>
              <button
                onClick={() => playList(playable, i)}
                className="relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-chip"
                aria-label={`Play ${rel.title}`}
              >
                <Cover rel={rel} />
                <span className="absolute inset-0 grid place-items-center bg-bg/50 text-ink opacity-0 transition-opacity group-hover:opacity-100">
                  <IconPlay size={18} />
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <Link to={`/release/${encodeURIComponent(rel.id)}`} className="block truncate text-sm font-medium text-ink hover:text-accent">
                  {rel.title}
                </Link>
                <span className="block truncate text-[12px] text-muted">{rel.artist}</span>
              </div>
              <div className="flex shrink-0 items-center">
                <button
                  onClick={() => moveTrack(pl.id, idx, -1)}
                  disabled={idx === 0}
                  className="grid h-9 w-8 cursor-pointer place-items-center text-faint hover:text-body disabled:pointer-events-none disabled:opacity-30"
                  aria-label={`Move ${rel.title} up`}
                >
                  <IconChevronUp size={16} />
                </button>
                <button
                  onClick={() => moveTrack(pl.id, idx, 1)}
                  disabled={idx === pl.ids.length - 1}
                  className="grid h-9 w-8 cursor-pointer place-items-center text-faint hover:text-body disabled:pointer-events-none disabled:opacity-30"
                  aria-label={`Move ${rel.title} down`}
                >
                  <IconChevronDown size={16} />
                </button>
                <button
                  onClick={() => removeTrack(pl.id, rel.id)}
                  className="grid h-9 w-8 cursor-pointer place-items-center text-faint hover:text-accent"
                  aria-label={`Remove ${rel.title} from playlist`}
                >
                  <IconClose size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Rename (inline form, no window.prompt) + two-step delete. */
function HeaderActions({ pl, rename, onDelete }: { pl: Playlist; rename: (id: string, name: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(pl.name)
  const [confirming, setConfirming] = useState(false)

  if (editing) {
    return (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          rename(pl.id, draft)
          setEditing(false)
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Playlist name"
          className="h-9 w-44 rounded-btn border border-line bg-surface px-3 text-sm text-ink focus:border-accent/60 focus:outline-none"
          maxLength={80}
          autoFocus
        />
        <Button size="sm" variant="primary" type="submit" disabled={!draft.trim()}>
          Save
        </Button>
      </form>
    )
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        onClick={() => {
          setDraft(pl.name)
          setEditing(true)
        }}
      >
        Rename
      </Button>
      <Button
        size="sm"
        className={confirming ? 'text-warn' : undefined}
        onClick={() => {
          if (confirming) onDelete()
          else {
            setConfirming(true)
            window.setTimeout(() => setConfirming(false), 3000)
          }
        }}
      >
        {confirming ? 'Confirm delete' : 'Delete'}
      </Button>
    </div>
  )
}
