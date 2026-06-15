import Arweave from 'arweave';

const arweave = Arweave.init({
  host: 'localhost',
  port: 1984,
  protocol: 'http'
});

// REPLACE with the TxID you copied from your publish step
const txId = "OEk3-JuF1Y7VnSH940zGt9VDpw_i-E_W4SU-WOwfA40";

async function verify() {
  try {
    console.log(`Fetching transaction details for: ${txId}...`);
    const status = await arweave.transactions.getStatus(txId);
    console.log("Transaction Status:", status);

    // Optional: If it's text/json, retrieve and print the payload
    const data = await arweave.transactions.getData(txId, { decode: true, string: true });
    console.log("Data retrieved successfully:", data.substring(0, 200) + "...");
  } catch (err) {
    console.error("Verification failed:", err.message);
  }
}

verify();
