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
