import { type ChangeResult, post } from '~/client/lib/post'
import type { AskPromptView, PromptFields } from '~/shared/ask-prompts/prompts'
import type { PromptProblem } from './prompt-messages'

export type PromptResult<T> = ChangeResult<T, PromptProblem>

const REASONS: readonly PromptProblem[] = [
  'name_empty',
  'name_too_long',
  'instruction_empty',
  'instruction_too_long',
  'reserved',
]
const CODES: readonly PromptProblem[] = ['exists', 'quota', 'not_found', 'signed_out']

const fail = (problem: PromptProblem): PromptResult<never> => ({ ok: false, problem })

export async function readPromptAnswer<T>(
  response: Response,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<PromptResult<T>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    const value = pick(body)
    return value === undefined ? fail('failed') : { ok: true, value }
  }
  if (body.error === 'invalid') return fail(REASONS.find((r) => r === body.reason) ?? 'failed')
  return fail(CODES.find((c) => c === body.error) ?? 'failed')
}

async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<PromptResult<T>> {
  try {
    return await readPromptAnswer(await post(path, body), pick)
  } catch {
    return fail('failed')
  }
}

const promptOf = (body: Record<string, unknown>) =>
  body.prompt && typeof body.prompt === 'object' ? (body.prompt as AskPromptView) : undefined

const promptPath = (id: string) => `/account/prompts/${encodeURIComponent(id)}`

export function createPrompt(fields: PromptFields): Promise<PromptResult<AskPromptView>> {
  return send('/account/prompts/new', fields, promptOf)
}

export function editPrompt(id: string, fields: PromptFields): Promise<PromptResult<AskPromptView>> {
  return send(promptPath(id), { intent: 'edit', ...fields }, promptOf)
}

export function movePrompt(id: string, direction: 'up' | 'down'): Promise<PromptResult<AskPromptView[]>> {
  return send(promptPath(id), { intent: 'move', direction }, (b) =>
    Array.isArray(b.prompts) ? (b.prompts as AskPromptView[]) : undefined,
  )
}

export function deletePrompt(id: string): Promise<PromptResult<true>> {
  return send(promptPath(id), { intent: 'delete' }, (b) => (b.deleted === true ? true : undefined))
}
