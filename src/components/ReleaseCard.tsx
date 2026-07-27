import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { edLabel, isSold, priceLabel, type Release } from '../lib/registry'
import { useFavorites } from '../state/collections'
import { usePlayer } from '../state/PlayerContext'
import { Cover } from './Cover'
import { IconCheck, IconHeart, IconPlay, IconQueue } from './icons'

export function ReleaseCard({ rel, note }: { rel: Release; note?: string }) {
  const { play, addToQueue } = usePlayer()
  const { ids, toggle } = useFavorites()
  const navigate = useNavigate()
  const fav = ids.includes(rel.id)
  // brief ✓ feedback after "Add to queue"
  const [justQueued, setJustQueued] = useState(false)
  const queuedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (queuedTimer.current) clearTimeout(queuedTimer.current)
    }
  }, [])
  const href = rel.type === 'editorial' ? `/editorial/${encodeURIComponent(rel.id)}` : `/release/${encodeURIComponent(rel.id)}`

  return (
    <article className="group fade-up">
      <div className="relative aspect-square overflow-hidden rounded-card bg-raised shadow-card">
        <Link to={href} aria-label={rel.title}>
          <Cover rel={rel} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        </Link>

        {rel.type === 'release' && (
          <button
            onClick={(e) => {
              e.preventDefault()
              play(rel)
            }}
            className="absolute bottom-3 left-3 grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-glow transition-all duration-200 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent-hi max-lg:opacity-100"
            aria-label={`Play ${rel.title}`}
          >
            <IconPlay size={20} />
          </button>
        )}

        <button
          onClick={(e) => {
            e.preventDefault()
            toggle(rel.id)
          }}
          className={`absolute right-3 top-3 grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-bg/70 backdrop-blur transition-all duration-200 ${
            fav ? 'text-accent opacity-100' : 'text-body opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100'
          }`}
          aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={fav}
        >
          <IconHeart size={18} filled={fav} />
        </button>

        {rel.type === 'release' && (
          <button
            onClick={(e) => {
              e.preventDefault()
              addToQueue(rel)
              setJustQueued(true)
              if (queuedTimer.current) clearTimeout(queuedTimer.current)
              queuedTimer.current = setTimeout(() => {
                setJustQueued(false)
              }, 1400)
            }}
            className={`absolute right-3 top-14 grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-bg/70 backdrop-blur transition-all duration-200 ${
              justQueued ? 'text-accent opacity-100' : 'text-body opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100'
            }`}
            aria-label={`Add ${rel.title} to queue`}
            title="Add to queue"
          >
            {justQueued ? <IconCheck size={18} /> : <IconQueue size={18} />}
          </button>
        )}

        {isSold(rel.editions) && (
          <span className="absolute left-3 top-3 rounded-chip bg-bg/80 px-2 py-0.5 text-[11px] font-medium tracking-wide text-warn backdrop-blur">
            SOLD OUT
          </span>
        )}
        {rel.type === 'editorial' && (
          <span className="absolute left-3 top-3 rounded-chip bg-bg/80 px-2 py-0.5 text-[11px] font-medium tracking-wide text-muted backdrop-blur">
            ARTICLE
          </span>
        )}
      </div>

      {/* HIER-02: value (title) loud, metadata quiet */}
      {note && <span className="mt-2.5 block truncate text-[11px] font-medium uppercase tracking-wider text-faint">{note}</span>}
      <Link to={href} className={`block truncate text-[15px] font-medium leading-snug text-ink hover:text-accent ${note ? 'mt-0.5' : 'mt-3'}`}>
        {rel.title}
      </Link>
      <button
        onClick={() => navigate(`/library?q=${encodeURIComponent(rel.artist)}`)}
        className="block max-w-full cursor-pointer truncate text-[13px] text-muted hover:text-body"
      >
        {rel.artist}
      </button>
      {rel.type === 'release' && (
        <div className="mt-1.5 flex items-baseline gap-2 text-[12px]">
          <span className="font-semibold tabular-nums text-body">{priceLabel(rel.price)}</span>
          <span className="text-faint">{edLabel(rel.editions)}</span>
        </div>
      )}
    </article>
  )
}

export function ReleaseGrid({ items }: { items: Release[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((rel) => (
        <ReleaseCard key={rel.id + rel.title} rel={rel} />
      ))}
    </div>
  )
}
