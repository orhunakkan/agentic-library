import { useLoaderData } from '@tanstack/react-router'
import { ArrowDownToLine, CircleCheck } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useToast } from '~/client/components/Toast'
import { Notice } from '~/client/features/account/ui'
import { type RepoDownloadProblem, useRepoDownload } from '~/client/features/offline/use-repo-download'
import type { RepoView } from '~/shared/github-repos/contract'
import {
  DOWNLOAD_FAILED_TEXT,
  DOWNLOAD_REMOVED_TOAST,
  DOWNLOAD_SIGN_OUT_NOTE,
  DOWNLOAD_TEXT,
  DOWNLOADED_TOAST,
  downloadedText,
  downloadingLabel,
  noRoomText,
  tooLargeText,
} from './repo-messages'

const SECONDARY =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition hover:border-accent-line hover:bg-panel'
const TEXT_BUTTON =
  'rounded-md text-[14.5px] font-semibold text-ink underline decoration-line underline-offset-4 transition hover:decoration-current'

function problemText(problem: RepoDownloadProblem): string {
  if (problem.kind === 'too_large') return tooLargeText(problem.tooLarge)
  if (problem.kind === 'no_room') return noRoomText(problem.bytes)
  return DOWNLOAD_FAILED_TEXT
}

function Problem({ problem }: { problem: RepoDownloadProblem | null }) {
  if (!problem) return null
  return (
    <div className="basis-full">
      <Notice kind={problem.kind === 'failed' ? 'error' : 'warning'} data-testid="repo-download-problem">
        {problemText(problem)}
      </Notice>
    </div>
  )
}

/** Downloads a saved repository for offline browsing, shows the download's progress, and removes it. */
export function RepoDownload({ repo }: { repo: RepoView }) {
  const nav = useLoaderData({ from: '__root__' })
  const { state, download, cancel, remove } = useRepoDownload(repo.id, nav)
  const toast = useToast()
  const focusNext = useRef<'cancel' | 'remove' | 'download' | null>(null)
  const downloadRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const removeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    const el = { cancel: cancelRef, remove: removeRef, download: downloadRef }[target].current
    if (!el) return
    focusNext.current = null
    el.focus()
  })

  if (state.kind === 'unavailable') return null

  const start = async () => {
    focusNext.current = 'cancel'
    const outcome = await download()
    focusNext.current = outcome?.result === 'ok' ? 'remove' : 'download'
    if (outcome?.result === 'ok') toast(DOWNLOADED_TOAST)
  }

  if (state.kind === 'idle')
    return (
      <div className="flex basis-full flex-wrap items-center gap-x-4 gap-y-2">
        <button
          ref={downloadRef}
          type="button"
          onClick={() => void start()}
          className={SECONDARY}
          data-testid="repo-download-offline"
        >
          <ArrowDownToLine className="size-4" aria-hidden />
          {DOWNLOAD_TEXT}
        </button>
        <Problem problem={state.problem} />
      </div>
    )

  if (state.kind === 'downloading')
    return (
      <div className="flex basis-full flex-wrap items-center gap-3">
        <span className="text-[14.5px] font-semibold text-ink tabular-nums" data-testid="repo-download-progress">
          Downloading… {state.percent}%
        </span>
        <progress
          value={state.percent}
          max={100}
          aria-label={downloadingLabel(repo)}
          className="h-1.5 w-24 overflow-hidden rounded-full accent-accent"
        />
        <button
          ref={cancelRef}
          type="button"
          onClick={cancel}
          className={TEXT_BUTTON}
          data-testid="repo-download-cancel"
        >
          Cancel
        </button>
      </div>
    )

  return (
    <div className="flex basis-full flex-wrap items-center gap-x-4 gap-y-2">
      <span
        className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink"
        data-testid="repo-download-done"
      >
        <CircleCheck className="size-[18px] text-accent" aria-hidden />
        {downloadedText(state.bytes)}
      </span>
      <button
        ref={removeRef}
        type="button"
        onClick={async () => {
          focusNext.current = 'download'
          await remove()
          toast(DOWNLOAD_REMOVED_TOAST)
        }}
        className={TEXT_BUTTON}
        data-testid="repo-download-remove"
      >
        Remove download
      </button>
      <p className="basis-full text-[14px] text-muted" data-testid="repo-download-note">
        {DOWNLOAD_SIGN_OUT_NOTE}
      </p>
      <Problem problem={state.problem} />
    </div>
  )
}
