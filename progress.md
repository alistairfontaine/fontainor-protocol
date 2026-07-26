# progress.md — append-only

## 2026-07-26 — iteration 0 (setup)
- Forked alistairfontaine/fontainor-protocol -> tapiwamakandigona/fontainor-protocol (VERIFIED via GitHub API response).
- Created branch `frontend-v2`; harness v3.0.1 files added (PROJECT.md, features.json, AGENTS.md, progress.md, loop.sh from subagent-toolkit@v3.0.1).
- Analysis findings that drive scope:
  - Live /registry returns [] (VERIFIED via fetch). Root cause: api/index.js resolves registry via manifest pointer in `pointer.json` next to the function — Vercel lambda FS is ephemeral/read-only, so writeManifestPointer() never persists; and `uploadManifest` is a stub returning "Serverless gateway mode active" in serverless mode. REGISTRY_MANIFEST env var is the only durable path today.
  - Old frontend: search input has no handler; favorites/history in-memory only; 2 media queries total (no real mobile support).
  - Repo pollution: dist/, .swo, validator logs, test-ledger committed.
- Next: F1 scaffold (TS + Tailwind + CI gate).
