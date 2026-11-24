import { useRouteContext } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useToast } from '~/client/components/Toast'
import { reloadWhenBack } from '~/client/lib/optimistic-collection'
import { getAudioBookmarks } from '~/server/account-functions'
import { AudioBookmarkRegistry, type NewAudioBookmark } from './audio-bookmark-list'
import * as client from './audio-bookmarks-client'

export type { AudioBookmarkItem, AudioBookmarksState, NewAudioBookmark } from './audio-bookmark-list'

const RELOAD_AFTER_MS = 60_000

let toastNow: (text: string) => void = () => {}

const registry = new AudioBookmarkRegistry({
  load: (slug) => getAudioBookmarks({ data: { book: slug } }),
  create: client.createAudioBookmark,
  remove: client.deleteAudioBookmark,
  toast: (text) => toastNow(text),
})

export function useSignedIn(): boolean {
  return useRouteContext({ from: '__root__', select: (context) => context.viewer !== null })
}

export function useAudioBookmarks(book: string) {
  const toast = useToast()
  const signedIn = useSignedIn()
  const toastRef = useRef(toast)
  toastRef.current = toast
  useEffect(() => {
    toastNow = (text) => toastRef.current(text)
  })
  const list = registry.listFor(book, signedIn)
  const snapshot = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot)

  useEffect(() => registry.sync(book, signedIn), [book, signedIn])

  useEffect(() => {
    if (!signedIn) return
    const back = reloadWhenBack(() => void list.load(), RELOAD_AFTER_MS)
    const onVisibility = () => back(document.visibilityState)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [signedIn, list])

  const add = useCallback((input: NewAudioBookmark) => void list.bookmark(input), [list])
  const remove = useCallback((key: string) => void list.remove(key), [list])
  const retry = useCallback(() => list.retry(), [list])

  return { book, state: snapshot.state, items: snapshot.items, add, remove, retry }
}

export type AudioBookmarksApi = ReturnType<typeof useAudioBookmarks>
