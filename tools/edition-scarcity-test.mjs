#!/usr/bin/env node
// Atomic scarcity/receipt integration test. Drives the real API and payment
// bridge against local Redis + Solana RPC stubs and proves:
//   - verified sales atomically append one receipt and increment minted;
//   - replay is idempotent;
//   - a second signature cannot oversell a one-copy edition;
//   - GET /registry overlays the live mutable counter without rewriting the
//     permanent registry document.
import http from 'node:http'
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const treasury = '6Bh5tpmUAVFWxWUPrMvyLCmSo5CouNVauMptgCumW2Fo'
const buyer = Keypair.generate().publicKey
const artist = Keypair.generate().publicKey
const trackId = 'FONT-LASTCOPY01'
const amount = 10_000_000
const release = {
  type: 'release',
  id: trackId,
  title: 'The Last Copy',
  artist: 'Scarcity Test',
  price: { amount: 0.01, currency: 'SOL' },
  editions: { total: 1 },
  status: 'REGISTERED_ON_FONTAINOR',
  date: '2026-08-12T00:00:00.000Z',
  audioUri: 'https://gateway.irys.xyz/test-audio',
  coverUri: null,
  artistWallet: artist.toBase58(),
}

function rpcTransaction(signature) {
  const treasuryLamports = Math.floor(amount * 0.02)
  const tx = new Transaction({
    feePayer: buyer,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    SystemProgram.transfer({ fromPubkey: buyer, toPubkey: artist, lamports: amount - treasuryLamports }),
    SystemProgram.transfer({ fromPubkey: buyer, toPubkey: new PublicKey(treasury), lamports: treasuryLamports }),
  )
  const message = tx.compileMessage()
  const accountKeys = message.accountKeys.map((key) => key.toBase58())
  const preBalances = accountKeys.map(() => 0)
  const postBalances = accountKeys.map(() => 0)
  const buyerIdx = accountKeys.indexOf(buyer.toBase58())
  preBalances[buyerIdx] = amount + 1_000_000
  postBalances[buyerIdx] = 995_000
  postBalances[accountKeys.indexOf(artist.toBase58())] = amount - treasuryLamports
  postBalances[accountKeys.indexOf(treasury)] = treasuryLamports
  return {
    slot: 1,
    blockTime: null,
    version: 'legacy',
    meta: {
      err: null,
      fee: 5_000,
      preBalances,
      postBalances,
      innerInstructions: null,
      logMessages: [],
      preTokenBalances: [],
      postTokenBalances: [],
      rewards: [],
    },
    transaction: {
      signatures: [signature],
      message: {
        header: message.header,
        accountKeys,
        recentBlockhash: message.recentBlockhash,
        instructions: message.instructions,
        addressTableLookups: [],
      },
    },
  }
}

// Minimal Upstash REST model, including the exact Lua transaction contract
// used by the endpoint. The real client sends EVAL as a single Redis command.
// Redis JSON values are transport copies. Keep the durable registry isolated
// from later test mutations just as a real Redis server would.
const kv = new Map([['fontainor:registry:v1', structuredClone([release])]])
const sets = new Map()
const lists = new Map()
const hashes = new Map()
let failNextEval = false
let failNextReceiptPush = false
let quietExpectedFailure = false
const run = (cmd) => {
  const [rawOp, key, ...args] = cmd
  const op = String(rawOp).toUpperCase()
  if (op === 'GET') return kv.get(key) ?? null
  if (op === 'SET') {
    kv.set(key, args[0])
    return 'OK'
  }
  if (op === 'HMGET') {
    const h = hashes.get(key) ?? {}
    return args.map((field) => h[field] ?? null)
  }
  if (op === 'LRANGE') {
    const list = lists.get(key) ?? []
    const start = Number(args[0])
    const stop = Number(args[1])
    return list.slice(start, stop < 0 ? undefined : stop + 1)
  }
  if (op === 'EVAL') {
    if (failNextEval) {
      failNextEval = false
      throw new Error('injected atomic-store failure')
    }
    const keyCount = Number(args[0])
    const keys = args.slice(1, 1 + keyCount)
    const argv = args.slice(1 + keyCount)
    const [sigsKey, receiptsKey, mintedKey] = keys
    const [signature, receipt, id, totalRaw] = argv
    const sigs = sets.get(sigsKey) ?? new Set()
    const minted = hashes.get(mintedKey) ?? {}
    if (sigs.has(signature)) return ['DUPLICATE', String(minted[id] ?? 0)]
    const count = Number(minted[id] ?? 0)
    const total = Number(totalRaw)
    // Execute the capacity predicate encoded by the production Lua, rather
    // than silently duplicating it in the fake. This makes a regression edit
    // to the real script observable by this integration test.
    const scarcityGuard = /\bif\s+total\s*>\s*0\s+and\s+count\s*>=\s*total\s+then\b/.test(String(key))
    if (scarcityGuard && total > 0 && count >= total) return ['SOLD_OUT', String(count)]
    const protectedPush = /\bredis\.pcall\('LPUSH',\s*receipts,\s*receipt\)/.test(String(key))
      && /\bpushed\.err\b/.test(String(key))
    if (failNextReceiptPush) {
      failNextReceiptPush = false
      if (protectedPush) return ['STORE_ERROR', String(count)]
      // Model the old SADD-before-LPUSH sequence: the append throws after the
      // replay marker was consumed, leaving the payment unrecoverable.
      sigs.add(signature)
      sets.set(sigsKey, sigs)
      throw new Error('injected LPUSH failure')
    }
    const receipts = lists.get(receiptsKey) ?? []
    if (protectedPush || /\bredis\.call\('LPUSH',\s*receipts,\s*receipt\)/.test(String(key))) {
      receipts.unshift(receipt)
      lists.set(receiptsKey, receipts)
    }
    if (!/\bredis\.p?call\('SADD',\s*sigs,\s*signature\)/.test(String(key))) return ['BROKEN_SCRIPT', String(count)]
    sigs.add(signature)
    sets.set(sigsKey, sigs)
    minted[id] = count + 1
    hashes.set(mintedKey, minted)
    return ['STORED', String(count + 1)]
  }
  return null
}

const upstash = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    try {
      const cmd = JSON.parse(body)
      const commands = Array.isArray(cmd?.[0]) ? cmd : [cmd]
      const output = commands.map((c) => {
        const result = run(c)
        // Upstash's base64 protocol would encode bulk strings; quoting the
        // Redis array strings models what the SDK's automatic parser receives
        // after transport decoding without coupling the fixture to base64.
        return { result: String(c[0]).toUpperCase() === 'EVAL' && Array.isArray(result) ? result.map(JSON.stringify) : result }
      })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(Array.isArray(cmd?.[0]) ? output : output[0]))
    } catch (e) {
      if (quietExpectedFailure) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'injected atomic-store failure' }))
        return
      }
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: e.message }))
    }
  })
})
await new Promise((resolve) => upstash.listen(0, '127.0.0.1', resolve))

