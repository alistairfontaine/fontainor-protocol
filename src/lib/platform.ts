// Platform detection, resolved once at module load (Capacitor answers
// synchronously). Import IS_NATIVE anywhere UI must diverge between the
// packaged Android app and the website — keep the divergences deliberate
// and listed in docs/design/MOBILE_V3_PLAN.md.
import { Capacitor } from '@capacitor/core'

export const IS_NATIVE = Capacitor.isNativePlatform()
