import { Keypair } from "@solana/web3.js";
import { createFontainorInstruction } from "./transactionBuilder";

const dummyWallet = Keypair.generate();
const data = Buffer.from("Hello Fontainor Protocol");
const instruction = createFontainorInstruction(dummyWallet.publicKey, data);

console.log("--- Protocol Builder Test ---");
console.log("Program ID:", instruction.programId.toBase58());
console.log("Success: Instruction created without errors.");
