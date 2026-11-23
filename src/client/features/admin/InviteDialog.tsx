import { type FormEvent, useState } from 'react'
import { Button, TextField } from '~/client/features/account/ui'
import { DialogError, DialogTitle } from './ConfirmDialog'
import type { Message } from './use-users'

export function InviteDialog({
  titleId,
  sending,
  error,
  onCreate,
  onCancel,
}: {
  titleId: string
  sending: boolean
  error: Message | null
  onCreate: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!sending) onCreate(note)
  }
  return (
    <form onSubmit={submit}>
      <DialogTitle id={titleId}>Invite someone</DialogTitle>
      <DialogError error={error} />
      <TextField
        className="mt-5"
        id="invite-note"
        data-testid="invite-note"
        label="Note (optional)"
        name="note"
        hint="Who it’s for. Only admins see it."
        autoComplete="off"
        maxLength={60}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button data-testid="invite-confirm" disabled={sending} aria-busy={sending || undefined}>
          Create link
        </Button>
        <Button type="button" variant="secondary" data-testid="invite-cancel" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
