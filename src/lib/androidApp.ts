// Android app distribution — single source of truth for the APK links.
// The GitHub Release asset `fontainor-android.apk` is re-attached on every
// release, so the `/releases/latest/download/` URL always serves the newest
// signed build without any site change.

export const RELEASES_PAGE = 'https://github.com/alistairfontaine/fontainor-protocol/releases/latest'
export const APK_URL = 'https://github.com/alistairfontaine/fontainor-protocol/releases/latest/download/fontainor-android.apk'

/** Static fallbacks shown until (or if) the live release lookup resolves.
 *  These must describe the latest release that actually EXISTS on GitHub —
 *  the download button serves `/releases/latest/`, so advertising an
 *  unpublished version here would promise a build the user cannot get. */
export const FALLBACK_VERSION = '4.2.0'
export const FALLBACK_SIZE_MB = 15

const DISMISS_KEY = 'fontainor_android_banner_dismissed_v1'

/** True in Android browsers only — never inside the native app's WebView. */
export function isAndroidBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  // The native app ships its own bundle and also exposes window.Capacitor;
  // both checks keep the promo out of the app itself.
  if ((window as unknown as Record<string, unknown>).Capacitor) return false
  return /android/i.test(navigator.userAgent)
}

export function isBannerDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return true
  }
}

export function dismissBanner(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode — banner just reappears next visit */
  }
}

export interface LatestRelease {
  version: string
  sizeMb: number | null
  publishedAt: string | null
}

/** Best-effort live lookup of the latest release (unauthenticated, cached). */
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch('https://api.github.com/repos/alistairfontaine/fontainor-protocol/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const d = (await res.json()) as {
      tag_name?: string
      published_at?: string
      assets?: Array<{ name?: string; size?: number }>
    }
    const apk = d.assets?.find((a) => a.name === 'fontainor-android.apk') ?? d.assets?.find((a) => a.name?.endsWith('.apk'))
    return {
      version: (d.tag_name ?? '').replace(/^v/, '') || FALLBACK_VERSION,
      sizeMb: apk?.size ? Math.round(apk.size / 1024 / 1024) : null,
      publishedAt: d.published_at ?? null,
    }
  } catch {
    return null
  }
}
