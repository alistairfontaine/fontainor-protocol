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

/** Solana mainnet RPC used by browser-side flows. */
export const SOLANA_RPC = (import.meta.env.VITE_SOLANA_RPC as string | undefined) || 'https://api.mainnet-beta.solana.com'
