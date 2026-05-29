const fs = require('fs');

// 1. Load the Genesis architecture
const genesis = JSON.parse(fs.readFileSync('genesis.json', 'utf8'));

// 2. Generate a unique ID for this specific "Equity Edition"
const mintId = "FONT-" + Math.random().toString(36).substr(2, 9).toUpperCase();

// 3. Create the Registry record
const registryRecord = {
  assetId: mintId,
  name: genesis.name,
  artist: genesis.artist,
  timestamp: new Date().toISOString(),
  equity: genesis.equity_model,
  status: "REGISTERED_ON_FONTAINOR"
};

// 4. Save the record to your local "Blockchain Ledger" (a JSON file)
fs.writeFileSync('registry.json', JSON.stringify(registryRecord, null, 2));

console.log("Success! Minted Asset ID: " + mintId);
console.log("Registry updated. See registry.json");
