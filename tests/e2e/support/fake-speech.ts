import type { Page } from '@playwright/test'

export interface FakeVoice {
  name: string
  lang: string
  localService: boolean
  default?: boolean
}

export interface FakeSpeechOptions {
  voices?: FakeVoice[]
  none?: boolean
}

const MS_PER_CHAR = 10

export const DEVICE_VOICE: FakeVoice = { name: 'Device English', lang: 'en-US', localService: true, default: true }
export const ONLINE_VOICE: FakeVoice = { name: 'Google US English', lang: 'en-US', localService: false }

export interface Spoken {
  text: string
  lang: string
  rate: number
  voice: string | null
}

declare global {
  interface Window {
    __speech: Spoken[]
    __speechFail: number
    __speechHang: boolean
  }
}

export async function fakeSpeech(page: Page, options: FakeSpeechOptions = {}) {
  await page.addInitScript(install, {
    voices: options.voices ?? [DEVICE_VOICE, ONLINE_VOICE],
    msPerChar: MS_PER_CHAR,
    none: options.none ?? false,
  })
}

export const spoken = (page: Page) => page.evaluate(() => window.__speech.map((s) => s.text))

export const lastSpoken = async (page: Page) => (await spoken(page)).at(-1)

export const hang = (page: Page, on = true) => page.evaluate((v) => (window.__speechHang = v), on)

export const marked = (page: Page) =>
  page.evaluate(() => {
    const highlight = CSS.highlights.get('ra-sentence')
    return highlight ? [...highlight].map((r) => r.toString()).join('') : null
  })

function install({ voices, msPerChar, none }: { voices: FakeVoice[]; msPerChar: number; none: boolean }) {
  if (none) {
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true })
    return
  }
  window.__speech = []
  window.__speechFail = 0
  window.__speechHang = false
  const list = voices.map((v) => ({ ...v, voiceURI: v.name, default: v.default ?? false }))

  class FakeUtterance extends EventTarget {
    text: string
    lang = ''
    rate = 1
    pitch = 1
    volume = 1
    voice: { name: string } | null = null
    onstart: ((e: Event) => void) | null = null
    onend: ((e: Event) => void) | null = null
    onerror: ((e: Event) => void) | null = null
    constructor(text = '') {
      super()
      this.text = text
    }
    fire(type: 'start' | 'end' | 'error', error?: string) {
      const event = Object.assign(new Event(type), { error, utterance: this })
      this[`on${type}`]?.(event)
      this.dispatchEvent(event)
    }
  }

  let current: { utterance: FakeUtterance; timers: number[] } | null = null
  const listeners = new EventTarget()
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    getVoices: () => list,
    speak(utterance: FakeUtterance) {
      window.__speech.push({
        text: utterance.text,
        lang: utterance.lang,
        rate: utterance.rate,
        voice: utterance.voice?.name ?? null,
      })
      const timers: number[] = []
      current = { utterance, timers }
      synth.speaking = true
      if (window.__speechFail > 0) {
        window.__speechFail--
        timers.push(window.setTimeout(() => utterance.fire('error', 'synthesis-failed'), 10))
        return
      }
      timers.push(window.setTimeout(() => utterance.fire('start'), 0))
      if (window.__speechHang) return
      const ms = (utterance.text.length * msPerChar) / (utterance.rate || 1)
      timers.push(
        window.setTimeout(() => {
          if (current?.utterance === utterance) current = null
          synth.speaking = false
          utterance.fire('end')
        }, ms),
      )
    },
    cancel() {
      if (!current) return
      const { utterance, timers } = current
      current = null
      synth.speaking = false
      for (const t of timers) window.clearTimeout(t)
      utterance.fire('error', 'interrupted')
    },
    pause() {},
    resume() {},
    addEventListener: (type: string, fn: EventListener) => listeners.addEventListener(type, fn),
    removeEventListener: (type: string, fn: EventListener) => listeners.removeEventListener(type, fn),
  }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true })
}
