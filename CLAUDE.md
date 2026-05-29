# Fontainor Protocol - System Instructions for AI

## Current Status (v0.2-development)
- **Infrastructure:** Backend is now an Express-based API gateway (`server.js`).
- **Storage:** Connected to Irys blockchain. Registry is read via API.
- **Workflow:** Publishing is enabled via `triggerUpload` in `index.html`.

## Directives for AI Collaborators
1. **Infrastructure Integrity:** Do not suggest changes to `server.js` or `irysStorage.js` unless explicitly requested. They are stable. Focus on frontend integration.
2. **Persistence:** Always assume we are moving toward full decentralization. When helping with UI, suggest how to replace local registry reads with blockchain transaction fetching.
3. **Security:** Never suggest hardcoding sensitive keys. Always enforce the use of environment variables.
4. **Protocol Logic:** When Rin or the team asks for new features (e.g., adding a release), help them implement the `fetch` calls to the `/upload` endpoint, ensuring the UI provides feedback during the Irys transaction process.
5. **UI/UX:** The goal is to make blockchain interactions feel invisible. Optimize for fast loading and clear "Publishing/Success" states.

## Next High-Priority Tasks
- Wire `triggerUpload` to a visible UI component.
- Transition from `registry.json` local file reading to Irys transaction polling.
- Build a "History/Version" viewer that displays past registry states from the blockchain.
