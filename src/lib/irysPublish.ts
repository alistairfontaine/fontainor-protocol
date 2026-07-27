// Musician-pays permanent storage (Zero-Dollar Launch Plan: no platform
// Arweave wallet). The artist's Phantom wallet funds the exact storage cost
// in SOL at publish time via Irys; files and the registry manifest land on
// the Arweave permanent record, then the serverless pointer is updated.
// All Irys/web3 code loads lazily so the main bundle stays slim.
import { API_BASE, type PublishResult } from './api'
import { getConnectedPhantom, getWorkingRpc, PhantomError } from './phantom'
import { getSolUsd } from './solPrice'

export const IRYS_GATEWAY = 'https://gateway.irys.xyz'

/** Tags must match the backend's registry self-heal query (api/index.js). */
const APP_NAME = 'Fontainor-Protocol'
const MANIFEST_TYPE = 'registry-manifest'

export type PublishStage = 'quote' | 'funding' | 'audio' | 'cover' | 'manifest' | 'listing'

export interface StorageQuote {
  totalBytes: number
  lamports: number
  sol: number
  usd: number | null
  /** Lamports that must move from the wallet to Irys (0 when balance covers it). */
  fundLamports: number
}

type IrysLike = {
  getPrice(bytes: number): Promise<{ toNumber(): number }>
  getBalance(): Promise<{ toNumber(): number }>
  fund(amount: number): Promise<unknown>
  upload(data: string, opts?: { tags?: { name: string; value: string }[] }): Promise<{ id: string }>
  uploadFile(file: File, opts?: { tags?: { name: string; value: string }[] }): Promise<{ id: string }>
}

async function buildIrys(): Promise<IrysLike> {
  const provider = await getConnectedPhantom()
  const [{ WebUploader }, { WebSolana }] = await Promise.all([
    import('@irys/web-upload'),
    import('@irys/web-upload-solana'),
  ])
  try {
    return (await WebUploader(WebSolana).withProvider(provider).withRpc(await getWorkingRpc()).mainnet()) as unknown as IrysLike
  } catch (e) {
    throw new PhantomError('network', 'Could not reach the Irys storage network: ' + ((e as Error)?.message || e))
  }
}

/** Estimated manifest size: current registry plus the new entry, with headroom. */
function manifestBytesEstimate(currentRegistry: unknown[]): number {
  try {
    return JSON.stringify(currentRegistry).length + 2048
  } catch {
    return 64 * 1024
  }
}

/**
 * Price the storage for a publish (audio + optional cover + manifest) in SOL.
 * Requires a connected Phantom wallet (price is quoted per-payer network).
 */
export async function quotePublish(
  currentRegistry: unknown[],
  audioFile?: File | null,
  coverFile?: File | null,
): Promise<StorageQuote> {
  const irys = await buildIrys()
  const totalBytes = (audioFile?.size ?? 0) + (coverFile?.size ?? 0) + manifestBytesEstimate(currentRegistry)
  const [price, balance, usdRate] = await Promise.all([
    irys.getPrice(totalBytes),
    irys.getBalance().catch(() => ({ toNumber: () => 0 })),
    getSolUsd(),
  ])
  const lamports = price.toNumber()
  const fundLamports = Math.max(0, lamports - balance.toNumber())
  return {
    totalBytes,
    lamports,
    sol: lamports / 1e9,
    usd: usdRate ? (lamports / 1e9) * usdRate : null,
    fundLamports,
  }
}

export interface RealPublishInput {
  /** Asset built by buildAsset (must already carry artistWallet). */
  asset: Record<string, unknown>
  audioFile?: File | null
  coverFile?: File | null
  /** Raw current registry array the new asset is appended to. */
  currentRegistry: unknown[]
  onStage?: (stage: PublishStage) => void
}

