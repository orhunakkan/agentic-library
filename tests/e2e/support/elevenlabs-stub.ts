export const STUB_ELEVENLABS_KEYS = {
  rejected: '-rejected',
  noVoices: '-novoices',
  down: '-down',
  noCredits: '-nocredits',
  noPermission: '-noperm',
  busy: '-busy',
  voiceGone: '-voicegone',
  free: '-free',
} as const

export const elevenLabsKey = (ending = '', id = '') => `el-test-valid-${id.padEnd(12, 'k')}${ending}`

export const STUB_VOICES = [
  {
    voice_id: 'StubVoiceAria01',
    name: 'Aria',
    labels: { accent: 'british', gender: 'female', age: 'young' },
    verified_languages: [{ language: 'en', model_id: 'eleven_v4', accent: 'british', locale: 'en-GB' }],
    preview_url: 'https://example.invalid/aria.mp3',
    category: 'premade',
  },
  {
    voice_id: 'StubVoiceCamille03',
    name: 'Camille',
    labels: { accent: 'parisian', gender: 'female' },
    verified_languages: [{ language: 'fr', model_id: 'eleven_v4', locale: 'fr-FR' }],
    preview_url: 'https://example.invalid/camille.mp3',
  },
  {
    voice_id: 'StubVoiceBen02',
    name: 'Ben',
    labels: { accent: 'american', gender: 'male' },
    verified_languages: [{ language: 'en', model_id: 'eleven_v4', locale: 'en-US' }],
    preview_url: 'https://example.invalid/ben.mp3',
  },
] as const

export interface StubSpeechRequest {
  key: string
  voice: string
  format: string | null
  body: Record<string, unknown>
}

const recorded: StubSpeechRequest[] = []

export const stubSpeechRequests = (): readonly StubSpeechRequest[] => recorded
export const resetElevenLabsStub = () => {
  recorded.length = 0
}

function silentMp3(): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(417)
  frame.set([0xff, 0xfb, 0x90, 0xc4])
  const bytes = new Uint8Array(frame.length * 38)
  for (let i = 0; i < 38; i++) bytes.set(frame, i * frame.length)
  return bytes
}

const MP3_BASE64 = Buffer.from(silentMp3()).toString('base64')

const error = (status: number, code: string) =>
  Response.json({ detail: { code, message: `stub: ${code}`, status: code } }, { status })

const FIELDS = new Set(['text', 'model_id', 'language_code', 'previous_text', 'next_text', 'apply_text_normalization'])

function shapeProblem(body: Record<string, unknown> | null, format: string | null): string | null {
  if (!body) return 'body is not JSON'
  if (Object.keys(body).some((k) => !FIELDS.has(k))) return 'unknown field'
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 200) return 'text'
  if (body.model_id !== 'eleven_v4_turbo' && body.model_id !== 'eleven_v4') return 'model_id'
  if (typeof body.language_code !== 'string' || !/^[a-z]{2,3}$/.test(body.language_code)) return 'language_code'
  for (const field of ['previous_text', 'next_text'] as const) {
    const value = body[field]
    if (value !== undefined && (typeof value !== 'string' || !value || value.length > 300)) return field
  }
  if (body.apply_text_normalization !== 'auto') return 'apply_text_normalization'
  if (format !== 'mp3_44100_64' && format !== 'mp3_44100_128') return 'output_format'
  return null
}

async function speech(request: Request, voice: string, key: string): Promise<Response> {
  const url = new URL(request.url)
  const format = url.searchParams.get('output_format')
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const problem = shapeProblem(body, format)
  if (problem) return error(400, `stub_unexpected_${problem.replaceAll(' ', '_')}`)
  recorded.push({ key, voice, format, body: body as Record<string, unknown> })
  if (key.endsWith(STUB_ELEVENLABS_KEYS.rejected)) return error(401, 'invalid_api_key')
  if (key.endsWith(STUB_ELEVENLABS_KEYS.noCredits)) return error(402, 'insufficient_credits')
  if (key.endsWith(STUB_ELEVENLABS_KEYS.noPermission)) return error(403, 'missing_permissions')
  if (key.endsWith(STUB_ELEVENLABS_KEYS.busy)) return error(429, 'system_busy')
  if (key.endsWith(STUB_ELEVENLABS_KEYS.voiceGone) || !STUB_VOICES.some((v) => v.voice_id === voice))
    return error(404, 'voice_not_found')
  if (key.endsWith(STUB_ELEVENLABS_KEYS.free) && format === 'mp3_44100_64') return error(422, 'invalid_output_format')
  const characters = [...String(body?.text)]
  const step = 1 / characters.length
  return Response.json({
    audio_base64: MP3_BASE64,
    alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => Number((i * step).toFixed(3))),
      character_end_times_seconds: characters.map((_, i) => Number(((i + 1) * step).toFixed(3))),
    },
    normalized_alignment: null,
  })
}

export async function elevenLabsStub(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  const key = request.headers.get('xi-api-key') ?? ''
  if (path.endsWith('/requests')) {
    if (request.method === 'DELETE') resetElevenLabsStub()
    const only = new URL(request.url).searchParams.get('key')
    const list = only === null ? recorded : recorded.filter((r) => r.key === only)
    return Response.json(list, { headers: { 'cache-control': 'no-store' } })
  }
  const valid = key.startsWith('el-test-valid') && !key.endsWith(STUB_ELEVENLABS_KEYS.rejected)
  if (path.endsWith('/v2/voices') && request.method === 'GET') {
    if (!valid) return error(401, 'invalid_api_key')
    if (key.endsWith(STUB_ELEVENLABS_KEYS.noVoices)) return error(403, 'missing_permissions')
    if (key.endsWith(STUB_ELEVENLABS_KEYS.down)) return new Response('upstream down', { status: 500 })
    const size = Number(new URL(request.url).searchParams.get('page_size') ?? 10)
    return Response.json({ voices: STUB_VOICES.slice(0, size), has_more: false, total_count: STUB_VOICES.length })
  }
  const speak = /\/v1\/text-to-speech\/([^/]+)\/with-timestamps$/.exec(path)
  if (speak && request.method === 'POST') {
    if (!key.startsWith('el-test-valid')) return error(401, 'invalid_api_key')
    return speech(request, decodeURIComponent(speak[1] ?? ''), key)
  }
  return new Response('not found', { status: 404 })
}
