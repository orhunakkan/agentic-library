import type { CoverSource } from '~/shared/content/private-book'

export type Result<T, P extends string> = { ok: true; value: T } | { ok: false; problem: P }

export type CommonProblem = 'not_found' | 'signed_out' | 'unavailable'
export type UploadProblem = CommonProblem | 'unreadable' | 'small'
export type LookupProblem = CommonProblem | 'rate' | 'busy' | 'invalid'

export interface UploadedCover {
  src: string
  width: number
  height: number
  source: CoverSource
}

export interface LookupMatch {
  work: string
  title: string
  author: string | null
  year: number | null
  coverId: number | null
  thumb: string | null
}

export interface Applied {
  changed: { description: boolean; cover: boolean; isbn: boolean; year: boolean }
  cover: UploadedCover | null
  coverProblem?: 'cover-too-large' | 'cover-failed'
}

const COMMON: Record<string, CommonProblem> = { not_found: 'not_found', signed_out: 'signed_out' }

async function post(
  url: string,
  init: { body: BodyInit; type: string },
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; data: Record<string, unknown> } | null> {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', headers: { 'content-type': init.type }, body: init.body })
  } catch {
    return null
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return response.ok ? { ok: true, data } : { ok: false, status: response.status, data }
}

const errorOf = (data: Record<string, unknown>) => (typeof data.error === 'string' ? data.error : '')

export async function uploadCover(
  id: string,
  blob: Blob,
  source: 'epub' | 'zip' | 'pdf' | 'audio' | 'upload',
): Promise<Result<UploadedCover, UploadProblem>> {
  const answer = await post(`/account/books/${encodeURIComponent(id)}/cover?source=${source}`, {
    body: blob,
    type: blob.type || 'image/jpeg',
  })
  if (!answer) return { ok: false, problem: 'unavailable' }
  if (answer.ok) return { ok: true, value: (answer.data as { cover: UploadedCover }).cover }
  const error = errorOf(answer.data)
  if (error === 'image') return { ok: false, problem: answer.data.problem === 'small' ? 'small' : 'unreadable' }
  return { ok: false, problem: COMMON[error] ?? 'unavailable' }
}

const LOOKUP_PROBLEMS: Record<string, LookupProblem> = {
  ...COMMON,
  rate: 'rate',
  busy: 'busy',
  invalid: 'invalid',
  unavailable: 'unavailable',
}

export async function lookup(query: {
  book: string
  title: string
  author: string
  isbn: string
}): Promise<Result<LookupMatch[], LookupProblem>> {
  const answer = await post('/account/books/lookup', { body: JSON.stringify(query), type: 'application/json' })
  if (!answer) return { ok: false, problem: 'unavailable' }
  if (answer.ok) return { ok: true, value: (answer.data as { matches: LookupMatch[] }).matches }
  return { ok: false, problem: LOOKUP_PROBLEMS[errorOf(answer.data)] ?? 'unavailable' }
}

export async function applyMatch(
  id: string,
  body: { work: string; coverId: number | null; useCover: boolean; useDescription: boolean },
): Promise<Result<Applied, LookupProblem>> {
  const answer = await post(`/account/books/${encodeURIComponent(id)}/open-library`, {
    body: JSON.stringify(body),
    type: 'application/json',
  })
  if (!answer) return { ok: false, problem: 'unavailable' }
  if (answer.ok) return { ok: true, value: answer.data as Applied }
  return { ok: false, problem: LOOKUP_PROBLEMS[errorOf(answer.data)] ?? 'unavailable' }
}
