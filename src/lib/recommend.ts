// Client-side recommendation engine (F15).
// Spotify-style "Made for you": builds a taste profile from favorites +
// listening history (tags, artists, recency-weighted), scores unheard
// releases, and explains each pick. Pure functions — no network, no state.

import type { Release } from './registry'

export interface Recommendation {
  rel: Release
  score: number
  reason: string
}

interface Profile {
  tags: Map<string, number>
  artists: Map<string, number>
  /** strongest seed release per tag/artist, for "Because you played …" copy */
  seeds: Map<string, Release>
}

const FAV_W = 3
const HIST_W = 1.6

function bump(m: Map<string, number>, k: string, w: number) {
  m.set(k, (m.get(k) ?? 0) + w)
}

function buildProfile(all: Release[], favIds: string[], histIds: string[]): Profile {
  const byId = new Map(all.map((r) => [r.id, r]))
  const tags = new Map<string, number>()
  const artists = new Map<string, number>()
  const seeds = new Map<string, Release>()

  const add = (rel: Release | undefined, w: number) => {
    if (!rel || rel.type !== 'release') return
    for (const t of rel.tags) {
      bump(tags, t, w)
      if (!seeds.has(t)) seeds.set(t, rel)
    }
    bump(artists, rel.artist, w)
    if (!seeds.has(rel.artist)) seeds.set(rel.artist, rel)
  }

  favIds.forEach((id) => add(byId.get(id), FAV_W))
  // history is most-recent-first: recency decay
  histIds.forEach((id, i) => add(byId.get(id), Math.max(0.4, HIST_W - 0.2 * i)))
  return { tags, artists, seeds }
}

function freshness(rel: Release): number {
  if (!rel.date) return 0
  const days = (Date.now() - new Date(rel.date).getTime()) / 86_400_000
  if (!isFinite(days) || days < 0) return 0
  return Math.max(0, 0.5 - days / 365) // up to +0.5 for brand-new
}

/** Personalized picks. Empty array = cold start (caller may hide the rail). */
export function recommendFor(
  all: Release[],
  favIds: string[],
  histIds: string[],
  limit = 5,
): Recommendation[] {
  const p = buildProfile(all, favIds, histIds)
  if (p.tags.size === 0 && p.artists.size === 0) return []

  const known = new Set([...favIds, ...histIds])
  const out: Recommendation[] = []

  for (const rel of all) {
    if (rel.type !== 'release' || known.has(rel.id)) continue

    let tagScore = 0
    let topTag: string | null = null
    for (const t of rel.tags) {
      const w = p.tags.get(t) ?? 0
      tagScore += w
      if (w > (topTag ? p.tags.get(topTag) ?? 0 : 0)) topTag = t
    }
    const artistScore = (p.artists.get(rel.artist) ?? 0) * 1.25
    const score = tagScore + artistScore + freshness(rel)
    if (score <= 0.01) continue

    let reason = 'Picked for you'
    if (artistScore >= tagScore && artistScore > 0) {
      const seed = p.seeds.get(rel.artist)
      reason = seed && seed.id !== rel.id ? `More from ${rel.artist}` : `Because you like ${rel.artist}`
    } else if (topTag) {
      const seed = p.seeds.get(topTag)
      reason = seed ? `Because you played ${seed.title}` : `More #${topTag}`
    }
    out.push({ rel, score, reason })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** "More like this" for a release page: shared tags > same artist > freshness. */
export function similarTo(rel: Release, all: Release[], limit = 5): Recommendation[] {
  const mine = new Set(rel.tags)
  const out: Recommendation[] = []
  for (const c of all) {
    if (c.type !== 'release' || c.id === rel.id) continue
    const shared = c.tags.filter((t) => mine.has(t))
    const sameArtist = c.artist === rel.artist ? 1.5 : 0
    // Freshness is a tiebreaker, never a qualifier: without a shared tag or
    // the same artist, a brand-new but unrelated release used to sneak into
    // "More like this" on a 0.001 score with an empty reason label.
    if (!shared.length && !sameArtist) continue
    const score = shared.length * 1.2 + sameArtist + freshness(c) * 0.3
    const reason = sameArtist ? `Also by ${c.artist}` : shared.length ? `#${shared[0]}` : ''
    out.push({ rel: c, score, reason })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
