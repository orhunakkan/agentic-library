import { useRouter } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ShelfView, ShelvesState } from '~/shared/shelves/contract'
import { ShelfStore } from './shelf-store'
import * as requests from './shelves-client'

export function useShelves({ initial, load }: { initial?: readonly ShelfView[]; load?: () => Promise<ShelvesState> }) {
  const router = useRouter()
  const [store] = useState(
    () =>
      new ShelfStore(
        requests,
        () => void router.invalidate({ filter: (match) => match.routeId === '/library/' }),
        initial,
      ),
  )
  const { shelves, status } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    if (initial) store.reset(initial)
  }, [store, initial])

  useEffect(() => (load ? store.load(load) : undefined), [store, load])

  return { shelves, status, create: store.create, toggle: store.toggle, rename: store.rename, remove: store.remove }
}

export type ShelvesApi = ReturnType<typeof useShelves>