function friendly(e: unknown): PublishResult {
  if (e instanceof PhantomError) {
    return { ok: false, failure: e.kind === 'network' ? 'network' : 'write', msg: e.message, code: e.kind.toUpperCase(), txId: null }
  }
  const msg = String((e as Error)?.message || e)
  if (/user rejected|declined|rejected the request/i.test(msg)) {
    return { ok: false, failure: 'write', msg: 'The transaction was declined in Phantom — nothing was charged.', code: 'REJECTED', txId: null }
  }
  if (/insufficient|not enough|0x1\b/i.test(msg)) {
    return { ok: false, failure: 'write', msg: 'Not enough SOL in the wallet to cover the storage cost.', code: 'INSUFFICIENT', txId: null }
  }
  return { ok: false, failure: 'network', msg: 'Publish failed: ' + msg, txId: null }
}

/**
 * The full musician-pays publish:
 * fund (if needed) → upload audio/cover → upload manifest → repoint registry.
 * On success the returned txId is the new registry manifest ID on Irys/Arweave.
 */
export async function publishReal(input: RealPublishInput): Promise<PublishResult> {
  const { asset, audioFile, coverFile, currentRegistry, onStage } = input
  try {
    onStage?.('quote')
    const irys = await buildIrys()

    // 1. Fund the exact shortfall (one Phantom approval), small headroom for
    //    price drift between quote and upload.
    const totalBytes = (audioFile?.size ?? 0) + (coverFile?.size ?? 0) + manifestBytesEstimate(currentRegistry)
    const price = (await irys.getPrice(totalBytes)).toNumber()
    const balance = (await irys.getBalance().catch(() => ({ toNumber: () => 0 }))).toNumber()
    if (price > balance) {
      onStage?.('funding')
      await irys.fund(Math.ceil((price - balance) * 1.1))
    }

    const patched: Record<string, unknown> = { ...asset }

    // 2. Audio file → permanent record.
    if (audioFile) {
      onStage?.('audio')
      const up = await irys.uploadFile(audioFile, {
        tags: [
          { name: 'Content-Type', value: audioFile.type || 'audio/mpeg' },
          { name: 'App-Name', value: APP_NAME },
          { name: 'Type', value: 'track-audio' },
        ],
      })
      patched.audioUri = `${IRYS_GATEWAY}/${up.id}`
    }

    // 3. Cover art → permanent record.
    if (coverFile) {
      onStage?.('cover')
      const up = await irys.uploadFile(coverFile, {
        tags: [
          { name: 'Content-Type', value: coverFile.type || 'image/jpeg' },
          { name: 'App-Name', value: APP_NAME },
          { name: 'Type', value: 'cover-art' },
        ],
      })
      patched.coverUri = `${IRYS_GATEWAY}/${up.id}`
    }

    // 4. Updated registry manifest → permanent record (tagged for self-heal).
    onStage?.('manifest')
    const manifest = [...currentRegistry, patched]
    const manifestUp = await irys.upload(JSON.stringify(manifest), {
      tags: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'App-Name', value: APP_NAME },
        { name: 'Type', value: MANIFEST_TYPE },
      ],
    })

    // 5. Repoint the live registry (server validates the manifest resolves).
    onStage?.('listing')
    let lastErr = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2500))
      try {
        const res = await fetch(API_BASE + '/api/v1/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txId: manifestUp.id }),
        })
        if (res.ok) {
          return { ok: true, msg: 'Permanently etched onto Arweave — storage paid from your wallet.', txId: manifestUp.id }
        }
        lastErr = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`
      } catch (e) {
        lastErr = String((e as Error)?.message || e)
      }
    }

    // Fallback listing path: POST the full manifest (durable store route).
    try {
      const res = await fetch(API_BASE + '/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      })
      if (res.ok) {
        return { ok: true, msg: 'Permanently etched onto Arweave — storage paid from your wallet.', txId: manifestUp.id }
      }
    } catch {
      /* fall through to honest partial-failure report */
    }

    return {
      ok: false,
      failure: 'write',
      msg:
        'Your files ARE safely on the permanent record (manifest ' +
        manifestUp.id +
        '), but listing it in the live registry failed: ' +
        lastErr +
        ' — it will be picked up automatically, or retry from this page without re-uploading.',
      code: 'LISTING_FAILED',
      txId: manifestUp.id,
    }
  } catch (e) {
    return friendly(e)
  }
}
