import { type ChangeResult, post, readAnswer } from '~/client/lib/post'
import type { BookmarkView } from '~/shared/bookmarks/bookmarks'
import type { PagePosition } from '~/shared/content/position'

export type BookmarkProblem = 'quota-book' | 'quota-user' | 'signed_out' | 'not_found' | 'failed'

export type BookmarkResult<T> = ChangeResult<T, BookmarkProblem>

export async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>, status: number) => T | undefined,
): Promise<BookmarkResult<T>> {
  try {
    const response = await post(path, body)
    const result = await readAnswer(response, (b) => pick(b, response.status))
    if (result.ok) return result
    return { ok: false, problem: result.problem === 'stale' ? 'failed' : result.problem }
  } catch {
    return { ok: false, problem: 'failed' }
  }
}

export function createdOf<T>(body: Record<string, unknown>, status: number) {
  return body.bookmark && typeof body.bookmark === 'object'
    ? { bookmark: body.bookmark as T, created: status === 201 }
    : undefined
}

export const deletedOf = (body: Record<string, unknown>) => (body.ok === true ? true : undefined)

export function createBookmark(request: {
  book: string
  position: PagePosition
}): Promise<BookmarkResult<{ bookmark: BookmarkView; created: boolean }>> {
  return send('/account/bookmarks/new', request, createdOf<BookmarkView>)
}

export function deleteBookmark(id: string): Promise<BookmarkResult<true>> {
  return send(`/account/bookmarks/${encodeURIComponent(id)}`, { intent: 'delete' }, deletedOf)
}
