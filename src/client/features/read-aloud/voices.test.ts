import { describe, expect, it, vi } from 'vitest'
import { type FolioVoice, folioVoice } from '~/shared/read-aloud/folio-voices'
import { memoryStorage } from '../../../../tests/fixtures/cache-storage'
import { rememberVoice, voiceChoiceKey } from './position-store'
import {
  cloudNote,
  folioVoiceLike,
  isCloudVoice,
  isLocalVoice,
  languageName,
  loadVoices,
  onlineNote,
  pickVoice,
  rankCloudVoices,
  rankLocalVoices,
  rankVoices,
  regionName,
  resolveVoice,
  type VoiceLike,
  type VoiceSource,
  vendorOf,
  voiceName,
} from './voices'

const v = (name: string, lang: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({
  name,
  lang,
  voiceURI: name,
  localService: true,
  default: false,
  ...extra,
})

const david = v('Microsoft David - English (United States)', 'en-US', { default: true })
const aria = v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', { localService: false })
const sonia = v('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', { localService: false })
const google = v('Google US English', 'en-US', { localService: false })
const daniel = v('Daniel', 'en_GB')
const samantha = v('Samantha (Enhanced)', 'en-US')
const yelda = v('Yelda', 'tr-TR')
const names = (list: VoiceLike[]) => list.map((x) => x.name)

describe('rankVoices', () => {
  it("keeps only the book's language, matching the base language and Android's en_US spelling", () => {
    expect(names(rankVoices([david, yelda, daniel], 'en', { privateBook: false }))).toEqual([david.name, daniel.name])
    expect(names(rankVoices([david, yelda], 'tr', { privateBook: false }))).toEqual(['Yelda'])
    expect(rankVoices([david, daniel], 'de', { privateBook: false })).toEqual([])
    expect(rankVoices([], 'en', { privateBook: false })).toEqual([])
  })

  it("puts the reader's own region first, or the book's when its tag has one", () => {
    expect(names(rankVoices([david, daniel], 'en', { privateBook: false, locale: 'en-GB' }))[0]).toBe('Daniel')
    expect(names(rankVoices([daniel, david], 'en', { privateBook: false, locale: 'en-US' }))[0]).toBe(david.name)
    expect(names(rankVoices([david, daniel], 'en-GB', { privateBook: false, locale: 'en-US' }))[0]).toBe('Daniel')
    expect(names(rankVoices([daniel, david], 'en', { privateBook: false, locale: 'tr-TR' }))).toEqual([
      david.name,
      'Daniel',
    ])
  })

  it('ranks Natural, Neural, Premium, Enhanced and Online names higher, then Google, then the default', () => {
    expect(names(rankVoices([david, google, aria, samantha], 'en', { privateBook: false, locale: 'en-US' }))).toEqual([
      aria.name,
      samantha.name,
      google.name,
      david.name,
    ])
    const plain = v('Plain', 'en-US')
    expect(names(rankVoices([plain, david], 'en', { privateBook: false, locale: 'en-US' }))).toEqual([
      david.name,
      'Plain',
    ])
  })

  it('puts every on-device voice before any online one for a private book', () => {
    expect(
      names(rankVoices([aria, google, sonia, david, samantha], 'en', { privateBook: true, locale: 'en-US' })),
    ).toEqual([samantha.name, david.name, aria.name, google.name, sonia.name])
  })
})

describe('pickVoice', () => {
  it('takes the remembered voice while it is offered, else the best one, else none', () => {
    const ranked = [aria, david]
    expect(pickVoice(ranked, david.voiceURI)).toBe(david)
    expect(pickVoice(ranked, 'gone')).toBe(aria)
    expect(pickVoice(ranked, undefined)).toBe(aria)
    expect(pickVoice([], 'gone')).toBeNull()
  })
})

describe('vendorOf and onlineNote', () => {
  it('names the vendor of an online voice from its name, or its maker', () => {
    expect(vendorOf(google)).toBe('Google')
    expect(vendorOf(aria)).toBe('Microsoft')
    expect(vendorOf(v('Siri Voice 2', 'en-US'))).toBe('Apple')
    expect(vendorOf({ name: 'Ava', voiceURI: 'com.apple.voice.premium.en-US.Ava' })).toBe('Apple')
    expect(vendorOf(v('Mystery', 'en-US'))).toBeNull()
    expect(onlineNote(google)).toBe('Online: the text is sent to Google to be spoken')
    expect(onlineNote(v('Mystery', 'en', { localService: false }))).toBe(
      'Online: the text is sent to its maker to be spoken',
    )
    expect(onlineNote(david)).toBeNull()
  })
})

describe('names', () => {
  it('gives the region and language in English, and a voice name without the repeated language', () => {
    expect(regionName('en-GB')).toBe('United Kingdom')
    expect(regionName('en_US')).toBe('United States')
    expect(regionName('en')).toBeNull()
    expect(languageName('tr-TR')).toBe('Turkish')
    expect(languageName('en')).toBe('English')
    expect(languageName('x!')).toBe('x!')
    expect(regionName('en-001')).toBe('world')
    expect(voiceName(aria)).toBe('Microsoft Aria Online (Natural)')
    expect(voiceName(google)).toBe('Google US English')
  })
})

describe('loadVoices', () => {
  function source(lists: VoiceLike[][]) {
    let listener: (() => void) | null = null
    let call = 0
    const synth: VoiceSource = {
      getVoices: () => lists[Math.min(call++, lists.length - 1)] ?? [],
      addEventListener: (_type, fn) => {
        listener = fn
      },
      removeEventListener: () => {
        listener = null
      },
    }
    return { synth, fire: () => listener?.() }
  }

  it('gives the list at once when there is one', async () => {
    expect(await loadVoices(source([[david]]).synth)).toEqual([david])
  })

  it('waits for voiceschanged', async () => {
    const s = source([[], [david, aria]])
    const wait = vi.fn()
    const loading = loadVoices(s.synth, wait)
    s.fire()
    expect(await loading).toEqual([david, aria])
  })

  it('waits two seconds of real time by default', async () => {
    vi.useFakeTimers()
    try {
      const loading = loadVoices(source([[]]).synth)
      await vi.advanceTimersByTimeAsync(2000)
      expect(await loading).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives what there is after two seconds, even nothing', async () => {
    const s = source([[]])
    let timeout: (() => void) | null = null
    const loading = loadVoices(s.synth, (fn, ms) => {
      expect(ms).toBe(2000)
      timeout = fn
    })
    ;(timeout as unknown as () => void)()
    s.fire()
    expect(await loading).toEqual([])
  })
})

describe('ElevenLabs voices', () => {
  const voices = [
    { id: 'Zed01', name: 'Zed', accent: 'new york', gender: 'male', languages: ['en'] },
    { id: 'Cam02', name: 'Camille', accent: 'parisian', gender: null, languages: ['fr'] },
    { id: 'Ann03', name: 'Ann', accent: null, gender: null, languages: ['en'] },
  ]

  it('become menu entries in the book’s language, verified for it first, labelled by accent and gender', () => {
    expect(rankCloudVoices(voices, 'en-GB')).toEqual([
      {
        name: 'Ann',
        lang: 'en-GB',
        voiceURI: 'elevenlabs:Ann03',
        localService: false,
        default: false,
        engine: 'cloud',
        labels: null,
      },
      expect.objectContaining({ name: 'Zed', voiceURI: 'elevenlabs:Zed01', labels: 'New York · male' }),
      expect.objectContaining({ name: 'Camille', labels: 'Parisian' }),
    ])
  })

  it('are told apart from device voices, which rankVoices never sees', () => {
    const [cloud] = rankCloudVoices(voices, 'en')
    expect(isCloudVoice(cloud)).toBe(true)
    expect(isCloudVoice({ engine: 'device' })).toBe(false)
    expect(isCloudVoice({})).toBe(false)
    expect(isCloudVoice(null)).toBe(false)
  })

  it('say where the text goes and what an hour costs at the chosen model', () => {
    expect(cloudNote('eleven_v4_turbo')).toBe('Online: sent to ElevenLabs on your key · about $2.20 an hour')
    expect(cloudNote('eleven_v4')).toBe('Online: sent to ElevenLabs on your key · about $4.30 an hour')
    expect(cloudNote(null)).toBe('Online: sent to ElevenLabs on your key · about $2.20 an hour')
  })
})

describe('Folio voices', () => {
  const cori = folioVoice('en_GB-cori-medium')
  const lj = folioVoice('en_US-ljspeech-medium')
  const thorsten = folioVoice('de_DE-thorsten-medium')
  if (!cori || !lj || !thorsten) throw new Error('in the catalogue')

  it('are on-device menu entries with their region and gender', () => {
    expect(folioVoiceLike(cori)).toEqual({
      name: 'Cori',
      lang: 'en-GB',
      voiceURI: 'folio:en_GB-cori-medium',
      localService: true,
      default: false,
      engine: 'local',
      labels: 'United Kingdom · female',
    })
    expect(folioVoiceLike(thorsten).labels).toBe('Germany')
    expect(isLocalVoice(folioVoiceLike(cori))).toBe(true)
    expect(isLocalVoice({ engine: 'cloud' })).toBe(false)
    expect(isLocalVoice(null)).toBe(false)
  })

  it('rank the downloaded ones for the book’s language, by region', () => {
    expect(rankLocalVoices([lj, cori, thorsten], 'en', 'en-GB').map((v) => v.name)).toEqual(['Cori', 'LJSpeech'])
    expect(rankLocalVoices([lj], 'en-GB').map((v) => v.name)).toEqual(['LJSpeech'])
    expect(rankLocalVoices([cori], 'de')).toEqual([])
  })

  it('come first in the automatic choice, and a remembered device voice still wins', () => {
    const device = { name: 'Daniel', lang: 'en-GB', voiceURI: 'Daniel', localService: true, default: true }
    const local = rankLocalVoices([cori], 'en-GB')
    expect(pickVoice([...local, device], undefined)?.name).toBe('Cori')
    expect(pickVoice([...local, device], 'Daniel')?.name).toBe('Daniel')
    expect(pickVoice([device], 'folio:en_GB-cori-medium')?.name).toBe('Daniel')
  })
})

describe('resolveVoice', () => {
  const cori = folioVoice('en_GB-cori-medium')
  const thorsten = folioVoice('de_DE-thorsten-medium')
  if (!cori || !thorsten) throw new Error('in the catalogue')

  function storageWith(choices: Record<string, string> = {}): Storage {
    const storage = memoryStorage()
    for (const [key, uri] of Object.entries(choices)) rememberVoice(storage, key, uri)
    return storage
  }
  const resolve = (
    storage: Storage | null,
    options: { privateBook?: boolean; downloaded?: readonly FolioVoice[] } = {},
  ) =>
    resolveVoice({
      voices: [david, daniel, yelda],
      downloaded: options.downloaded ?? [cori, thorsten],
      lang: 'en-GB',
      privateBook: options.privateBook ?? false,
      locale: 'en-GB',
      storage,
    })

  it("ranks the device and Folio voices for the book's language, and picks the first Folio voice", () => {
    const r = resolve(null)
    expect(names(r.device)).toEqual(['Daniel', david.name])
    expect(names(r.folio)).toEqual(['Cori'])
    expect(r.voice?.name).toBe('Cori')
    expect(r.cloudChoice).toBeNull()
  })

  it('picks the remembered device or Folio voice, and ranks again when the remembered one is gone', () => {
    expect(resolve(storageWith({ en: 'Daniel' })).voice?.name).toBe('Daniel')
    expect(resolve(storageWith({ en: 'folio:en_GB-cori-medium' }), { downloaded: [] }).voice?.name).toBe('Daniel')
    expect(resolve(storageWith({ en: 'Gone' })).voice?.name).toBe('Cori')
    const own = storageWith({ [voiceChoiceKey('en', true)]: 'Daniel' })
    expect(resolve(own, { privateBook: true }).voice?.name).toBe('Daniel')
  })

  it('reports a remembered cloud voice, with the best device or Folio voice to fall back on', () => {
    const r = resolve(storageWith({ en: 'elevenlabs:Aria01' }))
    expect(r.cloudChoice).toBe('elevenlabs:Aria01')
    expect(r.voice?.name).toBe('Cori')
    expect(resolve(storageWith({ en: 'elevenlabs:Aria01' }), { privateBook: true }).cloudChoice).toBeNull()
  })
})
