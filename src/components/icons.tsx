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

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
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
