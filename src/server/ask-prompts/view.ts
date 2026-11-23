import '@tanstack/react-start/server-only'
import type { AskPromptChoice, AskPromptView } from '~/shared/ask-prompts/prompts'
import type { PromptRow } from './store.ts'

export const toPromptView = (row: PromptRow): AskPromptView => ({
  id: row.id,
  name: row.name,
  appliesTo: row.appliesTo,
  instruction: row.instruction,
})

export const toPromptChoice = (row: PromptRow): AskPromptChoice => ({
  id: row.id,
  name: row.name,
  appliesTo: row.appliesTo,
})
