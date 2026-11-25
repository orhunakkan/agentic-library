import '@tanstack/react-start/server-only'
import {
  type ListeningPlace,
  parseSyncedSettings,
  READ_LIMITS,
  type ReadingPlace,
  type SyncState,
} from '~/shared/sync/sync'
import { fromStored } from '../../shared/content/position.ts'
import { slugOf } from '../books/ref.ts'
import type { Db } from '../db.ts'
import { signedInRead } from '../signed-in.ts'
import { bookFor, newPlaceCache, type PlaceCache, placeForRead, preloadBooks } from './places.ts'
import { getSettings, type ListeningRow, listListening, listReading, type ReadingRow, readingFor } from './store.ts'

async function toPlace(db: Db, userId: number, row: ReadingRow, cache: PlaceCache): Promise<ReadingPlace | null> {
  const slug = slugOf(row.ref)
  const place = await placeForRead(db, userId, slug, row.chapter, row.page, cache)
  return (
    place && {
      book: slug,
      bookTitle: place.bookTitle,
      chapterTitle: place.chapterTitle,
      href: place.href,
      label: place.label,
      position: place.position,
      at: row.at.getTime(),
      device: row.device,
    }
  )
}

function toListening(listeningRow: ListeningRow): ListeningPlace {
  const common = { book: slugOf(listeningRow.ref), at: listeningRow.at.getTime(), device: listeningRow.device }
  if (listeningRow.kind === 'episode')
    return { ...common, kind: 'episode', episode: listeningRow.episode, positionMs: listeningRow.positionMs }
  if (listeningRow.chapterIndex === null || listeningRow.page === null || listeningRow.offset === null)
    return { ...common, kind: 'voice', chapter: 0, position: null, offset: 0 }
  const position = fromStored(listeningRow.chapter, listeningRow.page)
  return { ...common, kind: 'voice', chapter: listeningRow.chapterIndex, position, offset: listeningRow.offset }
}

export function syncState(request: Request): Promise<SyncState> {
  return signedInRead(request, 'sync read', async ({ session, db }) => {
    const { userId } = session
    const [rows, listening, settings] = await Promise.all([
      listReading(db, userId, READ_LIMITS.reading),
      listListening(db, userId, READ_LIMITS.listening),
      getSettings(db, userId),
    ])
    const cache = newPlaceCache()
    await preloadBooks(
      db,
      userId,
      rows.map((r) => slugOf(r.ref)),
      cache,
    )
    const reading: ReadingPlace[] = []
    for (const row of rows) {
      const place = await toPlace(db, userId, row, cache)
      if (place) reading.push(place)
    }
    const values = settings && parseSyncedSettings(settings.settings)
    return {
      state: 'ready',
      reading,
      listening: listening.map(toListening),
      settings: settings && values ? { values, at: settings.at.getTime(), device: settings.device } : null,
    }
  })
}

export type ReadingPlaceState =
  | { state: 'signed_out' | 'unavailable' | 'not_found' }
  | { state: 'ready'; place: ReadingPlace | null }

export function readingPlaceState(request: Request, slug: string): Promise<ReadingPlaceState> {
  return signedInRead(request, 'sync read', async ({ session, db }) => {
    const cache = newPlaceCache()
    const book = await bookFor(db, session.userId, slug, cache)
    if (!book) return { state: 'not_found' }
    const row = await readingFor(db, session.userId, book.ref)
    return { state: 'ready', place: row && (await toPlace(db, session.userId, row, cache)) }
  })
}
