// Edition purchases — real SOL payment from the collector's Phantom wallet.
// One transaction, two transfers: 98% to the artist, 2% to the protocol
// treasury (same split the registry has always promised). The signature is
// the on-chain receipt; the server re-verifies it and stores a durable
// purchase record when the durable store is configured.
import { API_BASE } from './api'
import { getConnectedPhantom, PhantomError, SOLANA_RPC } from './phantom'
import { TIP_WALLET } from '../config/support'
import { getSolUsd } from './solPrice'
import type { Release } from './registry'

export const TREASURY_WALLET = TIP_WALLET
export const PROTOCOL_FEE_RATE = 0.02

export interface PurchaseQuote {
  lamports: number
  sol: number
  usdShown: number | null
  /** How the listed price was converted ('SOL' listings need no conversion). */
  pricedIn: string
}

export interface PurchaseReceipt {
  trackId: string
  title: string
  artist: string
  artistWallet: string
  signature: string
  lamports: number
  buyerWallet: string
  at: string
  serverVerified: boolean
}

const KEY = 'fontainor_purchases_v1'

export function loadPurchases(): PurchaseReceipt[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as PurchaseReceipt[]) : []
  } catch {
    return []
  }
}

export function hasPurchased(trackId: string): PurchaseReceipt | undefined {
  return loadPurchases().find((p) => p.trackId === trackId)
}

function savePurchase(r: PurchaseReceipt): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([r, ...loadPurchases()].slice(0, 200)))
  } catch {
    /* private mode — the on-chain receipt still exists */
  }
}

/** A release is purchasable when it has a price and a payout wallet on record. */
export function isPurchasable(rel: Release): boolean {
  return rel.type === 'release' && rel.price.amount > 0 && !!rel.artistWallet
}

/** Convert the listed price to lamports. USD/USDC/USDT convert at the live SOL quote. */
export async function quotePurchase(rel: Release): Promise<PurchaseQuote> {
  const { amount, currency } = rel.price
  if (currency === 'SOL') {
    const usd = await getSolUsd()
    return { lamports: Math.round(amount * 1e9), sol: amount, usdShown: usd ? amount * usd : null, pricedIn: 'SOL' }
  }
  // USD-pegged listings (USD / USDC / USDT) are settled in SOL at the live rate.
  const usdRate = await getSolUsd()
  if (!usdRate) throw new PhantomError('network', 'Live SOL price unavailable — try again in a moment.')
  const sol = amount / usdRate
  return { lamports: Math.round(sol * 1e9), sol, usdShown: amount, pricedIn: currency }
}

export interface PurchaseResult {
  ok: boolean
  msg: string
  receipt?: PurchaseReceipt
}

/** Execute the purchase: one Phantom approval, 98/2 split, on-chain receipt. */
export async function purchase(rel: Release, quote: PurchaseQuote): Promise<PurchaseResult> {
  try {
    if (!rel.artistWallet) throw new Error('This release has no payout wallet on record.')
    const provider = await getConnectedPhantom()
    const buyer = provider.publicKey?.toString()
    if (!buyer) throw new PhantomError('rejected', 'Wallet not connected.')

    const { Connection, PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js')
    const connection = new Connection(SOLANA_RPC, 'confirmed')

    const treasuryLamports = Math.floor(quote.lamports * PROTOCOL_FEE_RATE)
    const artistLamports = quote.lamports - treasuryLamports

    const buyerKey = new PublicKey(buyer)
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: buyerKey, toPubkey: new PublicKey(rel.artistWallet), lamports: artistLamports }),
      SystemProgram.transfer({ fromPubkey: buyerKey, toPubkey: new PublicKey(TREASURY_WALLET), lamports: treasuryLamports }),
    )
    tx.feePayer = buyerKey
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash

    let signature: string
    try {
      ;({ signature } = await provider.signAndSendTransaction(tx))
    } catch (e) {
      const m = String((e as Error)?.message || e)
      if (/insufficient|not enough/i.test(m)) return { ok: false, msg: 'Not enough SOL in the wallet for this purchase.' }
      return { ok: false, msg: 'The purchase was declined in Phantom — nothing was charged.' }
    }

    // Wait for confirmation so the receipt is real before we claim success.
    let confirmed = false
    for (let i = 0; i < 20; i++) {
      const st = (await connection.getSignatureStatuses([signature])).value[0]
      if (st?.err) return { ok: false, msg: 'The transaction failed on-chain — nothing was collected. ' + JSON.stringify(st.err) }
      if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') {
        confirmed = true
        break
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    if (!confirmed) {
      return {
        ok: false,
        msg: `The transaction was sent but has not confirmed yet. Check the receipt before retrying: ${solscanTx(signature)}`,
      }
    }

    // Server-side re-verification + durable receipt (best-effort).
    let serverVerified = false
    try {
      const res = await fetch(API_BASE + '/api/v1/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          artistWallet: rel.artistWallet,
          amountLamports: quote.lamports,
          buyerWallet: buyer,
          currency: 'SOL',
          trackId: rel.id,
        }),
      })
      serverVerified = res.ok && ((await res.json().catch(() => ({}))) as { verified?: boolean }).verified === true
    } catch {
      /* the on-chain signature remains the source of truth */
    }

    const receipt: PurchaseReceipt = {
      trackId: rel.id,
      title: rel.title,
      artist: rel.artist,
      artistWallet: rel.artistWallet,
      signature,
      lamports: quote.lamports,
      buyerWallet: buyer,
      at: new Date().toISOString(),
      serverVerified,
    }
    savePurchase(receipt)
    return { ok: true, msg: 'Collected — 98% went straight to the artist.', receipt }
  } catch (e) {
    if (e instanceof PhantomError) return { ok: false, msg: e.message }
    return { ok: false, msg: 'Purchase failed: ' + String((e as Error)?.message || e) }
  }
}

export const solscanTx = (sig: string): string => `https://solscan.io/tx/${sig}`
