import { describe, expect, it, vi } from 'vitest'
import { elevenLabsKey, elevenLabsStub, STUB_ELEVENLABS_KEYS } from '../../../tests/stubs/elevenlabs-stub'
import {
  checkKey,
  elevenLabsKeyProblem,
  errorCode,
  listVoices,
  NEXT_TEXT_MAX,
  OUTPUT_FORMATS,
  PREVIOUS_TEXT_MAX,
  type SpeechJob,
  speechBody,
  synthesize,
} from './elevenlabs'

const BASE = 'https://api.elevenlabs.test'
const KEY = 'sk_0123456789abcdef0123456789abcdef'

function answering(response: () => Response) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return response()
  }) as typeof fetch
  return { calls, fetchFn }
}

const throwing = (async () => {
  throw new TypeError(`fetch failed: xi-api-key ${KEY}`)
}) as typeof fetch

const job = (patch: Partial<SpeechJob> = {}): SpeechJob => ({
  voice: 'Voice01',
  model: 'eleven_v4_turbo',
  text: 'It is a truth universally acknowledged.',
  previousText: '',
  nextText: '',
  language: 'en',
  format: 'low',
  ...patch,
})

describe('elevenLabsKeyProblem', () => {
  it('takes 20–300 characters without whitespace, and refuses an Anthropic key', () => {
    expect(elevenLabsKeyProblem(KEY)).toBeNull()
    expect(elevenLabsKeyProblem('x'.repeat(20))).toBeNull()
    expect(elevenLabsKeyProblem('x'.repeat(300))).toBeNull()
    expect(elevenLabsKeyProblem('x'.repeat(19))).toBe('shape')
    expect(elevenLabsKeyProblem('x'.repeat(301))).toBe('shape')
    expect(elevenLabsKeyProblem(`${'x'.repeat(10)} ${'y'.repeat(10)}`)).toBe('shape')
    expect(elevenLabsKeyProblem('sk-ant-api03-a-test-key-that-is-long-enough')).toBe('anthropic')
    expect(elevenLabsKeyProblem('sk-ant-')).toBe('anthropic')
  })
})

describe('checkKey', () => {
  it('asks for one voice with the key in xi-api-key, refusing redirects', async () => {
    const { calls, fetchFn } = answering(() => Response.json({ voices: [] }))
    expect(await checkKey(KEY, { fetch: fetchFn, base: BASE })).toEqual({ result: 'valid', status: 200 })
    expect(calls[0]?.url).toBe(`${BASE}/v2/voices?page_size=1`)
    expect(calls[0]?.init.headers).toEqual({ 'xi-api-key': KEY })
    expect(calls[0]?.init.redirect).toBe('error')
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps 401 to rejected, 403 to permission, and anything else to try again', async () => {
    const status = async (code: number) =>
      (await checkKey(KEY, { fetch: answering(() => new Response('{}', { status: code })).fetchFn, base: BASE })).result
    expect(await status(401)).toBe('rejected')
    expect(await status(403)).toBe('permission')
    expect(await status(500)).toBe('unavailable')
    expect(await status(429)).toBe('unavailable')
    expect(await checkKey(KEY, { fetch: throwing, base: BASE })).toEqual({ result: 'unavailable' })
  })

  it('uses ELEVENLABS_API_BASE when no base is given', async () => {
    const { calls, fetchFn } = answering(() => Response.json({ voices: [] }))
    await checkKey(KEY, { fetch: fetchFn })
    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v2/voices?page_size=1')
  })
})

describe('errorCode', () => {
  const body = (code: string) => ({ detail: { code, message: 'x' } })

  it('maps detail.code first, then the status', () => {
    expect(errorCode(401, body('invalid_api_key'))).toBe('key_rejected')
    expect(errorCode(400, body('missing_api_key'))).toBe('key_rejected')
    expect(errorCode(401, null)).toBe('key_rejected')
    expect(errorCode(402, body('insufficient_credits'))).toBe('no_credits')
    expect(errorCode(400, body('insufficient_credits'))).toBe('no_credits')
    expect(errorCode(403, body('missing_permissions'))).toBe('permission')
    expect(errorCode(404, body('voice_not_found'))).toBe('voice_gone')
    expect(errorCode(400, body('invalid_voice_id'))).toBe('voice_gone')
    for (const code of ['rate_limit_exceeded', 'concurrent_limit_exceeded', 'system_busy'])
      expect(errorCode(429, body(code)), code).toBe('busy')
    expect(errorCode(400, body('system_busy'))).toBe('busy')
    expect(errorCode(429, null)).toBe('busy')
    expect(errorCode(503, null)).toBe('busy')
    expect(errorCode(500, body('internal'))).toBe('failed')
    expect(errorCode(422, body('invalid_output_format'))).toBe('failed')
  })

  it('reads the older detail.status, and treats a body that isn’t JSON as the status alone', () => {
    expect(errorCode(400, { detail: { status: 'invalid_api_key' } })).toBe('key_rejected')
    expect(errorCode(400, { detail: 'a string' })).toBe('failed')
    expect(errorCode(400, 'not json')).toBe('failed')
    expect(errorCode(404, null)).toBe('voice_gone')
  })
})

