import { isObject } from '~/shared/lib/json-shape'
import type {
  SpeakErrorCode,
  SpeakRequest,
  SpeechFormat,
  SpeechVoicesState,
  SpokenWord,
} from '~/shared/read-aloud/cloud'

export type SpeakResult =
  | { ok: true; audio: Blob; words: SpokenWord[]; format: SpeechFormat }
  | { ok: false; problem: SpeakErrorCode; retryAt?: Date }

const CODES: readonly SpeakErrorCode[] = [
  'invalid',
  'not_found',
  'signed_out',
  'no_key',
  'key_rejected',
  'no_credits',
  'permission',
  'voice_gone',
  'busy',
  'rate',
  'failed',
]

const isTime = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

function isWord(value: unknown): value is SpokenWord {
  if (!isObject(value)) return false
  return isTime(value.start) && isTime(value.end) && isTime(value.t0) && isTime(value.t1) && value.end > value.start
}

export function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const fail = (problem: SpeakErrorCode, retryAt?: Date): SpeakResult => ({ ok: false, problem, retryAt })

export async function speak(
  request: SpeakRequest,
  signal?: AbortSignal,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<SpeakResult> {
  try {
    const response = await fetchFn('/account/read-aloud/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
    const json: unknown = await response.json().catch(() => ({}))
    const body: Record<string, unknown> = isObject(json) ? json : {}
    if (!response.ok) {
      const code = CODES.find((c) => c === body.error) ?? 'failed'
      const retryAt = typeof body.retryAt === 'string' ? new Date(body.retryAt) : undefined
      return fail(code, retryAt && !Number.isNaN(retryAt.getTime()) ? retryAt : undefined)
    }
    const { audio, words, format } = body
    if (typeof audio !== 'string' || !audio || (format !== 'low' && format !== 'standard')) return fail('failed')
    return {
      ok: true,
      audio: new Blob([decodeBase64(audio)], { type: 'audio/mpeg' }),
      words: Array.isArray(words) ? words.filter(isWord) : [],
      format,
    }
  } catch {
    return fail('failed')
  }
}

export async function loadCloudVoices(
  book: string,
  load: (book: string) => Promise<SpeechVoicesState>,
): Promise<SpeechVoicesState> {
  try {
    return await load(book)
  } catch {
    return { state: 'unavailable' }
  }
}
