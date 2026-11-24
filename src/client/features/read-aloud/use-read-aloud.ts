import { isNotFound } from '@tanstack/react-router'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '~/client/components/Toast'
import { browserStorage } from '~/client/features/ask/thread-store'
import { isNetworkFailure } from '~/client/features/offline/network'
import { speechFromCopy } from '~/client/features/offline/offline-reader'
import { noteFinished } from '~/client/features/reading-stats/finish'
import { syncOutbox } from '~/client/features/sync/outbox'
import { getSpeechVoices } from '~/server/account-functions'
import { getSpeechChapter } from '~/server/functions'
import { type Aside, createAside, forwardAside } from './aside'
import { type AudioLike, createCloudSpeaker } from './cloud-speaker'
import { closedState, createReadAloud, type FetchResult, type ReadAloud, type ReadAloudState } from './controller'
import { createLocalSpeaker } from './local-speaker'
import type { DownloadNotice } from './messages'
import { createEngine, type WorkerLike } from './piper/engine'
import { ENGINE_FILES, ENGINE_URLS, WORKER_URL } from './piper/engine-files'
import { canRunPiper } from './piper/support'
import { createVoiceStore } from './piper/voice-store'
import { type SavedPosition, voiceItem } from './position-store'
import { createSpeaker, type Speaker, type SynthLike, type UtteranceLike } from './speaker'
import { loadCloudVoices, speak } from './speech-client'
import { loadVoices, type VoiceSource } from './voices'
import { wordMark } from './word-mark'

export type ReadAloudApi = Omit<ReadAloud, 'state'> & ReadAloudState & { supported: boolean; aside: Aside }

const IDLE = closedState(1)

const queueSaved = (book: string, saved: Omit<SavedPosition, 'v'> | null) =>
  syncOutbox.add(voiceItem(browserStorage(), book, saved, Date.now()))

async function fetchChapter(book: string, chapter: number): Promise<FetchResult> {
  try {
    return { ok: true, data: await getSpeechChapter({ data: { book, chapter } }) }
  } catch (error) {
    if (isNetworkFailure(error)) {
      const copy = await speechFromCopy(book, chapter).catch(() => null)
      if (copy) return { ok: true, data: copy }
    }
    return { ok: false, reason: isNotFound(error) ? 'not-found' : 'failed' }
  }
}

export function useReadAloud(
  onSleep: () => void,
  speech: RefObject<HTMLAudioElement | null>,
  signedIn: boolean,
  onNotice: (notice: DownloadNotice) => void = () => {},
  onPlaying: (on: boolean) => void = () => {},
  onClosed: () => void = () => {},
): ReadAloudApi {
  const [state, setState] = useState<ReadAloudState>(IDLE)
  const [supported, setSupported] = useState(false)
  const controller = useRef<ReadAloud | null>(null)
  const aside = useRef<Aside | null>(null)
  const sleepRef = useRef(onSleep)
  sleepRef.current = onSleep
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice
  const playingRef = useRef(onPlaying)
  playingRef.current = onPlaying
  const closedRef = useRef(onClosed)
  closedRef.current = onClosed
  const toast = useToast()
  const finishRef = useRef({ signedIn, toast })
  finishRef.current = { signedIn, toast }

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance !== 'function') return
    const synth = speechSynthesis
    const element = signedIn ? speech.current : null
    const cloudSpeaker =
      element &&
      createCloudSpeaker({
        audio: element as unknown as AudioLike,
        speak,
        onWord: wordMark.set,
      })
    const local = speech.current && canRunPiper() ? speech.current : null
    const engine =
      local && createEngine(() => new Worker(WORKER_URL, { type: 'module' }) as unknown as WorkerLike, ENGINE_FILES)
    const localSpeaker =
      local &&
      engine &&
      createLocalSpeaker({
        audio: local as unknown as AudioLike,
        engine,
        onSlow: () => controller.current?.noteSlow(),
      })
    const voiceStore =
      local &&
      createVoiceStore({ caches: globalThis.caches ?? null, storage: browserStorage(), engineUrls: ENGINE_URLS })
    const speaker: Speaker = createSpeaker(
      synth as unknown as SynthLike,
      (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    )
    const voices = () => loadVoices(synth as unknown as VoiceSource)
    controller.current = createReadAloud({
      speaker,
      loadVoices: voices,
      fetchChapter,
      storage: browserStorage(),
      onState: (next) => {
        setState(next)
        playingRef.current(next.status === 'playing')
      },
      onSleep: () => sleepRef.current(),
      locale: navigator.language,
      onSaved: (book, saved) => {
        queueSaved(book, saved)
        if (saved === null) {
          void noteFinished(book, controller.current?.state().book?.title ?? book, finishRef.current)
        }
      },
      onNotice: (notice) => noticeRef.current(notice),
      onClosed: () => closedRef.current(),
      ...(localSpeaker && voiceStore ? { localSpeaker, voiceStore } : {}),
      ...(cloudSpeaker
        ? {
            cloudSpeaker,
            loadCloudVoices: (book: string) => loadCloudVoices(book, (b) => getSpeechVoices({ data: { book: b } })),
          }
        : {}),
    })
    aside.current = createAside({
      speaker,
      ...(localSpeaker ? { localSpeaker } : {}),
      loadVoices: voices,
      downloaded: () => voiceStore?.downloaded() ?? Promise.resolve([]),
      storage: browserStorage(),
      locale: navigator.language,
      pauseBook: () => controller.current?.pause(),
    })
    setState(controller.current.state())
    setSupported(true)
    return () => {
      aside.current?.stop()
      aside.current = null
      controller.current?.close()
      engine?.terminate()
    }
  }, [signedIn, speech])

  const actions = useMemo(() => {
    const call =
      <K extends keyof ReadAloud>(name: K) =>
      (...args: Parameters<ReadAloud[K]>) =>
        (controller.current?.[name] as ((...a: Parameters<ReadAloud[K]>) => void) | undefined)?.(...args)
    return {
      start: call('start'),
      toggle: call('toggle'),
      pause: call('pause'),
      nextSentence: call('nextSentence'),
      prevSentence: call('prevSentence'),
      nextChapter: call('nextChapter'),
      prevChapter: call('prevChapter'),
      toChapter: call('toChapter'),
      seekFraction: call('seekFraction'),
      setRate: call('setRate'),
      setVoice: call('setVoice'),
      useDeviceVoice: call('useDeviceVoice'),
      retryCloudVoices: call('retryCloudVoices'),
      downloadLocal: call('downloadLocal'),
      cancelDownload: call('cancelDownload'),
      removeLocal: call('removeLocal'),
      dismissOffer: call('dismissOffer'),
      noteSlow: call('noteSlow'),
      setFollowing: call('setFollowing'),
      stopAfterSentence: call('stopAfterSentence'),
      setStopAtChapterEnd: call('setStopAtChapterEnd'),
      retry: call('retry'),
      close: call('close'),
      aside: forwardAside(() => aside.current),
    }
  }, [])

  return useMemo(() => ({ ...state, ...actions, supported }), [state, actions, supported])
}
