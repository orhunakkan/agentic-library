import { type AnswerProblem, type ChangeResult, post, readAnswer } from '~/client/lib/post'
import type { PagePosition } from '~/shared/content/position'
import type { HighlightColor } from '~/shared/highlights/colors'
import type { HighlightView } from '~/shared/highlights/group'

export type HighlightProblem = AnswerProblem

export interface NewHighlightRequest {
  book: string
  position: PagePosition
  start: number
  end: number
  text: string
  color: HighlightColor
  note?: string | null
}

const highlightOf = (body: Record<string, unknown>) =>
  body.highlight && typeof body.highlight === 'object' ? (body.highlight as HighlightView) : undefined

async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<ChangeResult<T, HighlightProblem>> {
  try {
    return await readAnswer(await post(path, body), pick)
  } catch {
    return { ok: false, problem: 'failed' }
  }
}

export function createHighlight(request: NewHighlightRequest): Promise<ChangeResult<HighlightView, HighlightProblem>> {
  return send('/account/highlights/new', request, highlightOf)
}

export function updateHighlight(
  id: string,
  change: { color?: HighlightColor; note?: string | null },
): Promise<ChangeResult<HighlightView, HighlightProblem>> {
  return send(`/account/highlights/${encodeURIComponent(id)}`, { intent: 'update', ...change }, highlightOf)
}

export function deleteHighlight(id: string): Promise<ChangeResult<true, HighlightProblem>> {
  return send(`/account/highlights/${encodeURIComponent(id)}`, { intent: 'delete' }, (b) =>
    b.ok === true ? true : undefined,
  )
}