describe('listVoices', () => {
  it('keeps the id, name, accent, gender and verified languages, and drops everything else', async () => {
    const { calls, fetchFn } = answering(() =>
      Response.json({
        voices: [
          {
            voice_id: 'Aria01',
            name: '  Aria ',
            labels: { accent: 'british', gender: 'female', age: 'young' },
            verified_languages: [
              { language: 'en', locale: 'en-GB', preview_url: 'https://x/1.mp3' },
              { language: 'en', locale: 'en-US' },
              { language: 'FR' },
              { language: 'not a language' },
              null,
            ],
            preview_url: 'https://x/aria.mp3',
            sharing: { secret: true },
          },
          { voice_id: 'Plain02', name: 'Plain', labels: null },
          { voice_id: 'bad id!', name: 'Broken' },
          { voice_id: 'NoName03', name: '   ' },
          'junk',
        ],
      }),
    )
    const result = await listVoices(KEY, { fetch: fetchFn, base: BASE })
    expect(calls[0]?.url).toBe(`${BASE}/v2/voices?page_size=100`)
    expect(calls[0]?.init.redirect).toBe('error')
    expect(result).toEqual({
      ok: true,
      voices: [
        { id: 'Aria01', name: 'Aria', accent: 'british', gender: 'female', languages: ['en', 'fr'] },
        { id: 'Plain02', name: 'Plain', accent: null, gender: null, languages: [] },
      ],
    })
  })

  it('says why it couldn’t list them', async () => {
    const at = (code: number, body = '{}') =>
      listVoices(KEY, { fetch: answering(() => new Response(body, { status: code })).fetchFn, base: BASE })
    expect(await at(401)).toEqual({ ok: false, code: 'key_rejected', status: 401 })
    expect(await at(403)).toEqual({ ok: false, code: 'permission', status: 403 })
    expect(await at(500)).toEqual({ ok: false, code: 'unavailable', status: 500 })
    expect(await at(200, '{"voices":"no"}')).toEqual({ ok: false, code: 'unavailable', status: 200 })
    expect(await at(200, 'not json')).toEqual({ ok: false, code: 'unavailable', status: 200 })
    expect(await listVoices(KEY, { fetch: throwing, base: BASE })).toEqual({ ok: false, code: 'unavailable' })
  })

  it('refuses an answer too big to be a voice list', async () => {
    const huge = answering(() => new Response('{}', { headers: { 'content-length': String(9 * 1024 * 1024) } }))
    expect(await listVoices(KEY, { fetch: huge.fetchFn, base: BASE })).toEqual({
      ok: false,
      code: 'unavailable',
      status: 200,
    })
    const long = answering(() => new Response(`{"voices":[],"pad":"${'x'.repeat(8 * 1024 * 1024)}"}`))
    expect((await listVoices(KEY, { fetch: long.fetchFn, base: BASE })).ok).toBe(false)
  })
})

describe('speechBody', () => {
  it('sends the text, the model, the language and normalisation, and no neighbours when there are none', () => {
    expect(speechBody(job())).toEqual({
      text: 'It is a truth universally acknowledged.',
      model_id: 'eleven_v4_turbo',
      language_code: 'en',
      apply_text_normalization: 'auto',
    })
  })

  it('sends the end of the previous text and the start of the next, each at most 300 characters', () => {
    expect([PREVIOUS_TEXT_MAX, NEXT_TEXT_MAX]).toEqual([300, 300])
    const before = `${'a'.repeat(400)}tail`
    const after = `head${'b'.repeat(400)}`
    const body = speechBody(job({ previousText: before, nextText: after }))
    expect(body.previous_text).toBe(before.slice(-300))
    expect(body.next_text).toBe(after.slice(0, 300))
    expect(Object.keys(body)).toEqual([
      'text',
      'model_id',
      'language_code',
      'previous_text',
      'next_text',
      'apply_text_normalization',
    ])
  })

  it('leaves a field out when its cap is 0, or when only whitespace is left', () => {
    const body = speechBody(job({ previousText: 'Before.', nextText: 'After.' }), { previous: 150, next: 0 })
    expect(body.previous_text).toBe('Before.')
    expect('next_text' in body).toBe(false)
    expect('previous_text' in speechBody(job({ previousText: '   ' }))).toBe(false)
  })
})

