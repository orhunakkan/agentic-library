import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { PromptCard } from '~/client/features/ask-prompts/PromptCard'
import type { AskPromptView } from '~/shared/ask-prompts/prompts'
import { mount } from '../../../../support/client/mount'

const SUMMARISE: AskPromptView = {
  id: '0b7e0000-0000-4000-8000-000000000001',
  name: 'Summarise the chapter',
  appliesTo: 'pages',
  instruction: 'Sum up the chapter so far.\nKeep it to five lines.',
}
const EXPLAIN: AskPromptView = {
  id: '0b7e0000-0000-4000-8000-000000000002',
  name: 'Explain simply',
  appliesTo: 'passage',
  instruction: 'Explain this passage in everyday words.',
}

/** Mounts the card in its list, with a stand-in for each thing it asks its page to do. */
function mountCard(prompt: AskPromptView, place: { first: boolean; last: boolean }) {
  const asked = { onEdit: vi.fn(), onMove: vi.fn<(direction: 'up' | 'down') => void>(), onDelete: vi.fn() }
  mount(
    <ul aria-label="Your prompts">
      <PromptCard prompt={prompt} {...place} {...asked} />
    </ul>,
  )
  return asked
}

const card = page.getByRole('listitem')

describe('PromptCard', () => {
  it('shows the prompt’s name, where it applies and what it asks', async () => {
    mountCard(SUMMARISE, { first: false, last: false })
    await expect.element(card.getByRole('heading', { name: 'Summarise the chapter', level: 2 })).toBeVisible()
    /** Where it applies and what it asks are plain text, with no role of their own. */
    await expect.element(card.getByText('On the pages you’ve read')).toBeVisible()
    const instruction = card.getByText(/^Sum up the chapter so far\./)
    await expect.element(instruction).toBeVisible()
    await expect.element(instruction).toHaveTextContent(SUMMARISE.instruction, { normalizeWhitespace: false })
  })

  it('says a passage prompt runs on a passage the reader selects', async () => {
    mountCard(EXPLAIN, { first: false, last: false })
    await expect.element(card.getByText('On a passage you select')).toBeVisible()
  })

  it('asks the page to edit, move and delete it', async () => {
    const asked = mountCard(SUMMARISE, { first: false, last: false })
    await card.getByRole('button', { name: 'Edit' }).click()
    expect(asked.onEdit).toHaveBeenCalledOnce()

    await card.getByRole('button', { name: 'Move “Summarise the chapter” up' }).click()
    await card.getByRole('button', { name: 'Move “Summarise the chapter” down' }).click()
    expect(asked.onMove.mock.calls).toEqual([['up'], ['down']])

    await card.getByRole('button', { name: 'Delete' }).click()
    expect(asked.onDelete).toHaveBeenCalledOnce()
  })

  it('can’t move the first prompt up or the last one down', async () => {
    mountCard(SUMMARISE, { first: true, last: false })
    await expect.element(card.getByRole('button', { name: 'Move “Summarise the chapter” up' })).toBeDisabled()
    await expect.element(card.getByRole('button', { name: 'Move “Summarise the chapter” down' })).toBeEnabled()
  })

  it('can’t move the only prompt either way', async () => {
    const asked = mountCard(EXPLAIN, { first: true, last: true })
    const up = card.getByRole('button', { name: 'Move “Explain simply” up' })
    const down = card.getByRole('button', { name: 'Move “Explain simply” down' })
    await expect.element(up).toBeDisabled()
    await expect.element(down).toBeDisabled()
    await up.click({ force: true })
    await down.click({ force: true })
    expect(asked.onMove).not.toHaveBeenCalled()
  })

  it('marks its Edit button with the prompt’s id, so the page can give it focus back', async () => {
    mountCard(EXPLAIN, { first: false, last: true })
    await expect.element(card.getByRole('button', { name: 'Edit' })).toHaveAttribute('data-prompt-edit', EXPLAIN.id)
    await expect.element(card.getByRole('button', { name: 'Move “Explain simply” down' })).toBeDisabled()
  })
})
