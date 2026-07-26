# progress.md — append-only

## 2026-07-26 — iteration 0 (setup)
- Forked alistairfontaine/fontainor-protocol -> tapiwamakandigona/fontainor-protocol (VERIFIED via GitHub API response).
- Created branch `frontend-v2`; harness v3.0.1 files added (PROJECT.md, features.json, AGENTS.md, progress.md, loop.sh from subagent-toolkit@v3.0.1).
- Analysis findings that drive scope:
  - Live /registry returns [] (VERIFIED via fetch). Root cause: api/index.js resolves registry via manifest pointer in `pointer.json` next to the function — Vercel lambda FS is ephemeral/read-only, so writeManifestPointer() never persists; and `uploadManifest` is a stub returning "Serverless gateway mode active" in serverless mode. REGISTRY_MANIFEST env var is the only durable path today.
  - Old frontend: search input has no handler; favorites/history in-memory only; 2 media queries total (no real mobile support).
  - Repo pollution: dist/, .swo, validator logs, test-ledger committed.
- Next: F1 scaffold (TS + Tailwind + CI gate).

## 2026-07-26 — iteration 1 (F1: scaffold + CI gate)
- Removed old src/ (jsx), committed dist/, .swo, validator logs from git index; extended .gitignore.
- Added TypeScript 5.6, Tailwind v4 (@tailwindcss/vite), react-router-dom, @types/*.
- New configs: tsconfig (strict, noEmit), vite.config.ts (react+tailwind plugins, dev proxy for /registry+/manifest to prod API), index.html (Space Grotesk + Inter).
- Ported data layer to TS: src/lib/registry.ts (locked schema types, normalize, tolerant parse, buildAsset, formatters, generative rosette cover recolored to dark tokens), src/lib/api.ts (loadRegistry fallback chain, publishManifest incl. mock modes, chunked audio upload).
- Design tokens in src/styles/index.css (@theme): dark "permanent archive" palette, amber accent, radius ladder, spacing per uxpeak LAYOUT-01/02, type per TYPE-01/02.
- VERIFIED: npm run ci green. F1 flipped with evidence.

## 2026-07-26 — iterations 2-4 (F2-F7, F10)
- Built: icons.tsx (single stroke family), ui.tsx (Button/Chip/Badge/EmptyState/Banner/PageHead/skeletons), AppShell (top bar + desktop sidebar + 5-tab mobile bottom nav w/ raised Publish CTA), PlayerBar, Cover (generative rosette fallback), ReleaseCard/Grid, pages: Home, Library (virtualized ≥60 items, live search/sort/filter), Editorial list+article, ReleaseDetail, Publish (2 modes, chunk upload or TX paste, mock modes), Profile, Favorites/History; AuthContext (Phantom sovereign login ported 1:1), collections stores (localStorage, useSyncExternalStore).
- Seeded public/registry.json with 13 demo assets (10 releases + 3 editorial).
- VERIFIED via local headless chromium (remote Browserbase cannot reach sandbox localhost; PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright): screenshots desktop+mobile, play/pause/seek, search filter, favorites persistence. F2-F7+F10 flipped with evidence.
- Preview page published (workspace-gated): https://minokitoka-927881.viktor.page/fontainor-v06-preview (self-contained dist inline + fetch shim serving seed).
- BLOCKER (reported to user): upstream push to alistairfontaine/fontainor-protocol returns 403 despite GitHub API showing push:true — the stored fine-grained PAT only covers repos owned by tapiwamakandigona. Need classic PAT (repo scope) or upstream-issued token. Branch v06-development pushed to the FORK meanwhile.
- Remaining: F8 (needs human Phantom test), F9 (gated behind login → same), F11 durable registry+seed on real API, F12 hygiene (partially done: dist/logs/swap removed; README fix pending), F13 Vercel deploy (needs user's Vercel import or token).

## 2026-07-26 — iterations 5-7 (upstream push, F14 demo media, F15 recommendations, F16 supporting pages)
- Upstream unblocked: classic PAT stored; `v06-development` + `frontend-v2` pushed to alistairfontaine/fontainor-protocol (VERIFIED: new-branch output).
- F14: 10 CC0/PD tracks from archive.org (Scrap Heap, mindcrack beatpack, Anchore State, Calm Pills) trimmed to 90s/96kbps with fades (~1MB each), credits in public/audio/CREDITS.md; 10 AI covers + 3 editorial heroes (gemini-flash-image) in public/covers; wired via audioUri/coverUri; editorial bodies expanded to full articles; tags enriched for rec overlap.
- F15: src/lib/recommend.ts (profile from favorites w=3 + recency-decayed history; tag+artist*1.25+freshness scoring; reasons). Home "Made for you" rail + ReleaseDetail "More like this"; ReleaseCard note prop.
- F16: src/pages/Static.tsx (About/Terms/Privacy/Contact/FAQ/404), Footer in AppShell. HashRouter + existing vercel.json SPA rewrite = free-tier safe, no server code added.
- UX fixes: empty live /registry now falls through to bundled snapshot (fresh Vercel deploys look full, not empty); removed demo-revealing snapshot banner; editorial cards/articles show hero imagery.
- Verification: local headless chromium against `python http.server` on dist (NOTE: vite preview + nohup inside tool-wrapped bash dies with the job; use setsid + system python; stale servers on old ports can serve stale dist — always curl-verify registry.json first).

## Iteration — persistent player queue + prev/next (F17)
- User feedback: music stops on navigation on the OLD live site (fontainor-protocol.vercel.app = original frontend, full-page-reload MPA). New v06 SPA already persists player across routes (VERIFIED: headless click-through, 0 page loads, player bar alive on /library /editorial /faq /).
- Added queue-based prev/next to PlayerContext (registry-order queue, wrap-around; prev restarts track past 3s like Spotify) + auto-advance on track end (real audio 'ended' + simulated path).
- PlayerBar: prev/next buttons flanking play/pause; new IconPrev/IconNext.
- VERIFIED: npm run ci green; headless: play→next→next→prev switches tracks (Genesis→Night Bus→Solder→Night Bus); seek-to-end auto-advances (Genesis→Night Bus, still playing); nav across 4 routes: 0 reloads, bar persists.
- Gotcha: python http.server lacks Range support → audio seek resets to 0 locally; use /tmp/rangeserver.py for dist verification.

## Iteration — performance pass (F18)
- Route code splitting via React.lazy (Home kept in main chunk); Suspense spinner fallback.
- vite manualChunks vendor (react/react-dom/router) → long-term cacheable 179KB chunk; main JS 267KB→46KB.
- Images: loading=lazy + decoding=async everywhere; article hero fetchPriority=high; covers recompressed q72 (828→612KB), editorial heroes ≤900w.
- vercel.json: Cache-Control immutable for /assets, 7d+SWR for /covers & /audio.
- SINGLE_FILE=1 env in vite.config.ts → inlineDynamicImports build for self-contained previews (dist-preview/, gitignored? no — left untracked).
- Preview republished same URL (fontainor-v06-preview), verified: data-URI covers render, player queue works, 0 reloads.

## Iteration — F13 production deploy DONE
- Re-auth to Vercel via GitHub OAuth (GitHub Mobile 2FA approved by user, number 16).
- Vercel production env tracked `main`; changed Branch Tracking to v06-development in project settings; empty commit 6a11d52 triggered production deploy.
- PRODUCTION URL: https://fontainor-protocol-two.vercel.app
- VERIFIED live: split bundles served, cache headers active (assets immutable, covers/audio 7d+SWR), audio Range 206, headless click-through = play/next/persist/0 reloads, first load ~1s.
- Note: fontainor-protocol.vercel.app (user's original link) is the OLD upstream project — the "reload on every click" complaint was about that MPA. New SPA has no reloads.

## Follow-up — "still reloading" report (2026-07-26 19:02)
- Re-verified live with marker test (window.__marker survives client-side nav only): all 8 internal links on fontainor-protocol-two.vercel.app keep marker alive = zero full reloads. VERIFIED.
- Old upstream fontainor-protocol.vercel.app confirmed visually distinct (light theme/blue buttons, login/signup) — user almost certainly still opening old URL (history/autocomplete). Sent side-by-side screenshots + "dark = new, white = old" check to DM thread 1785092558.

## Iteration — black screen fix (F20) + expanded player (F19)
- Black screen on /#/release/... : could NOT repro on live with fresh browser (renders fine, no console errors). Root cause: user's tab predated one of today's 3 redeploys; release route became lazy in perf pass -> old chunk URLs 404 -> dynamic import fails -> dead screen until manual reload. Fix: window 'vite:preloadError' -> one guarded auto-reload; ErrorBoundary around routes (auto-reload on chunk errors, styled ":(" screen + reload button otherwise).
- Expanded player: PlayerContext gains shuffle state + shuffled order (Fisher-Yates, current pinned first, appends new releases) + upNext(8); queue panel in PlayerBar (Now Playing, clickable Up Next, shuffle/in-order indicator); shuffle buttons desktop+mobile; panel closes with player.
- VERIFIED headless: see features.json F19/F20 evidence.

## Iteration — "favorites still broken" follow-up
- Fresh-profile REAL click Home->Favorites on live -two: works, 0 errors (desktop). His tab runs a pre-fix build -> still black-screens until one manual refresh; fix can't retro-apply to already-loaded tabs.
- Stale-tab simulation (load app, rename lazy chunks = redeploy, click Favorites) exposed reload LOOP in my guard (sessionStorage flag cleared on every load -> 194 reloads). Fixed: timestamp guard, max one auto-reload per 15s (main.tsx + ErrorBoundary). Re-sim: exactly 1 reload, RECOVERED OK.
- Note: mobile bottom nav has no Favorites tab (Home/Library/Publish/Editorial/Profile) - sidebar only on lg+. Potential UX gap if he browses on phone.

## Iteration — Chrome black-screen-on-nav fix (network-independent routing)
- User report: fresh Chrome (even incognito) shows black page on every nav until manual reload; Firefox-over-Tor flawless. NOT stale-tab (live bundle already had F20 fix; fresh incognito affected). Could not repro from sandbox (all 8 routes clean, 0 console errors, 0 failed requests) → his network path degrades click-time chunk fetches (QUIC/flaky ISP pattern; Tor forces TCP via different route, hence "works on Tor").
- Fix (src/App.tsx): (1) shared routeLoaders map + useWarmRouteChunks — prefetch ALL route chunks after first paint via requestIdleCallback, retry w/ exponential backoff (2s→120s cap) until cached → in-app nav never touches the network; (2) RouteFallback now shows "connection seems slow" + Reload button after 6s instead of a bare spinner on dark bg.
- VERIFIED: npm run ci green; headless sim A (load OK, then ALL /assets requests aborted → click Library/Editorial/Favorites/History) = every page renders from warmed cache, PASS; sim B (chunk blocked from start → click) = styled ":(" screen + reload button, no silent black page, PASS.

## Iteration — kill code splitting entirely (black screen root fix)
- User report (2026-07-26 19:50): STILL black page on every nav (home, /#/library, release pages) in latest Chrome, hard-refresh AND incognito, until manual reload. Screenshot shows fully black page — no app shell, no spinner → the app never booted on that load, not a Suspense fallback.
- Sandbox repro: live -two site 100% clean again (all 9 routes render via hash nav, 0 console errors, 0 failed requests, 0 reloads). His failure chain: click-time/warm-time chunk fetch stalls or fails on his network → vite:preloadError → guarded auto-reload → the reload itself stalls mid-boot on the same bad connection → fully black page until a manual reload lands on a good connection. The recovery mechanism amplified the flakiness into black screens.
- Fix (src/App.tsx): removed ALL route-level lazy() — every page is statically imported into the main bundle. Route chunks totaled only ~46 KB min; bundle now index 93.95 KB (28.4 KB gz) + vendor 179 KB (59 KB gz), one-time cost ≈ +12 KB gz on first load. After first paint, navigation can NEVER touch the network. Removed useWarmRouteChunks, RouteFallback, Suspense. Kept ErrorBoundary (styled error screen) and vite:preloadError guard in main.tsx (inert now, safety if splitting ever returns).
- VERIFIED: npm run ci green; dist served locally, headless sim: load app → abort ALL network → navigate 9 routes (library, editorial, favorites, history, publish, about, faq, home, release/FONT-4WHPZ2Q17) = every route renders full content, window.__marker survives (0 reloads), 0 page errors. "ALL ROUTES RENDER WITH DEAD NETWORK, NO RELOADS".

## Iteration — render-resilience hardening (defense-in-depth for machine-side black screens)
- Full-res re-read of user's 2nd screenshot: BOTH screenshots are fontainor-protocol-two.vercel.app (earlier "old domain" reading was a downscaled-image misread). Pixel-sampled both: uniform #0b0d12 = exactly --color-bg → body paints, nothing else does. With code-splitting gone, remaining suspects are machine-side (GPU compositing / frozen animations) or an uncaught error unmounting the React tree.
- Hardening 1 (index.css): fade-up keyframes no longer animate opacity (transform only). A paused/stalled CSS animation applies its FIRST keyframe regardless of fill-mode (verified empirically) — previously `from { opacity:0 }` left Home/Library/Release/etc. invisible over the dark bg if the compositor froze (broken GPU, energy-saver throttling). Do not add opacity back.
- Hardening 2 (main.tsx): root-level ErrorBoundary around <App> — inner boundary only wraps <Routes>, so an uncaught error in AppShell/PlayerBar/providers previously unmounted the ENTIRE tree (React 18) → bare #0b0d12 body, silent. Plus a last-resort window error/unhandledrejection handler that injects an inline-styled "Something went wrong + Reload" screen if #root ever ends up empty.
- VERIFIED: npm run ci green; frozen-animation sim (all animations paused before boot, nav to library/release/editorial/faq) = opacity 1 + full text on every route (previously opacity 0 on library/release); empty-root sim = last-resort screen renders.

## 2026-07-26 — Iteration: automatic error recovery + diagnosable crashes (RESILIENCE-01)
User still hit the error screen on his Chrome after bf3ce21 — good news: something IS throwing on his machine (boundary catches it; reload recovers). Code audit found no unguarded throw (localStorage parses, player, registry all defensive), so the fix is a recovery ladder + real diagnostics instead of a click-to-reload dead end:
- `src/lib/errlog.ts` (new): every uncaught error recorded to localStorage (`fontainor:errlog`, last 10, inspect via `window.__fontainorErrors()`), with route/source/stack/UA.
- `ErrorBoundary`: recovery ladder — (1) silent re-render retry after 150ms; (2) if it re-throws within 10s, ONE automatic reload (15s guard, shared with chunk-reload key); (3) only then the error screen, now with copyable error details; (4) hashchange resets the boundary so other pages stay reachable.
- `main.tsx` last-resort path: same ladder (record → guarded auto-reload → detailed screen with stack).
- `vite.config.ts`: prod sourcemaps ON so user-reported minified stacks are decodable.
VERIFIED (headless Chromium against built dist): transient render error → silent recovery, 0 reloads, content renders, 1 errlog entry; persistent render error → exactly 1 auto-reload then detailed screen with stack + working Copy button (no reload loop); window-level crash with emptied #root and spent guard → detailed last-resort screen. `npm run ci` green.
Next: when the user hits it again, the screen/errlog gives the exact throw site → root-cause fix.

## 2026-07-26 — Iteration: ROOT CAUSE FOUND + FIXED — "TypeError: n is not a function" on nav (user's Chrome crashes)
User's errlog screen finally delivered a decodable stack (route #/library, boundary). Decoded with prod sourcemaps (local `npm run build` reproduces deployed hashes bit-exact, vendor-DGAbXdT2): all frames = react-dom passive-effect UNMOUNT path (`commitHookEffectListUnmount`: `o=l.destroy; o()`) → some effect's cleanup was a truthy NON-function.
Audit of every authored effect found exactly one implicit-return effect: `ScrollToTop` in src/App.tsx — `useEffect(() => window.scrollTo(0,0), [pathname])`. Implicit arrow return hands scrollTo's RETURN VALUE to React as the cleanup. Stock browsers return undefined (skipped: react-dom checks `!== void 0`), but smooth-scroll browser EXTENSIONS monkey-patch window.scrollTo to return a truthy handle object → on the next navigation React calls it as a function → TypeError, boundary screen. Explains everything: only his Chrome (extension), every navigation, any route, Firefox/Tor fine, unreproducible from sandbox with stock Chromium.
VERIFIED repro: patching scrollTo to return `{cancel(){}}` in headless Chromium against the LIVE site produced the byte-identical stack (tu 32:22314 → jn 32:24008 → un/yp/Lt/ga) and the `:(` screen on #/library. 10 errlog entries.
Fix: block-bodied effect (no implicit return) + comment forbidding implicit-return effects codebase-wide.
VERIFIED fix: `npm run ci` green; rebuilt dist served locally; same patched-scrollTo sim across 7 navigations = 0 pageerrors, 0 errlog entries, scrollY=0 (scroll-to-top still works); stock browser also clean.
Lesson (permanent): NEVER write `useEffect(() => someCall(), deps)` — always a block body. Any DOM API can be monkey-patched by extensions to return truthy values.

## 2026-07-26 — Iteration: full codebase analysis + F8 (wallet auth) VERIFIED + handle bug fixed
User asked: does wallet connect work? + wants a fullscreen player + full codebase analysis.
Analysis: F1-F7, F10, F13-F20 pass. Failing: F9 (publish flow unverified), F11 (durable registry — live GET /registry returns []), F12 (repo hygiene: dist/ committed, README quickstart wrong). No fullscreen/expanded player exists (PlayerBar.tsx is bottom-bar only; grep: zero fullscreen/expand hits) — candidate new feature pending user scoping.
F8 wallet auth VERIFIED end-to-end (evidence in features.json): live endpoint sig-verification test + headless Chromium full-flow test with faithful Phantom mock against the deployed site. Found handle bug: server built handle by slicing the JSON byte-array string publicKey -> '@[249...130]'. Fixed in 249a63e: bs58-encode the VERIFIED publicKeyBytes (bs58 already a dep) in api/index.js + server.js; wallet field now also clean base58; not spoofable (derived from verified bytes, not client string). npm run ci green. Post-deploy live re-test: handle '@4EgH...JJXX', profile renders, session persists.
Note: Playwright CDN unreachable from sandbox — use cached chromium_headless_shell-1228 via launch({executablePath}).

## 2026-07-26 — Iteration: fullscreen player + Media Session + demo publish + responsive (user answers to Q1-5)
User: (1) fullscreen player per rec + Android notification controls w/ cover art, (2) seed demos [already done in df660d5], (3) Upstash as PR not direct merge, (4) no funded Arweave -> recommend => demo publish mode, (5) no real payments, polish all screen sizes.
Built (ea0bb6c, stacking fix 1abf489):
- NowPlaying.tsx fullscreen overlay (cover-tap or chevron opens; big cover, seek+times, shuffle/prev/play/next, up-next queue; Escape/chevron/swipe-down close; body scroll lock; rendered OUTSIDE the z-40 bar — nested fixed overlay was covered by z-40 bottom nav, caught via live screenshot).
- Media Session API in PlayerContext (metadata+artwork, play/pause/prev/next/seekto, positionState; handlers via actionsRef to avoid stale closures; all best-effort try/catch; block-bodied effects only).
- Demo publish: DEMO_PUBLISH=true in lib/api.ts -> publishDemo saves to localStorage (localPublish.ts), RegistryContext merges local pubs (dedup by id, newest first), publish UI fully labeled (banner/etching/done/hints); file audio via session blob URL. Flip DEMO_PUBLISH=false when wallet funded.
- Responsive: mobile header search (expanding row under sticky header), Favorites/History quick links on Profile (lg:hidden).
VERIFIED: 16/16 headless checks vs dist (desktop+mobile) + 11/11 vs live deploy incl. wallet login (clean handle @BK7E...N8qk), demo publish end-to-end (library+profile), MediaSession state transitions, 0 pageerrors. F9 flipped (demo-mode scope), F21 added+passing.
- PR #1 opened (feat/durable-registry-upstash -> v06-development): GET /registry reads Upstash first + gateway backfill; POST /upload writes durable registry, Arweave still used when wallet funded; zero behavior change without env vars. Labeled VERIFIED (syntax+CI+inspection) vs ASSUMED (live Redis) in PR body. F11 stays false until env vars set + merged.

## 2026-07-26 — Iteration: Spotify-style player UX rework (user feedback 22:11 + 22:16)
User: "not user friendly — add swipe-up on phones to open the main player; up-next is covering the currently playing; copy Spotify's design for both phones and PCs on the main player screens" + "large space below the footer is an eye sore" (desktop screenshot).
Built:
- PlayerBar rewritten: PHONES = Spotify floating mini-player card (cover, title/artist, heart, play/pause, hairline progress); whole card tap AND swipe-up (dy<-28) opens fullscreen; inner buttons stopPropagation. DESKTOP = Spotify 3-zone bar: [cover(click->fullscreen)+info+heart] [shuffle/prev/light-play/next stacked over time—seek—time] [queue popover / close].
- NowPlaying rewritten Spotify-style: top gradient wash + "PLAYING FROM" header, left-aligned title/artist with heart (useFavorites now wired into player), seek w/ flanking times, big bg-ink play circle; transport = shuffle/prev/play/next/queue. QUEUE FIX: phones get a Spotify queue SCREEN ("Now playing" section pinned on top, then "Next up") — never covers the current track; desktop (lg+) queue is a SIDE PANEL beside the artwork, everything visible at once. Responsive switch done purely with hidden/lg:flex classes.
- index.css: rise-in keyframes for the fullscreen entrance — transform-only AND small offset (28px) on purpose; a large translateY(100%) first-frame would park the player offscreen on a frozen compositor (same class of bug as the fade-up opacity incident). Do not raise the offset.
- Footer dead space: AppShell <main> had unconditional pb-40 lg:pb-32 reserving player-bar clearance even with no player. Now reads usePlayer(): pb-40 lg:pb-28 while playing, pb-24 lg:pb-8 otherwise.
VERIFIED: npm run ci green; 12/12 headless checks vs dist incl. real synthetic-TouchEvent swipe-up/swipe-down (script: /work/temp/fontainor-debug/spotify-player-test.mjs) + visual screenshot review desktop/mobile. F22 added passing.
Test-harness gotcha: dispatching touchstart/move/end in ONE page.evaluate never lets React re-render between events -> drag state stays 0; dispatch each phase in separate evaluate calls with waits.

## 2026-07-26 — Iteration: Android gesture fixes + swipe-down-anywhere + compact footer (user feedback 22:28 + 22:29)
User: swipe "very buggy and not smooth"; "activates even if I just swipe down fast even when not on the area its supposed to trigger"; wants swipe-down to close the open main player; mobile footer "too long".
Root causes found:
1. JANK: fullscreen drag used setDragY state -> full React re-render of the whole NowPlaying tree on EVERY touchmove frame. Fix: rootRef + rAF-batched direct style.transform (translate3d, GPU-composited), zero re-renders; settle-back uses a one-shot CSS transition set inline.
2. MISFIRE: mini player opened mid-touchmove at only -28px, so a fast downward page-scroll flick (finger moves UP) over the bottom strip opened the player. Fix: decision moved to touchEND with dominant-vertical check (|dy| > 1.2|dx|) + threshold (dy<=-48) or fling (dy<=-20 && vy<=-0.45 px/ms); card is touch-none so gestures starting on it never scroll the page; subtle capped lift (dy/3, max 14px) as feedback via direct DOM write.
3. Swipe-down-to-close now attached to the WHOLE fullscreen sheet (was header-only); scrollable queue list, desktop aside, and seek slider opt out via data-nodrag + target.closest check. Close on dy>110 or fling (dy>40 && vy>0.5).
4. Footer: compact phone layout — 3 link columns in ONE row (grid-cols-3), brand spans full width, tighter padding/text; desktop unchanged. 314px tall on Pixel 7 (was ~630).
Defensive: guard e.changedTouches[0] (synthetic events may omit it).
VERIFIED: npm run ci green; gesture-fix-test.mjs 12/12 + spotify-player-test.mjs 12/12 regression (test helpers updated: synthetic touchend must include changedTouches like real browsers do). F23 added passing.

## 2026-07-26 — Iteration: repo slim-down + LICENSE cleanup (user request 22:32, corrections 22:44–22:48)
User: slim the repo, remove unnecessary files; LICENSE/name cleanup — final direction after two corrections (confirmed in DM): KEEP "Alistair Fontaine", replace the old placeholder handle in the LICENSE with "tapiwamakandigona" (his account; spelling confirmed explicitly). Then merge to main (explicit ask).
- Removed 20 dead tracked files: solana-install.sh (806K), stray `logs` server-log file, loop.sh, legacy one-off scripts (mint.js, vault-engine.js, get-addr.js, init-registry.js, verify-tx.js, testConnection.js, testUpload.js, test-arlocal-upload.mjs, simpleUpload.js, root irysStorage.js + services/irysStorage.js — @irys/sdk isn't even a dependency, these couldn't run), genesis.json + vault/ (only consumers were the deleted scripts), stale docs (CLAUDE.md, todo.md, HANDOFF.md — referenced a src/protocol/ that no longer exists), unused assets/logo2.png.
- server.js chain removed too: smoke test showed `npm start` was ALREADY broken (server.js imports src/protocol/arweaveUploader.js, deleted in the frontend-v2 rewrite) and it just duplicated api/index.js. Removed server.js + root validator.js/paymentBridge.js/registry.json, moved social.js -> api/social.js (api/paymentBridge.js dynamic-imports './social.js', which previously pointed at a nonexistent file), `npm start` now runs api-server.js (VERIFIED: boots, GET /registry 200).
- BUG FIX en route: api/paymentBridge.js (and the deleted root copy) had a committed stray duplicated JSDoc fragment after the closing */ -> SyntaxError on import; the /api/pay path could never have loaded it (same bug the old fix/paymentbridge-syntax-error branch was for). Fixed; module now imports clean.
- LICENSE: resolved committed merge-conflict markers (<<<<<<< blocks were live in the file); now "Copyright (c) 2026 Alistair Fontaine and tapiwamakandigona".
- README rewritten to be accurate: real clone URL + branch, real commands, correct production link (fontainor-protocol-two), repo layout; dropped fake env-var quickstart and the nonexistent "Disaster Recovery rollback log" claim.
- F12 flipped with evidence.
