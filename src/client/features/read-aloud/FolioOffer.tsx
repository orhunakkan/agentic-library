import { Download, X } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { DOWNLOADING_LABEL, downloadingText, offerText } from './messages'

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

const button =
  'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export function FolioOffer() {
  const { readAloud: ra } = usePlayer()
  const online = useOnline()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const downloading = ra.local.voices.find((v) => v.state === 'downloading')
  const first = ra.local.voices[0]
  const isDownloading = downloading !== undefined

  useEffect(() => {
    if (isDownloading) cancelRef.current?.focus()
  }, [isDownloading])

  if (downloading) {
    return (
      <section
        aria-label="Folio voice"
        data-testid="voice-folio-downloading"
        className="mt-6 rounded-2xl border border-line bg-surface/70 p-4"
      >
        <p className="text-[14.5px] text-ink" aria-live="polite" data-testid="voice-folio-progress">
          {downloadingText(downloading.percent)}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <progress
            max={100}
            value={downloading.percent}
            aria-label={DOWNLOADING_LABEL}
            className="h-2 flex-1 accent-[var(--color-accent)]"
          />
          <button
            ref={cancelRef}
            type="button"
            onClick={ra.cancelDownload}
            data-testid="voice-folio-cancel"
            className={`${button} border border-line text-ink hover:bg-panel`}
          >
            <X className="size-4" aria-hidden />
            Cancel
          </button>
        </div>
      </section>
    )
  }
  if (!ra.local.offer || !online || !first) return null
  const text = offerText(first.bytes)
  return (
    <section
      aria-labelledby="folio-offer-title"
      data-testid="voice-folio-offer"
      className="mt-6 rounded-2xl border border-line bg-surface/70 p-4"
    >
      <h2 id="folio-offer-title" className="text-[16px] font-semibold text-ink">
        {text.title}
      </h2>
      <p className="mt-1 max-w-[60ch] text-[14.5px] leading-snug text-body">{text.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => ra.downloadLocal(first.id)}
          data-testid="voice-folio-offer-download"
          className={`${button} bg-accent-fill text-on-accent hover:brightness-105`}
        >
          <Download className="size-4" aria-hidden />
          Download
        </button>
        <button
          type="button"
          onClick={ra.dismissOffer}
          className={`${button} text-body hover:bg-panel`}
          data-testid="voice-folio-offer-dismiss"
        >
          Not now
        </button>
      </div>
    </section>
  )
}
