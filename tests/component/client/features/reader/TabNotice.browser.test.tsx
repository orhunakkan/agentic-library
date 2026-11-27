import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { TabNotice } from '~/client/features/reader/TabNotice'
import type { CollectionState } from '~/client/lib/optimistic-collection'
import { mountAt } from '../../../../support/client/router'

/**
 * The Reader test shows these notices to a reader who is signed out or offline. Loading and failing need a signed-in
 * reader, whose Reader would load every other collection too, so those two states are tested on the notice alone.
 */
async function mountNotice(state: CollectionState, { offline = false, name = 'highlights' as const } = {}) {
  const onRetry = vi.fn()
  await mountAt(
    '/read/essays/history',
    <TabNotice
      name={name}
      state={state}
      offline={offline}
      signInText="Sign in to highlight passages."
      next="/read/essays/history"
      onRetry={onRetry}
    />,
  )
  return onRetry
}

/** The notices are plain paragraphs, with no role or name of their own, so they're found by their text. */
describe('TabNotice', () => {
  it('says the highlights are loading', async () => {
    await mountNotice('loading')
    await expect.element(page.getByText('Loading your highlights…')).toBeVisible()
  })

  it('says the highlights couldn’t be loaded, and tries again on Retry', async () => {
    const onRetry = await mountNotice('unavailable')
    await expect.element(page.getByText('Your highlights couldn’t be loaded.')).toBeVisible()
    await page.getByRole('button', { name: 'Retry' }).click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('asks a signed-out reader to sign in, and brings them back to the page', async () => {
    await mountNotice('signed_out')
    await expect.element(page.getByText('Sign in to highlight passages.')).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Sign in' }))
      .toHaveAttribute('href', '/login?next=%2Fread%2Fessays%2Fhistory')
  })

  it('says offline before anything else, whatever state the collection is in', async () => {
    await mountNotice('unavailable', { offline: true })
    await expect.element(page.getByText('Highlights show here when you’re back online.')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shows nothing once the highlights are ready', async () => {
    await mountNotice('ready')
    await expect.element(page.getByText(/highlights/i)).not.toBeInTheDocument()
  })
})
