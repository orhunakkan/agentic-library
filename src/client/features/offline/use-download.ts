import { useRouteContext } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type DownloadResult, downloadBook } from './download'
import { listDownloads, removeDownload } from './store'

export type DownloadState =
  | { kind: 'unavailable' }
  | { kind: 'idle' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; bytes: number }

export function useDownload(slug: string, nav: unknown) {
  const [state, setState] = useState<DownloadState>({ kind: 'unavailable' })
  const { viewer } = useRouteContext({ from: '__root__' })
  const controller = useRef<AbortController | null>(null)
  const live = useRef(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the viewer's name is what should trigger the read.
  useEffect(() => {
    live.current = true
    if (typeof caches === 'undefined' || document.documentElement.dataset.embed === 'on') return
    void listDownloads()
      .then((list) => {
        const found = list.find((d) => d.slug === slug)
        if (live.current) setState(found ? { kind: 'downloaded', bytes: found.bytes } : { kind: 'idle' })
      })
      .catch(() => live.current && setState({ kind: 'idle' }))
    return () => {
      live.current = false
    }
  }, [slug, viewer?.username])

  const download = useCallback(async (): Promise<DownloadResult> => {
    const abort = new AbortController()
    controller.current = abort
    setState({ kind: 'downloading', percent: 0 })
    const result = await downloadBook(slug, {
      nav,
      signal: abort.signal,
      onProgress: (percent) => live.current && setState({ kind: 'downloading', percent }),
    })
    controller.current = null
    if (live.current)
      setState(result.result === 'ok' ? { kind: 'downloaded', bytes: result.book.bytes } : { kind: 'idle' })
    return result
  }, [slug, nav])

  const cancel = useCallback(() => controller.current?.abort(), [])

  const remove = useCallback(async () => {
    await removeDownload(slug).catch(() => {})
    if (live.current) setState({ kind: 'idle' })
  }, [slug])

  return { state, download, cancel, remove }
}
