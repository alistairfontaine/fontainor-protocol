// Edition purchases — real SOL payment from the collector's Phantom wallet.
// One transaction, two transfers: 98% to the artist, 2% to the protocol
// treasury (same split the registry has always promised). The signature is
// the on-chain receipt; the server re-verifies it and stores a durable
// purchase record when the durable store is configured.
import { useSyncExternalStore } from 'react'
import { API_BASE } from './api'
import { getConnectedPhantom, getWorkingRpc, PhantomError } from './phantom'
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

// Reactive store so the Profile updates live when receipts arrive from the
// durable server record (wallet-portable collection) or a fresh purchase.
type Listener = () => void
const listeners = new Set<Listener>()

function readStored(): PurchaseReceipt[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as PurchaseReceipt[]) : []
  } catch {
    return []
  }
}

let cache: PurchaseReceipt[] = readStored()

function persist(next: PurchaseReceipt[]): void {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode — the on-chain receipt still exists */
  }
  listeners.forEach((l) => l())
}

export function loadPurchases(): PurchaseReceipt[] {
  return cache
}

/**
 * The receipt store is shared by the browser profile, not by a wallet account.
 * Always scope collection reads to the active wallet; otherwise wallet B sees
 * wallet A's locally cached receipts after an account switch (and logout still
 * shows the previous person's collection).
 */
export function purchasesForWallet(wallet: string | null | undefined): PurchaseReceipt[] {
  if (!wallet) return []
  return cache.filter((p) => p.buyerWallet === wallet)
}

export function subscribePurchases(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** React hook: live view of the local receipt list. */
export function usePurchases(): PurchaseReceipt[] {
  return useSyncExternalStore(subscribePurchases, loadPurchases)
}

export function hasPurchased(trackId: string, buyerWallet: string | null | undefined): PurchaseReceipt | undefined {
  if (!buyerWallet) return undefined
  return cache.find((p) => p.trackId === trackId && p.buyerWallet === buyerWallet)
}

function savePurchase(r: PurchaseReceipt): void {
  persist([r, ...cache].slice(0, 500))
}

/** Merge receipts recovered from the durable server record (dedup by signature). */
export function mergePurchases(incoming: PurchaseReceipt[]): void {
  const known = new Set(cache.map((p) => p.signature))
  const fresh = incoming.filter((p) => p.signature && !known.has(p.signature))
  if (fresh.length === 0) return
  const merged = [...cache, ...fresh].sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  persist(merged.slice(0, 500))
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
    const connection = new Connection(await getWorkingRpc(), 'confirmed')

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
