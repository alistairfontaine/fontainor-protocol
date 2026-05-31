# Fontainor Protocol - Claude Primer
Project Context: Fontainor is an autonomous, decentralized registry for digital assets. 
Architecture: Full-stack node.js backend, Irys-based storage, JSON manifest registry.

Current Version: v0.3-development
Core Logic:
- server.js: Handles registry aggregation and Irys etching.
- pointer.json: The 'head' of the chain; stores the latest TxID.
- Data Flow: POST /upload -> validate -> etch to Irys -> update pointer.json -> response.

Goals for v0.3:
1. Schema Validation: Implement Zod/Joi for registry object structure validation on the /upload endpoint.
2. History Log: Maintain a rolling log (last 10 TxIDs) in a history.json to prevent state loss.
3. Media Ready: Ensure all metadata includes standardized audio/image URI fields for stream-readiness.

CRUCIAL NOTE. 2:22/ 5/31/26.
"Backend enforces strict Zod validation on POST /upload. Only accepts arrays of registry objects. Use import syntax for all modules."

# Fontainor Protocol - Project Rules

## Current Status 6:57 5/31/2026
- **Backend/Frontend Integration:** COMPLETED (PR #2 merged).
- **Validation:** Active via Zod middleware (`validator.js`).
- **Data Structure:** API now accepts and validates array-based payloads against `registrySchema`.
- **Infrastructure:** `/upload` route acts as a validation gatekeeper (Placeholder mode).

## Workflow Rules
1. All API payloads MUST adhere to `registrySchema` (array format).
2. Backend MUST return 200 for valid payloads and 400 for validation errors.
3. Frontend MUST handle Zod-formatted error messages from 400 responses.

## Upcoming Milestones
- Implement Library Grid (500+ asset support).
- Integrate Irys SDK for permanent decentralized storage on Arweave.
