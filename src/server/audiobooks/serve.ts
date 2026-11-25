import '@tanstack/react-start/server-only'
import { stat } from 'node:fs/promises'
import { isUuid } from '../../shared/uuid.ts'
import { sessionForRequest } from '../auth.ts'
import { rangeResponse } from '../byte-range.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { logError } from '../redact.ts'
import { parseFileNumber } from './actions.ts'
import { audiobooksDir, audioPath } from './files.ts'
import { readyAudioFile, typeOfMedia } from './store.ts'

const AUDIO_HEADERS = {
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'private, no-store',
} as const

const audioText = (status: number, text: string) =>
  new Response(text, { status, headers: { 'content-type': 'text/plain', ...AUDIO_HEADERS } })

const notFound = () => audioText(404, 'Not found')

const missingLogged = new Set<string>()

export async function serveAudio(request: Request, id: string, number: string): Promise<Response> {
  const fileNumber = parseFileNumber(number)
  if (!isUuid(id) || fileNumber === null || !isDatabaseConfigured()) return notFound()
  const root = await audiobooksDir()
  if (!root) return notFound()
  const session = await sessionForRequest(request)
  if (!session) return notFound()
  try {
    const file = await readyAudioFile(getDb(), session.userId, id, fileNumber)
    if (!file) return notFound()
    const path = audioPath(root, session.userId, id, fileNumber, typeOfMedia(file.mediaType))
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) {
      if (!missingLogged.has(path)) {
        missingLogged.add(path)
        logError('audiobook serve', new Error(`a ready audiobook's file ${fileNumber} is missing`))
      }
      return notFound()
    }
    return rangeResponse(request, path, info.size, { 'content-type': file.mediaType, ...AUDIO_HEADERS })
  } catch (error) {
    logError('audiobook serve', error)
    return audioText(503, 'Unavailable')
  }
}
