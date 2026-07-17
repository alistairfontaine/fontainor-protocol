# Fontainor Protocol: Decentralized Music Specification (v0.4-beta)

This document establishes the definitive monolithic Order of Operations (OOO) roadmap for the full-stack integration of the Fontainor Protocol. It maps out the development trajectory required to bind the React frontend chunk-slicing interface to the Node.js raw binary storage gateway, establishing a permanent asset-first music equity registry on Arweave.

---

## 🗺️ Monolithic Order of Operations (OOO) Matrix

### 🎵 Part I: Full-Stack Audio Chunking Ingress (v0.4-beta)
* **[ ] Milestone A1: React to Binary Upload Binding** -> Connect the React user interface components directly to `audioUploadEngine.js` to slice local audio tracks into 256KB binary fragments, completely dropping multipart/form data.
* **[ ] Milestone A2: Stream Header Synchronization** -> Enforce strict sequential passage of metadata headers (`x-upload-id`, `x-chunk-index`, `x-total-chunks`) across all active frontend fetch operations.
* **[ ] Milestone A3: Real-Time UI Progress Telemetry** -> Wire the engine's `onProgress` callbacks to drive high-fidelity user progress bars tracking exact transmission percentages and upload status.

### 🧠 Part II: Cryptographic Signing & Arweave Ledger Integration (v0.4-beta)
* **[ ] Milestone B1: Core Buffer Concatenation** -> Finalize backend map-buffer concatenation logic to automatically compile the full file memory block the moment the final chunk arrives.
* **[ ] Milestone B2: Local ArLocal Auto-Funding (`devFundArLocal`)** -> Enforce local-wallet simulated funding via the `AR_DEV_AUTOFUND` environment flags to test blockchain uploads on a local-only ArLocal node.
* **[ ] Milestone B3: Hardened Transaction ID Handoff** -> Swap out temporary backend mock tx-id strings for genuine Arweave/Irys transaction hashes, linking the published audio asset permanently to the distributed ledger.

### 🪙 Part III: Nina-Style Collector/Purchasing Cryptographic Architecture (v0.5)
* **[ ] Milestone C1: Non-Custodial Wallet Authentication** -> Deploy lightweight frontend adapters to allow collectors and artists to authenticate their identities natively via non-custodial crypto wallet interfaces.
* **[ ] Milestone C2: Equity Split Payment Bridge Logic** -> Build a secure transaction routing layer to distribute purchasing cryptocurrencies automatically between artists and curators based on immutable metadata rules.
* **[ ] Milestone C3: On-Chain Asset Manifest Pointer** -> Implement an autonomous state controller (`pointer.json`) to track the master registry transaction address without requiring manual updates.

---

## 🚥 Core Technical Protocol Constraints

* **Ingress Format:** Audio uploads must utilize an `application/octet-stream` binary chunk payload structure.
* **Memory Optimization:** To protect network threads, files are split into exact 256KB buffers to maintain a lean, constant-memory ingress profile.
* **Busy-Lock Enforcement:** The user interface must enforce a hard busy-lock state over the upload loops to eliminate race conditions while a song is being assembled on the backend.

# Fontainor Protocol Monolithic Development Roadmap

This living roadmap establishes the sequential order of operations (OOO) and architectural scope boundaries for the Fontainor Protocol distribution lifecycle.

---

## 📈 Current Status: Phase II (v0.4-development) — COMPLETE
* **Audio/Artwork Chunking Ingress:** Verified sequential 256KB binary octet-stream fragmentation pipeline [s].
* **Bare-Metal Cryptographic Signer:** Native backend `arweave-js` data transaction signing engine [s].
* **Cross-Generational Validation Gate:** Elastic array-safe `z.array(z.any())` metadata parsing rules [s].
* **Sovereign Presentation UI:** Fully proxy-resolved interface views pulling live blocks off local ledger nodes [s].

---

## 🚀 Upcoming Runway: Phase III (v0.5) — Solana Crypto Payment Bridges

Milestone Phase III implements true non-custodial asset tokenization and automated financial settlement architectures modeled after the Nina Protocol paradigm [s].

### 🪙 Milestone C1: Non-Custodial Wallet Purchase Automation
* **Objective:** Replace frontend optimistic local array pushes with binding Web3 cryptographic signature handshakes [s].
* **Execution:** Interface directly with `window.solana.signAndSendTransaction` via browser extensions (Phantom) [s].
* **Network Context:** Establish active RPC serialization loops connecting client terminals to the live `Solana Devnet` cluster (`https://solana.com`) [s].

### 🎚️ Milestone C2: Automated Split-Payment Routing
* **Objective:** Enforce an un-censorable, trustless economic framework routing payment tokens directly to stakeholders [s].
* **Execution Contract:** Construct native low-level backend transaction instructions mapping public keys to the blockchain runtime [s].
* **The Settlement Split:** Hardcode an unalterable financial distribution matrix:
  - **98.0%** routed directly to the artist's verified target cryptographic destination address string [s].
  - **2.0%** routed straight to the official Fontainor Protocol `Gas Bank` Community Treasury address [s].

### 💎 Milestone C3: Multi-Asset SPL Token Account (ATA) Mechanics
* **Objective:** Expand protocol settlement options to support international stablecoin standard liquidity pools [s].
* **Execution:** Incorporate Associated Token Account (ATA) derivation rules using Solana Program Library parameters [s].
* **Asset Support:** Facilitate native processing of both **USDC** and **USDT** stablecoins alongside raw SOL tokens [s].

---

## 🛡️ Future Horizon: Phase IV (v0.6) — Solana Collector Equity & Minting Engines
* **On-Chain Collector Ledger:** Establish immutable collector registry matrices on Arweave mapping track ownership state [s].
* **SPL Minting Finalizer:** Automated execution loops generating unique, limited-edition SPL equity tokens deposited straight into collector wallets upon payment signature confirmation [s].
* **Smart Contract Decentralization:** Port backend Node.js payment checking loops into permanent, permissionless on-chain Solana programs (Rust/Anchor) [s].

