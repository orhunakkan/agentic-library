import { describe, expect, it, vi } from 'vitest'
import {
  createPrompt,
  deletePrompt,
  editPrompt,
  movePrompt,
  readPromptAnswer,
} from '~/client/features/ask-prompts/ask-prompts-client'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const PROMPT = { id: 'p1', name: 'Who', appliesTo: 'pages', instruction: 'List them.' }
const FIELDS = { name: 'Who', appliesTo: 'pages', instruction: 'List them.' }

function answering(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const sentTo = (fetchMock: ReturnType<typeof answering>) => {
  const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  return [path, JSON.parse(String(init.body))]
}

describe('the requests', () => {
  it('creates a prompt', async () => {
    const fetchMock = answering(json(201, { prompt: PROMPT }))
    expect(await createPrompt(FIELDS)).toEqual({ ok: true, value: PROMPT })
    expect(sentTo(fetchMock)).toEqual(['/account/prompts/new', FIELDS])
  })

  it('edits one', async () => {
    const fetchMock = answering(json(200, { prompt: PROMPT }))
    expect(await editPrompt('p1', FIELDS)).toEqual({ ok: true, value: PROMPT })
    expect(sentTo(fetchMock)).toEqual(['/account/prompts/p1', { intent: 'edit', ...FIELDS }])
  })

  it('moves one, answering the list', async () => {
    const fetchMock = answering(json(200, { prompts: [PROMPT] }))
    expect(await movePrompt('p1', 'down')).toEqual({ ok: true, value: [PROMPT] })
    expect(sentTo(fetchMock)).toEqual(['/account/prompts/p1', { intent: 'move', direction: 'down' }])
  })

  it('deletes one', async () => {
    const fetchMock = answering(json(200, { deleted: true }))
    expect(await deletePrompt('p1')).toEqual({ ok: true, value: true })
    expect(sentTo(fetchMock)).toEqual(['/account/prompts/p1', { intent: 'delete' }])
  })

  it('a network failure is failed', async () => {
    answering(new TypeError('offline'))
    expect(await deletePrompt('p1')).toEqual({ ok: false, problem: 'failed' })
  })

  it('an answer without what was asked for is failed', async () => {
    answering(json(200, {}))
    expect(await movePrompt('p1', 'up')).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('readPromptAnswer', () => {
  const pick = (b: Record<string, unknown>) => b.prompt
  const problem = async (status: number, body: unknown) => {
    const result = await readPromptAnswer(json(status, body), pick)
    return result.ok ? null : result.problem
  }

  it('maps an invalid body’s reason, and one without a known reason to failed', async () => {
    for (const reason of ['name_empty', 'name_too_long', 'instruction_empty', 'instruction_too_long', 'reserved'])
      expect(await problem(400, { error: 'invalid', reason })).toBe(reason)
    expect(await problem(400, { error: 'invalid', reason: 'applies_to' })).toBe('failed')
    expect(await problem(400, { error: 'invalid' })).toBe('failed')
  })

  it('maps each code', async () => {
    expect(await problem(409, { error: 'exists' })).toBe('exists')
    expect(await problem(409, { error: 'quota', max: 20 })).toBe('quota')
    expect(await problem(404, { error: 'not_found' })).toBe('not_found')
    expect(await problem(401, { error: 'signed_out' })).toBe('signed_out')
    expect(await problem(500, { error: 'failed' })).toBe('failed')
    expect(await problem(403, 'not json')).toBe('failed')
  })
})
