import '@tanstack/react-start/server-only'
import type { AskPromptChoice } from '~/shared/ask-prompts/prompts'
import type { AiModelId } from '~/shared/lib/ai-models'
import { canUse } from '~/shared/plans/plans'
import { hasKey } from '../api-keys.ts'
import { listPrompts } from '../ask-prompts/store.ts'
import { toPromptChoice } from '../ask-prompts/view.ts'
import { sessionForRequest } from '../auth.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { logError } from '../redact.ts'
import { getAiModel } from '../users.ts'

export type AskSetup =
  | { signedIn: false }
  | { signedIn: true; pro: boolean; hasKey: boolean; model: AiModelId; prompts: AskPromptChoice[] }

export async function askSetup(request: Request): Promise<AskSetup> {
  if (!isDatabaseConfigured()) return { signedIn: false }
  try {
    const session = await sessionForRequest(request)
    if (!session) return { signedIn: false }
    const pro = canUse(session.plan, 'ask')
    const db = getDb()
    const [anthropicKey, model, prompts] = await Promise.all([
      hasKey(db, session.userId, 'anthropic'),
      getAiModel(db, session.userId),
      pro ? listPrompts(db, session.userId) : [],
    ])
    return { signedIn: true, pro, hasKey: anthropicKey, model, prompts: prompts.map(toPromptChoice) }
  } catch (error) {
    logError('ask setup', error)
    return { signedIn: false }
  }
}
