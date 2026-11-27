import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { useAskPrompts } from '~/client/features/ask-prompts/use-ask-prompts'
import type { AskPromptView, PromptErrorCode } from '~/shared/ask-prompts/prompts'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountHook } from '../../../../support/client/mount'

/**
 * A prompt endpoint's answer, as `src/server/ask-prompts/actions.ts` sends it. The refusal codes are the shared
 * `PromptErrorCode`; the success bodies have no shared type, so they are written to match the handler.
 */
const promptJson = (
  status: number,
  body: { prompt: AskPromptView } | { prompts: AskPromptView[] } | { deleted: true } | ErrorAnswer<PromptErrorCode>,
) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The network: each test says how the prompt endpoints answer, and a request it didn't expect gets no answer. */
let fetchSpy: MockInstance<typeof fetch>

/** Each request sent to the network, as its path, method and JSON body. */
const sent = () =>
  fetchSpy.mock.calls.map(([path, init]) => ({
    path: String(path),
    method: init?.method,
    body: JSON.parse(String(init?.body)) as unknown,
  }))

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer for this request'))
})

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
    const created = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(created.promise)
    const hook = mountHook(useAskPrompts, [summarise])

    const result = hook.current.create({ name: 'Explain', appliesTo: 'passage', instruction: 'Explain this.' })
    expect(names(hook.current.prompts)).toEqual(['Summarise'])
    created.resolve(promptJson(201, { prompt: explain }))

    expect(await result).toEqual({ ok: true, value: explain })
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Summarise', 'Explain']))
  })

  it('shows a move at once, and puts the prompt back when the server refuses it', async () => {
    const answer = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(answer.promise)
    const hook = mountHook(useAskPrompts, [summarise, explain, translate])

    const result = hook.current.move('p2', 'up')
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Explain', 'Summarise', 'Translate']))
    answer.resolve(promptJson(500, { error: 'failed' }))

    expect(await result).toEqual({ ok: false, problem: 'failed' })
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Summarise', 'Explain', 'Translate']))
  })

  it('takes a deleted prompt away at once, and brings it back when the server refuses', async () => {
    const answer = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(answer.promise)
    const hook = mountHook(useAskPrompts, [summarise, explain])

    const result = hook.current.remove('p1')
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Explain']))
    answer.resolve(promptJson(401, { error: 'signed_out' }))

    expect(await result).toEqual({ ok: false, problem: 'signed_out' })
    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Summarise', 'Explain']))
  })

  it('swaps in the server’s copy of an edited prompt', async () => {
    const edited: AskPromptView = { ...summarise, name: 'Summary' }
    fetchSpy.mockResolvedValue(promptJson(200, { prompt: edited }))
    const hook = mountHook(useAskPrompts, [summarise, explain])

    await hook.current.edit('p1', { name: 'Summary', appliesTo: 'pages', instruction: 'Sum it up.' })

    await vi.waitFor(() => expect(names(hook.current.prompts)).toEqual(['Summary', 'Explain']))
    expect(sent()).toEqual([
      {
        path: '/account/prompts/p1',
        method: 'POST',
        body: { intent: 'edit', name: 'Summary', appliesTo: 'pages', instruction: 'Sum it up.' },
      },
    ])
  })
})
