import type { Page } from '@playwright/test'

declare global {
  interface Window {
    __piper: string[]
    __piperFail: string | null
  }
}

const MS_PER_CHAR = 10

export async function fakePiper(page: Page) {
  await page.addInitScript(install, { msPerChar: MS_PER_CHAR })
}

export const piperSaid = (page: Page) => page.evaluate(() => window.__piper)

function install({ msPerChar }: { msPerChar: number }) {
  window.__piper = []
  window.__piperFail = null
  const RealWorker = window.Worker
  if (!RealWorker) return

  const silentWav = (ms: number) => {
    const rate = 8000
    const samples = Math.max(1, Math.round((ms / 1000) * rate))
    const bytes = new Uint8Array(44 + samples * 2)
    const view = new DataView(bytes.buffer)
    const text = (at: number, s: string) => {
      for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i)
    }
    text(0, 'RIFF')
    view.setUint32(4, 36 + samples * 2, true)
    text(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, 'data')
    view.setUint32(40, samples * 2, true)
    return bytes.buffer
  }

  class FakePiper {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    private loaded: Promise<string | null> = Promise.resolve('local_failed')
    private reply(data: unknown) {
      setTimeout(() => this.onmessage?.({ data }), 0)
    }
    postMessage(message: {
      type: string
      id?: string
      text?: string
      voice?: { id: string; model: string; config: string }
    }) {
      if (message.type === 'load' && message.voice) {
        const voice = message.voice
        this.loaded = (async () => {
          const cache = (await caches.has('folio-voices-v1')) ? await caches.open('folio-voices-v1') : null
          const found = cache && (await cache.match(voice.model)) && (await cache.match(voice.config))
          return found ? null : 'local_missing'
        })()
        void this.loaded.then((code) => this.reply(code ? { type: 'error', code } : { type: 'ready', voice: voice.id }))
        return
      }
      if (message.type === 'synth' && message.id !== undefined) {
        const { id, text = '' } = message
        window.__piper.push(text)
        void this.loaded.then((code) => {
          const fail = window.__piperFail ?? code
          if (fail) this.reply({ type: 'error', id, code: fail })
          else this.reply({ type: 'audio', id, wav: silentWav(text.length * msPerChar), ms: 5 })
        })
      }
    }
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  }

  class PiperAwareWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      // biome-ignore lint/correctness/noConstructorReturn: the fake for the piper worker, the real one for the rest.
      return (String(url).includes('piper.worker') ? new FakePiper() : new RealWorker(url, options)) as PiperAwareWorker
    }
  }
  window.Worker = PiperAwareWorker as unknown as typeof Worker
}
