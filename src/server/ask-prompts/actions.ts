import '@tanstack/react-start/server-only'
import { type AskPromptsState, MAX_ASK_PROMPTS, type PromptErrorCode } from '~/shared/ask-prompts/prompts'
import { noStoreJson } from '../auth.ts'
import { requirePro } from '../plans/plan.ts'
import { signedInEndpoints, signedInRead } from '../signed-in.ts'
import { isPromptId, type Parsed, parseNewPrompt, parsePromptChange } from './input.ts'
import { createPrompt, deletePrompt, editPrompt, listPrompts, movePrompt } from './store.ts'
import { toPromptView } from './view.ts'

export type { AskPromptsState }

const MAX_BODY_BYTES = 12 * 1024

const prompts = signedInEndpoints<PromptErrorCode>({ maxBytes: MAX_BODY_BYTES })
const { fail } = prompts

function withReason<T extends object>(input: Parsed<T>): T | Response | null {
  if (input && 'reason' in input) return fail(400, 'invalid', { reason: input.reason })
  return input
}

export const handlePromptNew = (request: Request) =>
  prompts.post(
    request,
    {
      log: 'prompt new',
      before: ({ session }) => requirePro(session, 'ask') ?? undefined,
      parse: (value) => withReason(parseNewPrompt(value)),
    },
    async ({ session, db, input }) => {
      const result = await createPrompt(db, session.userId, input)
      if (result === 'quota') return fail(409, 'quota', { max: MAX_ASK_PROMPTS })
      if (result === 'exists') return fail(409, 'exists')
      return noStoreJson(201, { prompt: toPromptView(result) })
    },
  )

export const handlePromptChange = (request: Request, id: string) =>
  prompts.post(
    request,
    {
      log: 'prompt change',
      before: () => (isPromptId(id) ? undefined : fail(404, 'not_found')),
      parse: (value) => withReason(parsePromptChange(value)),
    },
    async ({ session, db, input: change }) => {
      const { userId } = session
      if (change.intent === 'delete') {
        return (await deletePrompt(db, userId, id)) === true
          ? noStoreJson(200, { deleted: true })
          : fail(404, 'not_found')
      }
      const notPro = requirePro(session, 'ask')
      if (notPro) return notPro
      if (change.intent === 'move') {
        const moved = await movePrompt(db, userId, id, change.direction)
        return moved === 'missing' ? fail(404, 'not_found') : noStoreJson(200, { prompts: moved.map(toPromptView) })
      }
      const { intent: _intent, ...input } = change
      const edited = await editPrompt(db, userId, id, input)
      if (edited === 'missing') return fail(404, 'not_found')
      if (edited === 'exists') return fail(409, 'exists')
      return noStoreJson(200, { prompt: toPromptView(edited) })
    },
  )

export const askPromptsState = (request: Request): Promise<AskPromptsState> =>
  signedInRead(request, 'prompts read', async ({ session, db }) => {
    const prompts = await listPrompts(db, session.userId)
    return { state: 'ready', plan: session.plan, prompts: prompts.map(toPromptView) }
  })