const transactions = new Map()
const rpc = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const payload = JSON.parse(body)
    const signature = payload.params?.[0]
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: transactions.get(signature) ?? null }))
  })
})
await new Promise((resolve) => rpc.listen(0, '127.0.0.1', resolve))

process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${upstash.address().port}`
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
process.env.SOLANA_RPC_URL = `http://127.0.0.1:${rpc.address().port}`
process.env.TREASURY_WALLET = treasury
const { default: app } = await import(`../api/index.js?scarcity=${Date.now()}`)
const api = app.listen(0)
await new Promise((resolve) => api.once('listening', resolve))
const base = `http://127.0.0.1:${api.address().port}`

async function verify(signature) {
  transactions.set(signature, rpcTransaction(signature))
  const res = await fetch(`${base}/api/v1/verify-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      signature,
      artistWallet: artist.toBase58(),
      buyerWallet: buyer.toBase58(),
      amountLamports: amount,
      currency: 'SOL',
      trackId,
    }),
  })
  return { status: res.status, body: await res.json() }
}

const sig1 = Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58().slice(0, 44)
const sig2 = Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58().slice(0, 44)
const sig3 = Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58().slice(0, 44)
const sig4 = Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58().slice(0, 44)

console.log('atomic receipt + scarcity')
let out = await verify(sig1)
check('first verified buyer receives the only copy', out.status === 200 && out.body.receiptStored === true && out.body.minted === 1, JSON.stringify(out))
check('one receipt was appended', (lists.get('fontainor:purchases:v1') ?? []).length === 1)
check('minted counter incremented once', hashes.get('fontainor:editions:minted:v1')?.[trackId] === 1)

out = await verify(sig1)
check('same signature replay is idempotent', out.status === 200 && out.body.duplicate === true && out.body.minted === 1, JSON.stringify(out))
check('replay adds no receipt and no edition', (lists.get('fontainor:purchases:v1') ?? []).length === 1 && hashes.get('fontainor:editions:minted:v1')?.[trackId] === 1)

out = await verify(sig2)
check('a different valid payment cannot oversell the edition', out.status === 409 && out.body.code === 'SOLD_OUT' && out.body.minted === 1, JSON.stringify(out))
check('sold-out signature is not consumed and no receipt is added', !(sets.get('fontainor:purchases:sigs:v1') ?? new Set()).has(sig2) && (lists.get('fontainor:purchases:v1') ?? []).length === 1)

console.log('failure atomicity')
// Use a second unlimited track to prove a failed atomic store does not burn a
// signature; after the injected failure, the identical request can succeed.
release.editions.total = 0
hashes.get('fontainor:editions:minted:v1')[trackId] = 0
lists.set('fontainor:purchases:v1', [])
sets.set('fontainor:purchases:sigs:v1', new Set())
failNextEval = true
quietExpectedFailure = true
const originalConsoleError = console.error
try {
  console.error = () => {}
  out = await verify(sig3)
} finally {
  console.error = originalConsoleError
}
quietExpectedFailure = false
check('store failure is explicit 503, not false success', out.status === 503 && out.body.code === 'RECEIPT_STORE_UNAVAILABLE', JSON.stringify(out))
check('failed atomic write leaves no signature, receipt, or mint', !(sets.get('fontainor:purchases:sigs:v1') ?? new Set()).has(sig3) && (lists.get('fontainor:purchases:v1') ?? []).length === 0 && hashes.get('fontainor:editions:minted:v1')?.[trackId] === 0)
out = await verify(sig3)
check('same payment can be receipted after storage recovers', out.status === 200 && out.body.receiptStored === true, JSON.stringify(out))

// A Redis command can fail *inside* an EVAL. Redis scripts are isolated but do
// not automatically roll back earlier commands, so the production Lua must
// pcall LPUSH before consuming the replay marker.
lists.set('fontainor:purchases:v1', [])
sets.set('fontainor:purchases:sigs:v1', new Set())
hashes.get('fontainor:editions:minted:v1')[trackId] = 0
failNextReceiptPush = true
quietExpectedFailure = true
try {
  console.error = () => {}
  out = await verify(sig4)
} finally {
  console.error = originalConsoleError
  quietExpectedFailure = false
}
check('internal receipt-write failure returns 503', out.status === 503 && out.body.code === 'RECEIPT_STORE_UNAVAILABLE', JSON.stringify(out))
check('internal receipt-write failure does not burn the signature', !(sets.get('fontainor:purchases:sigs:v1') ?? new Set()).has(sig4))
out = await verify(sig4)
check('same signature succeeds after the internal write recovers', out.status === 200 && out.body.receiptStored === true, JSON.stringify(out))

console.log('registry overlay')
const registry = await (await fetch(`${base}/registry`)).json()
check('registry exposes the durable live minted count', registry[0]?.editions?.minted === 1, JSON.stringify(registry[0]?.editions))
check('permanent registry document itself was not rewritten', kv.get('fontainor:registry:v1')[0].editions.minted == null)

api.close()
rpc.close()
upstash.close()
console.log(`\nedition-scarcity: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
