# Fontainor Protocol Development Roadmap

## Phase 1: Environment & Sync (Done)
- [x] Merge Rin's PR (Storage Spec integration)
- [x] Verify UI Mock States (/?mock=ok)

## Phase 2: Protocol Core Logic (In Progress)
- [ ] Implement core transaction builder
- [ ] Connect UI forms to backend services
- [ ] Define data schema for Arweave/Irys uploads
- [ ] Handle error states (using mock-failures as test cases)

## Phase 3: Storage Integration (Rin's Spec)
- [ ] Implement Irys uploader (per spec: verify file hash before upload)
- [ ] Add retry logic for network timeouts
- [ ] Ensure metadata persistence on-chain (Solana account mapping)

## Phase 4: Local Stack Stabilization
- [ ] Resolve Validator binary/config (or migrate to stable version)
- [ ] Validate end-to-end flow with ArLocal
