import { useMemo, useState } from 'react'
import { coverSVG, type Release } from '../lib/registry'

/** Release artwork with deterministic generative fallback (one visual treatment across sets — DEPTH-07). */
export function Cover({ rel, className = '' }: { rel: Release; className?: string }) {
  const [broken, setBroken] = useState(false)
  const fallback = useMemo(() => coverSVG(rel.id + rel.title), [rel.id, rel.title])

  if (rel.coverUrl && !broken) {
    return (
      <img
        src={rel.coverUrl}
        alt={`${rel.title} cover art`}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className={`h-full w-full object-cover ${className}`}
      />
    )
  }
  return <div className={`h-full w-full ${className}`} dangerouslySetInnerHTML={{ __html: fallback }} aria-hidden="true" />
}
