import { describe, expect, it, vi } from 'vitest'
import { citationMarker } from '~/client/features/ask/answer-format'
import { historyFor, isStudyAction, readEvents, sendQuestion } from '~/client/features/ask/ask-client'
import type { ThreadTurn } from '~/client/features/ask/thread-store'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function all(stream: ReadableStream<Uint8Array>) {
  const out = []
  for await (const event of readEvents(stream)) out.push(event)
  return out
}

describe('readEvents', () => {
  it('reads one event per line, across chunk boundaries and split characters', async () => {
    const line = '{"type":"text","text":"café"}\n'
    const bytes = new TextEncoder().encode(`${line}{"type":"done","stop":"end_turn"}`)
    const split = [bytes.slice(0, 26), bytes.slice(26, 40), bytes.slice(40)]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of split) controller.enqueue(part)
        controller.close()
      },
    })
    expect(await all(stream)).toEqual([
      { type: 'text', text: 'café' },
      { type: 'done', stop: 'end_turn' },
    ])
  })

  it('skips blank and malformed lines', async () => {
    expect(await all(streamOf(['\n', 'nope\n', '42\n', '{"type":"text","text":"a"}\n']))).toEqual([
      { type: 'text', text: 'a' },
    ])
  })
})

describe('historyFor', () => {
  const turn = (role: 'user' | 'assistant', text: string): ThreadTurn => ({ role, text, citations: [], at: 0 })

  it('sends plain text, without citation markers or empty answers', () => {
    expect(
      historyFor([turn('user', 'Q?'), turn('assistant', `A${citationMarker(0)}.`), turn('assistant', '  ')]),
    ).toEqual([
      { role: 'user', text: 'Q?' },
      { role: 'assistant', text: 'A.' },
    ])
  })

  it('keeps the newest 10 turns within 16,000 characters', () => {
    const turns = Array.from({ length: 14 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', `t${i}`))
    expect(historyFor(turns).map((t) => t.text)).toEqual(turns.slice(4).map((t) => t.text))
    const long = [turn('user', 'x'.repeat(9_000)), turn('assistant', 'y'.repeat(9_000)), turn('user', 'z')]
    expect(historyFor(long).map((t) => t.text.length)).toEqual([9_000, 1])
  })

  it('cuts a single turn longer than the budget to its end', () => {
    const [only] = historyFor([turn('assistant', `${'a'.repeat(20_000)}END`)])
    expect(only?.text.length).toBe(16_000)
    expect(only?.text.endsWith('END')).toBe(true)
  })
})

describe('sendQuestion', () => {
  const request = {
    position: { chapter: 'chapter-1', page: 1 },
    wholeBook: false,
    question: 'Quiz me on this chapter so far.',
    quote: null,
    history: [],
    action: 'quiz' as const,
  }
  const answer = (status: number, body: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status })),
    )

  it('reads a quiz event from the stream', async () => {
    const quiz = { type: 'quiz', span: 'chapter', questions: [] }
    answer(200, `${JSON.stringify(quiz)}\n{"type":"done","stop":"end_turn"}\n`)
    const result = await sendQuestion('b', request, new AbortController().signal)
    if (!result.ok) throw new Error(result.problem)
    const events = []
    for await (const event of result.events) events.push(event)
    expect(events).toEqual([quiz, { type: 'done', stop: 'end_turn' }])
  })

  it('names too little read, and anything unknown as failed', async () => {
    answer(422, '{"error":"too_little"}')
    expect(await sendQuestion('b', request, new AbortController().signal)).toEqual({ ok: false, problem: 'too_little' })
    answer(500, 'not json')
    expect(await sendQuestion('b', request, new AbortController().signal)).toEqual({ ok: false, problem: 'failed' })
  })

  it('names a saved prompt that has gone, and sends the prompt’s id', async () => {
    answer(404, '{"error":"no_prompt"}')
    const id = '6f1c0000-0000-4000-8000-000000000000'
    expect(await sendQuestion('b', { ...request, prompt: id }, new AbortController().signal)).toEqual({
      ok: false,
      problem: 'no_prompt',
    })
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body)).prompt).toBe(id)
  })

  it('sends spoken: true for a question asked by voice, and nothing for a typed one', async () => {
    answer(200, '{"type":"done","stop":"end_turn"}\n')
    await sendQuestion('b', { ...request, spoken: true }, new AbortController().signal)
    await sendQuestion('b', request, new AbortController().signal)
    const bodies = vi
      .mocked(fetch)
      .mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)))
    expect(bodies[0].spoken).toBe(true)
    expect('spoken' in bodies[1]).toBe(false)
  })

  it('knows which actions answer with a quiz or cards', () => {
    expect(['quiz', 'flashcards', 'summary', null].map((a) => isStudyAction(a as never))).toEqual([
      true,
      true,
      false,
      false,
    ])
  })
})
