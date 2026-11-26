import type { BookStart } from '~/client/features/import/import-client'
import type { DrawnPicture } from '~/client/features/import/picture-draw'
import { keptPictures, type PrivateBookSteps, savePrivateBook } from '~/client/features/import/private-book-save'
import type { ArticleFetch } from '~/shared/articles/contract'
import type { PictureType } from '~/shared/import/blocks'
import { BOOK_ROOM, type PictureState, planPictures, saveableChapters } from '~/shared/import/draft'
import { sniffImage } from '~/shared/import/image'
import type { DraftResult, ReadabilityResult } from './article-draft'
import type { SaveStage } from './article-messages'
import type { ArticleFailure, ArticleResult } from './articles-client'

export interface SaveSteps {
  fetchArticle: (url: string) => Promise<ArticleResult<ArticleFetch>>
  read: (html: string, finalUrl: string) => Promise<ReadabilityResult | null>
  draft: (result: ReadabilityResult | null, finalUrl: string) => Promise<DraftResult>
  fetchPicture: (fetchId: string, url: string) => Promise<Uint8Array | null>
  drawPicture: (bytes: Uint8Array, type: PictureType) => Promise<DrawnPicture>
  startArticle: (
    start: BookStart & { article: string },
  ) => Promise<ArticleResult<{ id: string; imageBytesLeft: number }>>
  upload: Omit<PrivateBookSteps<ArticleRefusal>, 'start' | 'uploadCover'>
}

type ArticleRefusal = Extract<ArticleResult<unknown>, { ok: false }>

export type SaveOutcome =
  | { ok: true; id: string; failed: number; capped: number }
  | { ok: false; failure: ArticleFailure }

const AT_ONCE = 2

const failure = (problem: ArticleFailure['problem']): SaveOutcome => ({ ok: false, failure: { problem } })

async function inTwos(total: number, work: (i: number) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < total) await work(next++)
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, total) }, worker))
}

export async function saveArticle(
  url: string,
  steps: SaveSteps,
  { imageBytesUsed = 0, userPictureBytes }: { imageBytesUsed?: number; userPictureBytes: number },
  onProgress: (progress: SaveStage) => void,
): Promise<SaveOutcome> {
  onProgress({ stage: 'fetching' })
  const page = await steps.fetchArticle(url)
  if (!page.ok) return { ok: false, failure: page.failure ?? { problem: page.problem } }
  const { fetch: fetchId, finalUrl, html } = page.value

  onProgress({ stage: 'reading' })
  const drafted = await steps
    .read(html, finalUrl)
    .then((result) => steps.draft(result, finalUrl))
    .catch((): DraftResult => ({ ok: false, problem: 'no_article' }))
  if (!drafted.ok) return failure('no_article')
  const { book, pictureUrls, capped } = drafted.draft

  const wanted = [...pictureUrls]
  const states = new Map<number, PictureState>()
  const blobs = new Map<number, Blob>()
  let fetched = 0
  if (wanted.length) onProgress({ stage: 'pictures', done: 0, total: wanted.length })
  await inTwos(wanted.length, async (i) => {
    const [pictureNumber, address] = wanted[i] as [number, string]
    const bytes = await steps.fetchPicture(fetchId, address)
    const type = bytes && sniffImage(bytes)?.type
    const drawn: DrawnPicture = bytes && type ? await steps.drawPicture(bytes, type) : { problem: 'unreadable' }
    if ('blob' in drawn) {
      states.set(pictureNumber, { ok: true, bytes: drawn.blob.size, width: drawn.width, height: drawn.height })
      blobs.set(pictureNumber, drawn.blob)
    } else states.set(pictureNumber, { ok: false, problem: drawn.problem })
    onProgress({ stage: 'pictures', done: ++fetched, total: wanted.length })
  })
  const plan = planPictures(
    book.chapters,
    (n) => states.get(n),
    BOOK_ROOM(Math.max(0, userPictureBytes - imageBytesUsed)),
  )
  const isSpacer = (state: PictureState | undefined) => state?.ok === false && state.problem === 'small'
  const failed = wanted.filter(([n]) => !plan.numbers.has(n) && !isSpacer(states.get(n))).length
  const saveable = saveableChapters(plan.chapters)
  const pictures = keptPictures(plan.uploads, (n) => blobs.get(n))
  if (!saveable.ok || !pictures) return failure('failed')

  onProgress({ stage: 'saving' })
  const { title, author, language, details } = book
  const saved = await savePrivateBook<ArticleRefusal>(
    {
      book: { title, author, language, ...details, isbn: null },
      chapters: saveable.chapters,
      pictures,
    },
    { ...steps.upload, start: (start) => steps.startArticle({ ...start, article: fetchId }) },
  )
  if (saved.ok) return { ok: true, id: saved.id, failed, capped }
  if (saved.at === 'start') return { ok: false, failure: saved.refused.failure ?? { problem: saved.refused.problem } }
  if (saved.at === 'chapter' && saved.problem === 'article-too-large')
    return { ok: false, failure: { problem: 'article_too_large', max: saved.max } }
  return failure(saved.at !== 'picture' && saved.problem === 'signed-out' ? 'signed_out' : 'failed')
}
