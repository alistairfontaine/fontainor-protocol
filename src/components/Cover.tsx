import { useMemo, useState } from 'react'
import { localCoverSrc, useDownloads } from '../lib/downloads'
import { IS_NATIVE } from '../lib/platform'
import { coverSVG, type Release } from '../lib/registry'

/** Release artwork with deterministic generative fallback (one visual treatment across sets — DEPTH-07). */
export function Cover({ rel, className = '' }: { rel: Release; className?: string }) {
  const [broken, setBroken] = useState(false)
  const fallback = useMemo(() => coverSVG(rel.id + rel.title), [rel.id, rel.title])
  // Downloaded releases show their SAVED artwork: the remote URL is unreachable
  // in airplane mode, which is exactly when an offline download is used.
  const { ids } = useDownloads()
  const src = (ids.has(rel.id) ? localCoverSrc(rel.id) : null) ?? rel.coverUrl

  if (src && !broken) {
    return (
      <img
        src={src}
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
