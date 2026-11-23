import '@tanstack/react-start/server-only'
import type { SpeechModelId } from '../../shared/lib/speech-models.ts'
import type { Alignment } from '../../shared/read-aloud/alignment.ts'
import type { CloudVoice, SpeakErrorCode, SpeechFormat } from '../../shared/read-aloud/cloud.ts'
import { getConfig } from '../config.ts'

export const PREVIOUS_TEXT_MAX = 300
export const NEXT_TEXT_MAX = 300

const CHECK_TIMEOUT_MS = 10_000
const SPEECH_TIMEOUT_MS = 20_000
const VOICES_PAGE = 100
const MAX_ANSWER_BYTES = 8 * 1024 * 1024

export const OUTPUT_FORMATS: Record<SpeechFormat, string> = { low: 'mp3_44100_64', standard: 'mp3_44100_128' }

export interface ElevenLabsOptions {
  fetch?: typeof fetch
  base?: string
}

const baseOf = (options: ElevenLabsOptions) => options.base ?? getConfig().elevenLabsApiBase

export function elevenLabsKeyProblem(key: string): 'shape' | 'anthropic' | null {
  if (key.startsWith('sk-ant-')) return 'anthropic'
  return key.length >= 20 && key.length <= 300 && !/\s/.test(key) ? null : 'shape'
}

export type KeyCheck = 'valid' | 'rejected' | 'permission' | 'unavailable'

export async function checkKey(
  key: string,
  options: ElevenLabsOptions = {},
): Promise<{ result: KeyCheck; status?: number }> {
  try {
    const response = await (options.fetch ?? fetch)(`${baseOf(options)}/v2/voices?page_size=1`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      redirect: 'error',
    })
    await response.body?.cancel().catch(() => {})
    if (response.status === 200) return { result: 'valid', status: 200 }
    if (response.status === 401) return { result: 'rejected', status: 401 }
    if (response.status === 403) return { result: 'permission', status: 403 }
    return { result: 'unavailable', status: response.status }
  } catch {
    return { result: 'unavailable' }
  }
}

function detailCode(body: unknown): string | null {
  const detail = body && typeof body === 'object' ? (body as { detail?: unknown }).detail : null
  if (!detail || typeof detail !== 'object') return null
  const { code, status } = detail as { code?: unknown; status?: unknown }
  return typeof code === 'string' ? code : typeof status === 'string' ? status : null
}

const BUSY = new Set(['rate_limit_exceeded', 'concurrent_limit_exceeded', 'system_busy'])

export function errorCode(status: number, body: unknown): SpeakErrorCode {
  const code = detailCode(body)
  if (code === 'invalid_api_key' || code === 'missing_api_key' || status === 401) return 'key_rejected'
  if (code === 'insufficient_credits' || status === 402) return 'no_credits'
  if (code === 'voice_not_found' || code === 'invalid_voice_id' || status === 404) return 'voice_gone'
  if (status === 403) return 'permission'
  if ((code !== null && BUSY.has(code)) || status === 429 || status === 503) return 'busy'
  return 'failed'
}

async function jsonOf(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_ANSWER_BYTES) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  const text = await response.text()
  if (text.length > MAX_ANSWER_BYTES) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

const stringOr = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

function toVoice(raw: unknown): CloudVoice | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as { voice_id?: unknown; name?: unknown; labels?: unknown; verified_languages?: unknown }
  if (typeof v.voice_id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(v.voice_id)) return null
  const name = stringOr(v.name)?.slice(0, 100)
  if (!name) return null
  const labels = (v.labels && typeof v.labels === 'object' ? v.labels : {}) as Record<string, unknown>
  const languages = new Set<string>()
  for (const l of Array.isArray(v.verified_languages) ? v.verified_languages : []) {
    const language = stringOr((l as { language?: unknown } | null)?.language)
    const base = language?.replace(/_/g, '-').split('-')[0]?.toLowerCase()
    if (base && /^[a-z]{2,3}$/.test(base)) languages.add(base)
  }
  return {
    id: v.voice_id,
    name,
    accent: stringOr(labels.accent)?.slice(0, 40) ?? null,
    gender: stringOr(labels.gender)?.slice(0, 20) ?? null,
    languages: [...languages],
  }
}

