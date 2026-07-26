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
- Payments purchase flow UI is stubbed behind a "coming soon" state in v1;
  wallet **auth** (Phantom) is real (2026-07-26).
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

foundation — scaffold new frontend workspace, CI gate, design tokens.
