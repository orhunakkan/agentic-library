import '@tanstack/react-start/server-only'
import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'
import type { AskEvent } from '~/shared/ask/events'
import { OpenAiResponseError } from '../openai.ts'

type StreamEvent = OpenAI.Responses.ResponseStreamEvent
type ResponseBody = OpenAI.Responses.Response

/** The stop reasons Claude's stream gives, so `done` reads the same whichever provider answered. */
function stopOf(response: ResponseBody, refused: boolean): string {
  if (refused) return 'refusal'
  if (response.status !== 'incomplete') return 'end_turn'
  const reason = response.incomplete_details?.reason
  if (reason === 'max_output_tokens') return 'max_tokens'
  if (reason === 'content_filter') return 'refusal'
  return 'end_turn'
}

/**
 * Maps a Responses API stream to Ask's events: text as it arrives, and nothing for citations, which OpenAI doesn't
 * give. The stream's end is read from its last event; a failed response throws, to be reported as an error.
 */
export function openAiEventMapper() {
  let response: ResponseBody | null = null
  let refused = false
  return {
    map(event: StreamEvent): AskEvent[] {
      switch (event.type) {
        case 'response.created':
        case 'response.in_progress':
        case 'response.completed':
        case 'response.incomplete':
          response = event.response
          return []
        case 'response.output_text.delta':
          return event.delta ? [{ type: 'text', text: event.delta }] : []
        case 'response.refusal.delta':
          refused = true
          return []
        case 'response.failed':
          response = event.response
          throw new OpenAiResponseError(event.response.error?.code ?? null)
        default:
          return []
      }
    },
    /** Why the answer stopped, in Claude's words, once the stream has ended; null when it ended without saying. */
    stop(): string | null {
      if (!response || (response.status !== 'completed' && response.status !== 'incomplete')) return null
      return stopOf(response, refused)
    },
    get response(): ResponseBody | null {
      return response
    },
  }
}

export interface OpenAiUsage {
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/** OpenAI counts cached tokens inside input_tokens; Claude counts them apart, as the usage records do. */
export function openAiUsage(usage: OpenAI.Responses.ResponseUsage | null | undefined): OpenAiUsage {
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0
  return {
    inputTokens: Math.max(0, (usage?.input_tokens ?? 0) - cached),
    cacheReadTokens: cached,
    cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  }
}

const attribute = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function partText(part: Anthropic.Beta.BetaContentBlockParam): string {
  if (part.type === 'text') return part.text
  if (part.type === 'document' && part.source.type === 'content' && Array.isArray(part.source.content)) {
    const text = part.source.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n\n')
    return `<document title="${attribute(part.title ?? '')}">\n${text}\n</document>`
  }
  return ''
}

/**
 * The same messages Claude is sent, as Responses API input: each document becomes a <document> of its pages' text,
 * since OpenAI has no cited documents. Nothing is added or dropped, so both models see the same book and question.
 */
export function openAiInput(messages: readonly Anthropic.Beta.BetaMessageParam[]): OpenAI.Responses.ResponseInput {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : (m.content ?? []).map(partText).join('\n\n'),
  }))
}
