import { TransactionInstruction, PublicKey } from "@solana/web3.js";

const FONTAINOR_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

export function createFontainorInstruction(
    payer: PublicKey,
    data: Buffer
): TransactionInstruction {
    return new TransactionInstruction({
        keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
        programId: FONTAINOR_PROGRAM_ID,
        data: data,
    });
}
