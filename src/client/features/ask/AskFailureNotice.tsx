import { Link } from '@tanstack/react-router'
import type { AiProvider } from '~/shared/lib/ai-models'
import { canRetry, failureText } from './ask-problems'
import type { AskFailure } from './use-ask'

/** The turn that says why an answer failed, with API keys when the key is the problem and Retry when retrying helps. */
export function AskFailureNotice({
  failure,
  onRetry,
  provider,
}: {
  failure: AskFailure
  onRetry: () => void
  provider: AiProvider
}) {
  return (
    <li
      role="alert"
      data-testid="ask-error"
      className="rounded-xl border border-r-line bg-r-page px-3.5 py-3 text-[14px] leading-relaxed"
    >
      <p>{failureText(failure.problem, failure.retryAt, failure.action, provider)}</p>
      {(failure.problem === 'key_rejected' || failure.problem === 'needs_claude') && (
        <Link
          to="/account/api-keys"
          data-testid="ask-error-api-keys"
          className="mt-1 inline-block text-r-accent underline underline-offset-2"
        >
          API keys
        </Link>
      )}
      {canRetry(failure.problem) && (
        <button
          type="button"
          onClick={onRetry}
          data-testid="ask-retry"
          className="mt-2 inline-flex h-10 items-center rounded-full border border-r-line px-4 text-[13.5px] font-medium transition hover:border-r-accent/60"
        >
          Retry
        </button>
      )}
    </li>
  )
}
