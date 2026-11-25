import { cleanText } from '../import/blocks.ts'
import { isOneOf } from '../lib/json-shape.ts'
import type { Plan } from '../plans/plans.ts'
import { isUuid } from '../uuid.ts'

export const MAX_ASK_PROMPTS = 20
export const PROMPT_NAME_MAX = 60
export const PROMPT_INSTRUCTION_MAX = 2_000

export const APPLIES_TO = ['pages', 'passage'] as const
export type AppliesTo = (typeof APPLIES_TO)[number]

export const isAppliesTo = (value: unknown): value is AppliesTo => isOneOf(value, APPLIES_TO)

export interface AskPromptView {
  id: string
  name: string
  appliesTo: AppliesTo
  instruction: string
}

export interface AskPromptChoice {
  id: string
  name: string
  appliesTo: AppliesTo
}

export type PromptErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'exists' | 'quota' | 'pro' | 'failed'

export type AskPromptsState =
  | { state: 'signed_out' }
  | { state: 'unavailable' }
  | { state: 'ready'; plan: Plan; prompts: AskPromptView[] }

export interface PromptFields {
  name: string
  appliesTo: string
  instruction: string
}

export type PromptReason =
  | 'name_empty'
  | 'name_too_long'
  | 'instruction_empty'
  | 'instruction_too_long'
  | 'reserved'
  | 'applies_to'

export type PromptCheck =
  | { ok: true; prompt: { name: string; appliesTo: AppliesTo; instruction: string } }
  | { ok: false; reason: PromptReason }

const length = (text: string) => [...text].length

export const isPromptId = (value: unknown): value is string => typeof value === 'string' && isUuid(value)

export const cleanPromptName = (raw: string): string => cleanText(raw.toWellFormed()).replace(/\s+/gu, ' ').trim()

export const cleanPromptInstruction = (raw: string): string => cleanText(raw.toWellFormed(), true).trim()

const RESERVED = /<\/?reader-prompt/i

export function checkPrompt(fields: PromptFields): PromptCheck {
  const name = cleanPromptName(fields.name)
  const instruction = cleanPromptInstruction(fields.instruction)
  if (!name) return { ok: false, reason: 'name_empty' }
  if (length(name) > PROMPT_NAME_MAX) return { ok: false, reason: 'name_too_long' }
  if (!instruction) return { ok: false, reason: 'instruction_empty' }
  if (length(instruction) > PROMPT_INSTRUCTION_MAX) return { ok: false, reason: 'instruction_too_long' }
  if (RESERVED.test(name) || RESERVED.test(instruction)) return { ok: false, reason: 'reserved' }
  if (!isAppliesTo(fields.appliesTo)) return { ok: false, reason: 'applies_to' }
  return { ok: true, prompt: { name, appliesTo: fields.appliesTo, instruction } }
}

export const instructionLength = (raw: string): number => length(cleanPromptInstruction(raw))
