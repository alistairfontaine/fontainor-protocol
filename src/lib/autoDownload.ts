// Auto-download on like (native, opt-in) — Metrolist-style.
//
// With the setting on, liking a release queues its download immediately, so
// the library a user curates is the library that works offline. Only NEW
// likes trigger a download: the existing favorites backlog is not bulk-fetched
// when the setting is switched on (that could be hundreds of MB on mobile
// data — the user can download the backlog explicitly).
import { useEffect } from 'react'
import { subscribeFavorites, getFavoriteIds } from '../state/collections'
import { getSetting } from '../state/settings'
import { downloadRelease, isDownloaded } from './downloads'
import { IS_NATIVE } from './platform'
import type { Release } from './registry'

/** Mount once (App). Watches favorites and downloads newly-liked releases. */
export function useAutoDownloadLikes(releases: Release[]): void {
  useEffect(() => {
    if (!IS_NATIVE) return
    let prev = new Set(getFavoriteIds())
    return subscribeFavorites(() => {
      const cur = getFavoriteIds()
      const added = cur.filter((id) => !prev.has(id))
      prev = new Set(cur)
      if (!getSetting('autoDownloadLikes')) return
      for (const id of added) {
        if (isDownloaded(id)) continue
        const rel = releases.find((r) => r.id === id)
        // Respects the Wi-Fi-only gate: on metered this lands in the waiting
        // queue, not on the modem.
        if (rel?.audio) void downloadRelease(rel)
      }
    })
  }, [releases])
}
