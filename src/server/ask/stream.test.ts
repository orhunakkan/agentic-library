import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { BookText } from './book-text'
import { buildContext } from './context'
import { type AskEvent, askErrorCode, encodeEvent, eventMapper, studyEvent } from './stream'

type RawEvent = Anthropic.Beta.BetaRawMessageStreamEvent

const book: BookText = {
  kind: 'chapter',
  chapters: [{ title: 'Functions', slug: 'functions', firstPage: 0, pageCount: 2 }],
  pages: [
    {
      href: '/read/b/functions',
      label: 'Ch. 1 · p. 1',
      heading: 'Chapter 1: Functions, page 1',
      chapterIndex: 0,
      printedPage: null,
      blocks: ['A closure keeps its scope.', 'Second paragraph.'],
    },
    {
      href: '/read/b/functions/2',
      label: 'Ch. 1 · p. 2',
      heading: 'Chapter 1: Functions, page 2',
      chapterIndex: 0,
      printedPage: null,
      blocks: ['Bindings live on.'],
    },
  ],
}
const built = buildContext(book, 1, { bookTitle: 'B', wholeBook: false })
if (!built.ok) throw new Error('context')
const context = built.context

const start = (index: number, type: 'text' | 'thinking' | 'fallback') =>
  ({
    type: 'content_block_start',
    index,
    content_block:
      type === 'text'
        ? { type: 'text', text: '', citations: null }
        : type === 'thinking'
          ? { type: 'thinking', thinking: '', signature: '' }
          : {
              type: 'fallback',
              from: { model: 'claude-opus-5-5' },
              to: { model: 'claude-opus-5' },
              trigger: { type: 'refusal', category: null },
            },
  }) as RawEvent
const text = (index: number, t: string) =>
  ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } }) as RawEvent
const cite = (index: number, document_index: number, start_block_index: number, end_block_index: number) =>
  ({
    type: 'content_block_delta',
    index,
    delta: {
      type: 'citations_delta',
      citation: {
        type: 'content_block_location',
        cited_text: 'ignored: the server uses its own copy',
        document_index,
        document_title: 'B',
        start_block_index,
        end_block_index,
      },
    },
  }) as RawEvent
const stop = (index: number) => ({ type: 'content_block_stop', index }) as RawEvent
const messageDelta = (stop_reason: string) =>
  ({ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } }) as RawEvent

function run(events: RawEvent[]) {
  const mapper = eventMapper(context)
  return { out: events.flatMap((e) => mapper.map(e)), stop: mapper.stop }
}

describe('eventMapper', () => {
  it('streams text, skips the empty thinking block and puts each citation after its passage', () => {
    const { out, stop: reason } = run([
      { type: 'message_start', message: {} } as RawEvent,
      start(0, 'thinking'),
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } } as RawEvent,
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } } as RawEvent,
      stop(0),
      start(1, 'text'),
      text(1, 'The book says '),
      stop(1),
      start(2, 'text'),
      cite(2, 0, 0, 1),
      text(2, 'a closure keeps '),
      text(2, 'its scope'),
      stop(2),
      start(3, 'text'),
      text(3, '.'),
      stop(3),
      messageDelta('end_turn'),
      { type: 'message_stop' } as RawEvent,
    ])
    expect(out).toEqual<AskEvent[]>([
      { type: 'text', text: 'The book says ' },
      { type: 'text', text: 'a closure keeps ' },
      { type: 'text', text: 'its scope' },
      {
        type: 'citation',
        pageHref: '/read/b/functions',
        label: 'Ch. 1 · p. 1',
        citedText: 'A closure keeps its scope.',
      },
      { type: 'text', text: '.' },
    ])
    expect(reason).toBe('end_turn')
  })

  it('drops citations outside what was sent and repeats of one within a block', () => {
    const { out } = run([
      start(0, 'text'),
      cite(0, 0, 2, 3),
      cite(0, 1, 0, 1),
      cite(0, 0, 9, 10),
      text(0, 'x'),
      stop(0),
    ])
    expect(out.filter((e) => e.type === 'citation')).toEqual([
      { type: 'citation', pageHref: '/read/b/functions/2', label: 'Ch. 1 · p. 2', citedText: 'Bindings live on.' },
    ])
    const repeated = run([start(0, 'text'), cite(0, 0, 0, 1), cite(0, 0, 0, 1), text(0, 'x'), stop(0)])
    expect(repeated.out.filter((e) => e.type === 'citation')).toHaveLength(1)
  })

  it('keeps going through a mid-stream fallback: text already sent stays, the fallback block is skipped', () => {
    const { out, stop: reason } = run([
      start(0, 'text'),
      text(0, 'Partly '),
      stop(0),
      start(1, 'fallback'),
      stop(1),
      start(2, 'text'),
      text(2, 'answered.'),
      stop(2),
      messageDelta('end_turn'),
    ])
    expect(out).toEqual([
      { type: 'text', text: 'Partly ' },
      { type: 'text', text: 'answered.' },
    ])
    expect(reason).toBe('end_turn')
  })

  it('reports a refusal as the stop reason', () => {
    expect(run([messageDelta('refusal')]).stop).toBe('refusal')
  })

  it('encodes one event per line', () => {
    expect(encodeEvent({ type: 'done', stop: 'end_turn' })).toBe('{"type":"done","stop":"end_turn"}\n')
    expect(encodeEvent({ type: 'text', text: 'a\nb' })).toBe('{"type":"text","text":"a\\nb"}\n')
  })
})

