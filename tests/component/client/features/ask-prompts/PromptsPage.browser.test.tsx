import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import { PromptsPage } from '~/client/features/ask-prompts/PromptsPage'
import {
  type AskPromptsState,
  type AskPromptView,
  MAX_ASK_PROMPTS,
  type PromptErrorCode,
} from '~/shared/ask-prompts/prompts'
import { isObject } from '~/shared/lib/json-shape'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountAt } from '../../../../support/client/router'

const PROMPTS_PAGE = '/account/prompts'
const NEW_URL = '/account/prompts/new'

const SUMMARISE: AskPromptView = {
  id: '0b7e0000-0000-4000-8000-000000000001',
  name: 'Summarise',
  appliesTo: 'pages',
  instruction: 'Sum up the chapter so far.',
}
const EXPLAIN: AskPromptView = {
  id: '0b7e0000-0000-4000-8000-000000000002',
  name: 'Explain',
  appliesTo: 'passage',
  instruction: 'Explain this passage.',
}

const changeUrl = (prompt: AskPromptView) => `/account/prompts/${prompt.id}`

/**
 * The prompt routes' answers, shaped as `src/server/ask-prompts/actions.ts` sends them: the prompt kept, the list
 * after a move, a delete, or a refusal with the server's code.
 */
type PromptAnswer =
  | { prompt: AskPromptView }
  | { prompts: AskPromptView[] }
  | { deleted: true }
  | ErrorAnswer<PromptErrorCode>

const answer = (status: number, body: PromptAnswer) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchSpy: MockInstance<typeof fetch>

/** The paths and bodies posted, in order. */
const sent = () =>
  fetchSpy.mock.calls.map(([input, init]) => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    return [String(input), isObject(body) ? body : null]
  })

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer was set up'))
})

const mountPage = (state: AskPromptsState) =>
  mountAt(
    PROMPTS_PAGE,
    <ToastProvider>
      <PromptsPage state={state} />
    </ToastProvider>,
    { viewer: { username: 'reader' } },
  )

const mountPrompts = (prompts: AskPromptView[]) => mountPage({ state: 'ready', prompts })

const newPrompt = page.getByRole('region', { name: 'New prompt' })
const list = page.getByRole('list', { name: 'Your prompts' })
const cardOf = (name: string) =>
  list.getByRole('listitem').filter({ has: page.getByRole('heading', { name, level: 2 }) })
const deleteDialog = page.getByRole('dialog', { name: 'Delete prompt' })
const nameField = page.getByRole('textbox', { name: 'Name' })
const instructionField = page.getByRole('textbox', { name: 'What it asks' })
/**
 * The page's screen-reader announcement and the toast are both status regions with no name, so the tests find each
 * by its test id; the first test checks their role.
 */
const announcement = page.getByTestId('prompts-status')
const toast = page.getByTestId('toast')
/** The prompt count is plain text, with no role of its own. */
const count = page.getByTestId('prompts-count')

/** The prompts' names, top to bottom. */
const order = () =>
  list
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent)

