import { uploadCover } from '~/client/features/book-details/details-client'
import type { ChangeResult } from '~/client/features/highlights/highlights-client'
import type { PrivateBookSteps } from './private-book-save'

export type ImportProblem =
  | 'signed-out'
  | 'not-found'
  | 'invalid'
  | 'too-long'
  | 'empty'
  | 'request-too-large'
  | 'book-too-large'
  | 'quota'
  | 'quota-free'
  | 'quota-user'
  | 'rate'
  | 'incomplete'
  | 'failed'

const IMPORT_PROBLEMS: readonly ImportProblem[] = [
  'signed-out',
  'not-found',
  'invalid',
  'too-long',
  'empty',
  'request-too-large',
  'book-too-large',
  'quota',
  'rate',
  'incomplete',
]

export type PictureProblem = 'not-found' | 'quota-book' | 'quota-user' | 'too-large' | 'type' | 'invalid' | 'failed'

type Answer = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; data: Record<string, unknown> }

async function post(url: string, body: BodyInit, type: string): Promise<Answer | null> {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', headers: { 'content-type': type }, body })
  } catch {
    return null
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return response.ok ? { ok: true, data } : { ok: false, status: response.status, data }
}

const failed = { ok: false, problem: 'failed' } as const

function importProblem(data: Record<string, unknown>): ImportProblem {
  if (data.error === 'quota' && data.scope === 'user') return 'quota-user'
  if (data.error === 'quota' && data.plan === 'free') return 'quota-free'
  return IMPORT_PROBLEMS.find((p) => p === data.error) ?? 'failed'
}

async function send<T>(
  url: string,
  body: string,
  pick: (data: Record<string, unknown>) => T | undefined,
): Promise<ChangeResult<T, ImportProblem>> {
  const answer = await post(url, body, 'application/json')
  if (!answer) return failed
  if (!answer.ok) return { ok: false, problem: importProblem(answer.data) }
  const value = pick(answer.data)
  return value === undefined ? failed : { ok: true, value }
}

export interface BookStart {
  title: string
  author: string
  language: string
  chapterCount: number
  description: string | null
  isbn: string | null
  publisher: string | null
  publishedYear: number | null
  images: { count: number; bytes: number }
}

export function startBook(
  book: BookStart,
): Promise<ChangeResult<{ id: string; imageBytesLeft: number }, ImportProblem>> {
  return send('/account/books/new', JSON.stringify(book), (data) =>
    typeof data.id === 'string'
      ? { id: data.id, imageBytesLeft: typeof data.imageBytesLeft === 'number' ? data.imageBytesLeft : 0 }
      : undefined,
  )
}

const done = (data: Record<string, unknown>) => (data.ok === true ? true : undefined)

export function uploadChapter(id: string, position: number, body: string): Promise<ChangeResult<true, ImportProblem>> {
  return send(`/account/books/${encodeURIComponent(id)}/chapters/${position}`, body, done)
}

export function finishBook(id: string): Promise<ChangeResult<true, ImportProblem>> {
  return send(`/account/books/${encodeURIComponent(id)}/finish`, '{}', done)
}

export async function uploadPicture(
  id: string,
  n: number,
  blob: Blob,
): Promise<ChangeResult<{ width: number; height: number }, PictureProblem>> {
  const answer = await post(`/account/books/${encodeURIComponent(id)}/images/${n}`, blob, blob.type || 'image/png')
  if (!answer) return failed
  if (answer.ok) {
    const { width, height } = answer.data
    return typeof width === 'number' && typeof height === 'number' ? { ok: true, value: { width, height } } : failed
  }
  const { status, data } = answer
  if (status === 409 && data.error === 'quota')
    return { ok: false, problem: data.scope === 'user' ? 'quota-user' : 'quota-book' }
  if (status === 413) return { ok: false, problem: 'too-large' }
  if (status === 415) return { ok: false, problem: 'type' }
  if (status === 400) return { ok: false, problem: 'invalid' }
  if (status === 404) return { ok: false, problem: 'not-found' }
  return failed
}

export function discardUpload(id: string): void {
  void fetch('/account/books', {
    method: 'POST',
    body: new URLSearchParams({ intent: 'delete', id }),
    redirect: 'manual',
  }).catch(() => {})
}

export const BOOK_STEPS: PrivateBookSteps<{ ok: false; problem: ImportProblem }> = {
  start: startBook,
  uploadCover,
  uploadPicture,
  uploadChapter,
  finish: finishBook,
  discard: discardUpload,
}
