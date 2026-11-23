import type { Timers } from '~/client/features/read-aloud/speaker'

export const MAX_LISTEN_MS = 30_000
export const INSTALL_TIMEOUT_MS = 180_000
export const ERROR_GRACE_MS = 1_500

export type Mode = 'local' | 'downloadable' | 'online' | 'none'

export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable'

export interface RecognitionOptions {
  langs: string[]
  processLocally: boolean
}

interface Alternative {
  transcript: string
}

export interface ResultListLike {
  length: number
  [index: number]: { isFinal: boolean; length: number; [index: number]: Alternative }
}

export interface RecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  processLocally?: boolean
  onresult: ((event: { results: ResultListLike }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export interface RecognitionCtor {
  new (): RecognitionLike
  available?: (options: RecognitionOptions) => Promise<Availability>
  install?: (options: RecognitionOptions) => Promise<boolean>
}

export interface RecognitionDeps {
  ctor: RecognitionCtor
  timers: Timers
}

export interface ListenHandlers {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (code: string) => void
}

export interface Session {
  stop: () => void
  abort: () => void
}

export interface Recognition {
  mode: (lang: string) => Promise<Mode>
  online: (lang: string) => Promise<boolean>
  install: (lang: string) => Promise<boolean>
  listen: (lang: string, options: { local: boolean } & ListenHandlers) => Session
}

export function browserRecognition(scope: Record<string, unknown> = globalThis as never): RecognitionCtor | null {
  const ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition
  return typeof ctor === 'function' ? (ctor as RecognitionCtor) : null
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

export function heardText(results: ResultListLike): string {
  const parts: string[] = []
  for (let i = 0; i < results.length; i++) parts.push(results[i]?.[0]?.transcript ?? '')
  return collapse(parts.join(' '))
}

export function vendorOf(userAgent: string): 'Google' | 'Microsoft' | 'Apple' | null {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'Apple'
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return 'Microsoft'
  if (/Firefox\/|FxiOS|OPR\/|SamsungBrowser/.test(userAgent)) return null
  if (/Chrome\/|CriOS/.test(userAgent)) return 'Google'
  if (/Safari\//.test(userAgent) && /Macintosh/.test(userAgent)) return 'Apple'
  return null
}

export function createRecognition(deps: RecognitionDeps): Recognition {
  const { ctor, timers } = deps
  const modes = new Map<string, Promise<Mode>>()
  const onlines = new Map<string, Promise<boolean>>()
  let open: { abort: () => void } | null = null

  const ask = async (lang: string, processLocally: boolean): Promise<Availability | 'failed'> => {
    try {
      return (await ctor.available?.({ langs: [lang], processLocally })) ?? 'failed'
    } catch {
      return 'failed'
    }
  }

  const resolve = async (lang: string): Promise<Mode> => {
    if (typeof ctor.available !== 'function') return 'online'
    const local = await ask(lang, true)
    if (local === 'available') return 'local'
    if (local === 'downloadable' || local === 'downloading') return 'downloadable'
    return (await online(lang)) ? 'online' : 'none'
  }

  const online = (lang: string) => {
    let found = onlines.get(lang)
    if (!found) {
      found =
        typeof ctor.available === 'function'
          ? ask(lang, false).then((a) => a !== 'unavailable' && a !== 'failed')
          : Promise.resolve(true)
      onlines.set(lang, found)
    }
    return found
  }

  const mode = (lang: string) => {
    let found = modes.get(lang)
    if (!found) {
      found = resolve(lang)
      modes.set(lang, found)
    }
    return found
  }

  const install = (lang: string): Promise<boolean> => {
    if (typeof ctor.install !== 'function') return Promise.resolve(false)
    let asked: Promise<boolean>
    try {
      asked = ctor.install({ langs: [lang], processLocally: true }).then((ok) => ok === true)
    } catch {
      return Promise.resolve(false)
    }
    let timer: unknown
    const timeout = new Promise<boolean>((done) => {
      timer = timers.setTimeout(() => done(false), INSTALL_TIMEOUT_MS)
    })
    return Promise.race([asked.catch(() => false), timeout]).then((ok) => {
      timers.clearTimeout(timer)
      if (ok) modes.set(lang, Promise.resolve('local'))
      return ok
    })
  }

  const listen = (lang: string, options: { local: boolean } & ListenHandlers): Session => {
    open?.abort()
    const recognition = new ctor()
    recognition.lang = lang
    recognition.interimResults = true
    recognition.continuous = false
    recognition.maxAlternatives = 1
    if (options.local) recognition.processLocally = true
    let heard = ''
    let error: string | null = null
    let done = false
    let grace: unknown = null
    const cap = timers.setTimeout(() => recognition.stop(), MAX_LISTEN_MS)

    const finish = () => {
      if (done) return
      done = true
      timers.clearTimeout(cap)
      if (grace !== null) timers.clearTimeout(grace)
      if (open === session) open = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      if (error === 'aborted') return
      if (error) options.onError(error)
      else options.onFinal(heard)
    }

    recognition.onresult = (event) => {
      if (done) return
      heard = heardText(event.results)
      options.onInterim(heard)
    }
    recognition.onerror = (event) => {
      if (done) return
      error = event.error || 'failed'
      grace ??= timers.setTimeout(finish, ERROR_GRACE_MS)
    }
    recognition.onend = finish

    const session = {
      stop: () => {
        if (!done) recognition.stop()
      },
      abort: () => {
        if (done) return
        error = 'aborted'
        finish()
        recognition.abort()
      },
    }
    open = session
    try {
      recognition.start()
    } catch {
      error = 'failed'
      timers.setTimeout(finish, 0)
    }
    return session
  }

  return { mode, online, install, listen }
}
