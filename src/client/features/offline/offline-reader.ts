import { buildReaderView, type ReaderView } from '~/shared/content/reader-view'
import type { CoverStyle } from '~/shared/content/schema'
import type { OfflineBook } from '~/shared/offline/book'
import { type SpeechChapterData, speechChapter } from '~/shared/read-aloud/speech-text'
import { mayOpen, type OfflineEnv, offlineEnv, readCopy, removeDownload } from './store'

export class OfflineMissing extends Error {
  name = 'OfflineMissing'
  constructor(readonly slug: string) {
    super(`${slug} is not downloaded on this device`)
  }
}

export const isOfflineMissing = (error: unknown): error is OfflineMissing =>
  error instanceof Error && error.name === 'OfflineMissing'

export interface OfflineReaderPage {
  view: ReaderView
  cover: CoverStyle
  audio: null
  offlineVersion: string
  offline: true
}

async function openCopy(slug: string, env: OfflineEnv): Promise<OfflineBook> {
  const copy = await readCopy(slug, env)
  if (!copy) throw new OfflineMissing(slug)
  if (!mayOpen(slug, env)) {
    await removeDownload(slug, env)
    throw new OfflineMissing(slug)
  }
  return copy
}

export async function readerPageFromCopy(
  slug: string,
  part: string,
  pageNumber: string | undefined,
  env: OfflineEnv = offlineEnv(),
): Promise<OfflineReaderPage> {
  const copy = await openCopy(slug, env)
  const view = buildReaderView(copy.context, copy.content, part, pageNumber)
  if (!view) throw new OfflineMissing(slug)
  return { view, cover: copy.cover, audio: null, offlineVersion: copy.version, offline: true }
}

export async function speechFromCopy(
  slug: string,
  chapter: number,
  env: OfflineEnv = offlineEnv(),
): Promise<SpeechChapterData> {
  const copy = await openCopy(slug, env)
  const found = speechChapter(copy.content, chapter)
  if (!found) throw new OfflineMissing(slug)
  return { book: copy.speech, chapter: found }
}
