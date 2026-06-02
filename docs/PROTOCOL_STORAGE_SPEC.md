# Protocol Storage Specification (Irys/Arweave)

## Network
- Target: **Devnet** (Initial stage for smoke testing).

## Response Shapes
Backend services must return the following JSON structures to maintain UI compatibility[cite: 1]:

- **Success:**
  {
    "success": true,
    "txId": "string"
  }

- **Failure (Write Error):**
  {
    "success": false,
    "error": "string",
    "code": "string"
  }

## Performance
- **Timeout Threshold:** 30 seconds[cite: 1].
- UI should maintain "Etching" state within this window.
