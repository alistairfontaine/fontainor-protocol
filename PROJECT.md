# PROJECT.md

## Goal

Replace the Fontainor frontend with a brand-new, professionally designed web app
(new visual identity), keep the existing serverless backend working, and fix the
backend defects that block real usage (registry persistence above all). Done =
`npm run ci` green, all `features.json` entries passing with evidence, preview
deployment reachable, and the app fully usable on desktop + mobile against the
live `/registry` API (with seeded data).

## Session-start ritual

1. Read this file, `features.json`, and the tail of `progress.md`.
2. Run `npm run ci` to confirm the baseline is green.
3. Pick the single most important unfinished feature; work only on that.

## Standing decisions

- Single-Agent Harness v3.0.1 — no subagents, one task per iteration (2026-07-26).
- Work happens on fork `tapiwamakandigona/fontainor-protocol`, branch
  `frontend-v2` (2026-07-26).
- Stack: Vite 5 + React 18 + **TypeScript** + **Tailwind CSS v4** +
  react-router (hash → real routes) + react-window for the Library grid.
  Rationale: Vercel-native static build, keeps the existing `api/` Express
  serverless function and `vercel.json` wiring intact (2026-07-26).
- Old `src/` is replaced wholesale; the locked registry schema
  `{id, title, artist, price:{amount,currency}, editions:{total}, status,
  date, audioUri?, coverUri?}` plus `type: release|editorial` is the contract
  with the backend and must not change (2026-07-26).
- Design language follows uxpeak-codex rules (`data/rules.json` hard rules,
  self-scored against `data/rubric.json`); repo mirrored at
  `/work/temp/uxpeak-codex`. Extract structure (spacing scale, radius ladder,
  type ramp), not the tutorial palette (2026-07-26).
- Backend fix scope: registry persistence (pointer.json is ephemeral on
  Vercel — move pointer to a durable store or env-var + fallback), seedable
  sample data, keep `/registry`, `/upload`, `/manifest`, chunk-upload and
  payment routes API-compatible (2026-07-26).
- Payments purchase flow is REAL as of 2026-07-27: one Phantom tx, 98/2
  split (artistWallet / treasury), on-chain receipt; releases without
  artistWallet stay unavailable. Publish is REAL musician-pays Irys
  storage (no platform wallet, no demo mode).
- Deferred pages in v1: Insights, Iceberg, Offramp, Discover, Staff Picks,
  Now Listening (no data source behind them) (2026-07-26).

## Constraints

- Never commit credential values; secrets live in
  `/work/secrets/u0bktuagrpy/` only.
- Don't break the deployed API contract consumed by third parties (registry
  JSON shape).
- No paid services without asking; Vercel hobby tier + existing Arweave/Solana
  endpoints only.
- Evidence rules: claims labeled VERIFIED (command output/artifact) or ASSUMED.

## Current phase

launch-readiness — real publish + purchases shipped; remaining gates are
ops (Upstash env vars on the production Vercel project) and real-SOL
smoke tests (one publish, one purchase, one tip).

## Launch decisions (Zero-Dollar Launch Plan, 2026-07-27)

- License: AGPL-3.0-only (strongest still-open-source anti-clone option;
  name protected separately via NOTICE — the license covers code, not the
  "Fontainor" name). Requires both copyright holders; lands via PR so
  Alistair's approval is his consent on record (2026-07-27).
- Donations posture: WinRAR honor system — never gate, never nag hard.
  /support page + SOL tip jar (treasury wallet in src/config/support.ts);
  fiat channels config-gated until the accounts exist, no dead buttons
  (2026-07-27).
- Launch gate unchanged: no Reddit/HN marketing until a stranger can
  publish a real track and find it tomorrow from another device (Arweave
  wallet funded + durable registry merged) (2026-07-27).

- Commit identity: ALL commits must be authored as
  `tapiwamakandigona <230673668+tapiwamakandigona@users.noreply.github.com>`
  — never any assistant identity, no Co-authored-by trailers (2026-07-27).
