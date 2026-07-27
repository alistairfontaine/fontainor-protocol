// Support / donations configuration (Zero-Dollar Launch Plan §4).
// One place to flip channels on as the accounts get created — the page
// renders only channels marked `live: true`, so we never ship a dead button.

/** Fontainor treasury / tip-jar wallet (Solana mainnet). */
export const TIP_WALLET = '6Bh5tpmUAVFWxWUPrMvyLCmSo5CouNVauMptgCumW2Fo'

/** Phantom username attached to the treasury wallet (Phantom users can send to this handle). */
export const TIP_WALLET_HANDLE = '@fontainor'

/** Preset tip amounts in SOL for the one-tap Phantom flow. */
export const TIP_PRESETS = [0.05, 0.1, 0.5] as const

export interface SupportChannel {
  id: string
  name: string
  blurb: string
  href: string
  live: boolean
}

export const CHANNELS: SupportChannel[] = [
  {
    id: 'github-sponsors',
    name: 'GitHub Sponsors',
    blurb: '0% fees — GitHub absorbs processing costs.',
    href: 'https://github.com/sponsors/tapiwamakandigona',
    live: false, // flip on once Sponsors enrollment is approved
  },
  {
    id: 'ko-fi',
    name: 'Ko-fi',
    blurb: 'One-off tips by card or PayPal, no account needed.',
    href: 'https://ko-fi.com/fontainor',
    live: false, // flip on once the Ko-fi page exists
  },
  {
    id: 'liberapay',
    name: 'Liberapay',
    blurb: 'Recurring, open-source-native donations.',
    href: 'https://liberapay.com/fontainor',
    live: false, // flip on once the Liberapay account exists
  },
]

// ── Gentle nudge (WinRAR posture: never gate, never nag hard) ──
/** Show the support nudge after this many completed play starts. */
export const NUDGE_AFTER_PLAYS = 15
/** Once dismissed, stay quiet for this many further plays. */
export const NUDGE_COOLDOWN_PLAYS = 150
