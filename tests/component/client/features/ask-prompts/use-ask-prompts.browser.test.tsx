import { describe, expect, it, vi } from 'vitest'
import type { PromptResult } from '~/client/features/ask-prompts/ask-prompts-client'
import { useAskPrompts } from '~/client/features/ask-prompts/use-ask-prompts'
import type { AskPromptView } from '~/shared/ask-prompts/prompts'
import { mountHook } from '../../../../support/client/mount'

/** The prompt endpoints; each test says how the server answers. */
const requests = vi.hoisted(() => ({
  createPrompt: vi.fn(),
  editPrompt: vi.fn(),
  movePrompt: vi.fn(),
  deletePrompt: vi.fn(),
}))
vi.mock('~/client/features/ask-prompts/ask-prompts-client', () => requests)

const summarise: AskPromptView = { id: 'p1', name: 'Summarise', appliesTo: 'pages', instruction: 'Sum it up.' }
const explain: AskPromptView = { id: 'p2', name: 'Explain', appliesTo: 'passage', instruction: 'Explain this.' }
const translate: AskPromptView = { id: 'p3', name: 'Translate', appliesTo: 'passage', instruction: 'Translate it.' }

const names = (prompts: readonly AskPromptView[]) => prompts.map((prompt) => prompt.name)

describe('useAskPrompts', () => {
  it('starts with the prompts the page loaded', () => {
    const hook = mountHook(useAskPrompts, [summarise, explain])
    expect(names(hook.current.prompts)).toEqual(['Summarise', 'Explain'])
  })

  it('keeps its own list when the page renders it with another', () => {
    const hook = mountHook(useAskPrompts, [summarise])
    hook.rerender([explain, translate])
    expect(names(hook.current.prompts)).toEqual(['Summarise'])
  })

  it('shows a new prompt once the server keeps it', async () => {
    const created = Promise.withResolvers<PromptResult<AskPromptView>>()
    requests.createPrompt.mockReturnValue(created.promise)
    const hook = mountHook(useAskPrompts, [summarise])

    const result = hook.current.create({ name: 'Explain', appliesTo: 'passage', instruction: 'Explain this.' })
    expect(names(hook.current.prompts)).toEqual(['Summarise'])
    created.resolve({ ok: true, value: explain })

    expect(await result).toEqual({ ok: true, value: explain })
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Summarise', 'Explain']))
  })

  it('shows a move at once, and puts the prompt back when the server refuses it', async () => {
    const answer = Promise.withResolvers<PromptResult<AskPromptView[]>>()
    requests.movePrompt.mockReturnValue(answer.promise)
    const hook = mountHook(useAskPrompts, [summarise, explain, translate])

    const result = hook.current.move('p2', 'up')
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Explain', 'Summarise', 'Translate']))
    answer.resolve({ ok: false, problem: 'failed' })

    expect(await result).toEqual({ ok: false, problem: 'failed' })
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Summarise', 'Explain', 'Translate']))
  })

  it('takes a deleted prompt away at once, and brings it back when the server refuses', async () => {
    const answer = Promise.withResolvers<PromptResult<true>>()
    requests.deletePrompt.mockReturnValue(answer.promise)
    const hook = mountHook(useAskPrompts, [summarise, explain])

    const result = hook.current.remove('p1')
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Explain']))
    answer.resolve({ ok: false, problem: 'signed_out' })

    expect(await result).toEqual({ ok: false, problem: 'signed_out' })
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Summarise', 'Explain']))
  })

  it('swaps in the server’s copy of an edited prompt', async () => {
    const edited: AskPromptView = { ...summarise, name: 'Summary' }
    requests.editPrompt.mockResolvedValue({ ok: true, value: edited })
    const hook = mountHook(useAskPrompts, [summarise, explain])

    await hook.current.edit('p1', { name: 'Summary', appliesTo: 'pages', instruction: 'Sum it up.' })

    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Summary', 'Explain']))
    expect(requests.editPrompt).toHaveBeenCalledExactlyOnceWith('p1', {
      name: 'Summary',
      appliesTo: 'pages',
      instruction: 'Sum it up.',
    })
  })
})
