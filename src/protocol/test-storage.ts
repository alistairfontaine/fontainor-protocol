import { prepareMetadata } from "./storageUtils";

const fileName = "fontainor-spec-v1.pdf";
const dummyData = Buffer.from("Example file content for the protocol");

const metadata = prepareMetadata(fileName, dummyData);

console.log("--- Storage Spec Verification ---");
console.log("File Name:", metadata.fileName);
console.log("SHA-256 Hash:", metadata.hash);
console.log("Timestamp:", metadata.timestamp);
console.log("Status: Metadata ready for Irys/Arweave upload.");