describe('PromptsPage', () => {
  it('lists the reader’s prompts in order under the account tabs, with a form for a new one', async () => {
    await mountPrompts([SUMMARISE, EXPLAIN])
    await expect.element(page.getByRole('heading', { name: 'Your prompts', level: 1 })).toBeVisible()
    await expect
      .element(page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'Prompts' }))
      .toHaveAttribute('aria-current', 'page')
    await expect.element(count).toHaveTextContent(`2 of ${MAX_ASK_PROMPTS} prompts`)
    expect(order()).toEqual(['Summarise', 'Explain'])
    await expect.element(newPrompt).toBeVisible()
    await expect.element(page.getByText('You haven’t saved a prompt yet.', { exact: false })).not.toBeInTheDocument()
    await expect.element(announcement).toHaveRole('status')
    await expect.element(toast).toHaveRole('status')
  })

  it('offers starters when the reader has no prompts, and saves one they pick', async () => {
    fetchSpy.mockImplementation(async (_, init) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      const fields = isObject(body) ? body : {}
      return answer(201, {
        prompt: {
          id: '0b7e0000-0000-4000-8000-000000000009',
          name: String(fields.name),
          appliesTo: fields.appliesTo === 'passage' ? 'passage' : 'pages',
          instruction: String(fields.instruction),
        },
      })
    })
    await mountPrompts([])
    await expect.element(count).toHaveTextContent(`0 of ${MAX_ASK_PROMPTS} prompts`)
    /** The empty state is plain text. */
    await expect
      .element(page.getByText('You haven’t saved a prompt yet. Start from one of these, or write your own.'))
      .toBeVisible()
    await expect.element(list).not.toBeInTheDocument()
    const uses = page.getByRole('button', { name: /^Use “/ })
    await expect.poll(() => uses.elements().length).toBe(4)

    await page.getByRole('button', { name: "Use “Explain like I'm new”" }).click()
    await expect.element(nameField).toHaveValue("Explain like I'm new")
    await expect.element(nameField).toHaveFocus()
    await expect.element(newPrompt.getByRole('radio', { name: /^A passage I select/ })).toBeChecked()
    await expect.element(instructionField).toHaveValue(expect.stringMatching(/^Explain this passage as if/))

    await newPrompt.getByRole('button', { name: 'Save' }).click()
    await expect.element(cardOf("Explain like I'm new")).toBeVisible()
    expect(sent()).toEqual([[NEW_URL, expect.objectContaining({ name: "Explain like I'm new", appliesTo: 'passage' })]])
    await expect.element(announcement).toHaveTextContent("Saved “Explain like I'm new”.")
    await expect.element(count).toHaveTextContent(`1 of ${MAX_ASK_PROMPTS} prompts`)
    await expect.element(nameField).toHaveValue('')
    await expect.element(uses.first()).not.toBeInTheDocument()
  })

  it('adds a prompt the reader writes to the end of the list', async () => {
    const written = { ...EXPLAIN, id: '0b7e0000-0000-4000-8000-000000000003', name: 'Define' }
    fetchSpy.mockResolvedValue(answer(201, { prompt: written }))
    await mountPrompts([SUMMARISE])
    await nameField.fill('Define')
    await instructionField.fill(written.instruction)
    await newPrompt.getByRole('button', { name: 'Save' }).click()
    await expect.poll(order).toEqual(['Summarise', 'Define'])
    await expect.element(announcement).toHaveTextContent('Saved “Define”.')
  })

  it('shows a new prompt the server refuses in the form, and adds nothing', async () => {
    fetchSpy.mockResolvedValue(answer(409, { error: 'quota', max: MAX_ASK_PROMPTS }))
    await mountPrompts([SUMMARISE])
    await nameField.fill('Define')
    await instructionField.fill('Define the word.')
    await newPrompt.getByRole('button', { name: 'Save' }).click()
    await expect
      .element(newPrompt.getByRole('alert'))
      .toHaveTextContent('You have 20 prompts, the most an account can keep. Delete one to add another.')
    expect(order()).toEqual(['Summarise'])
  })

  it('has no form for a new prompt once the reader has the most prompts', async () => {
    const full = Array.from({ length: MAX_ASK_PROMPTS }, (_, i) => ({
      ...SUMMARISE,
      id: `0b7e0000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`,
      name: `Prompt ${i + 1}`,
    }))
    await mountPrompts(full)
    await expect.element(count).toHaveTextContent(`${MAX_ASK_PROMPTS} of ${MAX_ASK_PROMPTS} prompts`)
    await expect.element(cardOf('Prompt 20')).toBeVisible()
    await expect.element(newPrompt).not.toBeInTheDocument()
  })

  it('says to sign in again when the session ended before the page loaded', async () => {
    await mountPage({ state: 'signed_out' })
    await expect.element(page.getByRole('alert')).toHaveTextContent('Sign in again to change your prompts.')
    await expect.element(newPrompt).not.toBeInTheDocument()
    await expect.element(count).not.toBeInTheDocument()
  })

  it('says to try again when the prompts couldn’t be loaded', async () => {
    await mountPage({ state: 'unavailable' })
    await expect.element(page.getByRole('alert')).toHaveTextContent('Couldn’t save the prompt. Try again.')
    await expect.element(newPrompt).not.toBeInTheDocument()
  })
})

