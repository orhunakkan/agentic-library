import '@tanstack/react-start/server-only'
import {
  type AudioBookmarkView,
  MAX_AUDIO_BOOKMARKS_PER_BOOK,
  MAX_AUDIO_BOOKMARKS_PER_USER,
  momentAnchor,
} from '~/shared/bookmarks/audio'
import type { AudioBook } from '~/shared/content/schema'
import { type BookPage, pageIndexOf } from '~/shared/highlights/page-text'
import { isUuid } from '../../shared/uuid.ts'
import { noStoreJson } from '../auth.ts'
import { findAudio, findBook } from '../book-ref/book.ts'
import { type BookRef, refFor } from '../book-ref/ref.ts'
import type { Pool } from '../db.ts'
import { signedInEndpoints, signedInRead } from '../signed-in.ts'
import type { BookmarkErrorCode } from './actions.ts'
import { type AudioBookmarkCreateInput, parseAudioBookmarkChange, parseAudioBookmarkCreate } from './audio-input.ts'
import { createAudioBookmark, deleteAudioBookmark, listAudioForBook, type NewAudioBookmark } from './audio-store.ts'
import { toAudioBookmarkView, toAudioBookmarkViews } from './audio-view.ts'

const MAX_BODY_BYTES = 2 * 1024

const audioBookmarks = signedInEndpoints<BookmarkErrorCode>({ maxBytes: MAX_BODY_BYTES })
const { fail } = audioBookmarks

type Moment =
  | { ok: true; ref: BookRef; moment: NewAudioBookmark; pages: readonly BookPage[]; audio: AudioBook | null }
  | { ok: false; response: Response }

async function momentFor(db: Pool, userId: number, input: AudioBookmarkCreateInput): Promise<Moment> {
  if (input.kind === 'voice') {
    const book = await findBook(db, userId, input.book, 'text')
    if (!book) return { ok: false, response: fail(404, 'not_found') }
    const pages = await book.pages()
    const page = pages[pageIndexOf(pages, input.position)]
    if (!page) return { ok: false, response: fail(400, 'invalid') }
    const anchor = momentAnchor(page.text, input.offset)
    if (!anchor) return { ok: false, response: fail(400, 'invalid') }
    const moment: NewAudioBookmark = { kind: 'voice', chapter: page.chapterSlug, page: page.page, ...anchor }
    return { ok: true, ref: book.ref, moment, pages, audio: null }
  }
  const audio = await findAudio(db, userId, input.book)
  if (!audio) return { ok: false, response: fail(404, 'not_found') }
  const episode = audio.episodes.find((e) => e.id === input.episode)
  if (!episode || input.positionMs > episode.durationMs) return { ok: false, response: fail(400, 'invalid') }
  const moment: NewAudioBookmark = {
    kind: 'episode',
    episode: episode.id,
    positionMs: Math.floor(input.positionMs / 1000) * 1000,
  }
  return { ok: true, ref: refFor(input.book), moment, pages: [], audio }
}

export const handleAudioBookmarkCreate = (request: Request) =>
  audioBookmarks.post(
    request,
    { log: 'audio bookmark create', parse: parseAudioBookmarkCreate },
    async ({ session, db, input }) => {
      const found = await momentFor(db, session.userId, input)
      if (!found.ok) return found.response
      const result = await createAudioBookmark(db, session.userId, found.ref, found.moment)
      if (result === 'missing') return fail(404, 'not_found')
      if (result === 'quota-book') return fail(409, 'quota', { scope: 'book', max: MAX_AUDIO_BOOKMARKS_PER_BOOK })
      if (result === 'quota-user') return fail(409, 'quota', { scope: 'user', max: MAX_AUDIO_BOOKMARKS_PER_USER })
      const bookmark = toAudioBookmarkView(result.row, found.pages, found.audio)
      return noStoreJson(result.created ? 201 : 200, { bookmark })
    },
  )

export const handleAudioBookmarkChange = (request: Request, id: string) =>
  audioBookmarks.post(
    request,
    {
      log: 'audio bookmark change',
      before: () => (isUuid(id) ? undefined : fail(404, 'not_found')),
      parse: parseAudioBookmarkChange,
    },
    async ({ session, db }) =>
      (await deleteAudioBookmark(db, session.userId, id)) ? noStoreJson(200, { ok: true }) : fail(404, 'not_found'),
  )

export type AudioBookmarksState =
  | { state: 'signed_out' }
  | { state: 'not_found' }
  | { state: 'unavailable' }
  | { state: 'ready'; bookmarks: AudioBookmarkView[] }

export function audioBookmarksState(request: Request, slug: string): Promise<AudioBookmarksState> {
  return signedInRead(request, 'audio bookmarks', async ({ session, db }) => {
    const book = await findBook(db, session.userId, slug, 'text')
    if (!book) {
      const ref = refFor(slug)
      const audio = ref.userBookId === null ? null : await findAudio(db, session.userId, slug)
      if (!audio) return { state: 'not_found' }
      const rows = await listAudioForBook(db, session.userId, ref)
      return { state: 'ready', bookmarks: toAudioBookmarkViews(rows, [], audio) }
    }
    const [rows, audio, pages] = await Promise.all([
      listAudioForBook(db, session.userId, book.ref),
      book.ref.slug === null ? null : findAudio(db, session.userId, slug),
      book.pages(),
    ])
    return { state: 'ready', bookmarks: toAudioBookmarkViews(rows, pages, audio) }
  })
}
