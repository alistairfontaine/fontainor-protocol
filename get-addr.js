import Arweave from 'arweave';
import fs from 'fs';

// Load the key
const key = JSON.parse(fs.readFileSync('./wallet-key.json', 'utf8'));

// Initialize Arweave (it doesn't need a full host for just deriving an address)
const arweave = Arweave.init({});

// Get and print the address
arweave.wallets.jwkToAddress(key).then(addr => {
  console.log("-----------------------------------------");
  console.log("YOUR WALLET ADDRESS IS:", addr);
  console.log("-----------------------------------------");
});
