// strip-demo-audio.mjs — remove the bundled demo MP3s from dist/ before the
// web build is synced into the native project (`npx cap sync android`).
//
// Why: the 13-entry demo catalog's audio is ~10.3 MB, which was 76% of a
// 13.5 MB APK. The app is a client of a network catalog — it streams demo
// audio from the deployed site (streamableAudioUrl in src/lib/api.ts) exactly
// like it fetches /registry, and offline listening is what downloads are for.
// The WEB build keeps the files: the site itself serves /audio/*.
//
// Run AFTER `npm run build` and after any browser suite that streams from
// dist, and BEFORE `npx cap sync android`. Idempotent.
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

const dist = new URL('../dist', import.meta.url).pathname
if (!existsSync(dist)) {
  console.error('dist/ does not exist — run `npm run build` first')
  process.exit(1)
}

const dir = join(dist, 'audio')
let removed = 0
let bytes = 0
if (existsSync(dir)) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.mp3')) continue // CREDITS.md stays: attribution travels with the app
    const p = join(dir, f)
    bytes += statSync(p).size
    unlinkSync(p)
    removed++
  }
}
console.log(`stripped ${removed} demo mp3(s), ${(bytes / 1024 / 1024).toFixed(1)} MiB, from ${dir}`)
