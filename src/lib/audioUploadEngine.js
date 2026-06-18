// audioUploadEngine.js — Phase 1: the pure logic layer (no React, no DOM).
// Implements AUDIO_UPLOAD_SPEC_v2: 50MB cap, 256KB chunks, per-chunk retry x3,
// restart-on-failure, sequential streaming, progress + ETA, cancel.
// The React hook (Phase 2) will wrap this; keeping it pure makes it testable.

export const MAX_FILE_BYTES = 52_428_800 // 50 MB
export const CHUNK_BYTES = 262_144 // 256 KB
export const MAX_CHUNK_RETRIES = 3
export const CHUNK_TIMEOUT_MS = 60_000
export const ACCEPTED_TYPES = ['audio/wav', 'audio/flac', 'audio/mpeg', 'audio/ogg']

const CHUNK_ENDPOINT = '/api/v1/upload-audio/chunk'

// ---- validation (runs before a single byte leaves the browser) ----
export function validateFile(file) {
  if (!file) return { ok: false, code: 'validation', message: 'No file selected.' }
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

export function totalChunks(size) {
  return Math.ceil(size / CHUNK_BYTES)
}

// human-friendly size, used by the UI
export function fmtBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// POST one chunk with a timeout. Injectable fetchImpl for tests.
async function postChunk({ uploadId, index, total, blob, fetchImpl, timeoutMs, apiBase }) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(apiBase + CHUNK_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-upload-id': uploadId,
        'x-chunk-index': String(index),
        'x-total-chunks': String(total),
        'content-type': 'application/octet-stream',
      },
      body: blob,
      signal: ctrl.signal,
    })
    clearTimeout(t)
    return res
  } catch (e) {
    clearTimeout(t)
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) {
      const err = new Error('chunk timeout'); err.__timeout = true; throw err
    }
    throw e
  }
}

/**
 * Upload a file in sequential 256KB chunks.
 * @returns { ok:true, audioUri } | { ok:false, code, message, failedChunk? }
 *
 * opts:
 *   uploadId   string (frontend-generated session id)
 *   fetchImpl  fetch (injectable)
 *   apiBase    '' by default
 *   onProgress ({ index, total, percent, sentBytes, totalBytes, etaMs }) => void
 *   sliceFile  (file, start, end) => blob   (so tests can pass plain data)
 *   shouldCancel () => boolean
 *   timeoutMs / maxRetries  (defaults from spec)
 */
export async function uploadInChunks(file, opts = {}) {
  const {
    uploadId,
    fetchImpl = fetch,
    apiBase = '',
    onProgress = () => {},
    sliceFile = (f, s, e) => f.slice(s, e),
    shouldCancel = () => false,
    timeoutMs = CHUNK_TIMEOUT_MS,
    maxRetries = MAX_CHUNK_RETRIES,
    retryBackoffMs = 400,
  } = opts

  const v = validateFile(file)
  if (!v.ok) return v

  const total = totalChunks(file.size)
  const startedAt = Date.now()

  for (let index = 0; index < total; index++) {
    if (shouldCancel()) return { ok: false, code: 'cancelled', message: 'Upload cancelled.' }

    const start = index * CHUNK_BYTES
    const end = Math.min(start + CHUNK_BYTES, file.size)
    const blob = sliceFile(file, start, end)

    // per-chunk retry (restart-on-failure happens at the caller if this returns fail)
    let attempt = 0
    let lastErr = null
    let res = null
    while (attempt < maxRetries) {
      if (shouldCancel()) return { ok: false, code: 'cancelled', message: 'Upload cancelled.' }
      try {
        res = await postChunk({ uploadId, index, total, blob, fetchImpl, timeoutMs, apiBase })
        if (res && res.status >= 200 && res.status < 300) break // ack (200 mid, 201 final)
        // non-2xx -> treat as failure, retry
        lastErr = { status: res && res.status }
        res = null
      } catch (e) {
        lastErr = e
        if (e && e.__timeout) lastErr = { timeout: true }
      }
      attempt++
      if (attempt < maxRetries) await sleep(retryBackoffMs * attempt)
    }

    if (!res) {
      // exhausted retries on this chunk -> v1 restart-on-failure
      const timedOut = lastErr && lastErr.timeout
      return {
        ok: false,
        code: timedOut ? 'timeout' : 'chunk-fail',
        message: timedOut
          ? 'Upload timed out. Check your connection and try again.'
          : 'Upload failed mid-stream — not saved. Please try again.',
        failedChunk: index,
      }
    }

    // progress (after a successful ack)
    const sentBytes = end
    const done = index + 1
    const elapsed = Date.now() - startedAt
    const etaMs = done > 0 ? Math.round((elapsed / done) * (total - done)) : 0
    onProgress({
      index, total, percent: Math.round((done / total) * 100),
      sentBytes, totalBytes: file.size, etaMs,
    })

    // final chunk: backend returns { success, audioUri } on 201
    if (index === total - 1) {
      let body = {}
      try { body = await res.json() } catch (e) {}
      if (body && body.success && body.audioUri) {
        return { ok: true, audioUri: body.audioUri }
      }
      return { ok: false, code: 'finalize', message: 'Upload finished but no audioUri was returned.' }
    }
  }

  return { ok: false, code: 'finalize', message: 'No chunks were uploaded.' }
}
