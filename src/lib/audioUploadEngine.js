export const MAX_FILE_BYTES = 52_428_800
export const ACCEPTED_TYPES = ['audio/wav', 'audio/flac', 'audio/mpeg', 'audio/ogg']

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

// Placeholder — upload is now manual via Arweave TX ID paste
export async function uploadInChunks(file, opts = {}) {
  return { ok: false, code: 'deprecated', message: 'Direct upload disabled. Please paste your Arweave TX ID.' }
}
