import type { AudioChapter } from '~/shared/audiobooks/chapters'
import type { AudioFileType } from '~/shared/audiobooks/limits'
import type { BookDetails } from '~/shared/import/details'
import { type AudiobookProblem, problem } from './audiobook-problems'

export type Result<T> = { ok: true; value: T } | { ok: false; problem: AudiobookProblem }

export interface AudiobookStart {
  title: string
  author: string
  narrator: string | null
  language: string
  details: BookDetails
  files: { type: AudioFileType; bytes: number }[]
  chapters: AudioChapter[]
  cover: boolean
}

type Body = Record<string, unknown>

async function send(url: string, init: RequestInit): Promise<{ status: number; body: Body } | null> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return null
  }
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Body }
}

export function problemOf(status: number, body: Body): AudiobookProblem {
  if (body.error === 'quota') {
    if (body.scope === 'server') return problem('server-full')
    if (body.scope === 'audio') return problem('room')
    if (body.scope === 'rate') return problem('rate')
    return problem(body.plan === 'free' ? 'books-free' : 'books')
  }
  if (status === 403 && body.error === 'pro') return problem('pro')
  if (body.error === 'drm') return problem('drm')
  if (body.error === 'unreadable')
    return { code: 'server-unreadable', reason: typeof body.reason === 'string' ? body.reason : 'it couldn’t be read' }
  if (body.error === 'signed_out') return problem('signed-out')
  if (status === 404 || body.error === 'incomplete') return problem('interrupted')
  if (status === 400) return problem('invalid')
  return problem('failed')
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export async function startAudiobook(start: AudiobookStart): Promise<Result<{ id: string }>> {
  const answer = await send('/account/books/new-audiobook', json(start))
  if (!answer) return { ok: false, problem: problem('failed') }
  if (answer.status === 201 && typeof answer.body.id === 'string') return { ok: true, value: { id: answer.body.id } }
  return { ok: false, problem: problemOf(answer.status, answer.body) }
}

export type ChunkAnswer =
  | { ok: true; received: number }
  | { ok: false; offset: number }
  | { ok: false; problem: AudiobookProblem; retry: boolean }

export async function sendChunk(
  id: string,
  n: number,
  offset: number,
  bytes: Blob,
  signal?: AbortSignal,
): Promise<ChunkAnswer> {
  const answer = await send(`/account/books/${encodeURIComponent(id)}/audio/${n}?offset=${offset}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
    signal,
  })
  if (!answer || answer.status >= 500) return { ok: false, problem: problem('stopped'), retry: true }
  const { received } = answer.body
  if (answer.status === 200 && typeof received === 'number') return { ok: true, received }
  if (answer.status === 409 && answer.body.error === 'offset' && typeof received === 'number')
    return { ok: false, offset: received }
  return { ok: false, problem: problemOf(answer.status, answer.body), retry: false }
}

export async function finishAudiobook(id: string): Promise<Result<true>> {
  const answer = await send(`/account/books/${encodeURIComponent(id)}/audio/finish`, json({}))
  if (!answer) return { ok: false, problem: problem('failed') }
  if (answer.status === 200 && answer.body.ok === true) return { ok: true, value: true }
  return { ok: false, problem: problemOf(answer.status, answer.body) }
}
