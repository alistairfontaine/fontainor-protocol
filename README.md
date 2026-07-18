<p align="center">
  <img src="assets/logo.png" alt="Fontainor Protocol Full-Stack Header Logo" width="800" height="240">
</p>

# Fontainor Protocol (v0.5.0-Mainnet Build)

Fontainor is a high-performance, decentralized music equity registry and asset distribution protocol built on Arweave with trustless financial settlement via Solana. It provides a serverless platform for creators, allowing them to publish media and manage editorial content, with protocol nodes handling data-etching and payment splits.

---

## 📐 Core Architectural Strengths

* **Serverless Audio Ingress Chunker:** Handles large files by breaking them into 256KB chunks in the browser for efficient, memory-safe streaming to Arweave.
* **Cryptographic Sovereign Identity:** Uses Phantom wallet signature verification for authentication, bypassing the need for a backend database.
* **Omni-Asset Stablecoin Transfers:** Supports native SOL, USDC, and USDT, executing a 98% artist / 2% treasury split directly on the Solana Mainnet-Beta network.
* **Type-Segregated Registry Mapping:** Explicitly separates `release` (audio) and `editorial` (text) content for efficient data management.
* **Disaster Recovery:** Implements a 10-TxID rolling rollback log to ensure data persistence.

---

## 🏁 Quickstart Production Build Instructions

### 📦 1. Clone and Install Dependencies
```bash
git clone https://github.com
cd fontainor-protocol
git checkout production-mainnet
npm install
```

### 🔑 2. Configure Environment Rules
Create a `.env` file in your root folder for the Authority Keypair (use a strict `SOLANA_PRIVATE_KEY` array configuration).
```text
SOLANA_RPC_URL="https://solana.com"
SOLANA_PRIVATE_KEY="[...]"
```

### 🚀 3. Compile the Serverless Bundle
```bash
npm run build
```
This prepares the `dist/` folder, ready for deployment to Vercel.

---

## 📜 Open-Source Protocol Standards
Fontainor is MIT-licensed, offering an un-censorable platform for creators to own their work and for users to stream music permanently.
