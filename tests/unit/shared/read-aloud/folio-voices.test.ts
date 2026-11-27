import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  aboutMegabytes,
  ENGINE_BYTES,
  ENGINE_SOFTWARE,
  FOLIO_VOICES,
  folioVoice,
  folioVoicesFor,
  LICENCES,
  megabytes,
  PIPER_VOICES_COMMIT,
  voiceFileName,
  voiceFiles,
  voiceUrl,
} from '~/shared/read-aloud/folio-voices'

const ids = (lang: string, locale?: string) => folioVoicesFor(lang, locale).map((v) => v.id)

describe('the catalogue', () => {
  it('is pinned to one commit', () => {
    expect(PIPER_VOICES_COMMIT).toMatch(/^[0-9a-f]{40}$/)
  })

  it('has unique ids, valid BCP 47 tags and allowed licences', () => {
    expect(new Set(FOLIO_VOICES.map((v) => v.id)).size).toBe(FOLIO_VOICES.length)
    for (const v of FOLIO_VOICES) {
      expect(Intl.getCanonicalLocales(v.lang)).toEqual([v.lang])
      expect(Object.keys(LICENCES)).toContain(v.licence)
      expect(v.id.startsWith(v.lang.replace('-', '_'))).toBe(true)
      expect(v.dataset.url).toMatch(/^https:\/\//)
    }
  })

  it('gives each voice its files’ total size and 64-hex-digit hashes', () => {
    for (const v of FOLIO_VOICES) {
      const files = [v.files.onnx, v.files.config, v.files.card]
      expect(v.bytes).toBe(files.reduce((sum, f) => sum + f.bytes, 0))
      for (const f of files) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(f.path.startsWith(`${v.lang.split('-')[0]}/`)).toBe(true)
      }
      expect(v.files.onnx.path).toMatch(new RegExp(`/${v.id}\\.onnx$`))
      expect(v.files.config.path).toMatch(new RegExp(`/${v.id}\\.onnx\\.json$`))
      expect(v.files.card.path).toMatch(/\/MODEL_CARD$/)
    }
  })

  it('counts the engine’s files as node_modules has them', () => {
    const size = (path: string) =>
      statSync(fileURLToPath(new URL(`../../../../node_modules/${path}`, import.meta.url))).size
    expect(ENGINE_BYTES).toBe(
      size('onnxruntime-web/dist/ort-wasm-simd-threaded.wasm') +
        size('@diffusionstudio/piper-wasm/build/piper_phonemize.wasm') +
        size('@diffusionstudio/piper-wasm/build/piper_phonemize.data'),
    )
  })
})

describe('the engine’s software', () => {
  it('names the versions node_modules has', () => {
    const version = (name: string) =>
      (
        JSON.parse(
          readFileSync(
            fileURLToPath(new URL(`../../../../node_modules/${name}/package.json`, import.meta.url)),
            'utf8',
          ),
        ) as { version: string }
      ).version
    const byName = Object.fromEntries(ENGINE_SOFTWARE.map((s) => [s.name, s.version]))
    expect(byName['piper-wasm']).toBe(version('@diffusionstudio/piper-wasm'))
    expect(byName['onnxruntime-web']).toBe(version('onnxruntime-web'))
  })

  it('links to no removed repository', () => {
    const links = ENGINE_SOFTWARE.flatMap((s) => [s.licence.url, s.source])
    expect(links.filter((link) => /github\.com\/microsoft\/onnxruntime/i.test(link))).toEqual([])
  })
})

describe('folioVoicesFor', () => {
  it('puts the book’s region first, else the reader’s, else catalogue order', () => {
    expect(ids('en-GB', 'en-US')).toEqual(['en_GB-cori-medium', 'en_US-ljspeech-medium'])
    expect(ids('en-US', 'en-GB')).toEqual(['en_US-ljspeech-medium', 'en_GB-cori-medium'])
    expect(ids('en', 'en-GB')).toEqual(['en_GB-cori-medium', 'en_US-ljspeech-medium'])
    expect(ids('en', 'en-US')).toEqual(['en_US-ljspeech-medium', 'en_GB-cori-medium'])
    expect(ids('en', 'de-AT')).toEqual(['en_GB-cori-medium', 'en_US-ljspeech-medium'])
    expect(ids('en_US')).toEqual(['en_US-ljspeech-medium', 'en_GB-cori-medium'])
  })

  it('serves a whole language from another region', () => {
    expect(ids('pt-PT')).toEqual(['pt_BR-cadu-medium'])
    expect(ids('es-MX')).toEqual(['es_ES-davefx-medium'])
  })

  it('reads Norwegian Bokmål and Nynorsk with the Norwegian voice', () => {
    expect(ids('nb')).toEqual(['no_NO-nvcc-medium'])
    expect(ids('nn-NO')).toEqual(['no_NO-nvcc-medium'])
    expect(ids('no')).toEqual(['no_NO-nvcc-medium'])
  })

  it('has none for a language without a commercially licensed voice', () => {
    expect(ids('tr')).toEqual([])
    expect(ids('ja-JP')).toEqual([])
    expect(ids('zh-CN')).toEqual([])
    expect(ids('')).toEqual([])
  })
})

describe('voiceUrl', () => {
  it('names each file by id, hash and kind', () => {
    const cori = folioVoice('en_GB-cori-medium')
    if (!cori) throw new Error('Cori is in the catalogue')
    expect(voiceUrl(cori.files.onnx, cori.id)).toBe('/voices/en_GB-cori-medium.2e0a55e140de.onnx')
    expect(voiceUrl(cori.files.config, cori.id)).toBe('/voices/en_GB-cori-medium.f89b01c5e483.json')
    expect(voiceUrl(cori.files.card, cori.id)).toBe('/voices/en_GB-cori-medium.b1cdf93d1b05.md')
    expect(voiceFileName(cori.files.onnx, cori.id)).toBe('en_GB-cori-medium.2e0a55e140de.onnx')
    expect(voiceFiles(cori).map((f) => f.url)).toHaveLength(3)
    expect(folioVoice('nope')).toBeNull()
  })
})

describe('sizes', () => {
  it('rounds to whole megabytes, at least one', () => {
    expect(aboutMegabytes(63_228_626 + ENGINE_BYTES)).toBe('About 92 MB')
    expect(aboutMegabytes(63_228_626)).toBe('About 60 MB')
    expect(megabytes(63_228_626)).toBe('60 MB')
    expect(megabytes(10)).toBe('1 MB')
  })
})
