// Publishing must fail closed when the live registry cannot be read. Returning
// [] on a timeout used to let the artist pay for permanent uploads that the
// append-only backend would inevitably reject as an attempted replacement.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name} ${detail}`); }
};

const source = execFileSync('npx', [
    'esbuild',
    'src/lib/api.ts',
    '--bundle',
    '--format=esm',
    '--platform=browser',
    '--define:import.meta.env.VITE_API_BASE=undefined',
], { encoding: 'utf8' });
const dir = mkdtempSync(join(tmpdir(), 'publish-read-'));
const file = join(dir, 'api.mjs');
writeFileSync(file, source);

globalThis.window = { location: { origin: 'https://fontainor.test' } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { loadRawRegistryArray } = await import(pathToFileURL(file).href);

globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '[]' });
let value = await loadRawRegistryArray();
check('explicit HTTP 200 [] is accepted as a genuinely empty registry', Array.isArray(value) && value.length === 0);

globalThis.fetch = async () => { throw new Error('offline'); };
let err = '';
try { await loadRawRegistryArray(); } catch (e) { err = String(e.message || e); }
check('network failure rejects instead of masquerading as []', /Could not load.*offline/i.test(err), err);

globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
err = '';
try { await loadRawRegistryArray(); } catch (e) { err = String(e.message || e); }
check('HTTP failure rejects before storage quote/upload', /HTTP 503/i.test(err), err);

globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '<!doctype html>' });
err = '';
try { await loadRawRegistryArray(); } catch (e) { err = String(e.message || e); }
check('malformed/SPA-fallback response rejects', /malformed/i.test(err), err);

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
