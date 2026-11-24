import { hourlyCost, resolveSpeechModel } from '~/shared/lib/speech-models'
import { type CloudVoice, primarySubtag, rankCloudVoices as rankCloud } from '~/shared/read-aloud/cloud'
import { type FolioVoice, folioVoicesFor } from '~/shared/read-aloud/folio-voices'
import { CLOUD_VOICE_PREFIX } from './cloud-speaker'
import { LOCAL_VOICE_PREFIX } from './local-speaker'
import { rememberedVoice } from './position-store'

export interface VoiceLike {
  name: string
  lang: string
  voiceURI: string
  localService: boolean
  default: boolean
  engine?: 'device' | 'cloud' | 'local'
  labels?: string | null
}

export interface VoiceSource {
  getVoices: () => VoiceLike[]
  addEventListener: (type: 'voiceschanged', listener: () => void) => void
  removeEventListener: (type: 'voiceschanged', listener: () => void) => void
}

export const VOICES_WAIT_MS = 2000

export function loadVoices(
  synth: VoiceSource,
  wait: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): Promise<VoiceLike[]> {
  const now = synth.getVoices()
  if (now.length > 0) return Promise.resolve(now)
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      synth.removeEventListener('voiceschanged', finish)
      resolve(synth.getVoices())
    }
    synth.addEventListener('voiceschanged', finish)
    wait(finish, VOICES_WAIT_MS)
  })
}

function tagParts(tag: string): { base: string; region: string | null } {
  const [base = '', ...rest] = tag.replace(/_/g, '-').toLowerCase().split('-')
  return { base, region: rest.find((p) => /^[a-z]{2}$|^\d{3}$/.test(p)) ?? null }
}

const QUALITY = /\b(natural|neural|premium|enhanced|online)\b/i

export function rankVoices(
  voices: readonly VoiceLike[],
  lang: string,
  options: { privateBook: boolean; locale?: string },
): VoiceLike[] {
  const book = tagParts(lang)
  const reader = tagParts(options.locale ?? '')
  const region = book.region ?? (reader.base === book.base ? reader.region : null)
  const score = (v: VoiceLike) => {
    const parts = tagParts(v.lang)
    return [
      options.privateBook && !v.localService ? 1 : 0,
      region && parts.region === region ? 0 : 1,
      QUALITY.test(v.name) ? 0 : 1,
      /google/i.test(v.name) ? 0 : 1,
      v.default ? 0 : 1,
    ]
  }
  return voices
    .filter((v) => tagParts(v.lang).base === book.base)
    .map((voice, order) => ({ voice, order, score: score(voice) }))
    .sort((a, b) => {
      for (let i = 0; i < a.score.length; i++) {
        const d = (a.score[i] ?? 0) - (b.score[i] ?? 0)
        if (d !== 0) return d
      }
      return a.order - b.order
    })
    .map((r) => r.voice)
}

export function pickVoice(ranked: readonly VoiceLike[], remembered: string | undefined): VoiceLike | null {
  return ranked.find((v) => v.voiceURI === remembered) ?? ranked[0] ?? null
}

export function vendorOf(voice: Pick<VoiceLike, 'name' | 'voiceURI'>): 'Google' | 'Microsoft' | 'Apple' | null {
  const id = `${voice.name} ${voice.voiceURI}`
  if (/google/i.test(id)) return 'Google'
  if (/microsoft/i.test(id)) return 'Microsoft'
  if (/apple|siri/i.test(id)) return 'Apple'
  return null
}

export function onlineNote(voice: VoiceLike): string | null {
  return voice.localService ? null : `Online: the text is sent to ${vendorOf(voice) ?? 'its maker'} to be spoken`
}

export function regionName(lang: string): string | null {
  const { region } = tagParts(lang)
  return region ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(region.toUpperCase()) ?? null) : null
}

export function languageName(lang: string): string {
  const { base } = tagParts(lang)
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(base) ?? lang
  } catch {
    return lang
  }
}

export function voiceName(voice: Pick<VoiceLike, 'name'>): string {
  return voice.name.replace(/\s+-\s+[^-]+\([^)]*\)\s*$/, '').trim() || voice.name
}

export const isCloudVoice = (voice: Pick<VoiceLike, 'engine'> | null | undefined) => voice?.engine === 'cloud'

export const isLocalVoice = (voice: Pick<VoiceLike, 'engine'> | null | undefined) => voice?.engine === 'local'

export function folioVoiceLike(voice: FolioVoice): VoiceLike {
  return {
    name: voice.name,
    lang: voice.lang,
    voiceURI: `${LOCAL_VOICE_PREFIX}${voice.id}`,
    localService: true,
    default: false,
    engine: 'local',
    labels: [regionName(voice.lang), voice.gender].filter(Boolean).join(' · ') || null,
  }
}

export function rankLocalVoices(downloaded: readonly FolioVoice[], lang: string, locale?: string): VoiceLike[] {
  const ids = new Set(downloaded.map((v) => v.id))
  return folioVoicesFor(lang, locale)
    .filter((v) => ids.has(v.id))
    .map(folioVoiceLike)
}

export interface VoiceResolution {
  voice: VoiceLike | null
  device: VoiceLike[]
  folio: VoiceLike[]
  cloudChoice: string | null
}

/** Picks the remembered device or Folio voice, else the best ranked one; a remembered cloud voice is reported as `cloudChoice`, for a caller that can wait for the cloud voice list. */
export function resolveVoice(input: {
  voices: readonly VoiceLike[]
  downloaded: readonly FolioVoice[]
  lang: string
  privateBook: boolean
  locale?: string
  storage: Storage | null
}): VoiceResolution {
  const { lang, privateBook, locale } = input
  const device = rankVoices(input.voices, lang, { privateBook, locale })
  const folio = rankLocalVoices(input.downloaded, lang, locale)
  const remembered = rememberedVoice(input.storage, primarySubtag(lang), privateBook)
  const cloudChoice = remembered?.startsWith(CLOUD_VOICE_PREFIX) ? remembered : null
  return { voice: pickVoice([...folio, ...device], cloudChoice ? undefined : remembered), device, folio, cloudChoice }
}

const capitalised = (text: string) =>
  text.replace(/(^|[\s-])(\p{L})/gu, (_m, lead: string, c: string) => lead + c.toUpperCase())

export function rankCloudVoices(voices: readonly CloudVoice[], lang: string): VoiceLike[] {
  return rankCloud(voices, lang).map((v) => ({
    name: v.name,
    lang,
    voiceURI: `${CLOUD_VOICE_PREFIX}${v.id}`,
    localService: false,
    default: false,
    engine: 'cloud',
    labels: [v.accent && capitalised(v.accent), v.gender].filter(Boolean).join(' · ') || null,
  }))
}

export function cloudNote(model: string | null): string {
  return `Online: sent to ElevenLabs on your key · ${hourlyCost(resolveSpeechModel(model))} an hour`
}
