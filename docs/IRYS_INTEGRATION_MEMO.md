# Irys / Arweave Integration — design discussion memo

**Purpose:** a starting point for the architecture conversation Alistair proposed.
**Ownership:** the actual Irys SDK / `irysStorage.js` work is the backend's (Alistair's). This memo
is *not* backend code — it's (a) the open design questions, and (b) what the frontend already does
and needs at the seam, so the two sides line up.

---

## Where we are now

- **`/upload` is a validator-only placeholder.** It validates against `registrySchema` and logs;
  it does **not** yet write to Irys. (Confirmed in CLAUDE.md / README.)
- **Frontend is already wired for the real thing.** The publish path is built and tested:
  - `useStore.publish()` runs **Fetch → Append → Push** and tracks
    `uploadState` (`idle | uploading | success | error`) + `lastTx`.
  - The publish modal shows an **"Etching onto the blockchain…"** state with step indicators.
  - `api.publishManifest()` already **extracts the TxID** from the response and tolerates ~9
    field-name variants (`txId`, `id`, `manifestId`, `newManifest`, …).
  - `Toast` fires **green/200** on success (with an Arweave link if a `txId` is present) and
    **amber/400** on validation rejection. (Merged.)

So the frontend is **ready to consume a real Irys write** the moment the backend starts doing one.
The questions below are about making that handoff clean.

---

## The open questions (for us to decide together)

### ❶ Pointer update: does the real write keep the auto-pointer working?
The pointer auto-save (`pointer.json`) already landed in PR #1. When `/upload` becomes a *real*
Irys write, the new TxID it returns must flow into `pointer.json` the same way the placeholder's
did — so the registry head advances with no manual `.env` edit.
- **To confirm:** the real Irys response's TxID is what gets written to `pointer.json` (not some
  intermediate/placeholder id), and the existing auto-pointer logic still fires on the real path.

### ❷ Write latency vs. the frontend's "Etching" state  ← *frontend seam, my area*
A real Irys upload can take **seconds to tens of seconds** (funding check + propagation), versus
the instant placeholder. The frontend currently `await`s `publishManifest` with no hard timeout.
- **To decide:** is there a realistic upper bound on a successful write? I'll set the modal's
  patience / spinner copy to match. If writes can occasionally take, say, >30s, I'd rather show
  "still working…" than risk the user thinking it hung.
- No backend change needed for this — just tell me the expected range and I'll tune the UX.

### ❸ Failure modes beyond 400  ← *frontend seam, my area*
Validation failure (400) is handled. A *real* Irys write adds **new** failure cases the UI doesn't
distinguish yet:
- network / gateway error,
- **insufficient funds** (Arweave storage is paid — see ❹),
- signing / key error,
- timeout.
- **To decide:** what does the backend return for a *write* failure — a **5xx** with a message?
  If so, I'll add an **amber "Etch failed — not saved to Arweave"** toast branch (distinct from the
  400 "validation" branch) so the user knows the difference between "your data was rejected" and
  "the network write failed, try again." I need the backend's error **shape** (status + body) to
  map it cleanly.

### ❹ Who pays, and how much per upload?  ← *owner decision (Alistair F.), not technical*
Arweave is **permanent paid storage** (~$6–8/GB historically; varies). Every published manifest is
a write that **costs money**, and the Irys node needs a **funded wallet**.
- **To decide (owner):** which wallet funds writes, what currency, and is there a soft cap / budget
  per upload or per period? This is an operating-cost call, not an engineering one — flagging it so
  it's a conscious decision before we point at mainnet.

### ❺ devnet first, then mainnet
Irys has a **devnet** (cheap/free, data not permanent) and **mainnet** (real Arweave, permanent,
paid).
- **Proposal:** wire and verify the whole publish flow on **devnet** first — prove the round trip
  (upload → TxID → pointer.json → registry refresh shows the new release) at zero real cost. Flip
  to mainnet only once it's solid. Keeps ❹'s spend off the table until we're confident.

---

## Suggested sequence (once ❶–❺ are settled)

1. **Backend (Alistair):** inject Irys SDK into `/upload`, **on devnet**. Return `{ success, txId }`
   on success and a clear **5xx + message** on write failure.
2. **Joint smoke test:** publish a real release on devnet → confirm TxID comes back → `pointer.json`
   advances → browser refresh shows it persisted. (This is the same "final exam" we ran for v0.2,
   now against a real write.)
3. **Frontend (me):** tune the Etching timeout/copy to real latency (❷) and add the write-failure
   toast branch (❸). Small, contained changes.
4. **Owner (Alistair F.):** decide funding + budget (❹), then we flip devnet → mainnet (❺).

---

## What I am / am not doing here
- **I am:** raising the design questions, and owning the **frontend seam** — the Etching UX (❷) and
  the failure-feedback toast (❸).
- **I am not:** writing `irysStorage.js` or the SDK wiring. That's the backend's call and code. Tell
  me the response **shape** (success + failure) and the **latency range**, and I'll make the UI fit.

---

### Three things I need from you to move
1. **Success response shape** of the real write (is it still `{ success, txId }`? is `txId` the
   Arweave tx?).
2. **Failure response shape** (status code + body) for a *write* failure, so I can branch the toast.
3. **devnet vs mainnet** to start — I'm assuming **devnet first** unless you say otherwise.
