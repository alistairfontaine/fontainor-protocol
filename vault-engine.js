const fs = require('fs');

// This script simulates the "Vaulting" process
const record = JSON.parse(fs.readFileSync('registry.json', 'utf8'));

console.log("--- FONTAINOR VAULT ENGINE ---");
console.log("Preparing asset for permanent storage...");

// Create a local "vault" copy
const vaultFile = `vault/${record.assetId}.json`;
fs.writeFileSync(vaultFile, JSON.stringify(record, null, 2));

console.log("Asset VAULTED successfully at: " + vaultFile);
