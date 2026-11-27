import type { FolioVoice } from '~/shared/read-aloud/folio-voices'
import { LOOK_AHEAD, MAX_FAILURES } from './controller'
import { readSpeed } from './position-store'
import { type Speaker, speakersFor } from './speaker'
import { resolveVoice, type VoiceLike } from './voices'

export interface AsideDeps {
  speaker: Speaker
  localSpeaker?: Speaker
  loadVoices: () => Promise<VoiceLike[]>
  downloaded: () => Promise<readonly FolioVoice[]>
  storage: Storage | null
  locale?: string
  pauseBook: () => void
}

export interface AsideVoice {
  voice: VoiceLike | null
  skippedCloud: boolean
}

export interface AsideHandlers {
  onIdle: () => void
  onFailed: () => void
  onInterrupted: () => void
}

export interface Aside {
  voiceFor: (lang: string, privateBook: boolean) => Promise<AsideVoice>
  hush: () => void
  say: (utterances: readonly string[], book: { lang: string; privateBook: boolean }, handlers: AsideHandlers) => void
  append: (utterances: readonly string[]) => void
  stop: () => void
  interrupt: () => void
  active: () => boolean
}

const NO_VOICE: AsideVoice = { voice: null, skippedCloud: false }

export function forwardAside(get: () => Aside | null): Aside {
  return {
    voiceFor: (lang, privateBook) => get()?.voiceFor(lang, privateBook) ?? Promise.resolve(NO_VOICE),
    hush: () => get()?.hush(),
    say: (utterances, book, handlers) => get()?.say(utterances, book, handlers),
    append: (utterances) => get()?.append(utterances),
    stop: () => get()?.stop(),
    interrupt: () => get()?.interrupt(),
    active: () => get()?.active() ?? false,
  }
}

interface Run {
  queue: string[]
  at: number
  voice: AsideVoice | null
  lang: string
  speaking: boolean
  failures: number
  handlers: AsideHandlers
}

export function createAside(deps: AsideDeps): Aside {
  let run: Run | null = null

  const voiceFor = async (lang: string, privateBook: boolean): Promise<AsideVoice> => {
    const [voices, downloaded] = await Promise.all([
      deps.loadVoices().catch((): VoiceLike[] => []),
      deps.localSpeaker ? deps.downloaded().catch((): FolioVoice[] => []) : Promise.resolve([]),
    ])
    const { voice, cloudChoice } = resolveVoice({
      voices,
      downloaded,
      lang,
      privateBook,
      locale: deps.locale,
      storage: deps.storage,
    })
    return { voice, skippedCloud: cloudChoice !== null }
  }

  const { all: speakers, speakerFor } = speakersFor({ device: deps.speaker, folio: deps.localSpeaker })

  const silence = () => {
    for (const s of speakers) s.stop()
  }

  const next = () => {
    const mine = run
    if (!mine?.voice || mine.speaking) return
    const text = mine.queue[mine.at]
    if (text === undefined) {
      mine.handlers.onIdle()
      return
    }
    mine.speaking = true
    const { voice } = mine.voice
    const done = (ok: boolean) => {
      if (run !== mine) return
      mine.speaking = false
      mine.at++
      mine.failures = ok ? 0 : mine.failures + 1
      if (mine.failures >= MAX_FAILURES) {
        run = null
        silence()
        mine.handlers.onFailed()
        return
      }
      next()
    }
    speakerFor(voice).speak(
      text,
      {
        lang: voice?.lang ?? mine.lang,
        rate: readSpeed(deps.storage),
        voice,
        ahead: mine.queue.slice(mine.at + 1, mine.at + 1 + LOOK_AHEAD).map((text) => ({ text })),
      },
      {
        onEnd: () => done(true),
        onError: () => done(false),
      },
    )
  }

  const hush = () => {
    deps.pauseBook()
    for (const s of speakers) s.prime()
  }

  const stop = () => {
    if (!run) return
    run = null
    silence()
  }

  return {
    voiceFor,
    hush,
    say: (utterances, book, handlers) => {
      stop()
      deps.pauseBook()
      const mine: Run = {
        queue: [...utterances],
        at: 0,
        voice: null,
        lang: book.lang,
        speaking: false,
        failures: 0,
        handlers,
      }
      run = mine
      void voiceFor(book.lang, book.privateBook).then((voice) => {
        if (run !== mine) return
        mine.voice = voice
        next()
      })
    },
    append: (utterances) => {
      if (!run || utterances.length === 0) return
      run.queue.push(...utterances)
      next()
    },
    stop,
    interrupt: () => {
      const mine = run
      if (!mine) return
      run = null
      mine.handlers.onInterrupted()
    },
    active: () => run !== null,
  }
}
