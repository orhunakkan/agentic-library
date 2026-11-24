import { useRouter } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getShelves } from '~/server/account-functions'
import type { ShelfView } from '~/shared/shelves/contract'
import { ShelfStore, statusOf } from './shelf-store'
import * as requests from './shelves-client'

const load = () => getShelves()

/** The reader's shelves: the page's list when it has one, kept up to date with it, or else loaded here. */
export function useShelves({ initial }: { initial?: readonly ShelfView[] } = {}) {
  const router = useRouter()
  const [store] = useState(
    () =>
      new ShelfStore(
        {
          ...requests,
          load,
          changed: () => void router.invalidate({ filter: (match) => match.routeId === '/library/' }),
        },
        initial,
      ),
  )
  const { items: shelves, state } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    if (initial) store.loaded([...initial])
    else store.start({ signedIn: true })
  }, [store, initial])

  return {
    shelves,
    status: statusOf(state),
    create: store.create,
    toggle: store.toggle,
    rename: store.rename,
    remove: store.removeShelf,
  }
}

export type ShelvesApi = ReturnType<typeof useShelves>
