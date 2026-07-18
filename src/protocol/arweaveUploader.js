// arweaveUploader.js
import Arweave from 'arweave';
import { createHash } from 'crypto';

export function sha256Hex(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return createHash('sha256').update(buf).digest('hex');
}

export function initArweave({ host = 'arweave.net', port = 443, protocol = 'https' } = {}) {
  return Arweave.init({ host, port, protocol });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const e = new Error('upload timed out'); e.__timeout = true; reject(e);
    }, ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function uploadManifest(manifestString, opts = {}) {
  const { arweave, wallet, timeoutMs = 30000 } = opts;

  try {
    // 1. Get the current Anchor
    const anchorRes = await arweave.api.get('/tx_anchor');
    const anchor = anchorRes.data;

    // 2. Calculate the Reward (Fee) based on data size
    const byteSize = Buffer.byteLength(manifestString, 'utf8');
    const priceRes = await arweave.api.get(`/price/${byteSize}`);
    const reward = priceRes.data;

    const hash = sha256Hex(manifestString);

    // 3. Create the transaction with the Anchor AND Reward
    const tx = await arweave.createTransaction({
      data: manifestString,
      last_tx: anchor,
      reward: reward
    }, wallet);

    tx.addTag('Content-Type', 'application/json');
    tx.addTag('App-Name', 'Fontainor');
    tx.addTag('App-Version', 'v0.3');
    tx.addTag('Manifest-SHA256', hash);

    await arweave.transactions.sign(tx, wallet);

    const res = await withTimeout(arweave.transactions.post(tx), timeoutMs);

    if (res.status >= 200 && res.status < 300) {
      return { success: true, txId: tx.id, hash };
    }

    return { success: false, error: 'Node rejected (HTTP ' + res.status + ').', code: 'WRITE_' + res.status };
  } catch (e) {
    return { success: false, error: String(e.message), code: 'WRITE_ERR' };
  }
}
