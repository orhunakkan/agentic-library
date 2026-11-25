import type { Aside, AsideHandlers } from '~/client/features/read-aloud/aside'
import { answerSpeech, createSpeechFeed, type SpeechFeed } from './answer-speech'
import type { Mode, Recognition, Session } from './recognition'
import {
  elevenLabsNoteSeen,
  markElevenLabsNoteSeen,
  onlineAgreed,
  setOnlineAgreed,
  setSpeakAnswers,
  speakAnswers,
} from './voice-prefs'
import { type Effect, IDLE, step, type VoiceEvent, type VoiceTurn } from './voice-turn'

export interface VoiceState {
  turn: VoiceTurn
  mode: Mode | null
  online: boolean
  consented: boolean
  speak: boolean
  elevenLabsNote: boolean
}

export interface VoiceSessionDeps {
  recognition: Recognition | null
  aside: () => Aside
  storage: Storage | null
  send: (text: string) => void
  stopAnswer: () => void
  busy: () => boolean
  onState: (state: VoiceState) => void
}

export type AnswerOutcome = 'done' | 'failed' | 'stopped'

export interface VoiceSession {
  setBook: (lang: string, privateBook: boolean) => void
  press: () => void
  probe: () => void
  dispatch: (event: VoiceEvent) => void
  download: () => void
  useOnline: () => void
  notNow: () => void
  consent: () => void
  decline: () => void
  cancel: () => void
  stopSpeaking: () => void
  typedSend: () => void
  answer: (text: string | null, outcome: AnswerOutcome, stored: string | null) => void
  listen: (index: number, text: string) => void
  reset: () => void
  setConsented: (agreed: boolean) => void
  setSpeak: (on: boolean) => void
  state: () => VoiceState
}

export function createVoiceSession(deps: VoiceSessionDeps): VoiceSession {
  const { recognition, storage, aside } = deps
  let state: VoiceState = {
    turn: IDLE,
    mode: null,
    online: false,
    consented: onlineAgreed(storage),
    speak: speakAnswers(storage),
    elevenLabsNote: false,
  }
  let lang = 'en'
  let privateBook = false
  let probed: string | null = null
  let session: Session | null = null
  let answering: { feed: SpeechFeed } | null = null

  const emit = (patch: Partial<VoiceState>) => {
    state = { ...state, ...patch }
    deps.onState(state)
  }

  const handlers: AsideHandlers = {
    onIdle: () => dispatch({ type: 'speech-idle' }),
    onFailed: () => dispatch({ type: 'speech-failed' }),
    onInterrupted: () => dispatch({ type: 'speech-interrupted' }),
  }

  const say = (utterances: string[]) => {
    aside().say(utterances, { lang, privateBook }, handlers)
    if (elevenLabsNoteSeen(storage)) return
    const asked = lang
    void aside()
      .voiceFor(lang, privateBook)
      .then(({ skippedCloud }) => {
        if (!skippedCloud || asked !== lang || elevenLabsNoteSeen(storage)) return
        markElevenLabsNoteSeen(storage)
        emit({ elevenLabsNote: true })
      })
  }

  const run = (effect: Effect) => {
    switch (effect.type) {
      case 'hush':
        aside().hush()
        return
      case 'listen':
        if (!recognition) return
        session = recognition.listen(lang, {
          local: effect.local,
          onInterim: (text) => dispatch({ type: 'interim', text }),
          onFinal: (text) => {
            session = null
            dispatch({ type: 'final', text })
          },
          onError: (code) => {
            session = null
            dispatch({ type: 'recognition-error', code })
          },
        })
        return
      case 'stop-listening':
        session?.stop()
        return
      case 'abort-listening':
        session?.abort()
        session = null
        return
      case 'install': {
        if (!recognition) return
        const asked = lang
        void recognition.install(lang).then((ok) => {
          if (asked !== lang) return
          if (ok) emit({ mode: 'local' })
          dispatch({ type: 'installed', ok })
        })
        return
      }
      case 'consented':
        setOnlineAgreed(storage, true)
        emit({ consented: true })
        return
      case 'send':
        if (deps.busy()) {
          dispatch({ type: 'answer-end', outcome: 'failed', utterances: [], speak: state.speak })
          return
        }
        answering = { feed: createSpeechFeed(lang) }
        deps.send(effect.text)
        return
      case 'say':
        say(effect.utterances)
        return
      case 'append':
        aside().append(effect.utterances)
        return
      case 'stop-speaking':
        aside().stop()
        return
      case 'stop-answer':
        deps.stopAnswer()
        return
    }
  }

  function dispatch(event: VoiceEvent) {
    const next = step(state.turn, event)
    if (next.turn !== state.turn) emit({ turn: next.turn })
    for (const effect of next.effects) run(effect)
  }

  const probe = () => {
    if (!recognition || probed === lang) return
    const asked = lang
    probed = asked
    void recognition.mode(asked).then((mode) => asked === lang && emit({ mode }))
    void recognition.online(asked).then((online) => asked === lang && emit({ online }))
  }

  const reset = () => {
    answering = null
    if (state.elevenLabsNote) emit({ elevenLabsNote: false })
    dispatch({ type: 'reset' })
  }

  return {
    setBook: (nextLang, nextPrivate) => {
      if (nextLang === lang && nextPrivate === privateBook) return
      reset()
      lang = nextLang
      privateBook = nextPrivate
      probed = null
      emit({ mode: null, online: false })
    },
    press: () => {
      if (!recognition) return
      probe()
      if (state.elevenLabsNote) emit({ elevenLabsNote: false })
      aside().hush()
      const go = (mode: Mode) => dispatch({ type: 'press', mode, consented: onlineAgreed(storage) })
      if (state.mode) go(state.mode)
      else {
        const asked = lang
        void recognition.mode(asked).then((mode) => asked === lang && go(mode))
      }
    },
    probe,
    dispatch,
    download: () => dispatch({ type: 'download' }),
    useOnline: () => dispatch({ type: 'use-online', consented: onlineAgreed(storage) }),
    notNow: () => dispatch({ type: 'not-now' }),
    consent: () => dispatch({ type: 'consent' }),
    decline: () => dispatch({ type: 'decline' }),
    cancel: () => dispatch({ type: 'cancel' }),
    stopSpeaking: () => dispatch({ type: 'stop-speaking' }),
    typedSend: () => dispatch({ type: 'typed-send' }),
    answer: (text, outcome, stored) => {
      const mine = answering
      if (!mine) return
      if (text !== null) {
        dispatch({ type: 'answer-text', utterances: mine.feed.push(text), speak: state.speak })
        return
      }
      answering = null
      const rest = outcome === 'done' && stored !== null ? [...mine.feed.push(stored), ...mine.feed.end()] : []
      dispatch({ type: 'answer-end', outcome, utterances: rest, speak: state.speak })
    },
    listen: (index, text) => {
      const turn = state.turn
      if (turn.phase === 'speaking' && turn.listen === index) dispatch({ type: 'stop-speaking' })
      else dispatch({ type: 'listen-answer', index, utterances: answerSpeech(text, lang) })
    },
    reset,
    setConsented: (agreed) => {
      setOnlineAgreed(storage, agreed)
      emit({ consented: agreed })
    },
    setSpeak: (on) => {
      setSpeakAnswers(storage, on)
      emit({ speak: on })
    },
    state: () => state,
  }
}