export type VoicesResult =
  | { ok: true; voices: CloudVoice[] }
  | { ok: false; code: 'key_rejected' | 'permission' | 'unavailable'; status?: number }

export async function listVoices(key: string, options: ElevenLabsOptions = {}): Promise<VoicesResult> {
  try {
    const response = await (options.fetch ?? fetch)(`${baseOf(options)}/v2/voices?page_size=${VOICES_PAGE}`, {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      redirect: 'error',
    })
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {})
      const status = response.status
      return {
        ok: false,
        code: status === 401 ? 'key_rejected' : status === 403 ? 'permission' : 'unavailable',
        status,
      }
    }
    const body = await jsonOf(response)
    const raw = body && typeof body === 'object' ? (body as { voices?: unknown }).voices : null
    if (!Array.isArray(raw)) return { ok: false, code: 'unavailable', status: 200 }
    const voices = raw.map(toVoice).filter((v): v is CloudVoice => v !== null)
    return { ok: true, voices: voices.slice(0, VOICES_PAGE) }
  } catch {
    return { ok: false, code: 'unavailable' }
  }
}

export interface SpeechJob {
  voice: string
  model: SpeechModelId
  text: string
  previousText: string
  nextText: string
  language: string
  format: SpeechFormat
}

export type SpeechResult =
  | { ok: true; audio: string; alignment: Alignment | null }
  | { ok: false; status: number; code: SpeakErrorCode }

export function speechBody(
  job: SpeechJob,
  caps: { previous: number; next: number } = { previous: PREVIOUS_TEXT_MAX, next: NEXT_TEXT_MAX },
): Record<string, unknown> {
  const previous = caps.previous > 0 ? job.previousText.slice(-caps.previous).trim() : ''
  const next = caps.next > 0 ? job.nextText.slice(0, caps.next).trim() : ''
  return {
    text: job.text,
    model_id: job.model,
    language_code: job.language,
    ...(previous ? { previous_text: previous } : {}),
    ...(next ? { next_text: next } : {}),
    apply_text_normalization: 'auto',
  }
}

function alignmentOf(body: Record<string, unknown>): Alignment | null {
  const a = body.alignment as Record<string, unknown> | null | undefined
  if (!a || typeof a !== 'object') return null
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = a
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) return null
  if (starts.length !== characters.length || ends.length !== characters.length) return null
  if (!characters.every((c) => typeof c === 'string')) return null
  if (![...starts, ...ends].every((t) => typeof t === 'number' && Number.isFinite(t))) return null
  return { characters: characters as string[], starts: starts as number[], ends: ends as number[] }
}

export async function synthesize(
  key: string,
  job: SpeechJob,
  signal?: AbortSignal,
  options: ElevenLabsOptions = {},
): Promise<SpeechResult> {
  const url = `${baseOf(options)}/v1/text-to-speech/${encodeURIComponent(job.voice)}/with-timestamps?output_format=${OUTPUT_FORMATS[job.format]}`
  const timeout = AbortSignal.timeout(SPEECH_TIMEOUT_MS)
  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(speechBody(job)),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: 'error',
    })
    const body = await jsonOf(response)
    if (response.status !== 200) return { ok: false, status: response.status, code: errorCode(response.status, body) }
    const audio = body && typeof body === 'object' ? (body as { audio_base64?: unknown }).audio_base64 : null
    if (typeof audio !== 'string' || !audio) return { ok: false, status: 200, code: 'failed' }
    return { ok: true, audio, alignment: alignmentOf(body as Record<string, unknown>) }
  } catch {
    return { ok: false, status: 0, code: 'failed' }
  }
}
