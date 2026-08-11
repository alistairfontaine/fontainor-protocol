# Fontainor Mobile (Android / Capacitor)

The mobile app is the **same React/Vite web app** wrapped in a native Android
shell with [Capacitor](https://capacitorjs.com/). One codebase, no feature fork.
Wallet connectivity on native uses Phantom's encrypted deeplink protocol.

## Why Capacitor (not Flutter)

Fontainor is a mature React dApp whose publish/purchase/tip flows depend on
JS-only SDKs (`@irys/*`, `@solana/web3.js`, `arweave`, `bs58`, `tweetnacl`).
Capacitor reuses 100% of that. A Flutter rewrite would have to reimplement
musician-pays Irys/Arweave publishing in Dart (no equivalents) — so it was
rejected. The `lanlink`/`emberdelve` Flutter repos were used only as references
for the production Gradle setup (ABI splits, R8, keystore signing, universal APK).

## Phantom on native — how it works

Inside a WebView there is **no injected `window.solana`** (that only exists in
the Phantom in-app browser or the desktop extension). So on native we implement
[Phantom deeplinks](https://docs.phantom.com/phantom-deeplinks):

- `src/lib/phantomDeeplink.ts` — x25519 (tweetnacl) + bs58 encrypted session;
  `connect` / `signMessage` / `signAndSendTransaction` / `disconnect`.
- Responses bounce back to `fontainor://onphantom/<method>`, surfaced via
  `@capacitor/app`'s `appUrlOpen` and routed to the pending request.
- The session is persisted with `@capacitor/preferences` for warm reconnects.
- It is installed as `window.solana` **before React renders** (see
  `src/main.tsx` → `bootNativeWalletEarly()`), with the exact shape the app
  already consumes, so `AuthContext`, `purchase.ts`, `irysPublish.ts` and the
  Support tip jar work **unchanged**.

`src/lib/native.ts` adds status-bar theming, splash dismissal, the hardware
back button, and the `--safe-top` inset.

On native the API base points at the deployed origin (`src/lib/api.ts`,
overridable via `VITE_API_BASE`) because the WebView is served from
`https://localhost`. The deployed API sends `Access-Control-Allow-Origin: *`.

## Build

Prereqs: Node 18+, JDK 21, Android SDK (platform 36, build-tools 36), and a
release keystore referenced by `android/key.properties` (kept OUT of git).

```bash
npm ci
npm run build                     # produce dist/
node tools/strip-demo-audio.mjs   # demo MP3s stream from the site; don't ship ~10 MB in the APK
npx cap sync android              # copy web build + native plugins
cd android
./gradlew :app:assembleDebug      # dev/sideload (debug-signed)
./gradlew :app:assembleRelease    # signed + R8-shrunk universal APK
```

Outputs land in `android/app/build/outputs/apk/{debug,release}/` as
`app-release.apk` / `app-debug.apk` (no ABI splits — the shell has no native
libraries to split).

### Signing

`android/app/build.gradle` reads `android/key.properties`:

```
storeFile=/absolute/path/to/keystore.jks
storePassword=…
keyAlias=…
keyPassword=…
```

If the file is absent, release falls back to debug signing so the build still
produces an installable APK. The current keystore is a **sideload/dev** key —
a Google Play *upload* key (or Play App Signing) is a separate step.

## Downloads

Offline downloads run in a **foreground service** (`DownloadService`) with a
progress notification and real cancellation; the WebView half is
`src/lib/nativeDownloader.ts` (feature-detected, falls back to
`Filesystem.downloadFile` on older shells).

Download preferences live in the Library (native only):

- **Download over Wi-Fi only** — on a metered connection a requested download
  waits (visible "Waiting for Wi-Fi" state) and starts automatically when an
  unmetered network arrives (`DownloaderPlugin.isMetered()` +
  `networkStatusChanged` from a `registerDefaultNetworkCallback`). Tapping the
  waiting item downloads immediately anyway — the user outranks the setting.
- **Auto-download liked releases** — liking a release queues its download
  (only *new* likes; the existing backlog is never bulk-fetched). Respects the
  Wi-Fi-only gate. Un-liking never deletes a download.

A **Downloaded** filter chip appears in the Library once anything is
downloaded; it is index-first, so downloads missing from the loaded registry
still show up.

## Known limitation — Phantom domain warning

Phantom's in-app browser and connect screen flag `*.vercel.app` subdomains via
its community phishing blocklist. This is **Phantom-side** and cannot be patched
from the dApp. Fixes: (1) move to a custom domain and point the app at it via
`VITE_API_BASE` + `app_url`; (2) file a false-positive with Phantom's blocklist.
The native app already avoids the full-screen in-app-browser block because it
connects via deeplink rather than loading the site inside Phantom.

## Release checklist (GitHub Releases drives the /android page)

The site's `/android` page and its download button read
`releases/latest/download/fontainor-android.apk`, so cutting a release IS the
deployment:

1. Bump `versionName` / `versionCode` in `android/app/build.gradle`.
2. Build a **release-signed** APK (CI with the four `ANDROID_KEYSTORE_*`
   secrets, or locally with `android/key.properties`). A debug-signed APK
   cannot upgrade the release-signed installs users already have.
3. Create the GitHub release `vX.Y.Z` and attach the APK **twice**:
   `fontainor-X.Y.Z-release.apk` (archival name) and `fontainor-android.apk`
   (the stable name `/releases/latest/download/` serves).
4. Update `FALLBACK_VERSION` / `FALLBACK_SIZE_MB` in `src/lib/androidApp.ts`
   to match the release you just published — the fallback must only ever
   describe a build that actually exists.
