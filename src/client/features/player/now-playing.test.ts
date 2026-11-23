import { describe, expect, it } from 'vitest'
import type { ReadAloudState } from '~/client/features/read-aloud/controller'
import type { PlayerBook, PlayerEpisode } from '~/shared/content/book-page'
import type { SpeechBook } from '~/shared/read-aloud/speech-text'
import { bookmarkKind, bookmarkPlay, momentOf, type NowPlaying, nowPlaying, partsOf } from './now-playing'
import type { TransportState } from './transport'

const book: PlayerBook = {
  slug: 'time-machine',
  title: 'The Time Machine',
  author: 'H. G. Wells',
  href: '/library/wells/time-machine',
  coverUrl: '/covers/time-machine.jpg',
  cover: {} as PlayerBook['cover'],
  image: null,
}
const speechBook: SpeechBook = { ...book, slug: 'emerson', language: 'en', chapterTitles: ['History', 'Self'] }
const episodes: PlayerEpisode[] = [
  {
    id: 'e1',
    number: 1,
    title: 'The Coming',
    durationMs: 8 * 60_000,
    audioUrl: '/a/1.mp3',
    startMs: 0,
    pageHref: null,
  },
  {
    id: 'e2',
    number: 2,
    title: 'The Going',
    durationMs: 75 * 60_000,
    audioUrl: '/a/2.mp3',
    startMs: 0,
    pageHref: null,
  },
]

const idleAudio: TransportState = {
  book: null,
  episodes: [],
  current: null,
  playing: false,
  positionMs: 0,
  durationMs: 0,
  speed: 1,
  hasPrev: false,
  hasNext: false,
}
const audio: TransportState = { ...idleAudio, book, episodes, current: episodes[1] ?? null, positionMs: 12_345_678 }

const idleVoice = {
  book: null,
  chapter: null,
  page: null,
  utterance: null,
  status: 'paused',
} as unknown as ReadAloudState
const page = { index: 1, href: '/read/emerson/self/2', label: 'Ch. 2 · p. 2', position: { chapter: 'self', page: 2 } }
const voice = {
  ...idleVoice,
  book: speechBook,
  chapter: { index: 1, slug: 'self', title: 'Self', number: 2, chapterCount: 2 },
  page,
  utterance: { start: 140, end: 200 },
  status: 'playing',
  engine: 'local',
} as ReadAloudState

describe('nowPlaying', () => {
  it('is the audiobook first, then the voice, then nothing', () => {
    expect(nowPlaying(audio, voice)).toMatchObject({ source: 'audio', book, episode: episodes[1], playing: false })
    expect(nowPlaying(idleAudio, voice)).toMatchObject({
      source: 'speech',
      book: speechBook,
      engine: 'local',
      playing: true,
    })
    expect(nowPlaying(idleAudio, idleVoice)).toEqual({ source: null })
  })

  it('says the voice is not playing unless its status is', () => {
    expect(nowPlaying(idleAudio, { ...voice, status: 'loading' } as ReadAloudState)).toMatchObject({ playing: false })
  })
})

describe('momentOf', () => {
  it("is the voice's sentence", () => {
    expect(momentOf(nowPlaying(idleAudio, voice))).toEqual({
      request: { book: 'emerson', kind: 'voice', position: { chapter: 'self', page: 2 }, offset: 140 },
      view: {
        kind: 'voice',
        opening: '',
        place: {
          chapterIndex: 1,
          chapterTitle: 'Self',
          chapter: 'self',
          page: 2,
          pageHref: '/read/emerson/self/2',
          label: 'Ch. 2 · p. 2',
          position: 0,
          start: 140,
        },
      },
      label: 'Ch. 2 · p. 2',
    })
  })

  it("is offset 0 of the page while the chapter's title is said, and a printed page by its number", () => {
    const printed = { ...voice, utterance: null, page: { ...page, label: 'p. 112', position: { printedPage: 112 } } }
    const moment = momentOf(nowPlaying(idleAudio, printed as ReadAloudState))
    expect(moment?.request).toEqual({ book: 'emerson', kind: 'voice', position: { printedPage: 112 }, offset: 0 })
    expect(moment?.view).toMatchObject({ place: { chapter: null, page: 112, start: 0 } })
  })

  it("is the audiobook's episode at the whole second", () => {
    expect(momentOf(nowPlaying(audio, idleVoice))).toEqual({
      request: { book: 'time-machine', kind: 'episode', episode: 'e2', positionMs: 12_345_000 },
      view: {
        kind: 'episode',
        positionMs: 12_345_000,
        episode: { id: 'e2', number: 2, title: 'The Going', durationMs: 75 * 60_000 },
      },
      label: '3:25:45',
    })
  })

  it('is nothing before the voice is at a page, or with nothing playing', () => {
    expect(momentOf(nowPlaying(idleAudio, { ...voice, page: null } as ReadAloudState))).toBeNull()
    expect(momentOf({ source: null })).toBeNull()
  })
})

