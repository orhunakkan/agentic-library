import { uploadCover } from '~/client/features/book-details/details-client'
import { postBody } from '~/client/lib/post'
import type { PrivateBookSteps } from './private-book-save'

export type ImportProblem =
  | 'signed-out'
  | 'not-found'
  | 'invalid'
  | 'too-long'
  | 'empty'
  | 'request-too-large'
  | 'book-too-large'
  | 'article-too-large'
  | 'quota'
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
  'article-too-large',
  'quota',
  'rate',
  'incomplete',
]

export type PictureProblem = 'not-found' | 'quota-book' | 'quota-user' | 'too-large' | 'type' | 'invalid' | 'failed'

/** A refused step, with the limit it was refused at when the answer names one, so its message can name it too. */
export type Refusal<P extends string> = { ok: false; problem: P; max?: number }

/** What an import step came to: its value, or its refusal. */
export type ImportResult<T, P extends string = ImportProblem> = { ok: true; value: T } | Refusal<P>

const failed = { ok: false, problem: 'failed' } as const

const refused = <P extends string>(problem: P, data: Record<string, unknown>): Refusal<P> =>
  typeof data.max === 'number' ? { ok: false, problem, max: data.max } : { ok: false, problem }

function importProblem(data: Record<string, unknown>): ImportProblem {
  if (data.error === 'quota' && data.scope === 'user') return 'quota-user'
  return IMPORT_PROBLEMS.find((p) => p === data.error) ?? 'failed'
}

async function send<T>(
  url: string,
  body: string,
  pick: (data: Record<string, unknown>) => T | undefined,
): Promise<ImportResult<T>> {
  const answer = await postBody(url, body, 'application/json')
  if (!answer) return failed
  if (!answer.ok) return refused(importProblem(answer.data), answer.data)
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

/** The new book's id and the picture room left, from the answer to `/account/books/new`. */
export const startedOf = (data: Record<string, unknown>) =>
  typeof data.id === 'string'
    ? { id: data.id, imageBytesLeft: typeof data.imageBytesLeft === 'number' ? data.imageBytesLeft : 0 }
    : undefined

export function startBook(book: BookStart): Promise<ImportResult<{ id: string; imageBytesLeft: number }>> {
  return send('/account/books/new', JSON.stringify(book), startedOf)
}

const done = (data: Record<string, unknown>) => (data.ok === true ? true : undefined)

export function uploadChapter(id: string, position: number, body: string): Promise<ImportResult<true>> {
  return send(`/account/books/${encodeURIComponent(id)}/chapters/${position}`, body, done)
}

export function finishBook(id: string): Promise<ImportResult<true>> {
  return send(`/account/books/${encodeURIComponent(id)}/finish`, '{}', done)
}

export async function uploadPicture(
  id: string,
  n: number,
  blob: Blob,
): Promise<ImportResult<{ width: number; height: number }, PictureProblem>> {
  const answer = await postBody(`/account/books/${encodeURIComponent(id)}/images/${n}`, blob, blob.type || 'image/png')
  if (!answer) return failed
  if (answer.ok) {
    const { width, height } = answer.data
    return typeof width === 'number' && typeof height === 'number' ? { ok: true, value: { width, height } } : failed
  }
  const { status, data } = answer
  if (status === 409 && data.error === 'quota')
    return data.scope === 'user' ? refused('quota-user', data) : { ok: false, problem: 'quota-book' }
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

export const BOOK_STEPS: PrivateBookSteps<Refusal<ImportProblem>> = {
  start: startBook,
  uploadCover,
  uploadPicture,
  uploadChapter,
  finish: finishBook,
  discard: discardUpload,
}
