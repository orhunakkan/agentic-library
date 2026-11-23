import { Download, Share } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '~/client/features/account/ui'
import { cn } from '~/client/lib/cn'
import { useInstall } from './use-install'

export function InstallButton({ className }: { className?: string }) {
  const { offer, promptInstall } = useInstall()
  const [steps, setSteps] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const row = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (steps && !el.open) {
      el.showModal()
      el.querySelector<HTMLButtonElement>('[data-done]')?.focus()
    }
    if (!steps && el.open) {
      el.close()
      row.current?.focus()
    }
  }, [steps])

  if (offer === null && !steps) return null

  return (
    <>
      <button
        ref={row}
        type="button"
        onClick={() => (offer === 'ios' ? setSteps(true) : void promptInstall())}
        data-testid="install-app"
        className={cn(
          'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-body transition hover:bg-panel/60 hover:text-ink',
          className,
        )}
      >
        <Download className="size-[18px] shrink-0" aria-hidden />
        Install app
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        data-testid="install-app-steps"
        onCancel={(e) => {
          e.preventDefault()
          setSteps(false)
        }}
        onClose={() => setSteps(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.stopPropagation()
        }}
        className="m-auto max-w-[min(420px,calc(100vw-32px))] rounded-[22px] border border-line bg-surface p-6 text-ink backdrop:bg-black/40"
      >
        <h2 id={`${id}-title`} className="text-[18px] font-semibold">
          Install Folio
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-body">
          Tap the Share button
          <Share className="mx-1 inline size-4 align-[-2px]" aria-hidden />, then{' '}
          <strong className="font-semibold text-ink">Add to Home Screen</strong>. Folio then opens from your Home Screen
          in its own window.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-body">
          The Home Screen app keeps its own sign-in and settings, so sign in there once more.
        </p>
        <div className="mt-5 flex">
          <Button data-done type="button" onClick={() => setSteps(false)} data-testid="install-app-done">
            Done
          </Button>
        </div>
      </dialog>
    </>
  )
}
