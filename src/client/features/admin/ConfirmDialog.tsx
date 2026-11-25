import { type ReactNode, useEffect, useRef } from 'react'
import { Button, Notice } from '~/client/features/account/ui'
import type { Message } from './use-users'

export function Modal({
  open,
  labelledBy,
  onClose,
  children,
}: {
  open: boolean
  labelledBy: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop is a mouse shortcut; Escape, through the dialog's cancel event, is the keyboard's way to close
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[22px] border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
    >
      {open && <div className="p-6">{children}</div>}
    </dialog>
  )
}

export function DialogTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
      {children}
    </h2>
  )
}

/** A “Sign in” link that comes back to the users page, after a notice saying the admin was signed out. */
export function UsersSignIn({ testId }: { testId: string }) {
  return (
    <>
      {' '}
      <a href="/login?next=/account/users" data-testid={testId} className="font-semibold underline underline-offset-2">
        Sign in
      </a>
    </>
  )
}

export function DialogError({ error }: { error: Message | null }) {
  if (!error) return null
  return (
    <Notice kind="error" data-testid="users-dialog-error">
      {error.text}
      {error.signedOut && <UsersSignIn testId="users-dialog-sign-in" />}
    </Notice>
  )
}

export function ConfirmDialog({
  testId,
  testKey,
  titleId,
  title,
  body,
  confirm,
  sending,
  error,
  onConfirm,
  onCancel,
}: {
  testId: string
  testKey?: string
  titleId: string
  title: string
  body: string
  confirm: string
  sending: boolean
  error: Message | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">{body}</p>
      <DialogError error={error} />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          data-testid={`${testId}-confirm`}
          data-key={testKey}
          onClick={onConfirm}
          disabled={sending}
          aria-busy={sending || undefined}
        >
          {confirm}
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-testid={`${testId}-cancel`}
          data-key={testKey}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </>
  )
}