describe('synthesize', () => {
  const ok = () =>
    Response.json({
      audio_base64: 'SUQz',
      alignment: {
        characters: ['H', 'i'],
        character_start_times_seconds: [0, 0.2],
        character_end_times_seconds: [0.2, 0.4],
      },
    })

  it('posts to the voice’s with-timestamps endpoint at the format asked for', async () => {
    const { calls, fetchFn } = answering(ok)
    const signal = new AbortController().signal
    const result = await synthesize(KEY, job({ voice: 'Voice01' }), signal, { fetch: fetchFn, base: BASE })
    expect(result).toEqual({
      ok: true,
      audio: 'SUQz',
      alignment: { characters: ['H', 'i'], starts: [0, 0.2], ends: [0.2, 0.4] },
    })
    expect(calls[0]?.url).toBe(`${BASE}/v1/text-to-speech/Voice01/with-timestamps?output_format=mp3_44100_64`)
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json', accept: 'application/json' },
      redirect: 'error',
    })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(speechBody(job()))
    await synthesize(KEY, job({ format: 'standard' }), undefined, { fetch: fetchFn, base: BASE })
    expect(calls[1]?.url).toContain('output_format=mp3_44100_128')
    expect(OUTPUT_FORMATS).toEqual({ low: 'mp3_44100_64', standard: 'mp3_44100_128' })
  })

  it('aborts when the browser goes away', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined
      return ok()
    }) as typeof fetch
    await synthesize(KEY, job(), controller.signal, { fetch: fetchFn, base: BASE })
    expect(seen?.aborted).toBe(false)
    controller.abort()
    expect(seen?.aborted).toBe(true)
  })

  it('answers an error’s status and code, a thrown fetch as failed, and an answer without audio as failed', async () => {
    const error = answering(() => Response.json({ detail: { code: 'insufficient_credits' } }, { status: 402 }))
    expect(await synthesize(KEY, job(), undefined, { fetch: error.fetchFn, base: BASE })).toEqual({
      ok: false,
      status: 402,
      code: 'no_credits',
    })
    const html = answering(() => new Response('<html>busy</html>', { status: 503 }))
    expect(await synthesize(KEY, job(), undefined, { fetch: html.fetchFn, base: BASE })).toEqual({
      ok: false,
      status: 503,
      code: 'busy',
    })
    expect(await synthesize(KEY, job(), undefined, { fetch: throwing, base: BASE })).toEqual({
      ok: false,
      status: 0,
      code: 'failed',
    })
    const empty = answering(() => Response.json({ alignment: null }))
    expect(await synthesize(KEY, job(), undefined, { fetch: empty.fetchFn, base: BASE })).toEqual({
      ok: false,
      status: 200,
      code: 'failed',
    })
  })

  it('gives no alignment when ElevenLabs’ is missing or malformed', async () => {
    const alignment = async (value: unknown) => {
      const { fetchFn } = answering(() => Response.json({ audio_base64: 'SUQz', alignment: value }))
      const result = await synthesize(KEY, job(), undefined, { fetch: fetchFn, base: BASE })
      return result.ok ? result.alignment : 'failed'
    }
    expect(await alignment(undefined)).toBeNull()
    expect(await alignment({ characters: 'Hi' })).toBeNull()
    expect(
      await alignment({ characters: ['H'], character_start_times_seconds: [0, 1], character_end_times_seconds: [1] }),
    ).toBeNull()
    expect(
      await alignment({ characters: [1], character_start_times_seconds: [0], character_end_times_seconds: [1] }),
    ).toBeNull()
    expect(
      await alignment({ characters: ['H'], character_start_times_seconds: ['0'], character_end_times_seconds: [1] }),
    ).toBeNull()
  })
})

describe('against the stub', () => {
  const stub = ((url: RequestInfo | URL, init?: RequestInit) =>
    elevenLabsStub(new Request(String(url), init))) as typeof fetch
  const options = { fetch: stub, base: 'http://stub/test-elevenlabs' }

  it('passes the stub’s shape check, and the stub’s keys give each error', async () => {
    const said = await synthesize(
      elevenLabsKey(),
      job({ voice: 'StubVoiceAria01', previousText: 'Before.' }),
      undefined,
      options,
    )
    expect(said.ok && said.alignment?.characters.join('')).toBe('It is a truth universally acknowledged.')
    const codes = await Promise.all(
      (['rejected', 'noCredits', 'noPermission', 'busy', 'voiceGone'] as const).map(async (k) => {
        const result = await synthesize(
          elevenLabsKey(STUB_ELEVENLABS_KEYS[k]),
          job({ voice: 'StubVoiceAria01' }),
          undefined,
          options,
        )
        return result.ok ? 'ok' : result.code
      }),
    )
    expect(codes).toEqual(['key_rejected', 'no_credits', 'permission', 'busy', 'voice_gone'])
    const free = elevenLabsKey(STUB_ELEVENLABS_KEYS.free)
    expect(await synthesize(free, job({ voice: 'StubVoiceAria01' }), undefined, options)).toMatchObject({ status: 422 })
    expect((await synthesize(free, job({ voice: 'StubVoiceAria01', format: 'standard' }), undefined, options)).ok).toBe(
      true,
    )
    expect((await listVoices(elevenLabsKey(), options)).ok).toBe(true)
    expect((await checkKey(elevenLabsKey(), options)).result).toBe('valid')
  })

  it('never logs: nothing here writes to the console', async () => {
    const errors = vi.spyOn(console, 'error')
    await synthesize(KEY, job(), undefined, { fetch: throwing, base: BASE })
    await listVoices(KEY, { fetch: throwing, base: BASE })
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
