#!/usr/bin/env node
// Payment identity verification against the real paymentBridge.js and a local
// Solana JSON-RPC stub. A balance decrease alone is not proof of wallet
// identity: only an account in the message's signer prefix may own a receipt.
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
const payer = Keypair.generate().publicKey
const artist = Keypair.generate().publicKey
const nonSigner = Keypair.generate().publicKey
const amount = 1_000_000

const tx = new Transaction({
  feePayer: payer,
  recentBlockhash: Keypair.generate().publicKey.toBase58(),
}).add(
  SystemProgram.transfer({ fromPubkey: payer, toPubkey: artist, lamports: 980_000 }),
  SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(treasury), lamports: 20_000 }),
)
const message = tx.compileMessage()
const accountKeys = message.accountKeys.map((key) => key.toBase58())

// Include a non-signer account whose balance also drops by the whole price,
// modelling an unrelated instruction. The old verifier accepted this account
// as "buyer" solely because of the balance delta.
const systemIdx = accountKeys.indexOf(SystemProgram.programId.toBase58())
accountKeys.splice(systemIdx, 0, nonSigner.toBase58())
const instructions = message.instructions.map((ix) => ({
  ...ix,
  programIdIndex: ix.programIdIndex >= systemIdx ? ix.programIdIndex + 1 : ix.programIdIndex,
}))
const preBalances = accountKeys.map(() => 0)
const postBalances = accountKeys.map(() => 0)
const payerIdx = accountKeys.indexOf(payer.toBase58())
const artistIdx = accountKeys.indexOf(artist.toBase58())
const treasuryIdx = accountKeys.indexOf(treasury)
const nonSignerIdx = accountKeys.indexOf(nonSigner.toBase58())
preBalances[payerIdx] = 2_000_000
postBalances[payerIdx] = 995_000 // price + 5,000-lamport tx fee
postBalances[artistIdx] = 980_000
postBalances[treasuryIdx] = 20_000
preBalances[nonSignerIdx] = 2_000_000
postBalances[nonSignerIdx] = 1_000_000

const rpcResult = {
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
    signatures: ['1'.repeat(64)],
    message: {
      header: message.header,
      accountKeys,
      recentBlockhash: message.recentBlockhash,
      instructions,
      addressTableLookups: [],
    },
  },
}

const rpc = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const id = JSON.parse(body).id
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: rpcResult }))
  })
})
await new Promise((resolve) => rpc.listen(0, '127.0.0.1', resolve))
process.env.SOLANA_RPC_URL = `http://127.0.0.1:${rpc.address().port}`
process.env.TREASURY_WALLET = treasury

const { verifySolanaPayment } = await import(`../api/paymentBridge.js?test=${Date.now()}`)
const signature = '1'.repeat(64)

check(
  'actual signer/payer owns the receipt',
  await verifySolanaPayment(signature, artist.toBase58(), amount, 'SOL', payer.toBase58()),
)
check(
  'non-signer with an equal balance decrease cannot claim the receipt',
  !(await verifySolanaPayment(signature, artist.toBase58(), amount, 'SOL', nonSigner.toBase58())),
)
check(
  'buyer wallet is mandatory',
  !(await verifySolanaPayment(signature, artist.toBase58(), amount, 'SOL', null)),
)
check(
  'underpaid amount is rejected',
  !(await verifySolanaPayment(signature, artist.toBase58(), amount + 100, 'SOL', payer.toBase58())),
)

rpc.close()
console.log(`\npayment-bridge: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
