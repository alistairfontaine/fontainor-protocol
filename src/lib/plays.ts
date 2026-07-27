// Anonymous play counts (F32): fire-and-forget POST on each play, plus the
// weekly top list that powers the Trending rail. Everything degrades to
// silence — play counting must never affect playback.
import { API_BASE } from './api'

export interface TopPlay {
  id: string
  plays: number
}

export function postPlay(id: string): void {
  try {
    void fetch(API_BASE + '/api/v1/plays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* never interfere with playback */
  }
}

export async function fetchTopPlays(window: 'week' | 'all' = 'week', n = 12): Promise<TopPlay[]> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/plays/top?window=${window}&n=${n}`, { cache: 'no-store' })
    if (!res.ok) return []
    const d = (await res.json()) as { top?: TopPlay[] }
    return Array.isArray(d.top) ? d.top.filter((t) => t && typeof t.id === 'string' && t.plays > 0) : []
  } catch {
    return []
  }
}
