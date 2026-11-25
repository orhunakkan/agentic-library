import type { AskEvent } from '~/shared/ask/events'
import type { PagePosition } from '~/shared/content/position'
import { isObject } from '~/shared/lib/json-shape'
import { plainAnswer } from './answer-format'
import type { ThreadTurn } from './thread-store'

export const QUESTION_MAX = 2_000
export const QUOTE_MAX = 1_000
const HISTORY_TURNS = 10
const HISTORY_CHARS = 16_000

export type AskAction = 'explain' | 'summary' | 'recap' | 'define' | 'quiz' | 'flashcards'

export const isStudyAction = (action: AskAction | null | undefined): action is 'quiz' | 'flashcards' =>
  action === 'quiz' || action === 'flashcards'

export type AskProblem =
  | 'signed_out'
  | 'pro'
  | 'no_key'
  | 'not_found'
  | 'no_prompt'
  | 'invalid'
  | 'too_little'
  | 'limit'
  | 'too_long'
  | 'key_rejected'
  | 'billing'
  | 'busy'
  | 'bad_format'
  | 'refusal'
  | 'needs_claude'
  | 'failed'

const length = (text: string) => [...text].length

export function historyFor(turns: readonly ThreadTurn[]): { role: 'user' | 'assistant'; text: string }[] {
  const plain = turns
    .map((t) => ({ role: t.role, text: plainAnswer(t.text).trim() }))
    .filter((t) => t.text)
    .slice(-HISTORY_TURNS)
  let total = plain.reduce((n, t) => n + length(t.text), 0)
  while (plain.length > 1 && total > HISTORY_CHARS) total -= length(plain.shift()?.text ?? '')
  const only = plain[0]
  if (plain.length === 1 && only && total > HISTORY_CHARS) only.text = [...only.text].slice(-HISTORY_CHARS).join('')
  return plain
}

export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const parse = (line: string): AskEvent | null => {
    try {
      const value: unknown = JSON.parse(line)
      return isObject(value) && typeof value.type === 'string' ? (value as AskEvent) : null
    } catch {
      return null
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        const event = line.trim() ? parse(line) : null
        if (event) yield event
      }
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}

export interface AskRequest {
  position: PagePosition
  wholeBook: boolean
  question: string
  quote: string | null
  history: { role: 'user' | 'assistant'; text: string }[]
  highlights?: true
  action?: AskAction
  prompt?: string
  spoken?: true
}

export type AskResult =
  | { ok: true; events: AsyncGenerator<AskEvent> }
  | { ok: false; problem: AskProblem; retryAt?: string }

const KNOWN: readonly AskProblem[] = [
  'signed_out',
  'pro',
  'no_key',
  'not_found',
  'no_prompt',
  'invalid',
  'too_little',
  'limit',
  'too_long',
  'needs_claude',
  'failed',
]

export async function sendQuestion(bookSlug: string, request: AskRequest, signal: AbortSignal): Promise<AskResult> {
  const response = await fetch(`/read/${encodeURIComponent(bookSlug)}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  if (response.ok && response.body) return { ok: true, events: readEvents(response.body) }
  const body = (await response.json().catch(() => ({}))) as { error?: string; retryAt?: string }
  const problem = KNOWN.find((p) => p === body.error) ?? 'failed'
  return { ok: false, problem, ...(body.retryAt ? { retryAt: body.retryAt } : {}) }
}
