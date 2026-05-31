```markdown
# Project Context: Fontainor Protocol v0.2

Fontainor is a decentralized music registry protocol. We are currently using a Manifest-based architecture to store our data immutably.

## Protocol Status: Decentralized Manifest (v0.2)
- Architecture: We have migrated from local storage to a decentralized registry via Irys/Arweave.
- Current Source of Truth: Defined by `REGISTRY_MANIFEST` in `.env`.
- Workflow: The frontend follows a "Fetch-Append-Push" pattern.
  1. Fetch registry from `http://localhost:3000/registry`.
  2. Append new asset to the array.
  3. POST full array to `/upload`.
  4. Update `.env` with the new TxID returned by the server.
- Critical Note: Always ensure the backend is running before publishing.

## Protocol Mechanics
- **Source of Truth**: The `REGISTRY_MANIFEST` TxID defined in the `.env` file.
- **Data Flow**: Frontend -> Server -> Irys (Arweave).
- **Consistency**: The system uses a "Fetch-Append-Push" model. Every publish creates a new snapshot of the entire registry history.

## Developer Guidelines
- **Updating the Protocol**: Always check the terminal output for a "New Manifest ID." The system is optimistic; if the `.env` pointer is not updated after a successful upload, the app will continue to display an outdated registry.
- **Persistence**: Never delete old Irys TxIDs. They are our historical audit trail.
- **State**: The `useStore.js` hook is the heart of the app. It manages both the audio player and the protocol ledger logic.

## Current Limitations & Roadmap
- **Manual Sync**: Updating `.env` is manual. Future iterations should explore automated governance or ENS-based pointers to avoid manual environment variable updates.
- **Optimism**: UI updates are optimistic, meaning the app updates locally before the blockchain confirmation is finalized. Ensure users are warned if network latency is high.

```
