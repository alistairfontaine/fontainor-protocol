// arweaveUploader.js
import Arweave from 'arweave'
import { createHash } from 'crypto'

export function sha256Hex(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  return createHash('sha256').update(buf).digest('hex')
}

export function initArweave({ host = 'localhost', port = 1984, protocol = 'http' } = {}) {
  return Arweave.init({ host, port, protocol })
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const e = new Error('upload timed out'); e.__timeout = true; reject(e)
    }, ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

export async function uploadManifest(manifestString, opts = {}) {
  const { arweave, wallet, timeoutMs = 30000, anchor, reward } = opts
  if (!arweave || !wallet) {
    return { success: false, error: 'uploader misconfigured', code: 'CONFIG' }
  }
  try {
    const hash = sha256Hex(manifestString)
    const fields = { data: manifestString }
    if (anchor != null) fields.last_tx = anchor
    if (reward != null) fields.reward = reward

    const tx = await arweave.createTransaction(fields, wallet)
    tx.addTag('Content-Type', 'application/json')
    tx.addTag('App-Name', 'Fontainor')
    tx.addTag('App-Version', 'v0.3')
    tx.addTag('Manifest-SHA256', hash)

    await arweave.transactions.sign(tx, wallet)

    const res = await withTimeout(arweave.transactions.post(tx), timeoutMs)
    const status = (res && res.status) != null ? res.status : 200

    if (status >= 200 && status < 300) {
      return { success: true, txId: tx.id, hash }
    }
    return { success: false, error: 'Node rejected (HTTP ' + status + ').', code: 'WRITE_' + status }
  } catch (e) {
    if (e && e.__timeout) {
      return { success: false, error: 'Upload exceeded ' + (timeoutMs / 1000) + 's.', code: 'TIMEOUT' }
    }
    return { success: false, error: String((e && e.message) || e), code: 'WRITE_ERR' }
  }
}
