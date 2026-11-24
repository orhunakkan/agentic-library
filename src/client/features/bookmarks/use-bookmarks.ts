import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useToast } from '~/client/components/Toast'
import { getBookBookmarks } from '~/server/account-functions'
import { onPage } from '~/shared/bookmarks/bookmarks'
import { toStored } from '~/shared/content/position'
import { labelOf, positionOf, type ReaderView } from '~/shared/content/reader-view'
import { reloadWhenBack } from './audio-bookmark-list'
import { BookmarkList, type NewBookmark } from './bookmark-list'
import * as client from './bookmarks-client'

export type { BookmarkItem, BookmarksState } from './bookmark-list'

const RELOAD_AFTER_MS = 60_000

function newBookmark(view: ReaderView): NewBookmark {
  const position = positionOf(view)
  return {
    position,
    place: {
      chapterIndex: view.chapterIndex,
      chapterTitle: view.chapterTitle,
      ...toStored(position),
      pageHref: view.canonicalPath,
      label: labelOf(view),
      position: view.nav.progress.position - 1,
    },
  }
}

export function useBookmarks(book: string, { signedIn, embedded }: { signedIn: boolean; embedded: boolean }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  // biome-ignore lint/correctness/useExhaustiveDependencies: one list per book; signedIn and embedded only pick its first state, and the effect below follows their changes
  const list = useMemo(
    () =>
      new BookmarkList(
        book,
        {
          load: (slug) => getBookBookmarks({ data: { book: slug } }),
          create: client.createBookmark,
          remove: client.deleteBookmark,
          toast: (text) => toastRef.current(text),
        },
        embedded ? 'off' : signedIn ? 'loading' : 'signed_out',
      ),
    [book],
  )
  const { state, items } = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot)

  useEffect(() => list.start({ signedIn, embedded }), [list, signedIn, embedded])

  const enabled = signedIn && !embedded
  useEffect(() => {
    if (!enabled) return
    const back = reloadWhenBack(() => void list.load(), RELOAD_AFTER_MS)
    const onVisibility = () => back(document.visibilityState)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [enabled, list])

  const toggle = useCallback((view: ReaderView) => void list.toggle(newBookmark(view)), [list])
  const remove = useCallback((key: string) => void list.remove(key), [list])
  const retry = useCallback(() => list.retry(), [list])
  const onPageOf = useCallback((href: string) => onPage(items, href), [items])

  return { state, items, onPage: onPageOf, toggle, remove, retry }
}

export type BookmarksApi = ReturnType<typeof useBookmarks>
