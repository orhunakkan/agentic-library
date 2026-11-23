import { type FormEvent, useState } from 'react'
import { Button, TextField } from '~/client/features/account/ui'
import type { AdminRole } from '~/shared/admin/users'
import { DialogError, DialogTitle } from './ConfirmDialog'
import type { Message } from './use-users'

export function AddUserDialog({
  titleId,
  sending,
  error,
  onAdd,
  onCancel,
}: {
  titleId: string
  sending: boolean
  error: Message | null
  onAdd: (username: string, role: AdminRole) => void
  onCancel: () => void
}) {
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<AdminRole>('member')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!sending) onAdd(username, role)
  }
  return (
    <form onSubmit={submit}>
      <DialogTitle id={titleId}>Add user</DialogTitle>
      <DialogError error={error} />
      <TextField
        className="mt-5"
        id="add-user-username"
        data-testid="add-user-username"
        label="Username"
        name="username"
        hint="3–32 characters: a–z, 0–9, _ and -, starting with a letter or digit."
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        maxLength={32}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        aria-invalid={error && !error.signedOut ? true : undefined}
      />
      <fieldset className="mt-5">
        <legend className="text-[14px] font-medium text-ink">Role</legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {(['member', 'admin'] as const).map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2.5 text-[15px] text-ink">
              <input
                type="radio"
                name="role"
                value={value}
                data-testid="add-user-role"
                data-key={value}
                checked={role === value}
                onChange={() => setRole(value)}
                className="size-4 accent-[var(--color-accent)]"
              />
              {value === 'admin' ? 'Admin' : 'Member'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button data-testid="add-user-confirm" disabled={sending} aria-busy={sending || undefined}>
          Add user
        </Button>
        <Button type="button" variant="secondary" data-testid="add-user-cancel" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
