// paymentBridge.js — Solana payment verification for edition purchases.
// Verifies that a buyer's transaction actually delivered the 98/2 split
// (98% artist, 2% protocol treasury) on-chain before a purchase is recorded.
import { Connection, PublicKey } from '@solana/web3.js';

const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');

/** Protocol treasury (same wallet as the /support tip jar). Override via env. */
export const PROTOCOL_TREASURY_ADDRESS =
    process.env.TREASURY_WALLET || '6Bh5tpmUAVFWxWUPrMvyLCmSo5CouNVauMptgCumW2Fo';

/** 2% protocol treasury share; the remaining 98% goes to the artist. */
export const PROTOCOL_FEE_RATE = 0.02;

/**
 * Verify a purchase transaction on the Solana ledger.
 * Confirms the transaction exists, did not fail, and that the artist and
 * treasury balances increased by at least their share of the expected amount.
 *
 * `buyerWalletStr` is required and must be one of the transaction's SIGNERS,
 * in addition to losing at least the price. Balance movement alone is not
 * identity proof: a non-signer account may legitimately lose lamports during
 * another instruction, and could otherwise claim somebody else's receipt.
 *
 * @param {string} signature - Transaction signature from the buyer's wallet.
 * @param {string} artistWalletStr - Artist's public key (base58).
 * @param {number} expectedAmountLamports - Total price in lamports.
 * @param {string} [currency]
 * @param {string} buyerWalletStr - Claimed buyer wallet (base58), verified as signer + payer.
 * @returns {Promise<boolean>}
 */
export async function verifySolanaPayment(signature, artistWalletStr, expectedAmountLamports, currency = 'SOL', buyerWalletStr = null) {
    try {
        if (!signature || !artistWalletStr || !buyerWalletStr || !(expectedAmountLamports > 0)) return false;
        if (currency !== 'SOL') return false; // v1: native SOL transfers only

        let txInfo = null;
        let attempts = 5;
        while (attempts > 0) {
            txInfo = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
            if (txInfo) break;
            attempts--;
            if (attempts > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
        }
        if (!txInfo) {
            console.error('Payment verification: signature not found on-chain.');
            return false;
        }
        if (txInfo.meta && txInfo.meta.err) {
            console.error('Payment verification: transaction failed on-chain.');
            return false;
        }

        const accountKeys = txInfo.transaction.message.getAccountKeys
            ? txInfo.transaction.message.getAccountKeys().staticAccountKeys
            : txInfo.transaction.message.accountKeys;

        const artistPubKey = new PublicKey(artistWalletStr);
        const treasuryPubKey = new PublicKey(PROTOCOL_TREASURY_ADDRESS);
        const artistIdx = accountKeys.findIndex((key) => key.equals(artistPubKey));
        const treasuryIdx = accountKeys.findIndex((key) => key.equals(treasuryPubKey));
        if (artistIdx === -1 || treasuryIdx === -1) return false;

        const artistReceived = txInfo.meta.postBalances[artistIdx] - txInfo.meta.preBalances[artistIdx];
        const treasuryReceived = txInfo.meta.postBalances[treasuryIdx] - txInfo.meta.preBalances[treasuryIdx];

        const expectedTreasury = Math.floor(expectedAmountLamports * PROTOCOL_FEE_RATE);
        const expectedArtist = expectedAmountLamports - expectedTreasury;

        // Small tolerance: client rounds the split with integer lamports.
        if (!(artistReceived >= expectedArtist - 10 && treasuryReceived >= expectedTreasury - 10)) return false;

        const buyerPubKey = new PublicKey(buyerWalletStr);
        const buyerIdx = accountKeys.findIndex((key) => key.equals(buyerPubKey));
        if (buyerIdx === -1) return false;
        const requiredSigners = Number(txInfo.transaction.message.header?.numRequiredSignatures) || 0;
        if (buyerIdx >= requiredSigners) return false;
        const buyerPaid = txInfo.meta.preBalances[buyerIdx] - txInfo.meta.postBalances[buyerIdx];
        // The claimed buyer must have paid at least the price (fees make it more).
        if (buyerPaid < expectedAmountLamports - 10) return false;

        return true;
    } catch (err) {
        console.error('Payment verification crashed:', err.message);
        return false;
    }
}
