import { useState, useSyncExternalStore } from 'react'
import type { AskPromptView } from '~/shared/ask-prompts/prompts'
import * as requests from './ask-prompts-client'
import { PromptStore } from './prompt-store'

export function useAskPrompts(initial: readonly AskPromptView[]) {
  const [store] = useState(() => new PromptStore(requests, initial))
  const prompts = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { prompts, create: store.create, edit: store.edit, move: store.move, remove: store.remove }
}
