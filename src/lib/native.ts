// Native (Capacitor) app bootstrap — status bar, splash, hardware back button,
// safe-area insets, and the Phantom deeplink provider. Every call is guarded so
// importing this module on the web is a no-op; only the packaged Android app
// runs the native paths.
import { Capacitor } from '@capacitor/core'
import { installNativePhantom } from './phantomDeeplink'

/**
 * Install `window.solana` (Phantom deeplink shim) BEFORE React renders, so
 * AuthContext sees a wallet on first paint. Returns true when native.
 */
export function bootNativeWalletEarly(): boolean {
  return installNativePhantom()
}

/** Post-render native setup: status bar, splash dismissal, back button. */
export async function setupNativeChrome(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  // Expose a --safe-top for the sticky header so it clears the status bar on
  // edge-to-edge devices (mirrors the existing --safe-bottom).
  const root = document.documentElement
  root.style.setProperty('--safe-top', 'env(safe-area-inset-top, 0px)')
  root.classList.add('is-native')

  // Status bar: dark chrome to match the app background, content below it.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0b0d12' })
      await StatusBar.setOverlaysWebView({ overlay: false })
    }
  } catch {
    /* plugin absent — non-fatal */
  }

  // Dismiss the splash once the JS bundle is live.
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    /* non-fatal */
  }

  // Hardware back button: navigate back through the SPA history, exit at root.
  try {
    const { App } = await import('@capacitor/app')
    await App.addListener('backButton', ({ canGoBack }) => {
      const atRoot = window.location.hash === '' || window.location.hash === '#/' || window.location.hash === '#'
      if (canGoBack && !atRoot) {
        window.history.back()
      } else {
        void App.exitApp()
      }
    })
  } catch {
    /* non-fatal */
  }
}