describe('PromptsPage: moving', () => {
  it('moves a prompt down, and announces it', async () => {
    fetchSpy.mockResolvedValue(answer(200, { prompts: [EXPLAIN, SUMMARISE] }))
    await mountPrompts([SUMMARISE, EXPLAIN])
    await expect.element(cardOf('Summarise').getByRole('button', { name: 'Move “Summarise” up' })).toBeDisabled()
    await cardOf('Summarise').getByRole('button', { name: 'Move “Summarise” down' }).click()
    await expect.poll(order).toEqual(['Explain', 'Summarise'])
    expect(sent()).toEqual([[changeUrl(SUMMARISE), { intent: 'move', direction: 'down' }]])
    await expect.element(announcement).toHaveTextContent('Moved “Summarise” down.')
  })

  it('moves a prompt up, and announces it', async () => {
    fetchSpy.mockResolvedValue(answer(200, { prompts: [EXPLAIN, SUMMARISE] }))
    await mountPrompts([SUMMARISE, EXPLAIN])
    await cardOf('Explain').getByRole('button', { name: 'Move “Explain” up' }).click()
    await expect.poll(order).toEqual(['Explain', 'Summarise'])
    await expect.element(announcement).toHaveTextContent('Moved “Explain” up.')
  })

  it.each([
    ['the server fails', () => fetchSpy.mockResolvedValue(answer(500, { error: 'failed' }))],
    ['the reader is offline', () => fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'))],
  ])('puts a move back and says to try again when %s', async (_, reply) => {
    reply()
    await mountPrompts([SUMMARISE, EXPLAIN])
    await cardOf('Summarise').getByRole('button', { name: 'Move “Summarise” down' }).click()
    await expect.element(toast).toHaveTextContent('Couldn’t save the prompt. Try again.')
    expect(order()).toEqual(['Summarise', 'Explain'])
    await expect.element(announcement).toHaveTextContent('')
  })

  it('drops a prompt another device deleted, and says so', async () => {
    fetchSpy.mockResolvedValue(answer(404, { error: 'not_found' }))
    await mountPrompts([SUMMARISE, EXPLAIN])
    await cardOf('Summarise').getByRole('button', { name: 'Move “Summarise” down' }).click()
    await expect
      .element(toast)
      .toHaveTextContent('That prompt isn’t there any more. It may have been deleted on another device.')
    expect(order()).toEqual(['Explain'])
  })

  it('says to sign in again when the session ended', async () => {
    fetchSpy.mockResolvedValue(answer(401, { error: 'signed_out' }))
    await mountPrompts([SUMMARISE, EXPLAIN])
    await cardOf('Explain').getByRole('button', { name: 'Move “Explain” up' }).click()
    await expect.element(toast).toHaveTextContent('Sign in again to change your prompts.')
    expect(order()).toEqual(['Summarise', 'Explain'])
  })
})

describe('PromptsPage: deleting', () => {
  async function askToDelete(name: string) {
    await cardOf(name).getByRole('button', { name: 'Delete' }).click()
    await expect.element(deleteDialog).toBeVisible()
  }

  it('asks first, and Cancel or Escape keeps the prompt', async () => {
    await mountPrompts([SUMMARISE, EXPLAIN])
    await askToDelete('Explain')
    /** The question is plain text inside the dialog. */
    await expect.element(deleteDialog.getByText('Delete the prompt “Explain”? Nothing else changes.')).toBeVisible()
    await deleteDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(deleteDialog).not.toBeInTheDocument()

    await askToDelete('Explain')
    await userEvent.keyboard('{Escape}')
    await expect.element(deleteDialog).not.toBeInTheDocument()
    expect(order()).toEqual(['Summarise', 'Explain'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('deletes the prompt, and announces it', async () => {
    fetchSpy.mockResolvedValue(answer(200, { deleted: true }))
    await mountPrompts([SUMMARISE, EXPLAIN])
    await askToDelete('Summarise')
    await deleteDialog.getByRole('button', { name: 'Delete' }).click()
    await expect.element(deleteDialog).not.toBeInTheDocument()
    await expect.element(announcement).toHaveTextContent('Deleted “Summarise”.')
    expect(order()).toEqual(['Explain'])
    expect(sent()).toEqual([[changeUrl(SUMMARISE), { intent: 'delete' }]])
  })

  it('counts a prompt another device deleted as deleted', async () => {
    fetchSpy.mockResolvedValue(answer(404, { error: 'not_found' }))
    await mountPrompts([SUMMARISE])
    await askToDelete('Summarise')
    await deleteDialog.getByRole('button', { name: 'Delete' }).click()
    await expect.element(announcement).toHaveTextContent('Deleted “Summarise”.')
    await expect.element(list).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /^Use “/ }).first()).toBeVisible()
  })

  it.each([
    [
      'the server fails',
      () => fetchSpy.mockResolvedValue(answer(500, { error: 'failed' })),
      'Couldn’t save the prompt. Try again.',
    ],
    [
      'the reader is offline',
      () => fetchSpy.mockRejectedValue(new TypeError('Failed to fetch')),
      'Couldn’t save the prompt. Try again.',
    ],
    [
      'the session ended',
      () => fetchSpy.mockResolvedValue(answer(401, { error: 'signed_out' })),
      'Sign in again to change your prompts.',
    ],
  ])('puts the prompt back when %s, and says why', async (_, reply, text) => {
    reply()
    await mountPrompts([SUMMARISE, EXPLAIN])
    await askToDelete('Summarise')
    await deleteDialog.getByRole('button', { name: 'Delete' }).click()
    await expect.element(toast).toHaveTextContent(text)
    await expect.poll(order).toEqual(['Summarise', 'Explain'])
    await expect.element(announcement).toHaveTextContent('')
  })
})

describe('PromptsPage: editing', () => {
  const editing = list.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Cancel' }) })

  async function startEdit(name: string) {
    await cardOf(name).getByRole('button', { name: 'Edit' }).click()
    await expect.element(editing.getByRole('textbox', { name: 'Name' })).toHaveFocus()
  }

  it('edits a prompt in place, hiding the new prompt form meanwhile, and gives focus back to Edit', async () => {
    const edited = { ...EXPLAIN, name: 'Explain simply' }
    fetchSpy.mockResolvedValue(answer(200, { prompt: edited }))
    await mountPrompts([SUMMARISE, EXPLAIN])
    await startEdit('Explain')
    await expect.element(newPrompt).not.toBeInTheDocument()
    await expect.element(editing.getByRole('textbox', { name: 'Name' })).toHaveValue('Explain')

    await editing.getByRole('textbox', { name: 'Name' }).fill('Explain simply')
    await editing.getByRole('button', { name: 'Save' }).click()
    await expect.element(cardOf('Explain simply').getByRole('button', { name: 'Edit' })).toHaveFocus()
    expect(sent()).toEqual([
      [
        changeUrl(EXPLAIN),
        { intent: 'edit', name: 'Explain simply', appliesTo: 'passage', instruction: EXPLAIN.instruction },
      ],
    ])
    await expect.element(announcement).toHaveTextContent('Saved “Explain simply”.')
    expect(order()).toEqual(['Summarise', 'Explain simply'])
    await expect.element(newPrompt).toBeVisible()
  })

  it('cancels an edit, giving focus back to Edit', async () => {
    await mountPrompts([SUMMARISE, EXPLAIN])
    await startEdit('Summarise')
    await editing.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(cardOf('Summarise').getByRole('button', { name: 'Edit' })).toHaveFocus()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the edit open with the reason when the reader has another prompt by that name', async () => {
    fetchSpy.mockResolvedValue(answer(409, { error: 'exists' }))
    await mountPrompts([SUMMARISE, EXPLAIN])
    await startEdit('Explain')
    await editing.getByRole('textbox', { name: 'Name' }).fill('Summarise')
    await editing.getByRole('button', { name: 'Save' }).click()
    await expect
      .element(editing.getByRole('alert'))
      .toHaveTextContent('You already have a prompt called “Summarise”. Pick another name.')
    await expect.element(toast).toHaveTextContent('')
  })

  it('closes the edit and drops a prompt another device deleted, and says so', async () => {
    fetchSpy.mockResolvedValue(answer(404, { error: 'not_found' }))
    await mountPrompts([SUMMARISE, EXPLAIN])
    await startEdit('Explain')
    await editing.getByRole('button', { name: 'Save' }).click()
    await expect
      .element(toast)
      .toHaveTextContent('That prompt isn’t there any more. It may have been deleted on another device.')
    await expect.element(editing).not.toBeInTheDocument()
    expect(order()).toEqual(['Summarise'])
  })
})
