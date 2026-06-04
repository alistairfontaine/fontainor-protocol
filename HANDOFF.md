# Fontainor Protocol - Developer Hand-off

## Logic Overview
- **TransactionBuilder**: Located in `src/protocol/transactionBuilder.ts`. Handles instruction construction for the Solana program.
- **StorageUtils**: Located in `src/protocol/storageUtils.ts`. Handles file hashing (SHA-256) and metadata structure for Irys/Arweave uploads.

## Current Status
- Both modules are verified and passing local `tsx` tests.
- Dependencies: `@solana/web3.js` and Node's native `crypto` module.

## Pending Items for Integration
1. Connect the `generateFileHash` output to the `data` field in the TransactionBuilder.
2. Finalize the Irys Uploader integration using the `FileMetadata` structure defined in `storageUtils`.
