import { type ChangeResult, post } from '~/client/features/highlights/highlights-client'
import type { BookStart } from '~/client/features/import/import-client'
import type { ArticleFetch, ArticleUrlProblem, WebFetchProblem } from '~/shared/articles/contract'
import { isPlan, type Plan } from '~/shared/plans/plans'
import type { ArticleProblem } from './article-messages'

export interface ArticleFailure {
  problem: ArticleProblem
  existingId?: string
  retryAt?: string | null
  plan?: Plan
  max?: number
}

export type ArticleResult<T> = ChangeResult<T, ArticleProblem> & { failure?: ArticleFailure }

const URL_PROBLEMS: readonly ArticleUrlProblem[] = [
  'empty',
  'too_long',
  'not_url',
  'scheme',
  'port',
  'credentials',
  'private_host',
  'own_site',
]
const FETCH_PROBLEMS: readonly WebFetchProblem[] = [
  'blocked',
  'page_not_found',
  'refused',
  'not_html',
  'too_large',
  'too_many_redirects',
  'unavailable',
]
const CODES: readonly ArticleProblem[] = [
  ...FETCH_PROBLEMS,
  'exists',
  'expired',
  'limited',
  'busy',
  'quota',
  'signed_out',
]

const failed = (failure: ArticleFailure): ArticleResult<never> => ({ ok: false, problem: failure.problem, failure })

export async function readArticleAnswer<T>(
  response: Response,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<ArticleResult<T>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    const value = pick(body)
    return value === undefined ? failed({ problem: 'failed' }) : { ok: true, value }
  }
  const { error, reason } = body
  if (error === 'invalid' && typeof reason === 'string')
    return failed({ problem: URL_PROBLEMS.find((p) => p === reason) ?? 'failed' })
  const problem = error === 'signed-out' ? 'signed_out' : (CODES.find((c) => c === error) ?? 'failed')
  if (problem === 'exists' && typeof body.id === 'string') return failed({ problem, existingId: body.id })
  if (problem === 'limited') return failed({ problem, retryAt: typeof body.retryAt === 'string' ? body.retryAt : null })
  if (problem === 'quota' && body.scope !== 'articles') return failed({ problem: 'failed' })
  if (problem === 'quota')
    return failed({
      problem,
      plan: isPlan(body.plan) ? body.plan : undefined,
      max: typeof body.max === 'number' ? body.max : undefined,
    })
  return failed({ problem })
}

async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<ArticleResult<T>> {
  let response: Response
  try {
    response = await post(path, body)
  } catch {
    return failed({ problem: 'failed' })
  }
  return readArticleAnswer(response, pick)
}

export function fetchArticle(url: string): Promise<ArticleResult<ArticleFetch>> {
  return send('/account/articles/fetch', { url }, (b) =>
    typeof b.fetch === 'string' && typeof b.finalUrl === 'string' && typeof b.html === 'string'
      ? { fetch: b.fetch, finalUrl: b.finalUrl, html: b.html }
      : undefined,
  )
}

export async function fetchArticlePicture(fetchId: string, url: string): Promise<Uint8Array | null> {
  try {
    const response = await post('/account/articles/picture', { fetch: fetchId, url })
    if (!response.ok) return null
    return new Uint8Array(await response.arrayBuffer())
  } catch {
    return null
  }
}

export function startArticle(
  book: BookStart & { article: string },
): Promise<ArticleResult<{ id: string; imageBytesLeft: number }>> {
  return send('/account/books/new', book, (b) =>
    typeof b.id === 'string'
      ? { id: b.id, imageBytesLeft: typeof b.imageBytesLeft === 'number' ? b.imageBytesLeft : 0 }
      : undefined,
  )
}
