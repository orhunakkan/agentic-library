import type { Page } from '@playwright/test'

export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable'

export interface FakeRecognitionOptions {
  local?: Availability
  online?: Availability
  install?: boolean
}

export type Heard = { interim: string } | { final: string } | { error: string } | { hold: true }

interface Recorded {
  lang: string
  processLocally: boolean
}

declare global {
  interface Window {
    __recognition: {
      sessions: Recorded[]
      installs: number
      turns: Heard[][]
      finish: () => void
    }
  }
}

export async function withoutRecognition(page: Page) {
  await page.addInitScript(() => {
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'])
      Object.defineProperty(window, name, { value: undefined, configurable: true, writable: true })
  })
}

export async function fakeRecognition(page: Page, options: FakeRecognitionOptions = {}) {
  await page.addInitScript(install, {
    local: options.local ?? null,
    online: options.online ?? 'available',
    install: options.install ?? true,
  })
}

export const willHear = (page: Page, ...steps: Heard[]) =>
  page.evaluate((s) => window.__recognition.turns.push(s), steps)

export const speechEnds = (page: Page) => page.evaluate(() => window.__recognition.finish())

export const sessions = (page: Page) => page.evaluate(() => window.__recognition.sessions)

function install({ local, online, install }: { local: Availability | null; online: Availability; install: boolean }) {
  const STEP_MS = 60
  let holding: (() => void) | null = null
  window.__recognition = {
    sessions: [],
    installs: 0,
    turns: [],
    finish: () => holding?.(),
  }

  class FakeRecognition extends EventTarget {
    lang = ''
    interimResults = false
    continuous = false
    maxAlternatives = 1
    processLocally = false
    onstart: ((e: Event) => void) | null = null
    onaudiostart: ((e: Event) => void) | null = null
    onresult: ((e: Event) => void) | null = null
    onerror: ((e: Event) => void) | null = null
    onend: ((e: Event) => void) | null = null
    heard_ = ''
    done_ = false
    timers_: number[] = []

    fire_(type: string, extra: Record<string, unknown> = {}) {
      const event = Object.assign(new Event(type), extra)
      ;(this as unknown as Record<string, ((e: Event) => void) | null>)[`on${type}`]?.(event)
      this.dispatchEvent(event)
    }

    result_(text: string, isFinal: boolean) {
      this.heard_ = text
      const result = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal })
      this.fire_('result', { resultIndex: 0, results: [result] })
    }

    end_() {
      if (this.done_) return
      this.done_ = true
      holding = null
      for (const t of this.timers_) window.clearTimeout(t)
      this.fire_('end')
    }

    start() {
      window.__recognition.sessions.push({ lang: this.lang, processLocally: this.processLocally })
      const steps = window.__recognition.turns.shift() ?? [{ hold: true } as const]
      this.fire_('start')
      this.fire_('audiostart')
      let at = 0
      for (const step of steps) {
        at += STEP_MS
        this.timers_.push(
          window.setTimeout(() => {
            if (this.done_) return
            if ('interim' in step) this.result_(step.interim, false)
            else if ('final' in step) {
              this.result_(step.final, true)
              this.end_()
            } else if ('error' in step) {
              this.fire_('error', { error: step.error })
              this.end_()
            } else holding = () => this.stop()
          }, at),
        )
      }
    }

    stop() {
      if (this.done_) return
      if (this.heard_) this.result_(this.heard_, true)
      this.end_()
    }

    abort() {
      if (this.done_) return
      this.fire_('error', { error: 'aborted' })
      this.end_()
    }

    static available?: (o: { langs: string[]; processLocally: boolean }) => Promise<Availability>
    static install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>
  }

  if (local !== null) {
    FakeRecognition.available = async (o) => (o.processLocally ? local : online)
    FakeRecognition.install = (o) => {
      window.__recognition.installs++
      return new Promise((resolve) => window.setTimeout(() => resolve(install && o.langs.length > 0), 200))
    }
  }
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true })
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true })
}
