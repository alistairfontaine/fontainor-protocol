## v0.5.0-Mainnet (Current Production Release)
- **Production Infrastructure Lift:** Complete migration from ArLocal sandbox environments to live public Solana Mainnet-Beta and Arweave network gateways.
- **Sovereign Cryptographic Auth:** Implemented a completely free, zero-overhead user session layer using TweetNaCl message signatures via Phantom wallet, removing central database costs.
- **Omni-Asset Split Processing:** Upgraded `paymentBridge.js` to mathematically enforce the strict 98% artist equity / 2% protocol treasury revenue splits across native SOL, USDC, and USDT stablecoins.
- **Type-Segregated Registry Arrays:** Introduced an explicit `type` metadata discriminator parameter separating music track assets (`release`) from journalistic write-ups (`editorial`).
- **Serverless Production Optimization:** Configured a static, high-fidelity compilation target optimized specifically for deployment onto Vercel Serverless Function lanes.

## v0.2-development
- **Infrastructure Overhaul:** Migrated from local file-based storage to a live API gateway (`server.js`).
- **Blockchain Integration:** Added Irys storage engine (`irysStorage.js`) for permanent, immutable data persistence.
- **Frontend Bridge:** Implemented `triggerUpload` in `index.html` to allow direct-to-blockchain publishing from the browser.
- **Next Goal:** Deprecate `registry.json` in favor of full blockchain-ledgers.


