
```markdown
# Fontainor Protocol (v0.3-development)

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

## Architecture Overview v0.3
The Fontainor Protocol is an autonomous registry for digital assets. It utilizes an Irys-based storage layer and a `pointer.json` manifest to track the latest state of the registry, ensuring persistence without manual configuration.

## Status: v0.3-development
- **v0.2 Stable**: Auto-pointer functionality and registry persistence verified.
- **v0.3 Roadmap**:
    - **Schema Integrity**: Implementing Zod-based validation to ensure registry consistency.
    - **History Log**: Building a rolling log of the last 10 TxIDs for state rollback.
    - **Media Readiness**: Standardizing metadata fields for audio and image URI integration.
* **Auth/Payments:** Auth is currently local-only for UX. Payments are scaffolded but remain optimistic/non-custodial until the backend payment bridge is finalized.

## Current Update 6:59pm 5/31/2026

## Technical Overview
The protocol functions as a secure bridge between frontend asset submission and decentralized permanent storage.

### Data Gatekeeper
The protocol utilizes a Zod-based validation layer to ensure all incoming assets meet the required structural standards:
- **ID:** Unique Identifier
- **Title/Artist:** Metadata
- **Price:** Amount/Currency object
- **Editions:** Total count
- **Media:** audioUri and coverUri

### Status
- **v0.3-development:** Frontend-Backend integration complete and validated. 
- **Storage:** Currently running in validation-only mode. Irys integration pending.

---
*Built with an Asset-First philosophy.*

## Current Progress
* "Hardened server with Zod schema validation, moved to ES Module architecture, added automatic history logging."

```
