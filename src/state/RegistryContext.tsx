import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FALLBACK, loadRegistry, type RegistrySource } from '../lib/api'
import { normalize, type Release } from '../lib/registry'

interface RegistryState {
  releases: Release[]
  music: Release[]
  editorial: Release[]
  loading: boolean
  source: RegistrySource | ''
  repaired: boolean
  /** Set when source !== 'api': 'api-down' = stale data, 'api-empty' = demo mode. */
  fallbackReason: 'api-empty' | 'api-down' | ''
  reload: () => Promise<void>
}

const Ctx = createContext<RegistryState | null>(null)

export function RegistryProvider({ children }: { children: ReactNode }) {
  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<RegistrySource | ''>('')
  const [repaired, setRepaired] = useState(false)
  const [fallbackReason, setFallbackReason] = useState<'api-empty' | 'api-down' | ''>('')

  const reload = useCallback(async () => {
    setLoading(true)
    const r = await loadRegistry(FALLBACK)
    setReleases(normalize(r.data))
    setSource(r.source)
    setRepaired(r.repaired)
    setFallbackReason(r.source === 'api' ? '' : (r.fallbackReason ?? 'api-down'))
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // When connectivity returns, refresh instead of leaving the user on the
  // stale offline snapshot until a manual full page reload.
  useEffect(() => {
    const onOnline = () => {
      void reload()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [reload])

  const value = useMemo<RegistryState>(
    () => ({
      releases,
      music: releases.filter((r) => r.type === 'release'),
      editorial: releases.filter((r) => r.type === 'editorial'),
      loading,
      source,
      repaired,
      fallbackReason,
      reload,
    }),
    [releases, loading, source, repaired, fallbackReason, reload],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRegistry(): RegistryState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRegistry outside RegistryProvider')
  return v
}
