// Foreground-service downloads (Android).
//
// @capacitor/filesystem's downloadFile runs inside the app's process work: press
// Home while a 6 MB track is coming down a slow connection — exactly when a user
// switches away — and Android may freeze or kill it, so the download silently
// dies half-finished. The native DownloadService runs the transfer in a
// foreground service instead: visible progress notification, Cancel action, no
// background-execution limits.
//
// This module is the WebView half: a promise per download, driven by the
// service's events, plus real cancellation. It is feature-detected, so a shell
// without the plugin (older APK, iOS, web) keeps the previous behaviour.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface ServiceDownloadOptions {
  id: string
  url: string
  /** path relative to Directory.Data, e.g. `downloads/FONT-X.mp3` */
  path: string
  title?: string
}

export interface NetworkStatus {
  connected: boolean
  metered: boolean
}

interface FontainorDownloadsPlugin {
  download(options: ServiceDownloadOptions): Promise<void>
  cancel(options: { id?: string }): Promise<void>
  isMetered(): Promise<NetworkStatus>
  addListener(
    event: 'downloadProgress' | 'downloadComplete' | 'downloadFailed' | 'downloadCancelled',
    cb: (data: { id: string; bytes?: number; total?: number; path?: string; message?: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(event: 'networkStatusChanged', cb: (data: NetworkStatus) => void): Promise<PluginListenerHandle>
}

const Downloads = registerPlugin<FontainorDownloadsPlugin>('FontainorDownloads')

/** Sentinel: the user cancelled, which is not an error to report. */
export const DOWNLOAD_CANCELLED = 'FONTAINOR_DOWNLOAD_CANCELLED'

export function hasDownloadService(): boolean {
  try {
    return Capacitor.isPluginAvailable('FontainorDownloads')
  } catch {
    return false
  }
}

interface Pending {
  resolve: (bytes: number) => void
  reject: (err: Error) => void
  onProgress?: (bytes: number, total: number) => void
}

const pending = new Map<string, Pending>()
let armed = false

function settle(id: string, fn: (p: Pending) => void): void {
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  fn(p)
}

function arm(): void {
  if (armed || !hasDownloadService()) return
  armed = true
  void Downloads.addListener('downloadProgress', (d) => {
    pending.get(d.id)?.onProgress?.(d.bytes ?? 0, d.total ?? -1)
  })
  void Downloads.addListener('downloadComplete', (d) => {
    settle(d.id, (p) => p.resolve(d.bytes ?? 0))
  })
  void Downloads.addListener('downloadFailed', (d) => {
    settle(d.id, (p) => p.reject(new Error(d.message || 'The download failed.')))
  })
  void Downloads.addListener('downloadCancelled', (d) => {
    settle(d.id, (p) => p.reject(new Error(DOWNLOAD_CANCELLED)))
  })
}

/**
 * Download `url` to `path` in a foreground service.
 * Resolves with the byte count, rejects with `DOWNLOAD_CANCELLED` when the user
 * cancels (from the app or from the notification).
 */
export function serviceDownload(
  opts: ServiceDownloadOptions,
  onProgress?: (bytes: number, total: number) => void,
): Promise<number> {
  arm()
  // A second request for the same id would orphan the first promise.
  const existing = pending.get(opts.id)
  if (existing) return Promise.reject(new Error('This download is already running.'))
  return new Promise<number>((resolve, reject) => {
    pending.set(opts.id, { resolve, reject, onProgress })
    Downloads.download(opts).catch((e: unknown) => {
      settle(opts.id, (p) => p.reject(e instanceof Error ? e : new Error(String(e))))
    })
  })
}

/** Ask the service to stop a download (or all of them when id is omitted). */
export async function cancelServiceDownload(id?: string): Promise<void> {
  if (!hasDownloadService()) return
  try {
    await Downloads.cancel({ id })
  } catch {
    /* the service may already be gone — the pending promise still settles */
  }
}

export function isCancellation(e: unknown): boolean {
  return e instanceof Error && e.message === DOWNLOAD_CANCELLED
}

// ── network status (for Wi-Fi-only downloads) ──

/**
 * Is the active connection metered? Fails OPEN (not metered) when the shell
 * cannot answer — an old APK without the method must keep downloading exactly
 * as before, never silently queue forever.
 */
export async function isMeteredConnection(): Promise<boolean> {
  if (!hasDownloadService()) return false
  try {
    const st = await Downloads.isMetered()
    return !!st.connected && !!st.metered
  } catch {
    return false // method missing on an older shell — fail open
  }
}

/** Subscribe to connectivity changes. No-op (returns a no-op unsubscriber) without the plugin. */
export function onNetworkChange(cb: (st: NetworkStatus) => void): () => void {
  if (!hasDownloadService()) return () => {}
  let handle: PluginListenerHandle | null = null
  let dead = false
  void Downloads.addListener('networkStatusChanged', cb)
    .then((h) => {
      if (dead) void h.remove()
      else handle = h
    })
    .catch(() => {
      /* older shell without the event — the metered check still gates each start */
    })
  return () => {
    dead = true
    void handle?.remove()
  }
}