describe('partsOf', () => {
  it("is the voice's chapters, the current one checked", () => {
    expect(partsOf(nowPlaying(idleAudio, voice))).toEqual({
      items: [
        { value: '0', label: '1. History' },
        { value: '1', label: '2. Self' },
      ],
      current: '1',
    })
    expect(partsOf(nowPlaying(idleAudio, { ...voice, chapter: null } as ReadAloudState)).current).toBeNull()
  })

  it("is the audiobook's episodes with their lengths", () => {
    expect(partsOf(nowPlaying(audio, idleVoice))).toEqual({
      items: [
        { value: 'e1', label: '1. The Coming · 8 min' },
        { value: 'e2', label: '2. The Going · 1 hr 15 min' },
      ],
      current: 'e2',
    })
  })

  it('is nothing with nothing playing', () => {
    expect(partsOf({ source: null })).toEqual({ items: [], current: null })
  })
})

describe('bookmarks', () => {
  const speechNow = nowPlaying(idleAudio, voice)
  const audioNow = nowPlaying(audio, idleVoice)
  const place = {
    chapterIndex: 1,
    chapterTitle: 'Self',
    chapter: 'self',
    page: 2,
    pageHref: '/read/emerson/self/2',
    label: 'Ch. 2 · p. 2',
    position: 5,
    start: 140,
  }
  const voiceMark = { kind: 'voice', id: 'v', status: 'ok', opening: 'Trust', place, createdAt: '' } as const
  const episodeMark = { kind: 'episode', id: 'p', status: 'ok', positionMs: 60_000, createdAt: '' } as const
  const ep = { id: 'e1', number: 1, title: 'The Coming', durationMs: 8 * 60_000 }

  it('shows the kind that is playing', () => {
    expect(bookmarkKind(speechNow)).toBe('voice')
    expect(bookmarkKind(audioNow)).toBe('episode')
    expect(bookmarkKind({ source: null })).toBeNull()
  })

  it('plays a voice bookmark from its sentence, and a printed page by its number', () => {
    expect(bookmarkPlay(speechNow, voiceMark)).toEqual({
      kind: 'voice',
      book: 'emerson',
      at: { kind: 'offset', chapter: 1, position: { chapter: 'self', page: 2 }, offset: 140 },
    })
    const printed = { ...voiceMark, place: { ...place, chapter: null, page: 112 } }
    expect(bookmarkPlay(speechNow, printed)).toMatchObject({ at: { position: { printedPage: 112 } } })
  })

  it('plays an episode bookmark from its time', () => {
    expect(bookmarkPlay(audioNow, { ...episodeMark, episode: ep })).toEqual({
      kind: 'episode',
      episodeId: 'e1',
      positionMs: 60_000,
    })
  })

  it('plays nothing found nowhere, or of the other source', () => {
    const now: NowPlaying = speechNow
    expect(bookmarkPlay(now, { ...voiceMark, place: null })).toBeNull()
    expect(bookmarkPlay(audioNow, { ...episodeMark, episode: null })).toBeNull()
    expect(bookmarkPlay(audioNow, voiceMark)).toBeNull()
    expect(bookmarkPlay(speechNow, { ...episodeMark, episode: ep })).toBeNull()
  })
})
