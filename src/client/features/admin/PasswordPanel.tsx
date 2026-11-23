import { Check, Copy } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '~/client/features/account/ui'
import { DialogTitle } from './ConfirmDialog'

const COPIED_MS = 2000

export function PasswordPanel({
  titleId,
  username,
  password,
  onDone,
}: {
  titleId: string
  username: string
  password: string
  onDone: () => void
}) {
  const label = `${username}’s password`
  return (
    <>
      <DialogTitle id={titleId}>{label}</DialogTitle>
      <ShownOnce
        id="new-password"
        testId="user-password"
        label={label}
        value={password}
        textSize="text-[15px]"
        onDone={onDone}
      >
        Shown only this once. Send it to them privately; they can change it on their Account page.
      </ShownOnce>
    </>
  )
}

export function ShownOnce({
  id,
  testId,
  label,
  value,
  textSize,
  onDone,
  children,
}: {
  id: string
  testId: string
  label: string
  value: string
  textSize: string
  onDone: () => void
  children: ReactNode
}) {
  const field = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      field.current?.select()
    }
  }

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={field}
        id={id}
        data-testid={testId}
        readOnly
        value={value}
        spellCheck={false}
        autoComplete="off"
        className={`mt-4 h-12 w-full rounded-xl border border-line bg-page px-4 font-mono ${textSize} text-ink outline-none focus:border-accent focus:ring-4 focus:ring-accent/15`}
      />
      <p className="mt-3 text-[14px] leading-relaxed text-muted">{children}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" variant="secondary" data-testid={`${testId}-copy`} onClick={copy}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button type="button" data-testid={`${testId}-done`} onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  )
}
