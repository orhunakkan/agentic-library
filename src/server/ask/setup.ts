import '@tanstack/react-start/server-only'
import type { AskPromptChoice } from '~/shared/ask-prompts/prompts'
import { type AiModelId, type AiProvider, providerOf } from '~/shared/lib/ai-models'
import { getKeyStatuses } from '../api-keys.ts'
import { listPrompts } from '../ask-prompts/store.ts'
import { toPromptChoice } from '../ask-prompts/view.ts'
import { sessionForRequest } from '../auth.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { logError } from '../redact.ts'
import { getAiModel } from '../users.ts'

export type AskSetup =
  | { signedIn: false }
  | {
      signedIn: true
      /** Whether a key is saved for the chosen model's provider: the key Ask and Translate will use. */
      hasKey: boolean
      keys: Record<AiProvider, boolean>
      model: AiModelId
      provider: AiProvider
      prompts: AskPromptChoice[]
    }

export async function askSetup(request: Request): Promise<AskSetup> {
  if (!isDatabaseConfigured()) return { signedIn: false }
  try {
    const session = await sessionForRequest(request)
    if (!session) return { signedIn: false }
    const db = getDb()
    const [saved, model, prompts] = await Promise.all([
      getKeyStatuses(db, session.userId),
      getAiModel(db, session.userId),
      listPrompts(db, session.userId),
    ])
    const keys = {
      anthropic: saved.some((k) => k.provider === 'anthropic'),
      openai: saved.some((k) => k.provider === 'openai'),
    }
    const provider = providerOf(model)
    return {
      signedIn: true,
      hasKey: keys[provider],
      keys,
      model,
      provider,
      prompts: prompts.map(toPromptChoice),
    }
  } catch (error) {
    logError('ask setup', error)
    return { signedIn: false }
  }
}
