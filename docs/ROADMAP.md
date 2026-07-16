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
