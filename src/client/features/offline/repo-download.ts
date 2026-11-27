import type { RepoFile } from '~/shared/github-repos/contract'
import {
  OFFLINE_BATCH_MAX,
  type RepoOfflineBatchBody,
  type RepoOfflinePlan,
  type RepoTooLarge,
  repoOfflineHref,
} from '~/shared/github-repos/offline'
import { isObject } from '~/shared/lib/json-shape'
import { parseBatchFiles, parseOfflinePlan, parseTooLarge, type RepoCopy } from '~/shared/offline/repo'
import { planAppCache, refreshAppCache } from './app-cache'
import { askPersistOnce, type DownloadOptions, defaultStorageManager, hasRoom } from './download'
import { saveRepoCopy, sweepRepoOrphans } from './repo-store'
import { type OfflineEnv, offlineEnv, saveNav } from './store'

/**
 * How much bigger a rendered file is than its source: highlighted tokens and Markdown nodes, as JSON. Measured on the
 * GitHub stub's fixtures at 5.9 (Folio's own source renders at 2.7), so room is checked for six times the source.
 */
export const RENDER_RATIO = 6

/** How long to wait when GitHub is busy and says nothing of when to come back. */
export const BUSY_WAIT_MS = 30_000

/** The most times one request is tried again after a busy answer. */
export const BUSY_RETRIES = 3

/** A busy answer whose retry time is further off than this fails the download rather than leave it waiting. */
export const LONGEST_WAIT_MS = 2 * 60_000

export type RepoDownloadResult =
  | { result: 'ok'; copy: RepoCopy }
  | { result: 'no_room'; bytes: number }
  | { result: 'too_large'; tooLarge: RepoTooLarge }
  | { result: 'failed' }
  | { result: 'cancelled' }

/** Why a download didn't save a copy, for the control to say; null when it did, or was cancelled. */
export type RepoDownloadProblem =
  | { kind: 'too_large'; tooLarge: RepoTooLarge }
  | { kind: 'no_room'; bytes: number }
  | { kind: 'failed' }

export function problemOf(result: RepoDownloadResult): RepoDownloadProblem | null {
  if (result.result === 'too_large') return { kind: 'too_large', tooLarge: result.tooLarge }
  if (result.result === 'no_room') return { kind: 'no_room', bytes: result.bytes }
  return result.result === 'failed' ? { kind: 'failed' } : null
}

export interface RepoDownloadOptions extends Pick<DownloadOptions, 'nav' | 'signal' | 'onProgress' | 'fetcher'> {
  /** The signed-in reader's username: the copy belongs to that account. */
  account: string
  storageManager?: DownloadOptions['storageManager']
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Why a download stopped, where the answer says more than that it failed. */
class Stopped extends Error {
  constructor(
    readonly reason: 'changed' | 'too_large' | 'failed',
    readonly tooLarge?: RepoTooLarge,
  ) {
    super(reason)
  }
}

/** Waits `ms`, or rejects with the signal's reason when it aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

interface Context {
  id: string
  fetcher: typeof fetch
  signal?: AbortSignal
  wait: NonNullable<RepoDownloadOptions['wait']>
  env: OfflineEnv
}

/** Asks the server, waiting out a busy answer as `BUSY_*` say; answers the status and the JSON body. */
async function ask(context: Context, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const { fetcher, signal, wait, env } = context
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(repoOfflineHref(context.id), {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    })
    const body: unknown = await response.json().catch(() => null)
    const busy = response.status === 503 && isObject(body) && body.error === 'busy'
    if (!busy || attempt >= BUSY_RETRIES) return { status: response.status, body }
    const retryAt = typeof body.retryAt === 'string' ? Date.parse(body.retryAt) : Number.NaN
    const delay = Number.isFinite(retryAt) ? Math.max(0, retryAt - env.now()) : BUSY_WAIT_MS
    if (delay > LONGEST_WAIT_MS) return { status: response.status, body }
    await wait(delay, signal)
  }
}

async function fetchPlan(context: Context): Promise<RepoOfflinePlan> {
  const { status, body } = await ask(context)
  if (status === 413) {
    const tooLarge = parseTooLarge(body)
    throw new Stopped(tooLarge ? 'too_large' : 'failed', tooLarge ?? undefined)
  }
  const plan = status === 200 ? parseOfflinePlan(body, context.id) : null
  if (!plan) throw new Stopped('failed')
  return plan
}

async function* batchesOf(context: Context, plan: RepoOfflinePlan, step: () => void): AsyncGenerator<RepoFile[]> {
  for (let i = 0; i < plan.files.length; i += OFFLINE_BATCH_MAX) {
    const paths = plan.files.slice(i, i + OFFLINE_BATCH_MAX)
    const batch: RepoOfflineBatchBody = { commit: plan.repo.commit, paths }
    const { status, body } = await ask(context, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    if (status === 409 && isObject(body) && body.error === 'changed') throw new Stopped('changed')
    const files = status === 200 ? parseBatchFiles(body, paths) : null
    if (!files) throw new Stopped('failed')
    yield files
    step()
  }
}

const isQuotaError = (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError'

/**
 * Downloads saved repository `id` at its pinned commit: the plan, the app's files, then each batch in turn, saved
 * through `saveRepoCopy`, so a copy already here keeps opening until the new one is whole. When the repository moves
 * to another commit partway, it starts again once.
 */
export async function downloadRepo(
  id: string,
  options: RepoDownloadOptions,
  env: OfflineEnv = offlineEnv(),
): Promise<RepoDownloadResult> {
  const { signal, onProgress, nav, account } = options
  const manager = options.storageManager === undefined ? defaultStorageManager() : options.storageManager
  const context: Context = { id, fetcher: options.fetcher ?? fetch, signal, wait: options.wait ?? sleep, env }
  let needed = 0
  const attempt = async (): Promise<RepoDownloadResult> => {
    let done = 0
    let total = 1
    const step = () => {
      done++
      onProgress?.(Math.min(100, Math.round((done / total) * 100)))
    }
    onProgress?.(0)
    const plan = await fetchPlan(context)
    needed = plan.bytes * RENDER_RATIO
    if (!(await hasRoom(needed, manager))) return { result: 'no_room', bytes: needed }
    await askPersistOnce(env, manager)
    const appPlan = await planAppCache(env, context.fetcher)
    total = 1 + (appPlan?.missing.length ?? 0) + Math.ceil(plan.files.length / OFFLINE_BATCH_MAX)
    step()
    await refreshAppCache({ force: true, plan: appPlan, signal, onFile: step, fetcher: context.fetcher }, env)
    const copy = await saveRepoCopy(
      { id, account, repo: plan.repo, folders: plan.folders, files: plan.files },
      batchesOf(context, plan, step),
      { signal },
      env,
    )
    if (nav !== undefined) await saveNav(nav, env)
    onProgress?.(100)
    return { result: 'ok', copy }
  }
  for (let tries = 0; ; tries++) {
    try {
      return await attempt()
    } catch (error) {
      await sweepRepoOrphans(env).catch(() => {})
      if (signal?.aborted) return { result: 'cancelled' }
      if (error instanceof Stopped && error.reason === 'changed' && tries === 0) continue
      if (error instanceof Stopped && error.tooLarge) return { result: 'too_large', tooLarge: error.tooLarge }
      if (isQuotaError(error)) return { result: 'no_room', bytes: needed }
      return { result: 'failed' }
    }
  }
}
