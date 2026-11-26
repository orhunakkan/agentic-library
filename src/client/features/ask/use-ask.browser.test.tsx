import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { mountHook } from '~/client/testing/mount'
import type { QuizQuestion } from '~/shared/ask/events'
import { citationMarker } from '~/shared/ask/events'
import type { PagePosition } from '~/shared/content/position'
import { loadThread, saveThread, type Thread, threadKey } from './thread-store'
import { useAsk } from './use-ask'

const BOOK = 'use-ask-book'
const OTHER_BOOK = 'use-ask-other-book'
const PAGE_ONE: PagePosition = { chapter: 'ch1', page: 1 }
const PAGE_TWO: PagePosition = { chapter: 'ch1', page: 2 }

/**
 * One question as the fake server got it, and a way to stream its answer back, line by line as the server does. Events
 * are `unknown` so a test can send one the client doesn't know.
 */
interface AskCall {
  url: string
  request: unknown
  signal: AbortSignal
  send: (...events: unknown[]) => void
  end: () => void
}

let calls: AskCall[]
let fetchSpy: MockInstance<typeof fetch>

/** Answers each question with a stream the test writes to, which errors when the hook aborts the request. */
function streamedAnswer(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const signal = init.signal ?? new AbortController().signal
  const encoder = new TextEncoder()
  let open = true
  let writer: ReadableStreamDefaultController<Uint8Array> | null = null
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      writer = controller
    },
  })
  signal.addEventListener('abort', () => {
    if (open) writer?.error(signal.reason)
    open = false
  })
  calls.push({
    url: String(input),
    request: JSON.parse(String(init.body)),
    signal,
    send: (...events) => {
      for (const event of events) writer?.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
    },
    end: () => {
      if (open) writer?.close()
      open = false
    },
  })
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
}

const refusal = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function lastCall(): AskCall {
  const call = calls.at(-1)
  if (!call) throw new Error('No question was sent')
  return call
}

const savedThread = (): Thread => ({
  v: 1,
  wholeBook: false,
  turns: [
    { role: 'user', text: 'Who is Ishmael?', citations: [], at: 1 },
    { role: 'assistant', text: 'The narrator.', citations: [], at: 2 },
  ],
})

const question: QuizQuestion = {
  question: 'Where does the voyage start?',
  choices: ['Nantucket', 'Boston', 'London', 'Lima'],
  answer: 0,
  why: 'It sails from Nantucket.',
  citations: [],
  source: { position: PAGE_ONE, label: 'Chapter 1' },
}

interface Props {
  book: string
  position: PagePosition
}

const useAskOn = ({ book, position }: Props) => useAsk(book, position)

/** Mounts the hook on `book` and waits for the thread saved for it to load. */
async function mountOn(book: string, position: PagePosition = PAGE_ONE) {
  const hook = mountHook(useAskOn, { book, position })
  const saved = loadThread(localStorage, book)
  await vi.waitFor(() => expect(hook.current.thread).toEqual(saved))
  return hook
}

beforeEach(() => {
  localStorage.removeItem(threadKey(BOOK))
  localStorage.removeItem(threadKey(OTHER_BOOK))
  calls = []
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(streamedAnswer)
})

