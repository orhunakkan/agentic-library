import { isNotFound } from '@tanstack/react-router'
import { isNetworkFailure } from '~/client/features/offline/network'
import { speechFromCopy } from '~/client/features/offline/offline-reader'
import type { ReadAloudFactory } from '~/client/features/player/player'
import { browserStorage } from '~/client/lib/storage-keys'
import { getSpeechVoices } from '~/server/account-functions'
import { getSpeechChapter } from '~/server/functions'
import type { AudioLike } from './audio-speaker'
import { createCloudSpeaker } from './cloud-speaker'
import type { FetchResult } from './controller'
import { createLocalSpeaker } from './local-speaker'
import { createEngine, type WorkerLike } from './piper/engine'
import { ENGINE_FILES, ENGINE_URLS, WORKER_URL } from './piper/engine-files'
import { canRunPiper } from './piper/support'
import { createVoiceStore } from './piper/voice-store'
import { createSpeaker, type SynthLike, type UtteranceLike } from './speaker'
import { loadCloudVoices, speak } from './speech-client'
import { loadVoices, type VoiceSource } from './voices'
import { wordMark } from './word-mark'

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

/**
 * Read aloud the way this browser can speak: its own voices always, the cloud voices once signed in,
 * and Folio's voices where Piper runs. Nothing where the browser has no speech synthesis.
 */
export function browserReadAloud(element: HTMLAudioElement | null): ReadAloudFactory {
  return (signedIn, { onSlow }) => {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance !== 'function') return null
    const synth = speechSynthesis
    const cloudElement = signedIn ? element : null
    const cloudSpeaker =
      cloudElement && createCloudSpeaker({ audio: cloudElement as unknown as AudioLike, speak, onWord: wordMark.set })
    const local = element && canRunPiper() ? element : null
    const engine =
      local && createEngine(() => new Worker(WORKER_URL, { type: 'module' }) as unknown as WorkerLike, ENGINE_FILES)
    const localSpeaker = local && engine && createLocalSpeaker({ audio: local as unknown as AudioLike, engine, onSlow })
    const voiceStore =
      local &&
      createVoiceStore({ caches: globalThis.caches ?? null, storage: browserStorage(), engineUrls: ENGINE_URLS })
    const speaker = createSpeaker(
      synth as unknown as SynthLike,
      (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    )
    const voices = () => loadVoices(synth as unknown as VoiceSource)
    return {
      controller: {
        speaker,
        loadVoices: voices,
        fetchChapter,
        locale: navigator.language,
        ...(localSpeaker && voiceStore ? { localSpeaker, voiceStore } : {}),
        ...(cloudSpeaker
          ? {
              cloudSpeaker,
              loadCloudVoices: (book: string) => loadCloudVoices(book, (b) => getSpeechVoices({ data: { book: b } })),
            }
          : {}),
      },
      aside: {
        speaker,
        ...(localSpeaker ? { localSpeaker } : {}),
        loadVoices: voices,
        downloaded: () => voiceStore?.downloaded() ?? Promise.resolve([]),
        locale: navigator.language,
      },
      dispose: () => engine?.terminate(),
    }
  }
}
