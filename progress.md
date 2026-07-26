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
