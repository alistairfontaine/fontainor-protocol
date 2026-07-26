import { Link } from 'react-router-dom'
import { ReleaseGrid } from '../components/ReleaseCard'
import { IconHeart, IconHistory } from '../components/icons'
import { Button, EmptyState, GridSkeleton, PageHead } from '../components/ui'
import { useFavorites, useHistoryLog } from '../state/collections'
import { useRegistry } from '../state/RegistryContext'

export function Favorites() {
  const { releases, loading } = useRegistry()
  const { ids } = useFavorites()
  const items = releases.filter((r) => ids.includes(r.id))

  return (
    <>
      <PageHead title="Favorites" sub="Saved on this device — tap the heart on any release." />
      {loading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconHeart size={26} />}
          title="Nothing saved yet"
          body="Hearts you tap live here, and they survive a refresh."
          action={
            <Link to="/library">
              <Button variant="primary">Find something to save</Button>
            </Link>
          }
        />
      ) : (
        <ReleaseGrid items={items} />
      )}
    </>
  )
}

export function History() {
  const { releases, loading } = useRegistry()
  const { ids, clear } = useHistoryLog()
  const items = ids.map((id) => releases.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r))

  return (
    <>
      <PageHead
        title="History"
        sub="What you've listened to, most recent first."
        right={
          items.length > 0 ? (
            <Button size="sm" onClick={clear}>
              Clear history
            </Button>
          ) : undefined
        }
      />
      {loading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconHistory size={26} />}
          title="No listens yet"
          body="Play anything and it shows up here."
          action={
            <Link to="/">
              <Button variant="primary">Browse new releases</Button>
            </Link>
          }
        />
      ) : (
        <ReleaseGrid items={items} />
      )}
    </>
  )
}
