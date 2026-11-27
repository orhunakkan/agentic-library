import { expect, vi } from 'vitest'
import { page } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import { PlayerDock } from '~/client/features/player/PlayerDock'
import { PlayerProvider, usePlayer } from '~/client/features/player/PlayerProvider'
import type { ReadAloudParts } from '~/client/features/player/player'
import type { DownloadOutcome, VoiceStore } from '~/client/features/read-aloud/piper/voice-store'
import type { Speaker, SpeakHandlers } from '~/client/features/read-aloud/speaker'
import type { VoiceLike } from '~/client/features/read-aloud/voices'
import type { ChapterBook } from '~/shared/content/schema'
import { FOLIO_VOICES } from '~/shared/read-aloud/folio-voices'
import { type SpeechBook, speechChapter } from '~/shared/read-aloud/speech-text'
import { mountAt } from './router'

/** A voice the device has, as `speechSynthesis.getVoices()` lists it. */
export const deviceVoice = (name: string, lang = 'en-US', extra: Partial<VoiceLike> = {}): VoiceLike => ({
  name,
  lang,
  voiceURI: name,
  localService: true,
  default: false,
  ...extra,
})

/** A short book to read aloud: two chapters of a few sentences. */
export const ESSAYS: ChapterBook = {
  kind: 'chapter',
  slug: 'essays',
  chapters: [
    { id: 'c1', slug: 'history', title: 'History', pages: ['<p>One mind. Two minds.</p>', '<p>Three.</p>'] },
    { id: 'c2', slug: 'self-reliance', title: 'Self-Reliance', pages: ['<p>Trust thyself.</p>'] },
  ],
}

const ESSAYS_BOOK: SpeechBook = {
  slug: 'essays',
  title: 'Essays',
  author: 'Ralph Waldo Emerson',
  href: '/library/emerson/essays',
  coverUrl: '/covers/essays.svg',
  cover: { background: ['#000000', '#111111'], ink: '#ffffff', motif: 'arch' },
  image: null,
  language: 'en',
  chapterTitles: ['History', 'Self-Reliance'],
}

/** A Folio voice download in flight, which the test moves on and ends. */
export interface FakeDownload {
  id: string
  progress: (percent: number) => void
  finish: (outcome: DownloadOutcome) => void
}

/** The speech parts the player is handed in place of the browser's, and what they were asked to do. */
export interface FakeSpeech {
  parts: ReadAloudParts
  /** The texts spoken so far, in order, by any voice. */
  said: string[]
  /** The name of the voice the last text was spoken in, or null for the browser's default. */
  lastVoice: () => string | null
  /** Ends the utterance being spoken, as a speaker does when it has said it. */
  finish: () => void
  /** The Folio voice downloads started, in order. */
  downloads: FakeDownload[]
  voiceStore: VoiceStore
}

interface Speaking {
  handlers: SpeakHandlers | null
  voice: string | null
}

function fakeSpeaker(said: string[], speaking: Speaking): Speaker {
  return {
    speak: (text, options, handlers) => {
      said.push(text)
      speaking.handlers = handlers
      speaking.voice = options.voice?.name ?? null
    },
    stop: () => {
      speaking.handlers = null
    },
    prime: () => {},
    close: () => {},
  }
}

/**
 * Speech for read aloud without a real voice: the device's voices are `voices`, the book is `ESSAYS`, and with
 * `folio` the Folio voice can be downloaded, as where Piper runs. Nothing is heard: each speaker only records what
 * it was asked to say, and an utterance ends when the test calls `finish`.
 */
export function fakeSpeech({
  voices = [],
  folio = false,
  downloaded = [],
}: {
  voices?: VoiceLike[]
  folio?: boolean
  downloaded?: string[]
} = {}): FakeSpeech {
  const said: string[] = []
  const speaking: Speaking = { handlers: null, voice: null }
  const speaker = fakeSpeaker(said, speaking)
  const localSpeaker = fakeSpeaker(said, speaking)
  const onDevice = new Set(downloaded)
  const downloads: FakeDownload[] = []
  const voiceStore: VoiceStore = {
    status: async (voice) => (onDevice.has(voice.id) ? 'ready' : 'absent'),
    downloaded: async () => FOLIO_VOICES.filter((v) => onDevice.has(v.id)),
    download: (voice, onProgress, signal) =>
      new Promise((resolve) => {
        downloads.push({
          id: voice.id,
          progress: onProgress,
          finish: (outcome) => {
            if (outcome === 'ok') onDevice.add(voice.id)
            resolve(outcome)
          },
        })
        signal?.addEventListener('abort', () => resolve('cancelled'))
      }),
    remove: vi.fn(async (gone) => {
      for (const voice of gone) onDevice.delete(voice.id)
    }),
    ensureEngine: async () => {},
    engineUrls: () => [],
  }
  const loadVoices = async () => voices
  const parts: ReadAloudParts = {
    controller: {
      speaker,
      loadVoices,
      fetchChapter: async (_book, index) => {
        const chapter = speechChapter(ESSAYS, index)
        return chapter ? { ok: true, data: { book: ESSAYS_BOOK, chapter } } : { ok: false, reason: 'not-found' }
      },
      locale: 'en-US',
      ...(folio ? { localSpeaker, voiceStore } : {}),
    },
    aside: {
      speaker,
      ...(folio ? { localSpeaker } : {}),
      loadVoices,
      downloaded: () => voiceStore.downloaded(),
      locale: 'en-US',
    },
    dispose: () => {},
  }
  return {
    parts,
    said,
    lastVoice: () => speaking.voice,
    finish: () => {
      const handlers = speaking.handlers
      speaking.handlers = null
      handlers?.onEnd()
    },
    downloads,
    voiceStore,
  }
}

/** What the reader presses in the book to start reading it aloud from its first page. */
function StartReading() {
  const { readAloud } = usePlayer()
  return (
    <button
      type="button"
      onClick={() => readAloud.start('essays', { kind: 'page', chapter: 0, position: { chapter: 'history', page: 1 } })}
    >
      Read aloud
    </button>
  )
}

/** The read-aloud dock, or its sheet when opened, as the app puts them on every page, at `at`. */
export function mountReadAloud(at = '/library/emerson/essays') {
  return mountAt(
    at,
    <ToastProvider>
      <PlayerProvider>
        <StartReading />
        <PlayerDock />
      </PlayerProvider>
    </ToastProvider>,
  )
}

export const readAloudDock = page.getByRole('region', { name: 'Read aloud' })
export const readAloudSheet = page.getByRole('dialog', { name: 'Now playing' })

/** Starts reading the book aloud, and waits for the dock to show it playing. */
export async function startReading() {
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click()
  await expect.element(readAloudDock).toBeVisible()
  await expect.element(readAloudDock.getByRole('button', { name: 'Pause' })).toBeVisible()
}

/** Starts reading aloud and opens the sheet from the dock's summary of the book. */
export async function openSheet() {
  await startReading()
  await readAloudDock.getByRole('button', { name: /^Open player: / }).click()
  await expect.element(readAloudSheet).toBeVisible()
}
