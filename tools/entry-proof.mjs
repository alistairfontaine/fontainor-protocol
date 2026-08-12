// Test-only helper for generating the exact permanent artist authorization
// consumed by api/index.js and emitted by src/lib/irysPublish.ts.
import nacl from 'tweetnacl';

export function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}

export function authorizeEntry(entry, keypair) {
    const { artistProof: _proof, ...unsigned } = entry;
    const message = `Fontainor registry entry v1\n${canonical(unsigned)}`;
    const signature = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
    return {
        ...unsigned,
        artistProof: {
            version: 1,
            publicKey: JSON.stringify(Array.from(keypair.publicKey)),
            signature: JSON.stringify(Array.from(signature)),
        },
    };
}
