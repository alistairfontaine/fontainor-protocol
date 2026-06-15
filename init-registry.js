import Arweave from 'arweave';
import fs from 'fs';

const arweave = Arweave.init({
  host: 'localhost',
  port: 1984,
  protocol: 'http'
});

async function initRegistry() {
  console.log("Loading wallet...");
  const wallet = JSON.parse(fs.readFileSync('./wallet-key.json', 'utf8'));

  // Define an empty registry structure (adjust if yours is different)
  const registry = {
    version: "0.1",
    items: [],
    description: "Fontainor Protocol Genesis Registry"
  };

  console.log("Creating transaction...");
  const tx = await arweave.createTransaction({
    data: JSON.stringify(registry)
  }, wallet);

  tx.addTag('Content-Type', 'application/json');
  tx.addTag('App-Name', 'Fontainor');

  console.log("Signing and uploading...");
  await arweave.transactions.sign(tx, wallet);
  const result = await arweave.transactions.post(tx);

  if (result.status === 200) {
    console.log("SUCCESS! New Registry ID:", tx.id);

    // Update pointer.json automatically
    const pointerData = { txId: tx.id };
    fs.writeFileSync('pointer.json', JSON.stringify(pointerData, null, 2));
    console.log("pointer.json has been updated.");
  } else {
    console.error("Upload failed with status:", result.status);
  }
}

initRegistry().catch(console.error);
