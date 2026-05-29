# Fontainor Protocol

Fontainor puts music ownership back in artists’ hands by selling the architecture of a song—where collectors own equity and can resell it via smart contracts.

## Core Philosophy
1. **Asset-First:** We do not sell "streams." We sell the architecture of the music.
2. **Sovereignty:** All data lives on the Permaweb (Arweave). No centralized authority can censor or delete it.
3. **Collector's Equity:** Every edition is a financial instrument. When a collector resells, the artist earns a royalty.

## v0.2-development Updates
- **API Gateway:** Implemented Express.js backend to serve data and handle Irys blockchain uploads.
- **Permanent Storage:** Integrated Irys storage engine.
- **Decoupled Architecture:** Frontend now fetches from local API (`/registry`) rather than direct file access.

## How to run locally
1. Ensure your `.env` file is configured with `WALLET_KEY`.
2. Install dependencies: `npm install`
3. Start the server: `node server.js`
4. Access the protocol at: `http://localhost:3000`
