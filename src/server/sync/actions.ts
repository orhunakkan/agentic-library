import '@tanstack/react-start/server-only'
import { DAY_WINDOW } from '~/shared/reading-stats/contract'
import { dayIn, daysBetween } from '~/shared/reading-stats/days'
import type { ListeningWrite, TimeWrite } from '~/shared/sync/sync'
import { noStoreJson } from '../auth.ts'
import { refFor } from '../books/ref.ts'
import type { Db } from '../db.ts'
import { describeDevice } from '../device.ts'
import { saveTime } from '../reading-stats/store.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { parseSyncBatch } from './input.ts'
import { bookFor, newPlaceCache, type PlaceCache, preloadBooks, resolveEpisode, resolvePlace } from './places.ts'
import { type ListeningItem, type ReadingItem, saveBatch } from './store.ts'

const MAX_BODY_BYTES = 16 * 1024
const MAX_DEVICE = 60

type SyncErrorCode = 'signed_out' | 'invalid' | 'failed'

const sync = signedInEndpoints<SyncErrorCode>({
  maxBytes: MAX_BODY_BYTES,
  codes: { signedOut: 'signed_out', invalid: 'invalid', failed: 'failed' },
})

async function checkListening(
  db: Db,
  userId: number,
  item: ListeningWrite,
  cache: PlaceCache,
): Promise<ListeningItem | null> {
  if (item.kind === 'episode') {
    const episode = await resolveEpisode(db, userId, item.book, item.episode)
    if (!episode) return null
    const positionMs = item.positionMs === null ? null : Math.min(item.positionMs, episode.durationMs)
    return { ref: refFor(item.book), kind: 'episode', episode: item.episode, positionMs, at: item.at }
  }
  if (item.position === null) {
    const book = await bookFor(db, userId, item.book, cache)
    return book && { ref: book.ref, kind: 'voice', place: null, at: item.at }
  }
  const place = await resolvePlace(db, userId, item.book, item.position, cache)
  if (!place) return null
  return {
    ref: place.ref,
    kind: 'voice',
    place: { chapterIndex: place.chapterIndex, chapter: place.chapter, page: place.page, offset: item.offset },
    at: item.at,
  }
}

function inWindow(item: TimeWrite, today: string): boolean {
  const ago = daysBetween(item.day, today)
  return ago <= DAY_WINDOW.before && -ago <= DAY_WINDOW.after
}

export const handleSync = (request: Request) =>
  sync.post(
    request,
    { log: 'sync', parse: (value) => parseSyncBatch(value, Date.now()) },
    async ({ session, db, input: batch }) => {
      const { userId } = session
      const device = describeDevice(request.headers.get('user-agent')).slice(0, MAX_DEVICE)
      const cache = newPlaceCache()
      await preloadBooks(
        db,
        userId,
        [...(batch.reading ?? []), ...(batch.listening ?? [])].map((item) => item.book),
        cache,
      )
      let skipped = 0
      const reading: ReadingItem[] = []
      for (const item of batch.reading ?? []) {
        const place = await resolvePlace(db, userId, item.book, item.position, cache)
        if (!place) skipped++
        else reading.push({ ref: place.ref, chapter: place.chapter, page: place.page, at: item.at })
      }
      const listening: ListeningItem[] = []
      for (const item of batch.listening ?? []) {
        const checked = await checkListening(db, userId, item, cache)
        if (!checked) skipped++
        else listening.push(checked)
      }
      if (reading.length || listening.length || batch.settings) {
        await saveBatch(db, userId, device, { reading, listening, settings: batch.settings ?? null })
      }
      if (batch.time) {
        const today = dayIn(new Date(), 'UTC')
        const time = batch.time.filter((item) => inWindow(item, today))
        skipped += batch.time.length - time.length
        if (time.length || batch.zone) skipped += await saveTime(db, userId, time, batch.zone ?? null)
      }
      return noStoreJson(200, { ok: true, skipped })
    },
  )
