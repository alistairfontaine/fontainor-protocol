# v06 iteration block — 2026-07-26 (evening)

- [x] T1: Verify classic PAT, push v06-development + frontend-v2 upstream (VERIFIED: new branches on alistairfontaine/fontainor-protocol)
- [x] T2: Demo seed — download ~10 CC0 tracks (freepd.com), trim ~90s, encode ~112kbps mp3 → public/audio/; align registry.json metadata (titles/artists/tags/genres stay fictional-realistic, match audio mood)
- [x] T3: Generate 10 cover images (text2im), downscale ~640px, → public/covers/; wire coverUri
- [x] T4: F15 recommendation engine — client-side scoring: tag/genre overlap + artist affinity from favorites & listening history + freshness tiebreak; "For you" rail on Home + "More like this" on ReleaseDetail; cold-start = popular/new
- [x] T5: UI polish pass (hover overlays, player bar cover thumb, transitions, focus states)
- [x] T6: Verify — headless: audio actually plays (real currentTime from mp3), recs change after favoriting, screenshots; CI green
- [x] T7: Rebuild preview page (inline covers as data URIs, keep audio graceful-fallback), republish
- [x] T8: features.json (add F14 seed, F15 recs, evidence), progress.md, commit, push origin+upstream
- [x] T9: Report in DM threads 1785088544 (push/seed/polish) + 1785088596 (recommendations)
