/**
 * Fontainor Payment Bridge - v0.2
 * Handles the "Gasless" Economic Model:
 * 1. Takes payment.
 * 2. Splits off 2% for the "Community Treasury" (Gas Bank).
 * 3. Sends the remainder to the artist.
 * 4. Records the social event in the registry.
 */

const { processTip } = require('./social.js');

// Configuration
const TREASURY_WALLET = "0xFontainorTreasuryAddress"; // Your "Gas Bank"
const PROTOCOL_FEE_RATE = 0.02; // 2% fee

async function handlePayment(registry, paymentDetails) {
    console.log("--- Starting Payment Orchestration ---");

    // 1. Calculate the Split
    const treasuryShare = paymentDetails.amount * PROTOCOL_FEE_RATE;
    const artistShare = paymentDetails.amount - treasuryShare;

    // 2. Mock Logic: In production, this would trigger the actual blockchain transfer
    console.log(`[Treasury] Routing ${treasuryShare.toFixed(4)} USDC to Gas Bank.`);
    console.log(`[Artist] Sending ${artistShare.toFixed(4)} USDC to Artist.`);

    // 3. Verify Transaction (Crucial: only proceed if payment is confirmed)
    const isVerified = await verifyOnChainTransaction(paymentDetails.txHash);

    if (!isVerified) {
        throw new Error("Payment verification failed. No registry updates performed.");
    }

    // 4. Update the Registry via our Social Engine
    // We pass the net amount (artistShare) to the ledger
    return processTip(registry, paymentDetails.sender, artistShare);
}

// Simple verification stub
async function verifyOnChainTransaction(txHash) {
    console.log(`Verifying on-chain transaction: ${txHash}...`);
    // Placeholder: logic would go here to confirm txHash exists on Arweave/Mainnet
    return true;
}

module.exports = { handlePayment };
