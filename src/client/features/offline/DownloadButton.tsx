import { useLoaderData } from '@tanstack/react-router'
import { ArrowDownToLine, CircleCheck } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useToast } from '~/client/components/Toast'
import { useInstall } from '~/client/features/install/use-install'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import { formatBytes } from '~/shared/lib/format-bytes'
import { useDownload } from './use-download'

const SECONDARY =
  'inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition hover:-translate-y-0.5 hover:bg-panel active:scale-[.98]'
const TEXT_BUTTON =
  'rounded-md text-[14.5px] font-semibold text-ink underline decoration-line underline-offset-4 transition hover:decoration-current'

export function DownloadButton({ slug, title }: { slug: string; title: string }) {
  const nav = useLoaderData({ from: '__root__' })
  const { state, download, cancel, remove } = useDownload(slug, nav)
  const { offer } = useInstall()
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
    focusNext.current = outcome.result === 'ok' ? 'remove' : 'download'
    if (outcome.result === 'ok') toast('Downloaded for offline reading.')
    else if (outcome.result === 'no_room')
      toast(`There isn’t room on this device for this book (${formatBytes(outcome.bytes)}).`)
    else if (outcome.result === 'failed') toast('Couldn’t download this book. Check your connection and try again.')
  }

  if (state.kind === 'idle')
    return (
      <button ref={downloadRef} type="button" onClick={start} className={SECONDARY} data-testid="download-offline">
        <ArrowDownToLine className="size-[18px]" aria-hidden />
        Download for offline
      </button>
    )

  if (state.kind === 'downloading')
    return (
      <div className="inline-flex h-12 items-center gap-3 rounded-xl border border-line bg-surface px-4">
        <span className="text-[14.5px] font-semibold text-ink tabular-nums" data-testid="download-progress">
          Downloading… {state.percent}%
        </span>
        <progress
          value={state.percent}
          max={100}
          aria-label={`Downloading ${title}`}
          className="h-1.5 w-20 overflow-hidden rounded-full accent-accent"
        />
        <button ref={cancelRef} type="button" onClick={cancel} className={TEXT_BUTTON} data-testid="download-cancel">
          Cancel
        </button>
      </div>
    )

  return (
    <>
      <div className="inline-flex h-12 items-center gap-4">
        <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink" data-testid="download-done">
          <CircleCheck className="size-[18px] text-accent" aria-hidden />
          Downloaded · {formatBytes(state.bytes)}
        </span>
        <button
          ref={removeRef}
          type="button"
          onClick={async () => {
            focusNext.current = 'download'
            await remove()
            toast('Download removed.')
          }}
          className={TEXT_BUTTON}
          data-testid="download-remove"
        >
          Remove download
        </button>
      </div>
      {(isPrivateBookSlug(slug) || offer === 'ios') && (
        <div className="basis-full space-y-1 text-[14px] text-muted">
          {isPrivateBookSlug(slug) && <p data-testid="download-private-note">Removed when you sign out.</p>}
          {offer === 'ios' && (
            <p data-testid="download-safari-note">
              Safari may remove downloads after 7 days without a visit. Add Folio to your Home Screen to keep them.
            </p>
          )}
        </div>
      )}
    </>
  )
}
