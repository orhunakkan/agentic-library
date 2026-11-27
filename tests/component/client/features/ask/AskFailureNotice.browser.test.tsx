import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { AskFailureNotice } from '~/client/features/ask/AskFailureNotice'
import type { AskFailure } from '~/client/features/ask/use-ask'
import { mountAt } from '../../../../support/client/router'

const QUIZ: AskFailure = {
  problem: 'bad_format',
  question: 'Quiz me on this chapter so far.',
  quote: null,
  highlights: false,
  action: 'quiz',
  prompt: null,
}

const READER = '/read/pride-and-prejudice/chapter-1'

describe('AskFailureNotice', () => {
  it('says an answer that is no quiz should be tried again, and Retry asks again', async () => {
    const onRetry = vi.fn()
    await mountAt(READER, <AskFailureNotice failure={QUIZ} onRetry={onRetry} provider="anthropic" />)
    const alert = page.getByRole('alert')
    /** The message is plain text, found inside the alert that a screen reader announces. */
    await expect.element(alert.getByText('The answer didn’t come back as a quiz. Try again.')).toBeVisible()
    const retry = alert.getByRole('button', { name: 'Retry' })
    await expect.element(retry).toBeVisible()
    expect(onRetry).not.toHaveBeenCalled()
    await retry.click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('points to the API keys page when the key is refused, and offers no Retry', async () => {
    await mountAt(
      READER,
      <AskFailureNotice failure={{ ...QUIZ, problem: 'key_rejected' }} onRetry={vi.fn()} provider="anthropic" />,
    )
    const alert = page.getByRole('alert')
    await expect.element(alert.getByRole('link', { name: 'API keys' })).toHaveAttribute('href', '/account/api-keys')
    await expect.element(alert.getByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})
