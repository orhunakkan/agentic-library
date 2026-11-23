import { KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Notice } from '../account/ui'
import { signInProblemText } from './passkey-problems'
import { signInWithPasskey } from './passkeys-client'
import { canUsePasskeys } from './support'

export function PasskeySignIn({ next }: { next?: string }) {
  const [supported, setSupported] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => setSupported(canUsePasskeys()), [])
  if (!supported) return null

  async function signIn() {
    setWaiting(true)
    setProblem(null)
    const result = await signInWithPasskey(next, navigator.credentials)
    if (result.ok) {
      window.location.assign(result.value)
      return
    }
    setWaiting(false)
    setProblem(signInProblemText(result.problem))
  }

  return (
    <div className="mt-6 max-w-[420px]">
      <div className="flex items-center gap-3 text-[13px] text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      {problem && (
        <Notice kind="error" id="passkey-error" data-testid="passkey-sign-in-error">
          {problem}
        </Notice>
      )}
      <Button
        type="button"
        variant="secondary"
        data-testid="passkey-sign-in"
        className="mt-6 w-full sm:w-auto"
        disabled={waiting}
        aria-describedby={problem ? 'passkey-error' : undefined}
        onClick={signIn}
      >
        <KeyRound className="size-4" aria-hidden />
        {waiting ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
      </Button>
    </div>
  )
}
