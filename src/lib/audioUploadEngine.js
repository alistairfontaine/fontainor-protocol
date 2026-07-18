import { WebIrys } from "@irys/sdk";

export const MAX_FILE_BYTES = 52_428_800;
export const ACCEPTED_TYPES = ['audio/wav', 'audio/flac', 'audio/mpeg', 'audio/ogg'];

export function validateFile(file) {
  if (!file) return { ok: false, code: 'validation', message: 'No file selected.' }
  if (file.type.startsWith('image/')) {
    if (file.size > 10 * 1024 * 1024) {
      return { ok: false, code: 'validation', message: 'Cover artwork image cannot exceed 10 MB.' }
    }
    return { ok: true }
  }
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, code: 'validation', message: 'Unsupported format. Please upload a WAV, FLAC, MP3, or OGG file.' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, code: 'validation', message: 'File is over 50 MB. Please compress or trim the track.' }
  }
  if (file.size === 0) {
    return { ok: false, code: 'validation', message: 'File appears to be empty.' }
  }
  return { ok: true }
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

async function getIrys() {
  const provider = window?.solana || window?.phantom?.solana;
  if (!provider) throw new Error('Wallet not connected. Please connect Phantom first.');

  const irys = new WebIrys({
    url: "https://node1.irys.xyz",
    token: "solana",
    wallet: { provider, name: "phantom" }
  });

  await irys.ready();
  return irys;
}

export async function uploadInChunks(file, opts = {}) {
  const { onProgress = () => {}, shouldCancel = () => false } = opts;

  const v = validateFile(file);
  if (!v.ok) return v;

  if (shouldCancel()) return { ok: false, code: 'cancelled', message: 'Upload cancelled.' };

  try {
    onProgress({ percent: 5, etaMs: 5000 });

    const irys = await getIrys();

    onProgress({ percent: 25, etaMs: 8000 });

    const tags = [
      { name: "Content-Type", value: file.type || "application/octet-stream" },
      { name: "App-Name", value: "Fontainor" }
    ];

    // Convert File to ArrayBuffer for browser crypto compatibility
    const fileBuffer = await file.arrayBuffer();
    const data = Buffer.from(fileBuffer);
    const receipt = await irys.upload(data, { tags });

    onProgress({ percent: 100, etaMs: 0 });

    const txId = receipt.id;
    return { ok: true, audioUri: `https://arweave.net/${txId}` };

  } catch (err) {
    console.error('[Fontainor] Irys upload failed:', err);
    const msg = err.message || '';
    if (msg.includes('balance') || msg.includes('fund') || msg.includes('insufficient') || msg.includes('not enough')) {
      return {
        ok: false,
        code: 'funding',
        message: 'Not enough SOL to store this file on Arweave. Please add SOL to your wallet and try again.'
      };
    }
    if (msg.includes('cancel') || msg.includes('abort') || msg.includes('rejected')) {
      return {
        ok: false,
        code: 'cancelled',
        message: 'Upload cancelled by user.'
      };
    }
    return {
      ok: false,
      code: 'upload-fail',
      message: err.message || 'Upload to Arweave failed. Please try again.'
    };
  }
}
