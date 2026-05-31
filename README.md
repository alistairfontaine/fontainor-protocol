
```markdown
# Fontainor Web (v0.2) — React frontend

The production frontend for Fontainor, ported from the HTML prototype to **React + Vite**. It renders the full Nina-style UI and talks to the backend (`server.js` / Irys) through a decentralized data layer.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173

```

Build for production:

```bash
npm run build        # outputs to dist/
npm run preview      # serve the production build

```

## Architecture: The Manifest Protocol (v0.2 Update)

We have migrated from local file storage to a **Decentralized Manifest Protocol**. The source of truth for the registry is now an immutable ledger hosted on the Arweave network via Irys.

### How it connects to the backend

Data is no longer static. The registry is dynamically fetched:

1. **Manifest Pointer**: The server checks the `REGISTRY_MANIFEST` variable in your `.env` file. This TxID is the "Source of Truth" for the entire protocol.
2. **Backend API**: `GET /registry` fetches the full JSON array from the blockchain gateway using that TxID.
3. **Publishing Workflow (`useStore.js`)**:
* When a new asset is published, the app fetches the *current* array from the registry.
* It appends the new asset to that array.
* It sends the *entire updated array* via `POST /upload`.
* The backend pushes this to Irys and returns a new TxID.
* **Crucial:** You must update the `REGISTRY_MANIFEST` in your `.env` with the new TxID returned by the server to "point" the protocol to the latest version.


## Project structure

* `src/main.jsx`: App entry
* `src/App.jsx`: Hash router + layout + modals
* `src/lib/registry.js`: Schema normalization + builders
* `src/lib/api.js`: Backend client (GET/POST)
* `src/hooks/useStore.js`: App state, audio engine, and the **Fetch-Append-Push** publish logic
* `public/registry.json`: Legacy fallback only (do not use for active development)

## Important Protocol Notes

* **Persistence:** Because we upload the entire array every time, history is never lost.
* **Manual Pointer:** Version 0.2 requires manual `.env` updates. If the registry appears stale, check the terminal logs for the latest TxID and update your environment variable.
* **Auth/Payments:** Auth is currently local-only for UX. Payments are scaffolded but remain optimistic/non-custodial until the backend payment bridge is finalized.

```