describe('eventMapper, collecting a quiz or flashcards', () => {
  const card = (n: number) => `FRONT: Term ${n}\nBACK: Meaning ${n}`
  const collected = () => {
    const mapper = eventMapper(context, { collect: true })
    const out = [
      start(0, 'thinking'),
      stop(0),
      start(1, 'text'),
      text(1, `${card(1)}\n\n${card(2)}\n\n${card(3)}\n\nFRONT: Term 4\nBACK: `),
      stop(1),
      start(2, 'text'),
      cite(2, 0, 2, 3),
      text(2, 'bindings live on'),
      stop(2),
      start(3, 'fallback'),
      stop(3),
      messageDelta('end_turn'),
    ].flatMap((e) => mapper.map(e))
    return { mapper, out }
  }

  it('sends no text or citations, and keeps the text blocks with their citations', () => {
    const { mapper, out } = collected()
    expect(out).toEqual([])
    expect(mapper.blocks).toHaveLength(2)
    expect(mapper.blocks[1]).toEqual({
      text: 'bindings live on',
      citations: [
        { pageHref: '/read/b/functions/2', label: 'Ch. 1 · p. 2', citedText: 'Bindings live on.', pageIndex: 1 },
      ],
    })
    expect(mapper.stop).toBe('end_turn')
  })

  it('turns the blocks into one cards event, each card with its source', () => {
    const sourceOf = (pageIndex: number | null) => ({
      position: { chapter: 'functions', page: (pageIndex ?? 0) + 1 },
      label: pageIndex === null ? 'reader' : `cited ${pageIndex}`,
    })
    const { event, items } = studyEvent(collected().mapper.blocks, 'cards', 'chapter', sourceOf)
    expect(items).toBe(4)
    if (event.type !== 'cards') throw new Error(event.type)
    expect(event.span).toBe('chapter')
    expect(event.cards[0]?.source.label).toBe('reader')
    expect(event.cards[3]).toMatchObject({
      front: 'Term 4',
      citations: [{ pageHref: '/read/b/functions/2', label: 'Ch. 1 · p. 2', citedText: 'Bindings live on.' }],
      source: { position: { chapter: 'functions', page: 2 }, label: 'cited 1' },
    })
    expect(event.cards[3]?.citations[0]).not.toHaveProperty('pageIndex')
  })

  it('is bad_format when the answer is no quiz', () => {
    const sourceOf = () => ({ position: { chapter: 'functions', page: 1 }, label: 'x' })
    expect(studyEvent(collected().mapper.blocks, 'quiz', 'two', sourceOf)).toEqual({
      event: { type: 'error', code: 'bad_format' },
      items: null,
    })
  })
})

describe('askErrorCode', () => {
  const api = (status: number | undefined, type: Anthropic.ErrorType | null = null, message = 'x') =>
    status === undefined
      ? new Anthropic.APIError(undefined, { type: 'error', error: { type, message } }, undefined, new Headers(), type)
      : Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, message, new Headers())

  it('maps each failure to the code the panel shows', () => {
    expect(askErrorCode(api(401, 'authentication_error'))).toBe('key_rejected')
    expect(askErrorCode(api(403, 'permission_error'))).toBe('key_rejected')
    expect(askErrorCode(api(402, 'billing_error'))).toBe('billing')
    expect(askErrorCode(api(429, 'rate_limit_error'))).toBe('busy')
    expect(askErrorCode(api(529, 'overloaded_error'))).toBe('busy')
    expect(askErrorCode(api(413))).toBe('too_long')
    expect(askErrorCode(api(400, 'invalid_request_error', 'prompt is too long: 1100000 tokens > 1000000'))).toBe(
      'too_long',
    )
    expect(askErrorCode(api(400, 'invalid_request_error', 'messages: field required'))).toBe('failed')
    expect(askErrorCode(api(500, 'api_error'))).toBe('failed')
    expect(askErrorCode(new Error('socket hang up'))).toBe('failed')
  })

  it('maps errors that arrive mid-stream by their type', () => {
    expect(askErrorCode(api(undefined, 'overloaded_error'))).toBe('busy')
    expect(askErrorCode(api(undefined, 'api_error'))).toBe('failed')
  })

  it('says nothing for an abort', () => {
    expect(askErrorCode(new Anthropic.APIUserAbortError())).toBeNull()
  })
})
