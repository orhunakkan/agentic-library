import type { UploadProblem } from '~/client/features/book-details/details-client'
import type { CoverSource } from '~/shared/content/private-book'
import type { DraftChapter } from '~/shared/import/blocks'
import { chapterRequest } from '~/shared/import/draft'
import type { BookStart, ImportProblem, PictureProblem } from './import-client'

export type CoverFrom = Exclude<CoverSource, 'open-library'>

export type CoverRefusal = 'type' | 'small' | 'unavailable'

export function refusalOf(problem: UploadProblem): CoverRefusal {
  if (problem === 'small') return 'small'
  return problem === 'unreadable' ? 'type' : 'unavailable'
}

export interface PrivateBookDraft {
  book: Omit<BookStart, 'chapterCount' | 'images'>
  chapters: readonly DraftChapter[]
  pictures: readonly Blob[]
  cover?: { blob: Blob; from: CoverFrom } | null
}

type Step<P> = Promise<{ ok: true } | { ok: false; problem: P }>

export interface PrivateBookSteps<R extends { ok: false }> {
  start(book: BookStart): Promise<{ ok: true; value: { id: string } } | R>
  uploadCover?(id: string, blob: Blob, from: CoverFrom): Step<UploadProblem>
  uploadPicture(id: string, n: number, blob: Blob): Step<PictureProblem>
  uploadChapter(id: string, position: number, body: string): Step<ImportProblem>
  finish(id: string): Step<ImportProblem>
  discard(id: string): void
}

export interface SaveProgress {
  stage: 'cover' | 'pictures' | 'chapters'
  done: number
  total: number
}

export type PrivateBookResult<R> =
  | { ok: true; id: string; coverRefusal?: CoverRefusal }
  | { ok: false; at: 'start'; refused: R }
  | { ok: false; at: 'picture'; problem: PictureProblem }
  | { ok: false; at: 'chapter' | 'finish'; problem: ImportProblem }

export function keptPictures(uploads: readonly number[], blobOf: (n: number) => Blob | undefined): Blob[] | null {
  const blobs = uploads.map(blobOf)
  return blobs.every((b) => b !== undefined) ? blobs : null
}

const trimmed = (value: string | null) => value?.trim() || null

const AT_ONCE = 2

type Failure = Extract<PrivateBookResult<never>, { at: 'picture' | 'chapter' | 'finish' }>

class Stop extends Error {
  constructor(readonly failure: Failure) {
    super(failure.at)
  }
}

async function must<P>(step: Step<P>, failure: (problem: P) => Failure): Promise<void> {
  const answer = await step
  if (!answer.ok) throw new Stop(failure(answer.problem))
}

export async function savePrivateBook<R extends { ok: false }>(
  draft: PrivateBookDraft,
  steps: PrivateBookSteps<R>,
  onProgress: (progress: SaveProgress) => void = () => {},
): Promise<PrivateBookResult<R>> {
  const { book, chapters, pictures, cover } = draft
  const first: SaveProgress['stage'] = cover ? 'cover' : pictures.length ? 'pictures' : 'chapters'
  const begin = (stage: SaveProgress['stage'], total: number) => {
    if (stage !== first) onProgress({ stage, done: 0, total })
  }
  onProgress({ stage: first, done: 0, total: cover ? 1 : pictures.length || chapters.length })

  const started = await steps.start({
    ...book,
    chapterCount: chapters.length,
    description: trimmed(book.description),
    isbn: trimmed(book.isbn),
    publisher: trimmed(book.publisher),
    images: { count: pictures.length, bytes: pictures.reduce((sum, p) => sum + p.size, 0) },
  })
  if (!started.ok) return { ok: false, at: 'start', refused: started }
  const { id } = started.value

  let coverRefusal: CoverRefusal | undefined
  if (cover && steps.uploadCover) {
    const saved = await steps.uploadCover(id, cover.blob, cover.from).catch(() => null)
    if (!saved?.ok) coverRefusal = saved ? refusalOf(saved.problem) : 'unavailable'
  }

  let at: Failure['at'] = 'picture'
  try {
    if (pictures.length) begin('pictures', pictures.length)
    let next = 0
    let uploaded = 0
    let stopped: { error: unknown } | null = null
    const worker = async () => {
      while (next < pictures.length && !stopped) {
        const n = ++next
        try {
          await must(steps.uploadPicture(id, n, pictures[n - 1] as Blob), (problem) => ({
            ok: false,
            at: 'picture',
            problem,
          }))
          if (!stopped) onProgress({ stage: 'pictures', done: ++uploaded, total: pictures.length })
        } catch (error) {
          stopped ??= { error }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, pictures.length) }, worker))
    if (stopped) throw (stopped as { error: unknown }).error

    at = 'chapter'
    begin('chapters', chapters.length)
    for (const [i, chapter] of chapters.entries()) {
      await must(steps.uploadChapter(id, i, chapterRequest(chapter)), (problem) => ({
        ok: false,
        at: 'chapter',
        problem,
      }))
      onProgress({ stage: 'chapters', done: i + 1, total: chapters.length })
    }
    at = 'finish'
    await must(steps.finish(id), (problem) => ({ ok: false, at: 'finish', problem }))
  } catch (error) {
    steps.discard(id)
    return error instanceof Stop ? error.failure : { ok: false, at, problem: 'failed' }
  }
  return coverRefusal ? { ok: true, id, coverRefusal } : { ok: true, id }
}
