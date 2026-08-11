# AGENTS.md

## Project

Fontainor — decentralized music registry (Arweave storage, Solana payments).
This branch (`frontend-v2`) replaces the frontend wholesale and fixes backend
persistence. Stack: Vite 5, React 18, TypeScript, Tailwind CSS v4,
react-router, react-window; `api/index.js` Express serverless on Vercel.

## Commands

```bash
npm install                      # setup
npx playwright install chromium  # once per machine — the tools/*-test.mjs browser suites need it
npm run ci                       # full gate: typecheck + build — must pass before commit
npm run dev                      # run the app locally (vite)
node api-server.js               # run the API locally (if needed)
```

Browser tests resolve Chromium through Playwright's own registry; set
`FONTAINOR_CHROMIUM=/path/to/chrome` only to override.

## Structure

- `src/` — new frontend (TypeScript). `src/styles/tokens.css` = design tokens.
- `api/` — Express serverless function (registry/upload/payment). Keep API
  contract stable.
- `public/registry.json` — static fallback registry.
- State: `PROJECT.md` (decisions), `features.json` (definition of done),
  `progress.md` (append-only log). Read these first every session.

## Boundaries

**Always:** commit after each verified task; update `progress.md`; run
`npm run ci` before marking anything done; keep registry JSON schema
unchanged; label claims VERIFIED/ASSUMED.

**Ask first:** paid services, new runtime dependencies beyond the decided
stack, changing API routes/shapes, anything destructive on the upstream repo.

**Never:** edit verify commands or acceptance criteria in `features.json`;
commit secrets (credentials live outside the repo, never in git); force-push;
touch `dist/` by hand.

## Deeper docs

- `docs/PROTOCOL_STORAGE_SPEC.md` — registry schema + storage rules.
- `docs/design/LIBRARY_GRID_DESIGN.md` — virtualized grid rationale.
- uxpeak-codex mirror: `/work/temp/uxpeak-codex` (`AI-USAGE.md` load order;
  `data/rules.json` hard rules; `data/rubric.json` self-score).
