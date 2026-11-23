import { type FormEvent, useState } from 'react'
import { Button, TextField } from '~/client/features/account/ui'
import { DialogError, DialogTitle } from './ConfirmDialog'
import type { Message } from './use-users'

export function DeleteUserDialog({
  titleId,
  username,
  sending,
  error,
  onDelete,
  onCancel,
}: {
  titleId: string
  username: string
  sending: boolean
  error: Message | null
  onDelete: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const matches = typed === username
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (matches && !sending) onDelete()
  }
  return (
    <form onSubmit={submit}>
      <DialogTitle id={titleId}>{`Delete ${username}?`}</DialogTitle>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Their highlights, notes, bookmarks, shelves, private books, saved key and sessions are deleted for good. This
        can’t be undone.
      </p>
      <DialogError error={error} />
      <TextField
        className="mt-5"
        id="delete-user-confirm"
        data-testid="delete-user-name"
        label={`Type ${username} to confirm`}
        name="confirm"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          variant="danger"
          data-testid="delete-user-confirm"
          disabled={!matches || sending}
          aria-busy={sending || undefined}
        >
          Delete user
        </Button>
        <Button type="button" variant="secondary" data-testid="delete-user-cancel" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
