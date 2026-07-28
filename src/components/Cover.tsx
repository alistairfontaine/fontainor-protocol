import { useMemo, useState } from 'react'
import { IS_NATIVE } from '../lib/platform'
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
        // Native: the whole registry is ~a dozen small covers — decode them at
        // launch instead of mid-fling (lazy decode was the last source of
        // first-scroll jank over the music rails). Web keeps lazy semantics.
        loading={IS_NATIVE ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setBroken(true)}
        className={`h-full w-full object-cover ${className}`}
      />
    )
  }
  return <div className={`h-full w-full ${className}`} dangerouslySetInnerHTML={{ __html: fallback }} aria-hidden="true" />
}
