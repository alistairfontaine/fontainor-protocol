// test-arlocal-upload.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// SAFE LOADING: Try to find the constructor in any of the common export formats
const mod = require('arlocal');
const ArLocal = mod.ArLocal || mod.default || mod;

import { initArweave, uploadManifest, sha256Hex } from './src/protocol/arweaveUploader.js';

const PORT = 1984;

// Debug check
if (typeof ArLocal !== 'function') {
  console.error("CRITICAL: ArLocal is not a function/constructor. It is:", typeof ArLocal);
  console.error("Module content:", mod);
  process.exit(1);
}

const arLocal = new ArLocal(PORT, false);

async function main() {
  await arLocal.start();
  const arweave = initArweave({ host: 'localhost', port: PORT, protocol: 'http' });

  // wallet + fund it from ArLocal's faucet
  const wallet = await arweave.wallets.generate();
  const address = await arweave.wallets.jwkToAddress(wallet);
  await fetch(`http://localhost:${PORT}/mint/${address}/10000000000000`);

  const registry = [{
    id: 'GEN-1', title: 'Genesis', artist: 'Alistair Fontaine',
    price: { amount: 29.99, currency: 'USD' }, editions: { total: 200 },
    status: 'REGISTERED_ON_FONTAINOR', date: new Date().toISOString(),
    audioUri: null, coverUri: null,
  }];
  const manifest = JSON.stringify(registry);
  const expectHash = sha256Hex(manifest);

  const result = await uploadManifest(manifest, { arweave, wallet });
  console.log('upload result:', result);

  await fetch(`http://localhost:${PORT}/mine`);

  const back = await arweave.transactions.getData(result.txId, { decode: true, string: true });
  const backHash = sha256Hex(back);

  const checks = {
    'upload returned success': result.success === true,
    'got a txId': typeof result.txId === 'string' && result.txId.length > 10,
    'fetched content === original manifest': back === manifest,
    'hash survived round trip': backHash === expectHash && result.hash === expectHash,
  };

  let ok = true;
  for (const k in checks) {
    console.log((checks[k] ? 'PASS' : 'FAIL') + ' - ' + k);
    if (!checks[k]) ok = false;
  }
  console.log(ok ? '\nARLOCAL E2E OK ✅' : '\nARLOCAL E2E FAIL ❌');

  await arLocal.stop();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("Test failed with error:", e);
  try { await arLocal.stop(); } catch {}
  process.exit(1);
});
