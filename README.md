<p align="center">
  <img src="assets/logo.png" alt="Fontainor Protocol Full-Stack Header Logo" width="800" height="240">
</p>

# Fontainor Protocol (v0.4-development)

Fontainor is a high-performance, decentralized music registry and asset equity protocol built to run permanently on Arweave. It provides a completely sovereign computing architecture for artists and curators, delivering direct on-chain streaming ingress and asset validation with zero central authority tracking.

> 📖 **Architectural Engineering Manifestos:** For deep-dive breakdowns on system specifications, project trajectories, and codebase conventions, inspect the newly organized documentation tree:
> - 📐 [Subsystem Architecture Design Specification](docs/ARCHITECTURE.md)
> - 🗺️ [Monolithic Order of Operations (OOO) Roadmap](docs/ROADMAP.md)
> - 📜 [AI Developer Collaborator Handoff Standards](docs/CLAUDE.md)

---

## 🔧 Core Architectural Strengths
* **Lean Sequential Audio Ingress:** Slices massive WAV, FLAC, and MP3 files down to compact 256KB fragments inside browser memory space, streaming them via pure binary octet-streams to protect server thread heaps from bloat.
* **Native Cryptographic Signing:** Leverages direct `arweave-js` transaction parameters to sign and mine compiled bytes, removing layer-2 abstraction bottlenecks completely.
* **Elastic Ledger Validation:** Employs an array-safe, flexible validation gate that handles mixed-generation transaction structures with 100% backward and forward compatibility.
* **10-TxID Rolling History Log:** Maintains a bounded, persistent queue stack of historical transaction blocks directly on disk to provide instant rollback recovery layers.

---

## 🛠️ Required Protocol Distribution Stack
* **Runtime Environment:** `Node.js` (ES Module format configuration)
* **Interface Layer:** `React 18` + `Vite`
* **Validation Subsystem:** `Zod v4`
* **Cryptographic Ledger SDK:** `arweave` native client
* **Local Sandbox Testnet:** `arlocal` background ledger network service (Port 1984)

---

## 🏁 Quickstart Full-Stack Local Sandbox Execution

To ignite the integrated protocol workstation panel on your local machine, run the following commands across three independent terminal lanes inside the repository tree:

### 📡 1. Boot up the Local Blockchain Ledger Node
```bash
npm run arlocal
```

### 🧠 2. Ignite the Protocol Backend Server
```bash
npm start
```

### 🎨 3. Launch the Frontend Vite User Interface Viewport
```bash
npm run dev
```

Once the Vite dashboard fires open, hold **`Ctrl` and click `http://localhost:5173/`** inside your terminal string to open the panel, drop your local tracks onto the workspace, and watch your audio bytes lock directly to on-chain blocks!
