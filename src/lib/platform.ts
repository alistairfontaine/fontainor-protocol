// Platform detection, resolved once at module load (Capacitor answers
// synchronously). Import IS_NATIVE anywhere UI must diverge between the
// packaged Android app and the website — keep the divergences deliberate
// and listed in docs/design/MOBILE_V3_PLAN.md.
//
// `?native=1` forces native mode in a plain browser. This exists for the
// perf harness (scripts/perf-trace.mjs) and for debugging the app shell on
// desktop — real users never see it, and Capacitor ignores it.
import { Capacitor } from '@capacitor/core'

const forcedNative = (() => {
  try {
    return new URLSearchParams(location.search).get('native') === '1'
  } catch {
    return false
  }
})()

export const IS_NATIVE = Capacitor.isNativePlatform() || forcedNative
