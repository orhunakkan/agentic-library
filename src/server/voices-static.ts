import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { FOLIO_VOICES, type FolioVoiceFile, filesOfVoice, voiceFileName } from '../shared/read-aloud/folio-voices.ts'
import { rangeResponse } from './byte-range.ts'

export const VOICES_PREFIX = '/voices/'
export const VOICE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const TYPES = {
  onnx: 'application/octet-stream',
  json: 'application/json',
  md: 'text/markdown; charset=utf-8',
} as const

const BY_NAME = new Map<string, FolioVoiceFile>(
  FOLIO_VOICES.flatMap((v) => filesOfVoice(v).map((f) => [voiceFileName(f, v.id), f])),
)

export interface VoiceFile {
  path: string
  type: string
  bytes: number
}

export function voiceFile(pathname: string, dir: string): VoiceFile | null {
  if (!pathname.startsWith(VOICES_PREFIX)) return null
  const name = pathname.slice(VOICES_PREFIX.length)
  const file = BY_NAME.get(name)
  if (!file) return null
  const ext = name.slice(name.lastIndexOf('.') + 1) as keyof typeof TYPES
  return { path: join(dir, name), type: TYPES[ext], bytes: file.bytes }
}

export const voiceHeaders = (file: VoiceFile) => ({
  'content-type': file.type,
  'cache-control': VOICE_CACHE_CONTROL,
  'x-content-type-options': 'nosniff',
})

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain', 'x-content-type-options': 'nosniff' },
  })

export async function voiceResponse(request: Request, dir: string): Promise<Response> {
  const file = voiceFile(new URL(request.url).pathname, dir)
  if (!file || (request.method !== 'GET' && request.method !== 'HEAD')) return notFound()
  const info = await stat(file.path).catch(() => null)
  if (!info?.isFile()) return notFound()
  return rangeResponse(request, file.path, info.size, voiceHeaders(file))
}
