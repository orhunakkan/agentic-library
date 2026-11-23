import type { AskPromptView, PromptFields } from '~/shared/ask-prompts/prompts'
import type { PromptResult } from './ask-prompts-client'

export interface PromptRequests {
  createPrompt(fields: PromptFields): Promise<PromptResult<AskPromptView>>
  editPrompt(id: string, fields: PromptFields): Promise<PromptResult<AskPromptView>>
  movePrompt(id: string, direction: 'up' | 'down'): Promise<PromptResult<AskPromptView[]>>
  deletePrompt(id: string): Promise<PromptResult<true>>
}

export function moved(list: readonly AskPromptView[], id: string, direction: 'up' | 'down'): readonly AskPromptView[] {
  const at = list.findIndex((p) => p.id === id)
  const to = direction === 'up' ? at - 1 : at + 1
  const moving = list[at]
  if (!moving || to < 0 || to >= list.length) return list
  const next = list.filter((p) => p.id !== id)
  next.splice(to, 0, moving)
  return next
}

export class PromptStore {
  private prompts: readonly AskPromptView[]
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly requests: PromptRequests,
    initial: readonly AskPromptView[],
  ) {
    this.prompts = initial
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): readonly AskPromptView[] => this.prompts

  private set(next: readonly AskPromptView[]) {
    this.prompts = next
    for (const listener of this.listeners) listener()
  }

  private forget(id: string) {
    this.set(this.prompts.filter((p) => p.id !== id))
  }

  create = async (fields: PromptFields): Promise<PromptResult<AskPromptView>> => {
    const result = await this.requests.createPrompt(fields)
    if (result.ok) this.set([...this.prompts, result.value])
    return result
  }

  edit = async (id: string, fields: PromptFields): Promise<PromptResult<AskPromptView>> => {
    const result = await this.requests.editPrompt(id, fields)
    if (result.ok) this.set(this.prompts.map((p) => (p.id === id ? result.value : p)))
    else if (result.problem === 'not_found') this.forget(id)
    return result
  }

  move = async (id: string, direction: 'up' | 'down'): Promise<PromptResult<AskPromptView[]>> => {
    const before = this.prompts
    this.set(moved(before, id, direction))
    const result = await this.requests.movePrompt(id, direction)
    if (result.ok) this.set(result.value)
    else this.set(result.problem === 'not_found' ? before.filter((p) => p.id !== id) : before)
    return result
  }

  remove = async (id: string): Promise<PromptResult<true>> => {
    const before = this.prompts
    this.forget(id)
    const result = await this.requests.deletePrompt(id)
    if (!result.ok && result.problem !== 'not_found') this.set(before)
    return result
  }
}
