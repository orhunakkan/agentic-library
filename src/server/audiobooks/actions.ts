import '@tanstack/react-start/server-only'
import { fitToFiles } from '../../shared/audiobooks/chapters.ts'
import { parseAudiobookStart } from '../../shared/audiobooks/input.ts'
import {
  CHUNK_BYTES,
  MAX_AUDIO_FILES,
  MAX_START_REQUEST_BYTES,
  MIN_FREE_BYTES,
  MIN_FREE_BYTES_UPLOADING,
} from '../../shared/audiobooks/limits.ts'
import { isUuid } from '../../shared/uuid.ts'
import { noStoreJson, requestIp } from '../auth.ts'
import { getConfig } from '../config.ts'
import type { Pool } from '../db.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { deleteBook } from '../user-books.ts'
import {
  appendAt,
  audiobooksDir,
  audioPath,
  freeBytes as diskFreeBytes,
  makeBookDir,
  removeBook,
  sweep,
} from './files.ts'
import { probeFile } from './probe.ts'
import {
  finishAudiobook,
  finishingBook,
  readyAudioFile,
  recordChunk,
  rewindFile,
  startAudiobook,
  typeOfMedia,
  uploadingFile,
  userBookIds,
} from './store.ts'

export type AudiobookErrorCode =
  | 'signed_out'
  | 'not_found'
  | 'invalid'
  | 'quota'
  | 'offset'
  | 'incomplete'
  | 'drm'
  | 'unreadable'
  | 'failed'

export interface AudiobookOptions {
  freeBytes?: (dir: string) => Promise<number>
}

const audiobooks = signedInEndpoints<AudiobookErrorCode>({ maxBytes: MAX_START_REQUEST_BYTES })
const { fail } = audiobooks
const notFound = () => fail(404, 'not_found')
const serverFull = () => fail(409, 'quota', { scope: 'server' })

export function parseFileNumber(value: string): number | null {
  if (!/^[1-9]\d{0,2}$/.test(value)) return null
  const n = Number(value)
  return n <= MAX_AUDIO_FILES ? n : null
}

export const handleNewAudiobook = (request: Request, options: AudiobookOptions = {}) =>
  audiobooks.post(
    request,
    {
      log: 'audiobook start',
      parse: (value) => parseAudiobookStart(value, getConfig().limits.audiobookBytes),
    },
    async ({ session, db, input: book }) => {
      const root = await audiobooksDir()
      if (!root) return notFound()
      const { userId } = session
      const bytes = book.files.reduce((n, b) => n + b, 0)
      if ((await (options.freeBytes ?? diskFreeBytes)(root)) - bytes < MIN_FREE_BYTES) return serverFull()
      const started = await startAudiobook(db, userId, book, new Date(), getConfig().limits)
      if (!started.ok) return fail(409, 'quota', { scope: started.quota, max: started.max })
      await makeBookDir(root, userId, started.id)
      await sweep(root, userId, await userBookIds(db, userId))
      return noStoreJson(201, { id: started.id })
    },
  )

export const handleAudioChunk = (request: Request, id: string, number: string, options: AudiobookOptions = {}) =>
  audiobooks.post(
    request,
    {
      log: 'audiobook chunk',
      signedOut: 404,
      body: { bytes: CHUNK_BYTES, types: ['application/octet-stream'] },
      before: async () => {
        const fileNumber = parseFileNumber(number)
        const root = await audiobooksDir()
        if (!isUuid(id) || fileNumber === null || !root) return notFound()
        const offset = new URL(request.url).searchParams.get('offset') ?? ''
        if (!/^\d{1,10}$/.test(offset)) return fail(400, 'invalid')
        return { fileNumber, root, offset: Number(offset) }
      },
    },
    async ({ session, db, pre: { fileNumber, root, offset }, input: body }) => {
      const { userId } = session
      const file = await uploadingFile(db, userId, id, fileNumber)
      if (!file) {
        const ready = await readyAudioFile(db, userId, id, fileNumber)
        return ready ? fail(409, 'offset', { received: ready.bytes }) : notFound()
      }
      if (offset !== file.received) return fail(409, 'offset', { received: file.received })
      if (offset + body.bytes.length > file.bytes) return fail(400, 'invalid')
      if ((await (options.freeBytes ?? diskFreeBytes)(root)) - body.bytes.length < MIN_FREE_BYTES_UPLOADING)
        return serverFull()
      const written = await appendAt(
        audioPath(root, userId, id, fileNumber, typeOfMedia(file.mediaType)),
        offset,
        body.bytes,
      )
      if (written !== 'ok') {
        await rewindFile(db, userId, id, fileNumber, written.size)
        return fail(409, 'offset', { received: Math.min(written.size, file.received) })
      }
      const received = await recordChunk(db, userId, id, fileNumber, offset, body.bytes.length)
      if (received === null) {
        const now = await uploadingFile(db, userId, id, fileNumber)
        return now ? fail(409, 'offset', { received: now.received }) : notFound()
      }
      return noStoreJson(200, { received })
    },
  )

async function discard(db: Pool, root: string, userId: number, id: string): Promise<void> {
  await deleteBook(db, userId, id)
  await removeBook(root, userId, id)
}

export const handleAudioFinish = (request: Request, id: string) =>
  audiobooks.post(
    request,
    {
      log: 'audiobook finish',
      signedOut: 404,
      body: 'none',
      before: async () => {
        const root = await audiobooksDir()
        return isUuid(id) && root ? root : notFound()
      },
    },
    async ({ session, db, pre: root }) => {
      const { userId } = session
      const book = await finishingBook(db, userId, id)
      if (!book) return notFound()
      if (book.files.some((f) => f.received !== f.bytes)) return fail(409, 'incomplete')
      const durations: number[] = []
      for (const file of book.files) {
        const type = typeOfMedia(file.mediaType)
        const probe = await probeFile(audioPath(root, userId, id, file.n, type), type)
        if (!probe.ok) {
          await discard(db, root, userId, id)
          return probe.problem === 'drm' ? fail(400, 'drm') : fail(400, 'unreadable', { reason: probe.reason })
        }
        durations.push(probe.durationMs)
      }
      const chapters = fitToFiles(book.chapters, durations)
      if (!chapters) {
        await discard(db, root, userId, id)
        return fail(400, 'unreadable', { reason: 'its chapters don’t fit its length' })
      }
      if (!(await finishAudiobook(db, userId, id, { durations, chapters }, requestIp(request)))) return notFound()
      return noStoreJson(200, { ok: true })
    },
  )
