// One icon family, one complexity level (NAV-05): 24px grid, 1.7 stroke,
// round caps. Active state = fill swap handled by consumers.

interface IconProps {
  size?: number
  className?: string
  filled?: boolean
}

function Svg({ size = 24, className, children, viewBox = '0 0 24 24' }: IconProps & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconHome = ({ filled, ...p }: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" fill="none" />
    <path d="M5 9.5V21h14V9.5" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.22 : 0} />
    <path d="M9.5 21v-6h5v6" />
  </Svg>
)

export const IconLibrary = ({ filled, ...p }: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="4.5" height="16" rx="1" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.22 : 0} />
    <rect x="9.75" y="4" width="4.5" height="16" rx="1" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.22 : 0} />
    <path d="m16.5 5 4.2 14.6" />
  </Svg>
)

export const IconEditorial = ({ filled, ...p }: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3.5" width="16" height="17" rx="2" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.22 : 0} />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Svg>
)

export const IconProfile = ({ filled, ...p }: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.6" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.22 : 0} />
    <path d="M4.8 20c1.3-3.2 4-4.8 7.2-4.8s5.9 1.6 7.2 4.8" />
  </Svg>
)

export const IconPublish = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V5" />
    <path d="m7 9.5 5-5 5 5" />
    <path d="M4.5 16.5v2A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
  </Svg>
)

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.2-4.2" />
  </Svg>
)

export const IconPlay = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M8 5.9c0-1.16 1.26-1.88 2.26-1.3l10.14 5.86a1.5 1.5 0 0 1 0 2.6L10.26 18.9A1.5 1.5 0 0 1 8 17.6V5.9Z" />
  </svg>
)

export const IconPause = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </svg>
)

export const IconNext = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M5 6.1c0-1.16 1.26-1.88 2.26-1.3l9.02 5.2a1.5 1.5 0 0 1 0 2.6l-9.02 5.2A1.5 1.5 0 0 1 5 16.5V6.1Z" />
    <rect x="17.2" y="4.5" width="2.6" height="15" rx="1.1" />
  </svg>
)

export const IconPrev = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M19 6.1c0-1.16-1.26-1.88-2.26-1.3l-9.02 5.2a1.5 1.5 0 0 0 0 2.6l9.02 5.2A1.5 1.5 0 0 0 19 16.5V6.1Z" />
    <rect x="4.2" y="4.5" width="2.6" height="15" rx="1.1" />
  </svg>
)

export const IconShuffle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h3.2c1.1 0 2.13.5 2.8 1.37l5.2 6.76A3.5 3.5 0 0 0 17 16.5H21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M3 16.5h3.2c1.1 0 2.13-.5 2.8-1.37l.9-1.17M13.1 9.54l1.1-1.42A3.5 3.5 0 0 1 17 7.5H21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="m18.6 4.9 2.7 2.6-2.7 2.6M18.6 13.9l2.7 2.6-2.7 2.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const IconRepeat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 3.5 20 6.5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 6.5H8.5A4.5 4.5 0 0 0 4 11v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7 20.5 4 17.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 17.5h11.5A4.5 4.5 0 0 0 20 13v-1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
)

export const IconRepeatOne = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 3.5 20 6.5l-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 6.5H8.5A4.5 4.5 0 0 0 4 11v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7 20.5 4 17.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 17.5h11.5A4.5 4.5 0 0 0 20 13v-1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M11.2 10.4l1.6-1v5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const IconQueue = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5h16M4 12h16M4 17.5h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="m16.5 15.2 4 2.3-4 2.3v-4.6Z" />
  </Svg>
)

export const IconHeart = ({ filled, ...p }: IconProps) => (
  <Svg {...p}>
    <path
      d="M12 20.3 4.9 13a4.6 4.6 0 0 1 0-6.4 4.3 4.3 0 0 1 6.2 0l.9.9.9-.9a4.3 4.3 0 0 1 6.2 0 4.6 4.6 0 0 1 0 6.4Z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Svg>
)

export const IconHistory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
    <path d="M3.5 4v4.5H8" />
    <path d="M12 8v4.5l3 1.8" />
  </Svg>
)

export const IconDisc = ({ filled, ...p }: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" fill={filled ? 'currentColor' : 'none'} fillOpacity={filled ? 0.22 : 0} />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Svg>
)

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5Z" />
  </Svg>
)

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
)

export const IconChevronUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 14.5 6-6 6 6" />
  </Svg>
)

export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </Svg>
)

export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10h18" opacity="0" />
    <path d="M16 3.8H6A2.5 2.5 0 0 0 3.5 6.3" />
    <circle cx="16.8" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconArweave = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M9 15.5 12 8l3 7.5M10 13.4h4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4.5h5.5V10" />
    <path d="M19 5 11.5 12.5" />
    <path d="M19.5 13.5v4a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h4" />
  </Svg>
)

export const IconTag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.8 11.2V5.5A1.7 1.7 0 0 1 5.5 3.8h5.7a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-5.4 5.4a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.6-1.4Z" />
    <circle cx="8.2" cy="8.2" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v10m0 0 4.5-4.5M12 14l-4.5-4.5M5 19h14" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4 2.8 19.5h18.4L12 4Z" />
    <path d="M12 10v4.2" />
    <circle cx="12" cy="16.9" r="0.4" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconSpinner = ({ size = 24, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={'animate-spin ' + (className ?? '')} aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
)
