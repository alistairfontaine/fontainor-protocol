// Play counter for the gentle support nudge (launch plan §4).
// WinRAR posture: a small dismissible line after the listener's Nth play —
// never a modal, never blocking playback, quiet for a long stretch after
// each dismissal. State in localStorage; all reads/writes are best-effort.
import { NUDGE_AFTER_PLAYS, NUDGE_COOLDOWN_PLAYS } from '../config/support'

const PLAYS_KEY = 'fontainor_support_plays'
const DISMISSED_AT_KEY = 'fontainor_support_nudge_dismissed_at'

function readInt(key: string): number {
  try {
    const n = parseInt(localStorage.getItem(key) ?? '0', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Call once per play start. Returns the new total. */
export function recordPlay(): number {
  const n = readInt(PLAYS_KEY) + 1
  try {
    localStorage.setItem(PLAYS_KEY, String(n))
  } catch {
    /* private mode etc. — nudge simply never shows */
  }
  return n
}

export function shouldShowNudge(): boolean {
  const plays = readInt(PLAYS_KEY)
  if (plays < NUDGE_AFTER_PLAYS) return false
  const dismissedAt = readInt(DISMISSED_AT_KEY)
  if (dismissedAt === 0) return true
  return plays - dismissedAt >= NUDGE_COOLDOWN_PLAYS
}

export function dismissNudge(): void {
  try {
    localStorage.setItem(DISMISSED_AT_KEY, String(readInt(PLAYS_KEY)))
  } catch {
    /* best-effort */
  }
}
