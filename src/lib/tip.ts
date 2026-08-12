// Tip jar money path — the same honesty rules the purchase path follows.
//
// A signature is NOT a payment. `signAndSendTransaction` resolves as soon as
// the wallet hands the transaction to an RPC node, so a dropped or
// blockhash-expired transfer used to be reported to the tipper as "Tip sent".
// Every send here waits for a real confirmation, reports on-chain failures,
// and always hands back the signature so a slow-but-landed transfer can be
// checked instead of paid twice.
import { getConnectedPhantom, getWorkingRpc, PhantomError } from './phantom'
import { solscanTx } from './purchase'
import { TIP_WALLET } from '../config/support'

/** Outcome of a tip attempt. `signature` is present whenever SOL may have left the wallet. */
export interface TipResult {
  ok: boolean
  /** 'cancelled' is a user decline — never an error to apologise for. */
  kind: 'sent' | 'cancelled' | 'no-wallet' | 'insufficient' | 'unconfirmed' | 'failed'
  msg: string
  signature?: string
  explorerUrl?: string
}

const CONFIRM_ATTEMPTS = 20
const CONFIRM_DELAY_MS = 1500

/** Send `amount` SOL to the protocol wallet, resolving only once the network agrees. */
export async function sendTip(
  amount: number,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<TipResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, kind: 'failed', msg: 'Pick a tip amount above zero.' }
  }

  let provider
  try {
    provider = await getConnectedPhantom()
  } catch (e) {
    if (e instanceof PhantomError) {
      return {
        ok: false,
        kind: e.kind === 'rejected' ? 'cancelled' : 'no-wallet',
        msg:
          e.kind === 'rejected'
            ? 'No problem — the tip was cancelled.'
            : `${e.message} You can also copy the address below and send from any wallet.`,
      }
    }
    return { ok: false, kind: 'no-wallet', msg: 'No wallet available — copy the address below and send from any wallet.' }
  }

  const from = provider.publicKey?.toString()
  if (!from) {
    return { ok: false, kind: 'no-wallet', msg: 'Wallet not connected — connect Phantom and try again.' }
  }

  let signature: string
  let connection: { getSignatureStatuses: (s: string[]) => Promise<{ value: ({ err?: unknown; confirmationStatus?: string } | null)[] }> }
  try {
    const { Connection, PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js')
    connection = new Connection(await getWorkingRpc(), 'confirmed') as unknown as typeof connection
    const fromKey = new PublicKey(from)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKey,
        toPubkey: new PublicKey(TIP_WALLET),
        lamports: Math.round(amount * 1e9),
      }),
    )
    tx.feePayer = fromKey
    tx.recentBlockhash = (
      await (connection as unknown as { getLatestBlockhash: () => Promise<{ blockhash: string }> }).getLatestBlockhash()
    ).blockhash
    ;({ signature } = await provider.signAndSendTransaction(tx))
  } catch (e) {
    const m = String((e as Error)?.message || e)
    if (/reject|denied|cancel|declin/i.test(m)) return { ok: false, kind: 'cancelled', msg: 'No problem — the tip was cancelled.' }
    if (/insufficient|not enough|0x1\b/i.test(m))
      return { ok: false, kind: 'insufficient', msg: 'Not enough SOL in the wallet for that tip (plus network fee).' }
    return {
      ok: false,
      kind: 'failed',
      msg: `Couldn't send the tip (${m}). You can copy the address below and send from any wallet instead.`,
    }
  }

  if (!signature || typeof signature !== 'string') {
    return { ok: false, kind: 'failed', msg: "The wallet returned no transaction id, so the tip can't be confirmed. Nothing was recorded." }
  }

  // Confirm before thanking anyone.
  for (let i = 0; i < CONFIRM_ATTEMPTS; i++) {
    let status: { err?: unknown; confirmationStatus?: string } | null = null
    try {
      status = (await connection.getSignatureStatuses([signature])).value[0] ?? null
    } catch {
      /* transient RPC error — keep polling */
    }
    if (status?.err) {
      return {
        ok: false,
        kind: 'failed',
        msg: 'The tip failed on-chain — no SOL left your wallet beyond the network fee.',
        signature,
        explorerUrl: solscanTx(signature),
      }
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { ok: true, kind: 'sent', msg: 'Tip sent — thank you for keeping the registry alive.', signature, explorerUrl: solscanTx(signature) }
    }
    if (i < CONFIRM_ATTEMPTS - 1) await sleep(CONFIRM_DELAY_MS)
  }

  return {
    ok: false,
    kind: 'unconfirmed',
    msg: "Sent, but the network hasn't confirmed it yet. Check the transaction before sending again — it may still land.",
    signature,
    explorerUrl: solscanTx(signature),
  }
}
