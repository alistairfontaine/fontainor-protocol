import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FALLBACK, loadRegistry, type RegistrySource } from '../lib/api'
import { loadLocalPublications } from '../lib/localPublish'
import { normalize, type Release } from '../lib/registry'

interface RegistryState {
  releases: Release[]
  music: Release[]
  editorial: Release[]
  loading: boolean
  source: RegistrySource | ''
  repaired: boolean
  reload: () => Promise<void>
}

const Ctx = createContext<RegistryState | null>(null)

export function RegistryProvider({ children }: { children: ReactNode }) {
  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<RegistrySource | ''>('')
  const [repaired, setRepaired] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const r = await loadRegistry(FALLBACK)
    const remote = normalize(r.data)
    // demo-mode publications live in this browser; merge them in, newest first
    const local = normalize(loadLocalPublications())
    const remoteIds = new Set(remote.map((x) => x.id))
    setReleases([...local.filter((x) => !remoteIds.has(x.id)), ...remote])
    setSource(r.source)
    setRepaired(r.repaired)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<RegistryState>(
    () => ({
      releases,
      music: releases.filter((r) => r.type === 'release'),
      editorial: releases.filter((r) => r.type === 'editorial'),
      loading,
      source,
      repaired,
      reload,
    }),
    [releases, loading, source, repaired, reload],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRegistry(): RegistryState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRegistry outside RegistryProvider')
  return v
}
