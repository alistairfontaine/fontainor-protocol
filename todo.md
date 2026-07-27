# 2026-07-27 — Real publish (Irys musician-pays) + purchase flow + durable registry
User directive (DM 09:50): "fix all except the fiat donations, fix all including the purchase flow etc etc and Irys is good."

Scope: everything from the production-readiness list EXCEPT fiat donation channels.
Branch: feat/real-publish-and-purchase (off main). One upstream PR at the end.

- [ ] 1. Merge fork PR #1 changes (Upstash durable registry) into branch — commit
- [ ] 2. Backend: real treasury address (env + default from support config), verify-payment
       cleanup (no fake mint claims), durable purchase receipts via Upstash — commit
- [ ] 3. Irys musician-pays publish: src/lib/irysPublish.ts (lazy import, quote → fund →
       upload audio + optional cover file + manifest), kill DEMO_PUBLISH, Publish.tsx
       quote/confirm UI, POST /upload (durable) + /api/v1/publish pointer — commit
- [ ] 4. Registry self-heal: GET /registry falls back to Arweave GraphQL latest manifest
       (tag App-Name Fontainor-Registry) when pointer+durable are empty — commit
- [ ] 5. Purchase flow: src/lib/purchase.ts (98/2 SOL split via Phantom, price conversion
       via CoinGecko w/ fallback), ReleaseDetail buy UI (only when artistWallet present),
       local collection + Profile section, best-effort server verify — commit
- [ ] 6. Verify: npm run ci, headless checks (Phantom mock; Irys mocked in browser tests),
       optional Irys devnet probe in Node; update features.json (F27, F28), progress.md
- [ ] 7. Identity (Tapiwa 09:55, via other thread): git config set to tapiwamakandigona ✔;
       before pushing, rewrite author/committer on ALL branch commits (incl. Upstash merge
       commit at branch start) to tapiwamakandigona; no Co-authored-by: Viktor trailers;
       also rewrite + force-push fork PR #1 branch feat/durable-registry-upstash.
       Do NOT rewrite merged history on fork/upstream main.
- [ ] 7b. Push fork, open upstream PR, merge (write access), sync fork main
- [ ] 8. Slack report + env-var instructions for Alistair (Upstash), note tip test still ASSUMED
- [ ] 9. Compress skills/users/u0bl0rgky2v/SKILL.md (near auto-read limit)
