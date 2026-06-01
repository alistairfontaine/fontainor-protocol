# Fontainor v0.3 — Library Grid: design draft (for review)

This is a **proposal for the component structure**, to align before I implement.
Scope: the three frontend items assigned — Library Grid, Media Readiness, State Handling.

## Confirmed since the last draft (from CLAUDE.md / README + merged PR #2)
- **registrySchema is locked** (`validator.js`, merged in PR #2). The grid consumes and produces
  objects of exactly this shape:
  `{ id, title, artist, price:{amount,currency}, editions:{total}, status, date, audioUri?, coverUri? }`
- **`audioUri` / `coverUri` are the confirmed media field names** (optional + nullable). No more
  guessing — the grid maps these directly. (This resolves the open question from the last draft.)
- **`/upload` is a validator-only placeholder** right now (validates + logs; Irys write pending).
  Irys SDK injection is the backend's next step *after* the grid. The grid is built ready for that
  but doesn't depend on it — it reads from `GET /registry` either way.
- Frontend already satisfies the CLAUDE.md workflow rules: sends array payloads, handles 200, and
  shows Zod-formatted 400 errors (done in PR #2).

---

## 1. The performance problem (why a plain grid breaks at 500+)

Our current grid renders **every** release as a DOM node at once. At ~6 items that's fine.
At 500+ it isn't: 500 cards × (cover SVG + buttons + text) = thousands of DOM nodes mounted
simultaneously → slow first paint, janky scroll, high memory.

**The fix: virtualization (a.k.a. "windowing").**
Only render the rows currently visible in the viewport (plus a small buffer). Scroll 500
items, but only ~20–30 are ever in the DOM at once. This is the standard solution and it's
what makes the grid scale to thousands without "killing the frontend," exactly as you flagged.

Two ways to do it:
- **(A) Library:** `react-window` (tiny, ~6kb, battle-tested). `FixedSizeGrid` fits our
  uniform square covers perfectly. **My recommendation** — least custom code, most reliable.
- **(B) Hand-rolled IntersectionObserver:** no dependency, but more code to maintain and
  more edge cases (resize, variable columns). Only if you want zero new deps.

I propose **(A) react-window**. One small dependency, and it's the part that actually
delivers the "handles 500+ items" requirement.

---

## 2. Proposed component structure

```
src/
  components/
    library/
      LibraryView.jsx        # page: search bar + filters + the grid container
      LibraryGrid.jsx        # virtualized grid (react-window FixedSizeGrid)
      LibraryCard.jsx        # one release cell (reuses our existing card visuals)
      LibraryToolbar.jsx     # search input + sort/filter controls
  hooks/
    useLibrary.js            # derives the filtered/sorted/searched list from the registry
```

How they nest:

```
LibraryView
 ├─ LibraryToolbar         (search text, sort dropdown)  --> updates query state
 ├─ useLibrary(registry, query)  --> returns the filtered array
 └─ LibraryGrid(items)
       └─ LibraryCard      (rendered only for visible cells, via react-window)
```

**Key idea:** search/sort/filter is **pure data transformation** in `useLibrary` (fast,
runs on an in-memory array). Rendering is **virtualized** in `LibraryGrid`. The two concerns
stay separate, so neither becomes the bottleneck.

---

## 3. Search & filter (client-side, instant)

For the foreseeable registry size, search runs **client-side** over the already-loaded
array — no backend round-trip, instant results as you type. `useLibrary` handles:

- **Search**: match query against `title`, `artist`, `id`, and `tags`
- **Sort**: newest (by `date`), title A–Z, artist A–Z, price
- **Filter** (optional, later): free / for-sale / sold-out

Debounce the search input (~150ms) so typing stays smooth even mid-render.

> If the registry ever grows past what's comfortable to load fully in the browser
> (tens of thousands), we'd move search server-side — but that's a v0.4+ concern, not now.

---

## 4. Media Readiness (audioUri / coverUri — confirmed)

The schema's media fields are confirmed as **`audioUri`** and **`coverUri`** (both optional and
nullable). The grid maps them directly:

- **Cover**: if `coverUri` is present → `<img src={coverUri}>`; if null/absent → our generated SVG
  placeholder (so the grid never looks broken while real art is still being added).
- **Audio**: if `audioUri` is present → the card's play button streams it through the existing
  bottom player; if null → it's a silent/preview card.

Because `/upload` is in validator-only mode today, most assets will have `audioUri`/`coverUri` as
`null` for now. The grid handles that gracefully (placeholder cover, no-op play) and will "light up"
automatically once Irys writes real URIs — no frontend change needed when that lands.

> I'll keep a tiny tolerance for a couple of aliases internally (e.g. `cover`, `audio`) so older
> sample/test records still render, but `audioUri`/`coverUri` are treated as the source of truth.

---

## 5. State Handling (no manual reload on pointer update)

Goal you set: "frontend gracefully handles pointer.json updates without manual reloads."

Proposal:
- After a successful publish, we already optimistically show the new item. Then we **re-fetch
  `/registry`** to reconcile with the canonical (post-Irys) state. (Already in place from v0.2.)
- Add **light polling**: every N seconds (e.g. 20s) while the Library is open, re-fetch
  `/registry`; if the returned array differs, update the grid. This catches changes made by
  *other* sessions/teammates without a manual refresh.
- Optional later: a `GET /manifest` lightweight check (just the TxID) before re-pulling the
  full array — cheaper than fetching the whole registry every poll. (I already added a
  `/manifest` route in the server patch, so this is ready when we want it.)

Polling is the simplest robust option without adding websockets. If you'd rather push
updates (SSE/websocket), that's a backend decision — let me know and I'll consume whatever
you expose.

---

## 6. What I'd build first (once you approve the approach)

1. `useLibrary.js` (search/sort) + `LibraryToolbar.jsx` — get filtering right on the current data
2. `LibraryGrid.jsx` with `react-window` — prove it scrolls smoothly with a generated 500-item set
3. Wire `audioUri`/`coverUri` mapping into `LibraryCard` (field names already confirmed)
4. Add the polling reconcile to `useStore`

I can stand up #1 and #2 against a synthetic 500-item dataset immediately to prove the
performance — entirely independent of the Irys placeholder — then it just works when real
media URIs start landing.

---

## Open questions for you (Alistair)

1. **react-window OK as a dependency?** (vs. hand-rolled — I recommend the library; it's the part
   that actually delivers "handles 500+ without killing the frontend")
2. **Pointer-update strategy:** polling every ~20s (I can do now) vs. you exposing SSE/websocket
   later? Either is fine on my side — polling needs nothing from the backend.
3. Should search also match `tags`, or just title / artist / id for now?

That's it — the schema and media field names are settled, so these three are the only decisions
left. Answer them and I'll implement. Or if you'd rather I build the performance proof (#1 + #2 on
synthetic data) right now so you can see 500 items scroll, say the word and I'll start.
