import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useToast } from '~/client/components/Toast'
import { reloadWhenBack } from '~/client/lib/optimistic-collection'
import { getBookHighlights } from '~/server/account-functions'
import type { HighlightColor } from '~/shared/highlights/colors'
import { HighlightList, type NewHighlight } from './highlight-list'
import * as client from './highlights-client'

export type { HighlightItem, HighlightsState, NewHighlight } from './highlight-list'

const RELOAD_AFTER_MS = 60_000

export function useHighlights(book: string, { signedIn, embedded }: { signedIn: boolean; embedded: boolean }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  // biome-ignore lint/correctness/useExhaustiveDependencies: one list per book; signedIn and embedded only pick its first state, and the effect below follows their changes
  const list = useMemo(
    () =>
      new HighlightList(
        book,
        {
          load: (slug) => getBookHighlights({ data: { book: slug } }),
          create: client.createHighlight,
          update: client.updateHighlight,
          remove: client.deleteHighlight,
          toast: (text) => toastRef.current(text),
        },
        embedded ? 'off' : signedIn ? 'loading' : 'signed_out',
      ),
    [book],
  )
  const { state, items, color } = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot)

  useEffect(() => list.start({ signedIn, embedded }), [list, signedIn, embedded])

  const enabled = signedIn && !embedded
  useEffect(() => {
    if (!enabled) return
    const back = reloadWhenBack(() => void list.load(), RELOAD_AFTER_MS)
    const onVisibility = () => back(document.visibilityState)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, list])

  const create = useCallback((input: NewHighlight) => list.create(input), [list])
  const recolor = useCallback((key: string, next: HighlightColor) => list.recolor(key, next), [list])
  const saveNote = useCallback((key: string, note: string) => list.saveNote(key, note), [list])
  const remove = useCallback((key: string) => list.remove(key), [list])
  const retry = useCallback(() => list.retry(), [list])

  return { state, items, color, create, recolor, saveNote, remove, retry }
}

export type HighlightsApi = ReturnType<typeof useHighlights>
