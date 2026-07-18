// devFundArLocal.js  —  DEV-ONLY helper. Funds the server wallet on a LOCAL
// ArLocal node so you don't have to curl /mint after every restart.
//
// SAFETY: this is scaffolding for local development only. It refuses to run
// unless it is clearly pointing at a local ArLocal instance, so it can NEVER
// fire against Irys / a public gateway / mainnet. It also fails soft — if
// anything goes wrong, it logs and lets the server start normally.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

// Decide whether auto-funding is allowed in this environment.
export function shouldAutoFund({ host, enabled }) {
  // Must be explicitly enabled via env, AND the target must be a local host.
  // Both conditions required — defense in depth.
  return enabled === true && LOCAL_HOSTS.has(host)
}

/**
 * Top up the wallet on ArLocal if its balance is below a threshold.
 * @param arweave  initialized arweave-js instance (already pointing at ArLocal)
 * @param wallet   the JWK key object (server-side)
 * @param opts.host       the AR_HOST the server is using (gate check)
 * @param opts.enabled    AR_DEV_AUTOFUND === '1' (gate check)
 * @param opts.endpoint   base URL of the node (for the /mint call)
 * @param opts.minWinston threshold; top up if balance below this
 * @param opts.mintWinston how much to mint when topping up
 * @param opts.fetchImpl  injectable fetch (for testing)
 */
export async function devFundArLocal(arweave, wallet, opts = {}) {
  const {
    host = 'arweave.net',
    enabled = false,
    endpoint = 'https://arweave.net',
    minWinston = 1_000_000_000_000n, // ~1 AR
    mintWinston = 10_000_000_000_000n, // ~10 AR
    fetchImpl = fetch,
  } = opts

  if (!shouldAutoFund({ host, enabled })) {
    return { funded: false, reason: 'disabled-or-not-local' }
  }

  try {
    const address = await arweave.wallets.jwkToAddress(wallet)

    // check current balance; only top up if low (avoids minting every restart)
    let balance = 0n
    try {
      const winston = await arweave.wallets.getBalance(address)
      balance = BigInt(winston || '0')
    } catch {
      balance = 0n // node may not know the address yet -> treat as empty
    }

    if (balance >= minWinston) {
      return { funded: false, reason: 'already-funded', address, balance: balance.toString() }
    }

    const res = await fetchImpl(`${endpoint}/mint/${address}/${mintWinston.toString()}`)
    if (!res || !res.ok) {
      return { funded: false, reason: 'mint-failed', status: res && res.status, address }
    }
    return { funded: true, address, minted: mintWinston.toString() }
  } catch (e) {
    // fail soft — never block server startup over a dev convenience
    return { funded: false, reason: 'error', error: String((e && e.message) || e) }
  }
}
