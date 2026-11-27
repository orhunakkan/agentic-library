import { useRouteContext } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadRepo, problemOf, type RepoDownloadProblem, type RepoDownloadResult } from './repo-download'
import { listRepoCopies, removeRepoCopy } from './repo-store'

export type { RepoDownloadProblem }

export type RepoDownloadState =
  | { kind: 'unavailable' }
  | { kind: 'idle'; problem: RepoDownloadProblem | null }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; bytes: number; commit: string; problem: RepoDownloadProblem | null }

export function useRepoDownload(id: string, nav: unknown) {
  const [state, setState] = useState<RepoDownloadState>({ kind: 'unavailable' })
  const account = useRouteContext({ from: '__root__' }).viewer?.username ?? null
  const controller = useRef<AbortController | null>(null)
  /** The copy kept before a download started, which a failed or cancelled update leaves in place. */
  const kept = useRef<{ bytes: number; commit: string } | null>(null)
  /** The repository whose answers may still change the state: none once unmounted, so a late answer is dropped. */
  const shown = useRef<string | null>(null)

  useEffect(() => {
    shown.current = id
    if (typeof caches === 'undefined' || document.documentElement.dataset.embed === 'on' || !account) return
    void listRepoCopies()
      .then((list) => {
        const found = list.find((c) => c.id === id && c.account === account)
        kept.current = found ? { bytes: found.bytes, commit: found.commit } : null
        if (shown.current !== id) return
        setState(
          kept.current ? { kind: 'downloaded', ...kept.current, problem: null } : { kind: 'idle', problem: null },
        )
      })
      .catch(() => shown.current === id && setState({ kind: 'idle', problem: null }))
    return () => {
      shown.current = null
    }
  }, [id, account])

  const download = useCallback(async (): Promise<RepoDownloadResult | null> => {
    if (!account) return null
    const abort = new AbortController()
    controller.current = abort
    setState({ kind: 'downloading', percent: 0 })
    const result = await downloadRepo(id, {
      account,
      nav,
      signal: abort.signal,
      onProgress: (percent) => shown.current === id && setState({ kind: 'downloading', percent }),
    })
    controller.current = null
    if (result.result === 'ok') kept.current = { bytes: result.copy.bytes, commit: result.copy.commit }
    if (shown.current === id) {
      const problem = problemOf(result)
      setState(kept.current ? { kind: 'downloaded', ...kept.current, problem } : { kind: 'idle', problem })
    }
    return result
  }, [id, nav, account])

  const cancel = useCallback(() => controller.current?.abort(), [])

  const remove = useCallback(async () => {
    await removeRepoCopy(id).catch(() => {})
    kept.current = null
    if (shown.current === id) setState({ kind: 'idle', problem: null })
  }, [id])

  return { state, download, cancel, remove }
}
