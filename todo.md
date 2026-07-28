# v4 pass — "lock in" (evidence-first)

- [ ] T0 Perf harness: Playwright+CDP frame tracing on built dist, mobile viewport, 4x CPU throttle; BASELINE numbers for Home scroll, Library scroll, NowPlaying open/close, playing+scroll
- [ ] T1 Fix media notification cover art: base64 artwork pipeline (canvas 512px JPEG, cached) + absolute API_BASE fallback — plugin Java can't reach https://localhost
- [ ] T2 Perf fixes driven by T0 measurements (sized images, decoding hints, whatever tracing shows)
- [ ] T3 Animation pass: screen-enter transitions, card press feedback, NowPlaying spring, stagger — transform/opacity only; re-measure
- [ ] T4 Crossfade (2-6s, dual-element gain ramp) + next-track preload
- [ ] T5 Offline downloads: @capacitor/filesystem save audio+cover, index in localStorage, play local when present, Library "Downloads" UI
- [ ] T6 AFTER measurements + screen screenshots (proof pack)
- [ ] T7 features.json F55+, progress.md, plan doc
- [ ] T8 v4.0.0 signed build (verify keystore fp first), apksigner+aapt2 verify, upload APK + evidence to thread 1785227619.276999

Scope note: home-screen widget + Android Auto = native-shell milestones, folded into committed Flutter port (M3/M5) — report honestly.
