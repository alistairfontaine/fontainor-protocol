# Fontainor Web (v0.2) — React frontend

The production frontend for Fontainor, ported from the HTML prototype to **React + Vite**.
It renders the full Nina-style UI and talks to the backend (`server.js` / Irys) through one data layer.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Build for production:

```bash
npm run build      # outputs to dist/
npm run preview     # serve the production build
```

## How it connects to the backend

Data loading order (see `src/lib/api.js`):

1. **Backend API** — `GET {API_BASE}/registry`  (default `http://localhost:3000`)
2. **Local file** — `./registry.json` (the copy in `public/` — dev fallback)
3. **Embedded sample** — the genesis asset, if nothing else is reachable

A banner at the top of the feed shows which source loaded (green = live API).

Override the backend URL without editing code:

```
http://localhost:5173/?api=http://localhost:8080
```

### Publishing
`src/lib/api.js > publishAsset()`:
- If the host page exposes a global `triggerUpload(content)` (leader's integration), it calls that.
- Otherwise it does `POST {API_BASE}/upload` with the new asset as JSON.

New assets are built in **our registry schema** (`assetId` / `name` / `equity` /
`social_layer` / `profile_metadata`) by `buildAsset()` — so they match the backend.

### Two things the backend needs for the green banner
1. `GET /registry` returns the registry JSON (single object or array — both handled).
2. **CORS enabled** on the Express server (browser → localhost:3000 is cross-origin).

## Project structure

```
src/
  main.jsx               app entry
  App.jsx                hash router + layout + modals + overlay
  styles.css             all styles (Nina-style, white/blue)
  lib/
    registry.js          schema normalization, formatters, generated cover art
    api.js               backend client (GET /registry, POST /upload) + fallback
  hooks/
    useStore.js          app state + audio player engine + auth + publish
  components/
    Nav.jsx              sidebar + top nav (auth-aware) + dropdown
    Release.jsx          release card, grid, skeleton, cover
    ReleaseDetail.jsx    detail overlay (specs, support, profile)
    Player.jsx           persistent bottom player
    Modals.jsx           auth (email + Solana wallet) + publish
    Pages.jsx            all routed views
public/
  registry.json          dev fallback copy of the genesis asset
```

## Notes / honest limitations
- **Auth is provisional** (front-end only). Email/wallet sign-in sets local state so
  the app is explorable; real auth is a backend step.
- **Payments are not wired** — the "Collect" button and pay-what-you-want support
  update the UI optimistically but don't move money yet (that's `paymentBridge.js`).
- `localhost` is dev-only; going public needs hosting.
- The registry's `equity` / resale-royalty model still has the open securities question
  flagged earlier — a product/legal decision, not a frontend one.
