import { checkPrompt, type PromptReason } from '~/shared/ask-prompts/prompts'
import { isObject, only } from '../ask/input.ts'
import type { MoveDirection, PromptInput } from './store.ts'

export { isPromptId } from '~/shared/ask-prompts/prompts'

export type Parsed<T> = T | { reason: PromptReason } | null

function fields(value: Record<string, unknown>, extra: readonly string[]): Parsed<PromptInput> {
  if (!only(value, ['name', 'appliesTo', 'instruction', ...extra])) return null
  const { name, appliesTo, instruction } = value
  if (typeof name !== 'string' || typeof appliesTo !== 'string' || typeof instruction !== 'string') return null
  const checked = checkPrompt({ name, appliesTo, instruction })
  return checked.ok ? checked.prompt : { reason: checked.reason }
}

export function parseNewPrompt(value: unknown): Parsed<PromptInput> {
  return isObject(value) ? fields(value, []) : null
}

export type PromptChange =
  | ({ intent: 'edit' } & PromptInput)
  | { intent: 'move'; direction: MoveDirection }
  | { intent: 'delete' }

export const isDeleteBody = (value: unknown): boolean =>
  isObject(value) && only(value, ['intent']) && value.intent === 'delete'

export function parsePromptChange(value: unknown): Parsed<PromptChange> {
  if (!isObject(value)) return null
  if (isDeleteBody(value)) return { intent: 'delete' }
  if (value.intent === 'move') {
    if (!only(value, ['intent', 'direction'])) return null
    return value.direction === 'up' || value.direction === 'down'
      ? { intent: 'move', direction: value.direction }
      : null
  }
  if (value.intent !== 'edit') return null
  const edit = fields(value, ['intent'])
  if (!edit || 'reason' in edit) return edit
  return { intent: 'edit', ...edit }
}
