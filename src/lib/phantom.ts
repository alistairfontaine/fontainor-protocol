// Shared Phantom wallet provider access (injected `window.solana`).
// Used by the tip jar, the musician-pays publish flow, and purchases.

export interface PhantomLike {
  isPhantom?: boolean
  publicKey?: { toString(): string; toBytes(): Uint8Array } | null
  connect(): Promise<{ publicKey: { toString(): string } }>
  signAndSendTransaction(tx: unknown): Promise<{ signature: string }>
  signMessage?(msg: Uint8Array, encoding: string): Promise<{ signature: Uint8Array }>
}

export function getPhantom(): PhantomLike | null {
  const w = window as unknown as { solana?: PhantomLike; phantom?: { solana?: PhantomLike } }
  const p = w.solana ?? w.phantom?.solana ?? null
  return p?.isPhantom ? p : null
}

/** Get a connected Phantom provider, prompting the connect popup if needed. */
export async function getConnectedPhantom(): Promise<PhantomLike> {
  const provider = getPhantom()
  if (!provider) throw new PhantomError('no-wallet', 'Phantom wallet not detected. Install it from phantom.com and refresh.')
  if (!provider.publicKey) {
    try {
      await provider.connect()
    } catch {
      throw new PhantomError('rejected', 'Wallet connection was declined in Phantom.')
    }
  }
  return provider
}

export type PhantomErrorKind = 'no-wallet' | 'rejected' | 'insufficient' | 'network'

export class PhantomError extends Error {
  kind: PhantomErrorKind
  constructor(kind: PhantomErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * Solana mainnet RPCs used by browser-side flows, in preference order.
 * api.mainnet-beta.solana.com 403s browser/dApp traffic (verified 2026-07-27),
 * so it is only a last-resort fallback; publicnode is CORS-open (`ACAO: *`)
 * and keyless. Operators can pin a dedicated endpoint (Helius/QuickNode/...)
 * via VITE_SOLANA_RPC at build time — it then takes first priority.
 */
export const SOLANA_RPC_ENDPOINTS: string[] = [
  ...((import.meta.env.VITE_SOLANA_RPC as string | undefined) ? [import.meta.env.VITE_SOLANA_RPC as string] : []),
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
]

/** Back-compat single endpoint (first preference). Prefer getWorkingRpc(). */
export const SOLANA_RPC = SOLANA_RPC_ENDPOINTS[0]

let workingRpc: string | null = null

/**
 * Resolve a mainnet RPC that actually answers from this browser by probing
 * `getLatestBlockhash` down the endpoint list. Result is cached for the
 * session; cache is cleared on failure by the caller retrying.
 */
export async function getWorkingRpc(): Promise<string> {
  if (workingRpc) return workingRpc
  for (const url of SOLANA_RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' }),
      })
      if (!res.ok) continue
      const d = (await res.json()) as { result?: { value?: { blockhash?: string } } }
      if (d.result?.value?.blockhash) {
        workingRpc = url
        return url
      }
    } catch {
      /* try next endpoint */
    }
  }
  // Nothing answered — return first preference so the caller surfaces the
  // real network error instead of a synthetic one.
  return SOLANA_RPC_ENDPOINTS[0]
}
