# Fontainor Subsystem Architecture Specification

This document details the trustless data processing streams and immutable structural boundaries governing the Fontainor Protocol full-stack runtime.

## 1. Decentralized Storage & Chunk Ingress Subsystem
Audio payloads are chunked into 256KB segments in the client browser, dispatched via raw binary streams, and reconstructed for final publication onto the Arweave data network.

## 2. Cryptographic Sovereign Identity Auth
Fontainor utilizes a serverless account model where login is verified via Phantom wallet signatures, removing the need for a database.

## 3. Omni-Asset Verification and Splitting Contracts
Payment logic (`paymentBridge.js`) verifies transactions on-chain, securing a 98/2 revenue split between the artist and the protocol treasury, supporting SOL and SPL tokens (USDC/USDT).

## 4. Item Type Discrimination Normalization
Data structures use explicit `type` tags (`release` vs `editorial`) to segregate audio data from text content, ensuring accurate content delivery.
