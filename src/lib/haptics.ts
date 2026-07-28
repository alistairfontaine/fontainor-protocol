// Haptic feedback for the packaged app — the tactile half of "silky".
// Fire-and-forget, throttled, and a guaranteed no-op on the web build:
// the plugin is only imported on a native platform, and every call
// swallows failures (haptics must never break playback).

import { Capacitor } from '@capacitor/core'

type HapticsModule = typeof import('@capacitor/haptics')

let mod: HapticsModule | null = null
if (Capacitor.isNativePlatform()) {
  void import('@capacitor/haptics').then((m) => {
    mod = m
  })
}

let last = 0
function throttled(run: (m: HapticsModule) => Promise<unknown>): void {
  const now = Date.now()
  if (!mod || now - last < 40) return // collapse accidental double-fires
  last = now
  void run(mod).catch(() => {})
}

/** Light tick — favorites, queue-adds, toggles, selection changes. */
export function hapticTick(): void {
  throttled((m) => m.Haptics.impact({ style: m.ImpactStyle.Light }))
}

/** Medium thump — play/pause and track changes (the "transport" weight). */
export function hapticThump(): void {
  throttled((m) => m.Haptics.impact({ style: m.ImpactStyle.Medium }))
}
