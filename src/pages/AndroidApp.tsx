// Fontainor for Android — download + install instructions (/#/android).
// The APK is distributed from GitHub Releases; APK_URL always points at the
// newest signed build (stable asset name on /releases/latest/download/).
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, PageHead } from '../components/ui'
import {
  APK_URL,
  RELEASES_PAGE,
  FALLBACK_VERSION,
  FALLBACK_SIZE_MB,
  fetchLatestRelease,
  isAndroidBrowser,
} from '../lib/androidApp'

function Feature({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-raised p-5">
      <h3 className="font-display text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{children}</p>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[13px] font-semibold text-accent ring-1 ring-accent/40">
        {n}
      </span>
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  )
}

export function AndroidApp() {
  const [version, setVersion] = useState(FALLBACK_VERSION)
  const [sizeMb, setSizeMb] = useState<number | null>(FALLBACK_SIZE_MB)
  const onAndroid = isAndroidBrowser()

  useEffect(() => {
    let alive = true
    fetchLatestRelease().then((r) => {
      if (!alive || !r) return
      setVersion(r.version)
      if (r.sizeMb) setSizeMb(r.sizeMb)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead
        title="Fontainor for Android"
        sub="The registry as a real app — background playback, offline downloads, and one-tap wallet connect."
      />

      {/* Download */}
      <div className="rounded-card border border-line bg-raised p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[15px] font-semibold text-ink">
              {onAndroid ? 'You are on Android — this build is for your phone.' : 'Signed APK, direct download.'}
            </p>
            <p className="mt-1 text-[13px] text-muted">
              Version {version} · about {sizeMb ?? FALLBACK_SIZE_MB} MB · Android 8.0 or newer · free
            </p>
          </div>
          <a href={APK_URL} rel="noopener noreferrer">
            <Button variant="primary" size="lg">Download the app</Button>
          </a>
        </div>
        <p className="mt-4 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
          Every build is compiled from the public source and signed with the Fontainor release key. You can inspect the
          code and grab any version from the{' '}
          <a href={RELEASES_PAGE} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
            releases page on GitHub
          </a>
          .
        </p>
      </div>

      {/* Why the app */}
      <section className="mt-10">
        <h2 className="mb-4 font-display text-[19px] font-semibold text-ink">Why the app beats the browser tab</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Feature title="One-tap wallet connect">
            Connects through Android's own wallet sheet (Mobile Wallet Adapter) — works with Phantom, Solflare,
            Backpack and any installed wallet. No browser extension needed.
          </Feature>
          <Feature title="A real player">
            Lock-screen and notification controls, playback that keeps going with the screen off, crossfade, sleep
            timer, repeat modes and drag-to-seek.
          </Feature>
          <Feature title="Offline downloads">
            Save releases to your phone and listen without a connection — your collection travels with you.
          </Feature>
          <Feature title="Faster and quieter">
            No address bar, no tab eviction, no extension warnings — just the registry, full screen.
          </Feature>
        </div>
      </section>

      {/* Install steps */}
      <section className="mt-10">
        <h2 className="mb-4 font-display text-[19px] font-semibold text-ink">How to install</h2>
        <ol className="space-y-5">
          <Step n={1} title="Download the APK">
            Tap <strong className="text-ink">Download the app</strong> above. Your browser may warn that APKs "can harm
            your device" — that is Android's standard notice for any app installed outside the Play Store. Keep the
            file.
          </Step>
          <Step n={2} title="Open the downloaded file">
            Pull down the notification shade and tap the finished download, or open it from your{' '}
            <strong className="text-ink">Files</strong> app (Downloads folder).
          </Step>
          <Step n={3} title="Allow installs from this source">
            The first time, Android asks to allow your browser to install apps: tap{' '}
            <strong className="text-ink">Settings → Allow from this source</strong>, then go back. This is a one-time
            switch you can turn off afterwards.
          </Step>
          <Step n={4} title="Install and open">
            Tap <strong className="text-ink">Install</strong>. If Play Protect asks for a scan, let it run — the app
            passes. Open Fontainor, connect your wallet, and everything you own on the web is already there.
          </Step>
        </ol>
      </section>

      {/* Fine print */}
      <section className="mt-10 border-t border-line pt-8">
        <h2 className="mb-2.5 font-display text-[19px] font-semibold text-ink">Good to know</h2>
        <ul className="list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-muted">
          <li>
            <strong className="text-ink">Updates install over the old version</strong> — download the new APK and open
            it; your library, playlists and session are kept. No need to uninstall.
          </li>
          <li>
            <strong className="text-ink">Same account, no extra sign-up</strong> — your wallet is your identity, on the
            web and in the app.
          </li>
          <li>
            <strong className="text-ink">Not on the Play Store yet</strong> — direct distribution keeps releases
            instant and unfiltered. The APK is served from GitHub over HTTPS.
          </li>
          <li>
            Trouble installing? Ask on{' '}
            <a
              href="https://discord.gg/ARezqHYS23"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
              Discord
            </a>{' '}
            or use the <Link to="/contact" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">contact page</Link>.
          </li>
        </ul>
      </section>
    </div>
  )
}
