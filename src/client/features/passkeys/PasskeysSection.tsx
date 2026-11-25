import { KeyRound } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { shortDate } from '~/shared/lib/site'
import type { PasskeyView } from '~/shared/passkeys/passkeys'
import { Button, Notice, Section, TextField } from '../account/ui'
import { addProblemText, QUOTA_TEXT } from './passkey-problems'
import { addPasskey } from './passkeys-client'
import { canUsePasskeys } from './support'

const mutedText = 'max-w-[60ch] text-[15px] leading-relaxed text-muted'

export function PasskeysSection({
  username,
  initial,
  max,
  removed,
}: {
  username: string
  initial: PasskeyView[]
  max: number
  removed: string | null
}) {
  const [passkeys, setPasskeys] = useState(initial)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  const [problem, setProblem] = useState<{ text: string; password: boolean } | null>(null)
  useEffect(() => setSupported(canUsePasskeys()), [])
  useEffect(() => setPasskeys(initial), [initial])

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const password = new FormData(form).get('current')
    setBusy(true)
    setProblem(null)
    setAdded(false)
    const result = await addPasskey(typeof password === 'string' ? password : '', navigator.credentials)
    setBusy(false)
    if (result.ok) {
      setPasskeys((list) => [result.value, ...list])
      setOpen(false)
      setAdded(true)
      return
    }
    const text = addProblemText(result.problem)
    if (text) setProblem({ text, password: result.problem.kind === 'server' && result.problem.code === 'password' })
  }

  const full = passkeys.length >= max
  const status = added ? 'Passkey added.' : removed

  function adding() {
    if (full)
      return (
        <p className={mutedText} data-testid="passkey-quota">
          {QUOTA_TEXT}
        </p>
      )
    if (supported === false)
      return (
        <p className={mutedText} data-testid="passkey-unsupported">
          This browser can’t make passkeys.
        </p>
      )
    if (!supported) return null
    if (!open)
      return (
        <Button type="button" variant="secondary" data-testid="passkey-add" onClick={() => setOpen(true)}>
          <KeyRound className="size-4" aria-hidden />
          Add a passkey
        </Button>
      )
    return (
      <form onSubmit={add} className="space-y-5">
        <input type="hidden" name="username" autoComplete="username" value={username} />
        {problem?.password && (
          <Notice kind="error" id="passkey-password-error" data-testid="passkey-password-error">
            {problem.text}
          </Notice>
        )}
        <TextField
          id="field-passkey-current"
          data-testid="passkey-current-password"
          label="Current password"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          autoFocus
          aria-invalid={problem?.password || undefined}
          aria-describedby={problem?.password ? 'passkey-password-error' : undefined}
        />
        <Button disabled={busy} data-testid="passkey-continue">
          {busy ? 'Waiting for your passkey…' : 'Continue'}
        </Button>
      </form>
    )
  }

  return (
    <Section id="passkeys" title="Passkeys">
      <p className={mutedText}>
        Sign in with Face ID, Touch ID, Windows Hello, your phone or a security key instead of your password. Your
        password keeps working.
      </p>
      {status && (
        <Notice kind="success" data-testid="passkey-saved">
          {status}
        </Notice>
      )}
      {passkeys.length === 0 ? (
        <p className="mt-5 text-[15px] text-ink" data-testid="passkey-empty">
          No passkeys yet.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line" aria-label="Your passkeys">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              data-testid="passkey"
              data-key={passkey.id}
              className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3 text-[14.5px]">
                <KeyRound className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium break-words text-ink" data-testid="passkey-name">
                    {passkey.name}
                  </p>
                  <p className="text-muted">
                    Added {shortDate(passkey.createdAt)} ·{' '}
                    {passkey.lastUsedAt ? `Last used ${shortDate(passkey.lastUsedAt)}` : 'Never used'}
                  </p>
                </div>
              </div>
              <form method="post" action="/account" className="shrink-0">
                <input type="hidden" name="intent" value="passkey-remove" />
                <input type="hidden" name="passkey" value={passkey.id} />
                <Button
                  variant="secondary"
                  data-testid="passkey-remove"
                  data-key={passkey.id}
                  aria-label={`Remove ${passkey.name}, added ${shortDate(passkey.createdAt)}`}
                >
                  Remove
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {problem && !problem.password && (
        <Notice kind="error" id="passkey-add-error" data-testid="passkey-add-error">
          {problem.text}
        </Notice>
      )}
      <div className="mt-6 border-t border-line pt-6">{adding()}</div>
    </Section>
  )
}
