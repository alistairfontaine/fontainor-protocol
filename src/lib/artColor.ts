// Dominant-color extraction from cover art (Spotify's "living color" player).
// Downscale the cover into a tiny canvas, average pixels weighted by
// saturation (so a colorful sleeve beats its white border), then clamp the
// result into a band that reads well behind light text on our dark UI.
//
// Failure is always graceful: missing cover, CORS-tainted canvas, decode
// errors → null, and callers fall back to the brand amber. Results are
// memoized per release id for the session.

import { useEffect, useState } from 'react'
import type { Release } from './registry'

export type RGB = [number, number, number]

/** Brand amber — the fallback tint (matches --color-accent). */
export const BRAND_TINT: RGB = [247, 183, 51]

const cache = new Map<string, RGB | null>()
const SAMPLE = 24 // canvas edge; 576 px is plenty for a tint

function clampTone([r, g, b]: RGB): RGB {
  // Perceived luminance; steer into 0.35–0.62 so the gradient neither
  // disappears into the bg nor blows out under white text.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  let f = 1
  if (lum < 0.35) f = 0.35 / Math.max(lum, 0.05)
  else if (lum > 0.62) f = 0.62 / lum
  return [Math.min(255, Math.round(r * f)), Math.min(255, Math.round(g * f)), Math.min(255, Math.round(b * f))]
}

export async function dominantColor(rel: Release): Promise<RGB | null> {
  if (!rel.coverUrl) return null
  const hit = cache.get(rel.id)
  if (hit !== undefined) return hit

  const out = await new Promise<RGB | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const done = (v: RGB | null) => resolve(v)
    img.onerror = () => done(null)
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = SAMPLE
        c.height = SAMPLE
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return done(null)
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
        const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE) // throws if tainted
        let r = 0
        let g = 0
        let b = 0
        let wsum = 0
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb, pa] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
          if (pa < 128) continue
          const mx = Math.max(pr, pg, pb)
          const mn = Math.min(pr, pg, pb)
          // saturation-weighted (+small floor so grayscale art still averages)
          const w = (mx - mn) / 255 + 0.05
          r += pr * w
          g += pg * w
          b += pb * w
          wsum += w
        }
        if (!wsum) return done(null)
        done(clampTone([r / wsum, g / wsum, b / wsum] as RGB))
      } catch {
        done(null) // CORS-tainted canvas or decode failure
      }
    }
    img.src = rel.coverUrl!
  })

  cache.set(rel.id, out)
  return out
}

/** React hook: tint for the current release (brand amber until resolved). */
export function useArtTint(rel: Release | null): RGB {
  const [tint, setTint] = useState<RGB>(BRAND_TINT)
  useEffect(() => {
    let alive = true
    if (!rel) {
      setTint(BRAND_TINT)
      return
    }
    void dominantColor(rel).then((c) => {
      if (alive) setTint(c ?? BRAND_TINT)
    })
    return () => {
      alive = false
    }
  }, [rel?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return tint
}
