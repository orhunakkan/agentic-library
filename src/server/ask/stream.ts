import '@tanstack/react-start/server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { AskErrorCode, AskEvent, CitationLink, StudySource, StudySpan } from '~/shared/ask/events'
import { type BookContext, studyCitation } from './context'
import { type Rng, readStudy, type StudyBlock, type StudyCitation, type StudyKind } from './study-format'

export type { AskErrorCode, AskEvent }

export const encodeEvent = (event: AskEvent) => `${JSON.stringify(event)}\n`

export function eventMapper(context: BookContext, options: { collect?: boolean } = {}) {
  let pending: StudyCitation[] = []
  let inText = false
  let text = ''
  let stop: string | null = null
  const blocks: StudyBlock[] = []
  return {
    map(event: Anthropic.Beta.BetaRawMessageStreamEvent): AskEvent[] {
      switch (event.type) {
        case 'content_block_start':
          inText = event.content_block.type === 'text'
          pending = []
          text = ''
          return []
        case 'content_block_delta': {
          if (!inText) return []
          const delta = event.delta
          if (delta.type === 'text_delta') {
            if (options.collect) {
              text += delta.text
              return []
            }
            return delta.text ? [{ type: 'text', text: delta.text }] : []
          }
          if (delta.type === 'citations_delta' && delta.citation.type === 'content_block_location') {
            const found = studyCitation(context, delta.citation)
            if (found && !pending.some((p) => p.pageHref === found.pageHref && p.citedText === found.citedText))
              pending.push(found)
          }
          return []
        }
        case 'content_block_stop': {
          const cited = pending
          pending = []
          if (options.collect) {
            if (inText) blocks.push({ text, citations: cited })
            inText = false
            return []
          }
          inText = false
          return cited.map((c): AskEvent => ({ type: 'citation', ...linkOf(c) }))
        }
        case 'message_delta':
          stop = event.delta.stop_reason ?? stop
          return []
        default:
          return []
      }
    },
    get stop() {
      return stop
    },
    get blocks(): readonly StudyBlock[] {
      return blocks
    },
  }
}

const linkOf = ({ pageIndex: _, ...rest }: StudyCitation): CitationLink => rest

export function studyEvent(
  blocks: readonly StudyBlock[],
  kind: StudyKind,
  span: StudySpan,
  sourceOf: (pageIndex: number | null) => StudySource,
  rng?: Rng,
): { event: AskEvent; items: number | null } {
  const read = readStudy(blocks, kind, rng)
  if (!read) return { event: { type: 'error', code: 'bad_format' }, items: null }
  const source = (citations: readonly StudyCitation[]) => sourceOf(citations[0]?.pageIndex ?? null)
  if ('questions' in read) {
    const questions = read.questions.map((q) => ({
      ...q,
      citations: q.citations.map(linkOf),
      source: source(q.citations),
    }))
    return { event: { type: 'quiz', span, questions }, items: questions.length }
  }
  const cards = read.cards.map((c) => ({ ...c, citations: c.citations.map(linkOf), source: source(c.citations) }))
  return { event: { type: 'cards', span, cards }, items: cards.length }
}

const isTooLong = (error: InstanceType<typeof Anthropic.APIError>) =>
  /prompt is too long|too many tokens|context window/i.test(error.message)

export function askErrorCode(error: unknown): Exclude<AskErrorCode, 'bad_format'> | null {
  if (error instanceof Anthropic.APIUserAbortError) return null
  if (!(error instanceof Anthropic.APIError)) return 'failed'
  switch (error.status) {
    case 401:
    case 403:
      return 'key_rejected'
    case 402:
      return 'billing'
    case 413:
      return 'too_long'
    case 429:
    case 529:
      return 'busy'
    case 400:
      return isTooLong(error) ? 'too_long' : 'failed'
  }
  if (error.type === 'overloaded_error' || error.type === 'rate_limit_error') return 'busy'
  return 'failed'
}
