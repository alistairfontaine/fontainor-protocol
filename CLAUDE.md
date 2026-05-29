# Fontainor Protocol - Project Briefing

## Architecture Rules
1. **Never modify the v0.1 Core logic** (`genesis.json`, `registry.json` structure) without explicit approval from the Lead Architect.
2. **Network Agnostic:** All logic must be ready to switch from `ArLocal` to `Arweave Mainnet` via config settings.
3. **Extend, Don't Replace:** New features (Tipping, Social) should be added as extensions to the existing objects, not by overwriting core data.
4. **Data Integrity:** The `support_ledger` must remain immutable once recorded.

## Workflow
- Always work in the `v0.2-development` branch.
- Before starting a new task, create a plan and verify it against the `registry.json` schema.
- Use `social.js` for all tipping/support logic.
