# Fontainor Mobile v3 — "Its Own App" (plan of record, 2026-07-28)

Owner directive (DM): the APK must stop being "the website in a box". It must
feel like a first-class Android music app — silky smooth, branded, habit-forming
— competitive with (and in places better than) Spotify. Zero budget; reliability
over paid services.

## Diagnosis (evidence-based)

1. **Stale APK in the field.** The icon complaint ("default icon") is fixed at
   repo HEAD — `android/.../mipmap-*/ic_launcher*` is the branded yellow-F
   adaptive icon (visually VERIFIED). The user is holding a v1 build. v3 ships a
   fresh signed APK.
2. **Web chrome ships into the app.** Native build renders the web sticky
   header (logo + search + wallet), a marketing footer on every page, and
   desktop-style vertical grids. Real music apps have per-screen headers, no
   footer, horizontal rails, and a shortcut grid.
3. **Jank sources.** `backdrop-blur` on four always-on surfaces (header, bottom
   nav, mini player, queue popover) — the #1 WebView compositor cost (capgo/
   Ionic guidance: avoid blur + shadows in scrolling/fixed chrome on Android).
   Also: un-memoized `ReleaseCard` re-renders under the 250ms player tick.
4. **Flat, static Now Playing.** Fixed amber wash vs Spotify's artwork-derived
   color. No swipe-to-skip, no haptics, no sleep timer.

## Research inputs

- Habit psychology (Skinner variable reward, endowment effect, routine
  anchoring — shahzebspeaks audit, pmrepo, design-bootcamp): personalization
  rails ("Made for you", trending, new-from-followed — already built), streak
  and recap moments, greeting/time-of-day framing, instant feedback (haptics,
  motion), zero dead ends.
- Spotify UI conventions: 3-tab bottom nav, 2×3 shortcut grid on Home, mini
  player card, artwork-color gradient, queue as sheet, hairline progress.
- Capacitor/WebView perf: transform/opacity-only animation, no backdrop-filter
  in fixed chrome, GPU-composited drags (already done for sheets), memoized
  list rows, passive listeners, hardware acceleration on.
- Android media UX: MediaSession lock-screen/notification controls (already
  native via @capgo/capacitor-media-session), themed adaptive icon (done),
  sleep timer as a top-requested player feature.

## Targets checklist (definition of done; small commits, one per target)

- [ ] **T1 Native shell** — `isNativeApp()` const; on native: web header hidden
      (per-page contextual headers instead), footer hidden, all
      `backdrop-blur` disabled via `.is-native` CSS (solid surfaces), bottom
      nav stays. Web build byte-identical behavior. CI green.
- [ ] **T2 Native Home** — time-of-day greeting header, Spotify-style 2×3
      shortcut grid (resume + favorites + playlists entry points), horizontal
      snap rails for Trending/Made-for-you/New-from-followed on native.
- [ ] **T3 Living color player** — dominant color extracted from cover art
      (downscaled canvas, cached per release id), Now Playing gradient +
      mini-player tint follow the artwork. Graceful fallback to brand amber.
- [ ] **T4 Gestures + haptics** — swipe artwork left/right to skip (GPU drag,
      spring settle), @capacitor/haptics ticks on play/pause/skip/fav/queue.
      No-ops on web.
- [ ] **T5 Sleep timer** — 5/15/30/45/60 min + end-of-track; pauses playback,
      survives screen-off (JS timer + position check), visible countdown in
      Now Playing. A feature Spotify gates well; ours is free.
- [ ] **T6 Render perf** — memo(ReleaseCard), player-tick isolation audit,
      `content-visibility: auto` on below-fold rails; bundle check (Irys/Solana
      publish path lazy?) with evidence from build output.
- [ ] **T7 Signed release APK** — keystore from owner (outside repo),
      `keytool -list -v` SHA-256 == provided fingerprint (VERIFIED gate),
      `assembleRelease` + `apksigner verify`, `aapt2` badging shows branded
      icon/label/versionCode 3. APK delivered in DM.
- [ ] **T8 State + push** — progress.md, features.json (F43–F47), this plan
      committed; branch `mobile-v1` pushed.

## Non-goals today

Offline downloads/cache encryption, Android Auto, widgets, ANR telemetry —
listed in ROADMAP order for next session. Real-device smoke tests impossible in
sandbox: labeled ASSUMED, checklist provided to owner.