describe('useAsk', () => {
  it('starts with the thread saved for the book, and nothing being asked', async () => {
    saveThread(localStorage, BOOK, savedThread())
    const hook = await mountOn(BOOK)
    expect(hook.current.thread).toEqual(savedThread())
    expect(hook.current).toMatchObject({ pending: null, failure: null, busy: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('shows the answer as it streams in, then keeps it in the thread and in storage', async () => {
    const hook = await mountOn(BOOK)

    void hook.current.ask('  What happens first?  ', 'Call me Ishmael.')
    await vi.waitFor(() => expect(hook.current.busy).toBe(true))
    expect(hook.current.pending).toMatchObject({ question: 'What happens first?', quote: 'Call me Ishmael.', text: '' })

    lastCall().send({ type: 'text', text: 'A man goes ' })
    await vi.waitFor(() => expect(hook.current.pending?.text).toBe('A man goes '))
    lastCall().send(
      { type: 'text', text: 'to sea.' },
      { type: 'citation', pageHref: '/read/x/ch1/1', label: 'p. 1', citedText: 'Call me Ishmael.' },
      { type: 'done', stop: 'end_turn' },
    )

    await vi.waitFor(() => expect(hook.current.busy).toBe(false))
    expect(hook.current.pending).toBeNull()
    expect(hook.current.failure).toBeNull()
    expect(hook.current.thread.turns).toMatchObject([
      { role: 'user', text: '“Call me Ishmael.”\n\nWhat happens first?' },
      {
        role: 'assistant',
        text: `A man goes to sea.${citationMarker(0)}`,
        citations: [{ pageHref: '/read/x/ch1/1', label: 'p. 1', citedText: 'Call me Ishmael.' }],
      },
    ])
    expect(loadThread(localStorage, BOOK)).toEqual(hook.current.thread)
  })

  it('sends the page the reader is on now and the conversation so far', async () => {
    saveThread(localStorage, BOOK, { ...savedThread(), wholeBook: true })
    const hook = await mountOn(BOOK, PAGE_ONE)
    hook.rerender({ book: BOOK, position: PAGE_TWO })

    void hook.current.ask('And then?')

    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(lastCall().url).toBe(`/read/${BOOK}/ask`)
    expect(lastCall().request).toEqual({
      position: PAGE_TWO,
      wholeBook: true,
      question: 'And then?',
      quote: null,
      history: [
        { role: 'user', text: 'Who is Ishmael?' },
        { role: 'assistant', text: 'The narrator.' },
      ],
    })
  })

  it('sends nothing for a blank question, or for a second one while the first is answered', async () => {
    const hook = await mountOn(BOOK)

    await hook.current.ask('   ')
    expect(fetchSpy).not.toHaveBeenCalled()

    void hook.current.ask('First?')
    await vi.waitFor(() => expect(hook.current.busy).toBe(true))
    await hook.current.ask('Second?')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(hook.current.pending?.question).toBe('First?')
  })

  it('keeps what was said so far, marked stopped, when the reader stops it', async () => {
    const hook = await mountOn(BOOK)
    void hook.current.ask('What happens?')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    lastCall().send({ type: 'text', text: 'He goes' })
    await vi.waitFor(() => expect(hook.current.pending?.text).toBe('He goes'))

    hook.current.stop()

    await vi.waitFor(() => expect(hook.current.busy).toBe(false))
    expect(lastCall().signal.aborted).toBe(true)
    expect(hook.current.failure).toBeNull()
    expect(hook.current.thread.turns).toMatchObject([
      { role: 'user', text: 'What happens?' },
      { role: 'assistant', text: 'He goes', stopped: true },
    ])
    expect(loadThread(localStorage, BOOK)).toEqual(hook.current.thread)
  })

  it('keeps the thread as it was when the server refuses, and asks again the same way on retry', async () => {
    saveThread(localStorage, BOOK, savedThread())
    fetchSpy.mockResolvedValueOnce(refusal(429, { error: 'limit', retryAt: '2026-11-26T14:00:00.000Z' }))
    const hook = await mountOn(BOOK)

    await hook.current.ask('Explain this.', 'a quote', { highlights: true, action: 'explain', prompt: 'p1' })

    await vi.waitFor(() =>
      expect(hook.current.failure).toEqual({
        problem: 'limit',
        retryAt: '2026-11-26T14:00:00.000Z',
        question: 'Explain this.',
        quote: 'a quote',
        highlights: true,
        action: 'explain',
        prompt: 'p1',
      }),
    )
    await vi.waitFor(() => expect(hook.current.busy).toBe(false))
    expect(hook.current.thread).toEqual(savedThread())
    expect(loadThread(localStorage, BOOK)).toEqual(savedThread())

    hook.current.retry()

    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await vi.waitFor(() => expect(hook.current.failure).toBeNull())
    expect(lastCall().request).toMatchObject({
      question: 'Explain this.',
      quote: 'a quote',
      highlights: true,
      action: 'explain',
      prompt: 'p1',
    })
  })

  it('says the request failed when the server cannot be reached', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const hook = await mountOn(BOOK)

    await hook.current.ask('Anyone there?')

    await vi.waitFor(() => expect(hook.current.failure?.problem).toBe('failed'))
    expect(hook.current.thread.turns).toEqual([])
    await vi.waitFor(() => expect(hook.current.busy).toBe(false))
  })

  it.each<{ name: string; events: unknown[]; problem: string }>([
    { name: 'an error in the stream', events: [{ type: 'error', code: 'busy' }], problem: 'busy' },
    { name: 'an unknown error code', events: [{ type: 'error', code: 'other' }], problem: 'failed' },
    { name: 'a refusal', events: [{ type: 'done', stop: 'refusal' }], problem: 'refusal' },
    { name: 'a stream that ends early', events: [], problem: 'failed' },
  ])('fails, and keeps no turns, on $name', async ({ events, problem }) => {
    const hook = await mountOn(BOOK)
    void hook.current.ask('What now?')
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    lastCall().send({ type: 'text', text: 'Partly ' }, ...events)
    lastCall().end()

    await vi.waitFor(() => expect(hook.current.failure?.problem).toBe(problem))
    await vi.waitFor(() => expect(hook.current.busy).toBe(false))
    expect(hook.current.thread.turns).toEqual([])
    expect(localStorage.getItem(threadKey(BOOK))).toBeNull()
  })

  it('keeps a quiz as a turn of its own, and saves the reader’s picks', async () => {
    const hook = await mountOn(BOOK)
    void hook.current.ask('Quiz me', null, { action: 'quiz' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    lastCall().send({ type: 'quiz', span: 'chapter', questions: [question] }, { type: 'done', stop: 'end_turn' })

    await vi.waitFor(() => expect(hook.current.thread.turns).toHaveLength(2))
    expect(hook.current.thread.turns[1]?.study).toMatchObject({ kind: 'quiz', questions: [{ picked: null }] })

    hook.current.pick(1, 0, 2)

    await vi.waitFor(() =>
      expect(hook.current.thread.turns[1]?.study).toMatchObject({ kind: 'quiz', questions: [{ picked: 2 }] }),
    )
    expect(loadThread(localStorage, BOOK)).toEqual(hook.current.thread)
  })

  it('fails a quiz whose answer brings no questions', async () => {
    const hook = await mountOn(BOOK)
    void hook.current.ask('Quiz me', null, { action: 'quiz' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    lastCall().send({ type: 'done', stop: 'end_turn' })

    await vi.waitFor(() => expect(hook.current.failure?.problem).toBe('failed'))
    expect(hook.current.thread.turns).toEqual([])
  })

  it('drops an answer still coming for a book the reader has left', async () => {
    saveThread(localStorage, OTHER_BOOK, savedThread())
    const hook = await mountOn(BOOK)
    void hook.current.ask('What happens?')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    const left = lastCall()
    left.send({ type: 'text', text: 'He goes' })
    await vi.waitFor(() => expect(hook.current.pending?.text).toBe('He goes'))

    hook.rerender({ book: OTHER_BOOK, position: PAGE_ONE })

    expect(left.signal.aborted).toBe(true)
    await vi.waitFor(() => expect(hook.current.thread).toEqual(savedThread()))
    await vi.waitFor(() => expect(hook.current.busy).toBe(false))
    expect(hook.current.failure).toBeNull()
    expect(localStorage.getItem(threadKey(BOOK))).toBeNull()
    expect(loadThread(localStorage, OTHER_BOOK)).toEqual(savedThread())
  })

  it('clears the thread, keeping the whole-book choice, and drops an answer still coming', async () => {
    saveThread(localStorage, BOOK, { ...savedThread(), wholeBook: true })
    const hook = await mountOn(BOOK)
    void hook.current.ask('What happens?')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    lastCall().send({ type: 'text', text: 'He goes' })
    await vi.waitFor(() => expect(hook.current.pending?.text).toBe('He goes'))

    hook.current.clear()

    expect(lastCall().signal.aborted).toBe(true)
    await vi.waitFor(() => expect(hook.current.busy).toBe(false))
    expect(hook.current.thread).toEqual({ v: 1, wholeBook: true, turns: [] })
    expect(localStorage.getItem(threadKey(BOOK))).toBeNull()
  })

  it('saves the whole-book choice', async () => {
    const hook = await mountOn(BOOK)
    hook.current.setWholeBook(true)
    await vi.waitFor(() => expect(hook.current.thread.wholeBook).toBe(true))
    expect(loadThread(localStorage, BOOK).wholeBook).toBe(true)
  })

  it('aborts the answer when it unmounts, saving what was said as stopped', async () => {
    const hook = await mountOn(BOOK)
    void hook.current.ask('What happens?')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    lastCall().send({ type: 'text', text: 'He goes' })
    await vi.waitFor(() => expect(hook.current.pending?.text).toBe('He goes'))

    hook.unmount()

    expect(lastCall().signal.aborted).toBe(true)
    await vi.waitFor(() => expect(localStorage.getItem(threadKey(BOOK))).not.toBeNull())
    expect(loadThread(localStorage, BOOK).turns).toMatchObject([
      { role: 'user', text: 'What happens?' },
      { role: 'assistant', text: 'He goes', stopped: true },
    ])
  })
})
