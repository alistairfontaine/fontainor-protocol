// registryGuard.js — pure helpers protecting the shared registry from
// impersonation and tampering. No I/O here so everything is unit-testable.
//
// Two protections:
//  1. Append-only manifests: clients publish by POSTing the FULL registry
//     array (current + their new entry). A malicious client could rewrite
//     other artists' entries (e.g. swap `artistWallet` to hijack purchase
//     payouts). checkAppendOnly() rejects any manifest that drops or edits
//     an entry that already exists in the durable registry.
//  2. Claimed handles: when an artist has claimed a @handle for their wallet,
//     nobody else may publish under that name. findHandleConflicts() flags
//     new entries whose artist name matches a claimed handle owned by a
//     different wallet.

/** Reserved names that can never be claimed as handles. */
export const RESERVED_HANDLES = new Set([
    'admin', 'administrator', 'root', 'support', 'help',
    'official', 'staff', 'team', 'moderator', 'mod', 'system', 'treasury',
]);

/** Default treasury wallet (same fallback as api/paymentBridge.js). */
const DEFAULT_TREASURY = '6Bh5tpmUAVFWxWUPrMvyLCmSo5CouNVauMptgCumW2Fo';

/**
 * Protected names: claimable, but only by one specific wallet. `fontainor`
 * belongs to the project treasury wallet (env TREASURY_WALLET overrides,
 * mirroring paymentBridge.js). Returns the required owner wallet or null
 * when the name is unprotected. Read at call time so tests/deploys can
 * override via env.
 */
export function getProtectedOwner(bareHandle) {
    if (bareHandle === 'fontainor') {
        return process.env.TREASURY_WALLET || DEFAULT_TREASURY;
    }
    return null;
}

/**
 * Normalize a raw handle: strips one leading '@', lowercases, and validates
 * 3–20 chars of [a-z0-9_]. Returns the bare lowercase name (no '@') or null
 * if invalid/reserved.
 */
export function normalizeHandle(raw) {
    if (typeof raw !== 'string') return null;
    const bare = raw.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(bare)) return null;
    if (RESERVED_HANDLES.has(bare)) return null;
    return bare;
}

/** Stable stringify (recursively sorted object keys) for tamper comparison. */
export function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
}

const entryId = (e) => (e && typeof e === 'object' && typeof e.id === 'string' ? e.id : null);

/**
 * Enforce append-only publishing against the trusted current registry.
 * Returns { ok: true, newEntries } when every current entry appears in the
 * incoming manifest byte-identical (canonical form) and all other incoming
 * entries are genuinely new ids. Otherwise { ok: false, error }.
 *
 * When `current` is empty/unavailable there is nothing trusted to defend;
 * every incoming entry is treated as new.
 */
export function checkAppendOnly(current, incoming) {
    const cur = Array.isArray(current) ? current : [];
    const inc = Array.isArray(incoming) ? incoming : [];

    const incById = new Map();
    for (const e of inc) {
        const id = entryId(e);
        if (id) {
            if (incById.has(id)) return { ok: false, error: `Duplicate entry id in manifest: ${id}` };
            incById.set(id, e);
        }
    }

    const currentIds = new Set();
    for (const e of cur) {
        const id = entryId(e);
        if (!id) continue; // malformed legacy entry — nothing to defend
        currentIds.add(id);
        const match = incById.get(id);
        if (!match) return { ok: false, error: `Manifest drops existing entry ${id} — registry is append-only.` };
        if (canonical(match) !== canonical(e)) {
            return { ok: false, error: `Manifest modifies existing entry ${id} — registry is append-only.` };
        }
    }

    const newEntries = inc.filter((e) => {
        const id = entryId(e);
        return !id || !currentIds.has(id);
    });
    return { ok: true, newEntries };
}

/**
 * Detect impersonation of claimed handles among NEW entries.
 * `lookupWallet(bareHandle)` resolves a normalized handle to its owner wallet
 * (or null). An entry conflicts when its artist name normalizes to a claimed
 * handle whose owner wallet differs from the entry's artistWallet.
 * Returns an array of { id, artist, owner } conflicts (empty = clean).
 */
export async function findHandleConflicts(newEntries, lookupWallet) {
    const conflicts = [];
    for (const e of Array.isArray(newEntries) ? newEntries : []) {
        if (!e || typeof e !== 'object') continue;
        const bare = normalizeHandle(typeof e.artist === 'string' ? e.artist : '');
        if (!bare) continue; // free-text artist names that aren't handle-shaped stay allowed
        // Protected names are owned even before they are claimed.
        const owner = (await lookupWallet(bare)) || getProtectedOwner(bare);
        if (owner && owner !== e.artistWallet) {
            conflicts.push({ id: entryId(e), artist: e.artist, owner });
        }
    }
    return conflicts;
}
