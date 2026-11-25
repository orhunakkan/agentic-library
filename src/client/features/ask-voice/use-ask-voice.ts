import { useEffect, useRef, useState } from 'react'
import type { useAsk } from '~/client/features/ask/use-ask'
import { usePlayer } from '~/client/features/player/PlayerProvider'
import { browserTimers } from '~/client/features/read-aloud/speaker'
import { languageName } from '~/client/features/read-aloud/voices'
import { browserStorage } from '~/client/lib/storage-keys'
import { browserRecognition, createRecognition, vendorOf } from './recognition'
import { type AnswerOutcome, createVoiceSession, type VoiceSession } from './voice-session'

type AskState = ReturnType<typeof useAsk>

export interface AskVoiceOptions {
  ask: AskState
  lang: string
  privateBook: boolean
  active: boolean
  send: (text: string) => void
}

export function useAskVoice({ ask, lang, privateBook, active, send }: AskVoiceOptions) {
  const { readAloud } = usePlayer()
  const latest = useRef({ ask, send, aside: readAloud.aside })
  latest.current = { ask, send, aside: readAloud.aside }
  const [session] = useState<VoiceSession>(() => {
    const ctor = browserRecognition()
    return createVoiceSession({
      recognition: ctor && createRecognition({ ctor, timers: browserTimers }),
      aside: () => latest.current.aside,
      storage: browserStorage(),
      send: (text) => latest.current.send(text),
      stopAnswer: () => latest.current.ask.stop(),
      busy: () => latest.current.ask.busy,
      onState: (next) => setState(next),
    })
  })
  const [state, setState] = useState(session.state)
  const [browser, setBrowser] = useState<{ supported: boolean; vendor: ReturnType<typeof vendorOf> }>({
    supported: false,
    vendor: null,
  })

  useEffect(() => {
    setBrowser({ supported: browserRecognition() !== null, vendor: vendorOf(navigator.userAgent) })
    return session.reset
  }, [session])
  useEffect(() => session.setBook(lang, privateBook), [session, lang, privateBook])
  useEffect(() => {
    if (!active) session.reset()
  }, [session, active])

  useEffect(() => {
    const last = ask.thread.turns.at(-1)
    const lastAnswer = last?.role === 'assistant' ? last : null
    let outcome: AnswerOutcome = 'done'
    if (ask.failure) outcome = 'failed'
    else if (lastAnswer?.stopped) outcome = 'stopped'
    session.answer(ask.pending?.text ?? null, outcome, lastAnswer?.text ?? null)
  }, [session, ask.pending, ask.failure, ask.thread])

  const listening = state.turn.phase === 'listening'
  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      session.cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, session])

  return {
    ...state,
    ...browser,
    canListen: readAloud.supported,
    language: languageName(lang),
    press: session.press,
    probe: session.probe,
    listen: session.listen,
    reset: session.reset,
    setConsented: session.setConsented,
    setSpeak: session.setSpeak,
    download: session.download,
    useOnline: session.useOnline,
    notNow: session.notNow,
    consent: session.consent,
    decline: session.decline,
    cancel: session.cancel,
    stopSpeaking: session.stopSpeaking,
    typedSend: session.typedSend,
  }
}

export type AskVoice = ReturnType<typeof useAskVoice>
