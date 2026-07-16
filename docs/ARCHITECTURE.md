# Fontainor Protocol Full-Stack Architecture Specification
This specification matrix documents the low-level data design, streaming ingress mechanics, and validation perimeters governing the Fontainor Protocol (v0.4-development) ecosystem.

---## 📐 1. Full-Stack Data Ingress Layer (Sequential Chunking)
To support massive audio files (up to 50MB) natively inside a web browser without causing thread blockage or heap exhaustion, the platform utilizes an asynchronous binary slicing pipeline.


[ Local Client Audio File ]
│
▼ (256KB Slices)
[ application/octet-stream ] ──► [ express.raw Middleware ]
│ │
▼ (x-chunk-index) ▼ (In-Memory Map)
[ Sequential Fetch Stream ] [ uploadBuffer Assembly ]
│
▼ (Buffer.concat)
[ Uint8Array Cast & Sign ]
│
▼
[ Local ArLocal Ledger ]


### ⚙️ 1.1 Ingress Technical Protocols
1. **Frontend Chunking Engine (`src/lib/audioUploadEngine.js`):** Leverages a pure, non-DOM JavaScript worker framework to split target audio files into exact 262,144-byte (256KB) fragments. Chunks are transmitted sequentially via HTTP `POST` requests.
2. **Metadata Headers Contract:** Every transaction packet injects three strict tracking headers to cross-examine delivery states:
   - `x-upload-id`: Unique cryptographic session hash.
   - `x-chunk-index`: Chronological integer tracking index (0 to total - 1).
   - `x-total-chunks`: Absolute count boundary of the asset bitstream.
3. **Backend Buffer Assembly (`server.js`):** Intercepts raw incoming byte streams via `express.raw` middleware, bypassing multipart form-data parser overhead. An in-memory `Map` object index (`uploadBuffer`) stacks the incoming blocks until the final index arrives, executing an atomic `Buffer.concat()` aggregation.

---

## 🔒 2. Cryptographic Validation & Storage Perimeters

### 🛡️ 2.1 Native Arweave Transaction Signing
The platform completely drops third-party layer-2 aggregation dependencies inside the chunk assembly finalizer to prevent endpoint routing failures on local nodes.
- The backend reads the local `wallet-key.json` credentials to instantiate a native `arweave.createTransaction` container.
- **The Binary Type Cast:** To prevent server-side runtime object crashes, the concatenated Node.js Buffer is forcefully unpacked into a standard web `Uint8Array` before transaction allocation.
- The transaction block is cryptographically signed and posted directly onto port `1984` to be processed instantly by the local test-ledger node.

### 🚥 2.2 Elastic Cross-Generational Validation Gate (`validator.js`)
The validation perimeter utilizes a loose `z.array(z.any())` Zod verification schema rule. This choice enforces full cross-generational data compliance, allowing the on-chain distributed database to seamlessly read and catalog flat legacy tracks (v0.2 metadata spec) alongside modern nested asset structures (v0.4 metadata objects) without throwing validation dropouts or parsing exceptions.

---

## 💿 3. State Management & Rollback Protection

- **`pointer.json` Ledger:** Tracks the active root registry transaction address across server restarts to eliminate environment-variable variable injection dependencies.
- **10-TxID Rolling History Queue:** Restructures file writes into a bounded chronological stack. The file-write system automatically shifts old transaction records back, truncating the collection to exactly 10 slots to enforce a lean disk footprint while providing robust data rollback protection.
