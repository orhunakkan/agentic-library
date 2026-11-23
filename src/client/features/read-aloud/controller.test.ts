import { describe, expect, it, vi } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import type { ChapterBook } from '~/shared/content/schema'
import type { SpeechVoicesState } from '~/shared/read-aloud/cloud'
import { ENGINE_BYTES, FOLIO_VOICES } from '~/shared/read-aloud/folio-voices'
import { type SpeechChapterData, speechChapter } from '~/shared/read-aloud/speech-text'
import { createAside } from './aside'
import type { CloudSpeakOptions } from './cloud-speaker'
import {
  type ControllerDeps,
  createReadAloud,
  type FetchResult,
  type ReadAloudState,
  SAVE_EVERY_MS,
  type StartAt,
} from './controller'
import type { DownloadOutcome, VoiceStore } from './piper/voice-store'
import { positionKey, readPosition, SPEED_KEY, VOICE_KEY, writePosition } from './position-store'
import type { Speaker, SpeakHandlers, SpeakOptions } from './speaker'
import type { VoiceLike } from './voices'

const book: ChapterBook = {
  kind: 'chapter',
  slug: 'essays',
  chapters: [
    { id: 'c1', slug: 'history', title: 'History', pages: ['<p>One. Two.</p>', '<p>Three.</p>'] },
    { id: 'c2', slug: 'self', title: 'Self', pages: ['<p>Four.</p><pre>let x = 1</pre>'] },
  ],
}
const bookInfo = {
  slug: 'essays',
  title: 'Essays',
  author: 'Emerson',
  href: '/library/s/essays',
  coverUrl: '/covers/essays.svg',
  cover: { background: ['#000', '#111'], ink: '#fff', motif: 'arch' },
  language: 'en',
  chapterTitles: ['History', 'Self'],
} as SpeechChapterData['book']

const voice = (name: string, extra: Partial<VoiceLike> = {}): VoiceLike => ({
  name,
  lang: 'en-US',
  voiceURI: name,
  localService: true,
  default: false,
  ...extra,
})
const local = voice('Local')
const online = voice('Online (Natural)', { localService: false })

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function setup(
  options: {
    voices?: VoiceLike[]
    fetch?: (slug: string, chapter: number) => Promise<FetchResult>
    storage?: Storage
    content?: ChapterBook
    onSaved?: ControllerDeps['onSaved']
    cloud?: () => Promise<SpeechVoicesState>
  } = {},
) {
  const said: { text: string; rate: number; voice: string | null; lang: string; engine: 'device' | 'cloud' }[] = []
  const cloudSaid: (CloudSpeakOptions | undefined)[] = []
  let handlers: SpeakHandlers | null = null
  let stops = 0
  const primes = { count: 0 }
  const closes = { count: 0 }
  const speaker: Speaker = {
    speak: (text, opts, h) => {
      said.push({ text, rate: opts.rate, voice: opts.voice?.name ?? null, lang: opts.lang, engine: 'device' })
      handlers = h
    },
    stop: () => {
      stops++
      handlers = null
    },
  }
  const cloudSpeaker = options.cloud && {
    speak: (text: string, opts: SpeakOptions, h: SpeakHandlers) => {
      said.push({ text, rate: opts.rate, voice: opts.voice?.name ?? null, lang: opts.lang, engine: 'cloud' })
      cloudSaid.push(opts.cloud)
      handlers = h
    },
    stop: () => {
      handlers = null
    },
    prime: () => void primes.count++,
    close: () => void closes.count++,
  }
  const cloudLoads: string[] = []
  const content = options.content ?? book
  const fetches: number[] = []
  const fetchChapter =
    options.fetch ??
    (async (slug: string, index: number): Promise<FetchResult> => {
      fetches.push(index)
      const chapter = slug === 'essays' ? speechChapter(content, index) : null
      return chapter ? { ok: true, data: { book: bookInfo, chapter } } : { ok: false, reason: 'not-found' }
    })
  const storage = options.storage ?? memoryStorage()
  const states: ReadAloudState[] = []
  let clock = 0
  const onSleep = vi.fn()
  const ra = createReadAloud({
    speaker,
    loadVoices: async () => options.voices ?? [local, online],
    fetchChapter,
    storage,
    onState: (s) => states.push(s),
    onSleep,
    locale: 'en-US',
    now: () => clock,
    onSaved: options.onSaved,
    cloudSpeaker,
    loadCloudVoices: options.cloud
      ? (book) => {
          cloudLoads.push(book)
          return (options.cloud as () => Promise<SpeechVoicesState>)()
        }
      : undefined,
  })
  return {
    ra,
    speaker,
    said,
    cloudSaid,
    cloudLoads,
    primes,
    closes,
    texts: () => said.map((s) => s.text),
    fetches,
    storage,
    onSleep,
    state: () => ra.state(),
    stops: () => stops,
    tick: (ms: number) => {
      clock += ms
    },
    end: async () => {
      const h = handlers
      handlers = null
      h?.onEnd()
      await flush()
    },
    fail: async (error = 'synthesis-failed', retryAt?: Date) => {
      const h = handlers
      handlers = null
      if (retryAt) h?.onError(error, retryAt)
      else h?.onError(error)
      await flush()
    },
    start: async (at: StartAt, slug = 'essays') => {
      ra.start(slug, at)
      await flush()
    },
  }
}

const page = (chapter: number, slug: string, n: number): StartAt => ({
  kind: 'page',
  chapter,
  position: { chapter: slug, page: n },
})

describe('starting again', () => {
  it('keeps the book and chapter on show while a new place in the same book loads', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.start('essays', { kind: 'offset', chapter: 1, position: { chapter: 'self', page: 1 }, offset: 0 })
    expect(t.state()).toMatchObject({ status: 'loading', book: { slug: 'essays' }, chapter: { index: 0 }, page: null })
    await flush()
    expect(t.state()).toMatchObject({ status: 'playing', chapter: { index: 1 } })
  })

  it('shows nothing of the old book while another book loads', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.start('other', { kind: 'saved' })
    expect(t.state()).toMatchObject({ status: 'loading', book: null, chapter: null })
  })
})

describe('starting', () => {
  it("says the chapter's title on its first page, then reads its first sentence, marking it", async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    expect(t.texts()).toEqual(['Chapter 1. History.'])
    expect(t.state()).toMatchObject({ status: 'playing', utterance: null, following: true })
    expect(t.state().page).toMatchObject({ index: 0, href: '/read/essays/history', label: 'Ch. 1 · p. 1' })
    await t.end()
    expect(t.texts().at(-1)).toBe('One.')
    expect(t.state().utterance).toEqual({ start: 0, end: 4 })
    expect(t.state().book?.title).toBe('Essays')
    expect(t.state().chapter).toMatchObject({ index: 0, title: 'History', chapterCount: 2 })
  })

  it("starts at a later page's first sentence, without the title", async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    expect(t.texts()).toEqual(['Three.'])
    expect(t.state().page?.index).toBe(1)
  })

  it('carries on from the saved sentence when it is on this page, and from the page start otherwise', async () => {
    const storage = memoryStorage()
    writePosition(storage, 'essays', { chapter: 0, position: { chapter: 'history', page: 1 }, offset: 5, at: 1 })
    const t = setup({ storage })
    await t.start(page(0, 'history', 1))
    expect(t.texts()).toEqual(['Two.'])
    const other = setup({ storage })
    await other.start(page(0, 'history', 2))
    expect(other.texts()).toEqual(['Three.'])
  })

  it('starts from the saved position on the book page, or the first chapter', async () => {
    const storage = memoryStorage()
    const fresh = setup({ storage })
    await fresh.start({ kind: 'saved' })
    expect(fresh.texts()).toEqual(['Chapter 1. History.'])
    writePosition(storage, 'essays', { chapter: 1, position: { chapter: 'self', page: 1 }, offset: 0, at: 1 })
    const saved = setup({ storage })
    await saved.start({ kind: 'saved' })
    expect(saved.texts()).toEqual(['Chapter 2. Self.'])
  })

  it('starts from the saved sentence on the book page, wherever in the chapter it is', async () => {
    const storage = memoryStorage()
    writePosition(storage, 'essays', { chapter: 0, position: { chapter: 'history', page: 2 }, offset: 0, at: 1 })
    const laterPage = setup({ storage })
    await laterPage.start({ kind: 'saved' })
    expect(laterPage.texts()).toEqual(['Three.'])
    writePosition(storage, 'essays', { chapter: 0, position: { chapter: 'history', page: 1 }, offset: 5, at: 2 })
    const midPage = setup({ storage })
    await midPage.start({ kind: 'saved' })
    expect(midPage.texts()).toEqual(['Two.'])
  })

  it('takes no offset from a sentence saved on another page', async () => {
    const storage = memoryStorage()
    writePosition(storage, 'essays', { chapter: 0, position: { chapter: 'history', page: 2 }, offset: 5, at: 1 })
    const t = setup({ storage })
    await t.start(page(0, 'history', 1))
    expect(t.texts()).toEqual(['Chapter 1. History.'])
  })

  it('starts at the sentence a selection starts in, without the title', async () => {
    const t = setup()
    await t.start({ kind: 'offset', chapter: 0, position: { chapter: 'history', page: 1 }, offset: 6 })
    expect(t.texts()).toEqual(['Two.'])
  })

  it('picks the best voice, the remembered one for the language, and the remembered speed', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    expect(t.said[0]).toMatchObject({ voice: 'Online (Natural)', rate: 1, lang: 'en-US' })
    expect(t.state().voices.map((v) => v.name)).toEqual(['Online (Natural)', 'Local'])
    const storage = memoryStorage()
    storage.setItem(VOICE_KEY, JSON.stringify({ en: 'Local' }))
    storage.setItem(SPEED_KEY, '1.5')
    const remembered = setup({ storage })
    await remembered.start(page(0, 'history', 2))
    expect(remembered.said[0]).toMatchObject({ voice: 'Local', rate: 1.5 })
  })

  it('picks an on-device voice by itself for a private book', async () => {
    const slug = privateBookSlug('00000000-0000-4000-8000-000000000000')
    const t = setup({
      fetch: async (_s, index) => {
        const chapter = speechChapter(book, index)
        return chapter ? { ok: true, data: { book: { ...bookInfo, slug }, chapter } } : { ok: false, reason: 'failed' }
      },
    })
    await t.start(page(0, 'history', 2), slug)
    expect(t.said[0]?.voice).toBe('Local')
  })

  it('reads with the browser default voice when the device lists none', async () => {
    const t = setup({ voices: [] })
    await t.start(page(0, 'history', 2))
    expect(t.said[0]).toMatchObject({ voice: null, lang: 'en' })
  })

  it('closes and says so when the device has no voice for the language', async () => {
    const t = setup({ voices: [voice('Yelda', { lang: 'tr-TR' })] })
    await t.start(page(0, 'history', 1))
    expect(t.texts()).toEqual([])
    expect(t.state()).toMatchObject({ book: null, problem: { kind: 'no-voice', language: 'English' } })
  })

  it('closes on a 404, and on a failed first load, saying why', async () => {
    const missing = setup()
    await missing.start(page(0, 'x', 1), 'gone')
    expect(missing.state()).toMatchObject({ book: null, problem: { kind: 'unavailable' } })
    const offline = setup({ fetch: async () => Promise.reject(new Error('offline')) })
    await offline.start(page(0, 'history', 1))
    expect(offline.state()).toMatchObject({ book: null, problem: { kind: 'load-failed' } })
  })
})

describe('reading on', () => {
  it('goes from page to page, fetches the next chapter on the last page, and says its title', async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    await t.end()
    await t.end()
    expect(t.state().page?.index).toBe(0)
    expect(t.fetches).toEqual([0])
    await t.end()
    expect(t.texts().at(-1)).toBe('Three.')
    expect(t.state().page).toMatchObject({ index: 1, href: '/read/essays/history/2' })
    expect(t.fetches).toEqual([0, 1])
    await t.end()
    expect(t.texts().at(-1)).toBe('Chapter 2. Self.')
    expect(t.state().chapter?.index).toBe(1)
    await t.end()
    expect(t.texts().at(-1)).toBe('Four.')
  })

  it('says "Code example." for a code block, marking it whole', async () => {
    const t = setup()
    await t.start(page(1, 'self', 1))
    await t.end()
    await t.end()
    expect(t.texts().at(-1)).toBe('Code example.')
    expect(t.state().utterance).toEqual({ start: 5, end: 14 })
  })

  it("stops at the end of the book and marks it finished, so the next start is the book's beginning", async () => {
    const onSaved = vi.fn()
    const t = setup({ onSaved })
    await t.start(page(1, 'self', 1))
    t.tick(7)
    await t.end()
    await t.end()
    await t.end()
    expect(t.state()).toMatchObject({ status: 'ended', problem: { kind: 'end-of-book' } })
    expect(JSON.parse(t.storage.getItem(positionKey('essays')) ?? 'null')).toEqual({ v: 1, done: true, at: 7 })
    expect(readPosition(t.storage, 'essays')).toBeNull()
    expect(onSaved).toHaveBeenLastCalledWith('essays', null)
    t.ra.toggle()
    await flush()
    expect(t.texts().at(-1)).toBe('Chapter 1. History.')
  })

  it('moves on after a failed sentence, and stops after three in a row', async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    await t.end()
    await t.fail()
    expect(t.texts().at(-1)).toBe('Two.')
    await t.end()
    expect(t.texts().at(-1)).toBe('Three.')
    await t.fail()
    await t.fail()
    expect(t.state().status).toBe('playing')
    await t.fail()
    expect(t.state()).toMatchObject({ status: 'paused', problem: { kind: 'voice-failed' } })
    t.ra.toggle()
    expect(t.state()).toMatchObject({ status: 'playing', problem: null })
  })

  it('stops for good when the next chapter fails to load, and Retry goes on', async () => {
    let failing = true
    const t = setup({
      fetch: async (_s, index) => {
        if (index === 1 && failing) return { ok: false, reason: 'failed' }
        const chapter = speechChapter(book, index)
        return chapter ? { ok: true, data: { book: bookInfo, chapter } } : { ok: false, reason: 'not-found' }
      },
    })
    await t.start(page(0, 'history', 2))
    await t.end()
    expect(t.state()).toMatchObject({ status: 'error', problem: { kind: 'load-failed' } })
    expect(t.state().book?.title).toBe('Essays')
    failing = false
    t.ra.retry()
    await flush()
    expect(t.texts().at(-1)).toBe('Chapter 2. Self.')
  })

  it('Play after a failed load tries again, as Retry does', async () => {
    let failing = true
    const t = setup({
      fetch: async (_s, index) => {
        if (index === 1 && failing) return { ok: false, reason: 'failed' }
        const chapter = speechChapter(book, index)
        return chapter ? { ok: true, data: { book: bookInfo, chapter } } : { ok: false, reason: 'not-found' }
      },
    })
    await t.start(page(0, 'history', 2))
    await t.end()
    expect(t.state().problem).toEqual({ kind: 'load-failed' })
    failing = false
    t.ra.toggle()
    await flush()
    expect(t.texts().at(-1)).toBe('Chapter 2. Self.')
  })

  it('passes over a chapter with nothing to say, and ends on one', async () => {
    const withEmpty: ChapterBook = {
      kind: 'chapter',
      slug: 'essays',
      chapters: [
        { id: 'c1', slug: 'one', title: 'One', pages: ['<p>First.</p>'] },
        { id: 'c2', slug: 'blank', title: 'Blank', pages: ['<p>* * *</p>'] },
        { id: 'c3', slug: 'three', title: 'Three', pages: ['<p>Last.</p>'] },
        { id: 'c4', slug: 'coda', title: 'Coda', pages: ['<p>—</p>'] },
      ],
    }
    const t = setup({ content: withEmpty })
    await t.start(page(0, 'one', 1))
    await t.end()
    await t.end()
    expect(t.texts().at(-1)).toBe('Chapter 3. Three.')
    await t.end()
    await t.end()
    expect(t.texts().at(-1)).toBe('Last.')
    expect(t.state()).toMatchObject({ status: 'ended', problem: { kind: 'end-of-book' } })
  })

  it('closes when a later chapter is a 404 (a private book after sign-out)', async () => {
    const t = setup({
      fetch: async (_s, index) => {
        const chapter = index === 0 ? speechChapter(book, 0) : null
        return chapter ? { ok: true, data: { book: bookInfo, chapter } } : { ok: false, reason: 'not-found' }
      },
    })
    await t.start(page(0, 'history', 2))
    await t.end()
    expect(t.state()).toMatchObject({ book: null, problem: { kind: 'unavailable' } })
  })
})

describe('controls', () => {
  it('pause cancels the sentence, and play says it again from its start', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.toggle()
    expect(t.state().status).toBe('paused')
    expect(t.stops()).toBeGreaterThan(0)
    t.ra.toggle()
    expect(t.texts()).toEqual(['Three.', 'Three.'])
    expect(t.state().status).toBe('playing')
  })

  it('pause() holds the book for an aside, which leaves the position as it was', async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    await t.end()
    await t.end()
    expect(t.texts()).toEqual(['Chapter 1. History.', 'One.', 'Two.'])
    const before = t.state()
    t.ra.pause()
    expect(t.state().status).toBe('paused')
    const aside = createAside({
      speaker: t.speaker,
      loadVoices: async () => [local],
      downloaded: async () => [],
      storage: t.storage,
      pauseBook: t.ra.pause,
    })
    aside.say(
      ['An answer.'],
      { lang: 'en', privateBook: false },
      { onIdle: () => {}, onFailed: () => {}, onInterrupted: () => {} },
    )
    await flush()
    await t.end()
    expect(t.texts()).toEqual(['Chapter 1. History.', 'One.', 'Two.', 'An answer.'])
    expect([t.state().page, t.state().utterance, t.state().chapter]).toEqual([
      before.page,
      before.utterance,
      before.chapter,
    ])
    expect(readPosition(t.storage, 'essays')?.offset).toBe(before.utterance?.start)
    t.ra.toggle()
    expect(t.texts().at(-1)).toBe('Two.')
    t.ra.toggle()
    const stops = t.stops()
    t.ra.pause()
    expect(t.stops()).toBe(stops)
  })

  it('goes to the previous and next sentence, across pages, and skips the title', async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    t.ra.nextSentence()
    expect(t.texts().at(-1)).toBe('One.')
    t.ra.nextSentence()
    t.ra.nextSentence()
    expect(t.texts().at(-1)).toBe('Three.')
    t.ra.prevSentence()
    expect(t.texts().at(-1)).toBe('Two.')
    t.ra.prevSentence()
    t.ra.prevSentence()
    expect(t.texts().at(-1)).toBe('One.')
    t.ra.toggle()
    t.ra.nextSentence()
    expect(t.texts().at(-1)).toBe('One.')
    expect(t.state().utterance).toEqual({ start: 5, end: 9 })
  })

  it("goes on to the next chapter from a chapter's last sentence", async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.nextSentence()
    await flush()
    expect(t.texts().at(-1)).toBe('Chapter 2. Self.')
  })

  it('goes to the next and previous chapter, with its title', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.nextChapter()
    await flush()
    expect(t.texts().at(-1)).toBe('Chapter 2. Self.')
    t.ra.nextChapter()
    await flush()
    expect(t.state().chapter?.index).toBe(1)
    t.ra.prevChapter()
    await flush()
    expect(t.texts().at(-1)).toBe('Chapter 1. History.')
  })

  it('stays on the first chapter for Previous chapter, and restarts the first sentence for Previous sentence', async () => {
    const t = setup()
    await t.start({ kind: 'offset', chapter: 0, position: { chapter: 'history', page: 1 }, offset: 0 })
    t.ra.prevChapter()
    await flush()
    expect(t.fetches).toEqual([0])
    expect(t.state()).toMatchObject({ status: 'playing', book: { slug: 'essays' }, chapter: { index: 0 } })
    t.ra.prevSentence()
    expect(t.texts()).toEqual(['One.', 'One.'])
  })

  it('reads any chapter from its start, and keeps an index past either end to the book', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.toggle()
    expect(t.state().status).toBe('paused')
    t.ra.toChapter(1)
    await flush()
    expect(t.texts().at(-1)).toBe('Chapter 2. Self.')
    expect(t.state()).toMatchObject({ status: 'playing', chapter: { index: 1 }, page: { index: 0 } })
    t.ra.toChapter(0)
    await flush()
    expect(t.texts().at(-1)).toBe('Chapter 1. History.')
    expect(t.state().page?.index).toBe(0)
    t.ra.toChapter(99)
    await flush()
    expect(t.state().chapter?.index).toBe(1)
    t.ra.toChapter(-3)
    await flush()
    expect(t.state().chapter?.index).toBe(0)
  })

  it('does nothing for Chapters before a book is loaded', () => {
    const t = setup()
    t.ra.toChapter(1)
    expect(t.state().book).toBeNull()
    expect(t.texts()).toEqual([])
  })

  it('seeks by fraction of the chapter, and reports progress and time left', async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    expect(t.state().fraction).toBe(0)
    expect(t.state().minutesLeft).toBe(1)
    t.ra.seekFraction(0.99)
    expect(t.texts().at(-1)).toBe('Three.')
    expect(t.state().fraction).toBeCloseTo(8 / 14)
  })

  it('estimates the time left at the speed', async () => {
    const long: ChapterBook = {
      kind: 'chapter',
      slug: 'essays',
      chapters: [
        {
          id: 'c1',
          slug: 'history',
          title: 'History',
          pages: [`<p>${'This is a sentence of words. '.repeat(70)}</p>`],
        },
      ],
    }
    const t = setup({ content: long })
    await t.start(page(0, 'history', 1))
    expect(t.state().minutesLeft).toBe(3)
    t.ra.setRate(2)
    expect(t.state().minutesLeft).toBe(2)
  })

  it('restarts the sentence with a new speed or voice, and remembers both', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.setRate(1.25)
    expect(t.said.at(-1)).toMatchObject({ text: 'Three.', rate: 1.25 })
    expect(t.storage.getItem(SPEED_KEY)).toBe('1.25')
    t.ra.setVoice('Local')
    expect(t.said.at(-1)).toMatchObject({ text: 'Three.', voice: 'Local' })
    expect(JSON.parse(t.storage.getItem(VOICE_KEY) ?? '{}')).toEqual({ en: 'Local' })
    t.ra.setVoice('gone')
    expect(t.state().voice?.name).toBe('Local')
  })

  it('takes a new speed while paused without saying anything', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.toggle()
    t.ra.setRate(1.5)
    expect(t.texts()).toEqual(['Three.'])
    expect(t.state()).toMatchObject({ status: 'paused', rate: 1.5 })
  })

  it('turns following off and on', async () => {
    const t = setup()
    await t.start(page(0, 'history', 2))
    t.ra.setFollowing(false)
    expect(t.state().following).toBe(false)
    t.ra.setFollowing(true)
    expect(t.state().following).toBe(true)
  })

  it('saves the position as it reads, at most every 5 seconds, and on pause and close', async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    await t.end()
    expect(readPosition(t.storage, 'essays')).toMatchObject({ chapter: 0, offset: 0 })
    await t.end()
    expect(readPosition(t.storage, 'essays')?.offset).toBe(0)
    t.tick(SAVE_EVERY_MS)
    t.ra.nextSentence()
    expect(readPosition(t.storage, 'essays')).toMatchObject({
      chapter: 0,
      position: { chapter: 'history', page: 2 },
      offset: 0,
    })
    t.ra.prevSentence()
    t.ra.toggle()
    expect(readPosition(t.storage, 'essays')?.offset).toBe(5)
    t.ra.toggle()
    t.ra.nextSentence()
    t.ra.close()
    expect(readPosition(t.storage, 'essays')?.position).toEqual({ chapter: 'history', page: 2 })
    expect(t.state().book).toBeNull()
  })

  it('finishes the sentence and pauses for the sleep timer, or pauses at the end of the chapter', async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    await t.end()
    t.ra.stopAfterSentence()
    await t.end()
    expect(t.state().status).toBe('paused')
    expect(t.texts().at(-1)).toBe('One.')
    expect(t.onSleep).toHaveBeenCalledOnce()

    const chapterEnd = setup()
    await chapterEnd.start(page(0, 'history', 2))
    chapterEnd.ra.setStopAtChapterEnd(true)
    await chapterEnd.end()
    expect(chapterEnd.state()).toMatchObject({ status: 'paused', chapter: { index: 1 } })
    expect(chapterEnd.texts()).toEqual(['Three.'])
    expect(chapterEnd.onSleep).toHaveBeenCalledOnce()
    chapterEnd.ra.toggle()
    expect(chapterEnd.texts().at(-1)).toBe('Chapter 2. Self.')
  })

  it('stops for the sleep timer once: Play afterwards reads on', async () => {
    const t = setup()
    await t.start(page(0, 'history', 1))
    await t.end()
    t.ra.stopAfterSentence()
    await t.end()
    expect(t.state().status).toBe('paused')
    t.ra.toggle()
    await t.end()
    expect(t.texts().slice(-2)).toEqual(['One.', 'Two.'])
    expect(t.state().status).toBe('playing')

    const threeChapters: ChapterBook = {
      ...book,
      chapters: [...book.chapters, { id: 'c3', slug: 'coda', title: 'Coda', pages: ['<p>Five.</p>'] }],
    }
    const chapterEnd = setup({ content: threeChapters })
    await chapterEnd.start(page(0, 'history', 2))
    chapterEnd.ra.setStopAtChapterEnd(true)
    await chapterEnd.end()
    expect(chapterEnd.state()).toMatchObject({ status: 'paused', chapter: { index: 1 } })
    chapterEnd.ra.toggle()
    await chapterEnd.end()
    await chapterEnd.end()
    await chapterEnd.end()
    expect(chapterEnd.texts().at(-1)).toBe('Chapter 3. Coda.')
    expect(chapterEnd.state()).toMatchObject({ status: 'playing', chapter: { index: 2 } })
    expect(chapterEnd.onSleep).toHaveBeenCalledOnce()
  })

  it('ignores a late answer for a book it is no longer reading', async () => {
    let release: (r: FetchResult) => void = () => {}
    const t = setup({ fetch: () => new Promise((r) => (release = r)) })
    t.ra.start('essays', page(0, 'history', 1))
    t.ra.close()
    const chapter = speechChapter(book, 0)
    if (chapter) release({ ok: true, data: { book: bookInfo, chapter } })
    await flush()
    expect(t.texts()).toEqual([])
    expect(t.state().book).toBeNull()
  })
})

describe('onSaved', () => {
  it('hears each saved position with its time, as stored', async () => {
    const onSaved = vi.fn()
    const t = setup({ onSaved })
    t.tick(1000)
    await t.start(page(0, 'history', 1))
    await t.end()
    expect(onSaved).toHaveBeenCalledTimes(1)
    const [book, saved] = onSaved.mock.calls[0] ?? []
    expect(book).toBe('essays')
    expect(saved).toMatchObject({ chapter: 0, position: { chapter: 'history', page: 1 }, at: 1000 })
    expect(readPosition(t.storage, 'essays')).toEqual({ v: 1, ...saved })
  })
})

describe('ElevenLabs voices', () => {
  const VOICES: SpeechVoicesState = {
    state: 'ready',
    model: 'eleven_v4',
    voices: [
      { id: 'Ben02', name: 'Ben', accent: 'american', gender: 'male', languages: ['en'] },
      { id: 'Aria01', name: 'Aria', accent: 'british', gender: 'female', languages: ['en'] },
    ],
  }
  const ready = () => Promise.resolve(VOICES)
  const ARIA = 'elevenlabs:Aria01'
  const history1 = { book: 'essays', chapter: 0, position: { chapter: 'history', page: 1 } }

  function later() {
    let resolve: (s: SpeechVoicesState) => void = () => {}
    const answer = new Promise<SpeechVoicesState>((r) => {
      resolve = r
    })
    return { answer: () => answer, resolve }
  }

  it('lists the reader’s voices beside the device’s, and never picks one by itself', async () => {
    const t = setup({ cloud: ready })
    expect(t.state().cloudVoices).toBe('off')
    t.ra.start('essays', page(0, 'history', 2))
    expect(t.state().cloudVoices).toBe('loading')
    await flush()
    const list = t.state().cloudVoices
    expect(Array.isArray(list) && list.map((v) => [v.name, v.voiceURI, v.labels, v.engine])).toEqual([
      ['Aria', ARIA, 'British · female', 'cloud'],
      ['Ben', 'elevenlabs:Ben02', 'American · male', 'cloud'],
    ])
    expect(t.state().cloudModel).toBe('eleven_v4')
    expect(t.state()).toMatchObject({ engine: 'device', voice: { name: 'Online (Natural)' } })
    expect(t.said.at(-1)).toMatchObject({ text: 'Three.', engine: 'device' })
    expect(t.primes.count).toBe(0)
  })

  it('reads with the cloud speaker once one is picked, with the utterance’s place and the next one’s', async () => {
    const t = setup({ cloud: ready })
    await t.start(page(0, 'history', 1))
    t.ra.setVoice(ARIA)
    expect(t.primes.count).toBe(1)
    expect(t.state().engine).toBe('cloud')
    expect(t.said.at(-1)).toMatchObject({ text: 'Chapter 1. History.', engine: 'cloud', voice: 'Aria' })
    expect(t.cloudSaid.at(-1)).toEqual({
      ref: { book: 'essays', chapter: 0, intro: true },
      upcoming: { ...history1, start: 0, end: 4 },
      model: 'eleven_v4',
    })
    await t.end()
    expect(t.cloudSaid.at(-1)).toEqual({
      ref: { ...history1, start: 0, end: 4 },
      upcoming: { ...history1, start: 5, end: 9 },
      model: 'eleven_v4',
    })
    await t.end()
    await t.end()
    expect(t.said.at(-1)?.text).toBe('Three.')
    expect(t.cloudSaid.at(-1)?.upcoming).toEqual({ book: 'essays', chapter: 1, intro: true })
    expect(JSON.parse(t.storage.getItem(VOICE_KEY) ?? '{}')).toEqual({ en: ARIA })
  })

  it('waits for the list to read with a remembered ElevenLabs voice, priming on the press', async () => {
    const storage = memoryStorage()
    storage.setItem(VOICE_KEY, JSON.stringify({ en: ARIA }))
    const list = later()
    const t = setup({ cloud: list.answer, storage })
    await t.start(page(0, 'history', 2))
    expect(t.primes.count).toBe(1)
    expect(t.said).toEqual([])
    list.resolve(VOICES)
    await flush()
    expect(t.said.at(-1)).toMatchObject({ text: 'Three.', engine: 'cloud', voice: 'Aria' })
  })

  it('reads with the device voice when the list fails, and Retry asks again', async () => {
    const storage = memoryStorage()
    storage.setItem(VOICE_KEY, JSON.stringify({ en: ARIA }))
    let answer: SpeechVoicesState = { state: 'unavailable' }
    const t = setup({ cloud: () => Promise.resolve(answer), storage })
    await t.start(page(0, 'history', 2))
    expect(t.state().cloudVoices).toBe('failed')
    expect(t.said.at(-1)).toMatchObject({ text: 'Three.', engine: 'device' })
    answer = VOICES
    t.ra.retryCloudVoices()
    expect(t.state().cloudVoices).toBe('loading')
    await flush()
    expect(Array.isArray(t.state().cloudVoices)).toBe(true)
    expect(t.cloudLoads).toEqual(['essays', 'essays'])
    t.ra.retryCloudVoices()
    await t.start(page(0, 'history', 1))
    expect(t.cloudLoads).toEqual(['essays', 'essays'])
  })

  it('says why there are none: signed out, no key, a key that can’t list voices', async () => {
    for (const [answer, shown] of [
      [{ state: 'signed_out' }, 'off'],
      [{ state: 'no_key' }, 'no-key'],
      [{ state: 'pro' }, 'pro'],
      [{ state: 'permission' }, 'permission'],
      [{ state: 'key_rejected' }, 'failed'],
    ] as const) {
      const t = setup({ cloud: () => Promise.resolve(answer) })
      await t.start(page(0, 'history', 2))
      expect(t.state().cloudVoices, answer.state).toBe(shown)
    }
    const thrown = setup({ cloud: () => Promise.reject(new Error('offline')) })
    await thrown.start(page(0, 'history', 2))
    expect(thrown.state().cloudVoices).toBe('failed')
  })

  it('pauses on each ElevenLabs problem and keeps the book open', async () => {
    for (const code of [
      'key_rejected',
      'no_credits',
      'permission',
      'voice_gone',
      'busy',
      'no_key',
      'signed_out',
      'blocked',
    ]) {
      const t = setup({ cloud: ready })
      await t.start(page(0, 'history', 2))
      t.ra.setVoice(ARIA)
      await t.fail(code)
      expect(t.state(), code).toMatchObject({
        status: 'paused',
        problem: { kind: 'cloud', code },
        book: { slug: 'essays' },
      })
    }
    const t = setup({ cloud: ready })
    await t.start(page(0, 'history', 2))
    t.ra.setVoice(ARIA)
    await t.fail('rate', new Date(5000))
    expect(t.state().problem).toEqual({ kind: 'cloud', code: 'rate', retryAt: 5000 })
  })

  it('counts a failed request as a failed sentence, and closes on a 404', async () => {
    const t = setup({ cloud: ready })
    await t.start(page(0, 'history', 1))
    t.ra.setVoice(ARIA)
    await t.fail('failed')
    expect(t.said.at(-1)).toMatchObject({ text: 'One.', engine: 'cloud' })
    await t.fail('not_found')
    expect(t.state()).toMatchObject({ book: null, problem: { kind: 'unavailable' } })
    expect(t.closes.count).toBe(1)
  })

  it('an ElevenLabs problem in the intro says the intro again on Play', async () => {
    const t = setup({ cloud: ready })
    await t.start(page(0, 'history', 1))
    t.ra.setVoice(ARIA)
    await t.fail('no_credits')
    t.ra.toggle()
    expect(t.said.at(-1)).toMatchObject({ text: 'Chapter 1. History.' })
  })

  it('Use device voice goes on from the same sentence, keeping the remembered choice', async () => {
    const t = setup({ cloud: ready })
    await t.start(page(0, 'history', 2))
    t.ra.setVoice(ARIA)
    await t.fail('no_credits')
    t.ra.useDeviceVoice()
    expect(t.said.at(-1)).toMatchObject({ text: 'Three.', engine: 'device', voice: 'Online (Natural)' })
    expect(t.state()).toMatchObject({ engine: 'device', problem: null, status: 'playing' })
    expect(JSON.parse(t.storage.getItem(VOICE_KEY) ?? '{}')).toEqual({ en: ARIA })
  })

  it('Use device voice before anything is loaded only changes the voice', () => {
    const t = setup({ cloud: ready })
    t.ra.useDeviceVoice()
    expect(t.said).toEqual([])
    expect(t.state().engine).toBe('device')
  })

  it('forgets a voice ElevenLabs no longer has', async () => {
    const t = setup({ cloud: ready })
    await t.start(page(0, 'history', 2))
    t.ra.setVoice(ARIA)
    await t.fail('voice_gone')
    expect(JSON.parse(t.storage.getItem(VOICE_KEY) ?? '{}')).toEqual({})
    t.ra.setVoice('elevenlabs:Ben02')
    expect(t.state().problem).toBeNull()
  })

  it('keeps choices for private books apart from catalogue ones', async () => {
    const slug = privateBookSlug('6f1c0000-0000-4000-8000-000000000001')
    const fetch = async (s: string, index: number): Promise<FetchResult> => {
      const chapter = speechChapter(book, index)
      return chapter ? { ok: true, data: { book: { ...bookInfo, slug: s }, chapter } } : { ok: false, reason: 'failed' }
    }
    const storage = memoryStorage()
    storage.setItem(VOICE_KEY, JSON.stringify({ en: ARIA }))
    const t = setup({ cloud: ready, storage, fetch })
    await t.start(page(0, 'history', 2), slug)
    expect(t.said.at(-1)).toMatchObject({ engine: 'device', voice: 'Local' })
    expect(Array.isArray(t.state().cloudVoices)).toBe(true)
    t.ra.setVoice(ARIA)
    expect(JSON.parse(storage.getItem(VOICE_KEY) ?? '{}')).toEqual({ en: ARIA, 'en:private': ARIA })
    t.ra.setVoice('Local')
    expect(JSON.parse(storage.getItem(VOICE_KEY) ?? '{}')).toEqual({ en: ARIA, 'en:private': 'Local' })
    await t.start(page(0, 'history', 2), 'essays')
    expect(t.said.at(-1)).toMatchObject({ engine: 'cloud', voice: 'Aria' })
  })

  it('primes on Play with an ElevenLabs voice, not with a device one', async () => {
    const t = setup({ cloud: ready })
    await t.start(page(0, 'history', 2))
    t.ra.toggle()
    t.ra.toggle()
    expect(t.primes.count).toBe(0)
    t.ra.setVoice(ARIA)
    t.ra.toggle()
    t.ra.toggle()
    expect(t.primes.count).toBe(2)
    expect(t.said.at(-1)).toMatchObject({ text: 'Three.', engine: 'cloud' })
    t.ra.close()
    expect(t.closes.count).toBe(1)
  })
})

describe('the Folio voice', () => {
  const LJ = 'folio:en_US-ljspeech-medium'

  function localSetup(options: { downloaded?: string[]; storage?: Storage; slug?: string; voices?: VoiceLike[] } = {}) {
    const said: { text: string; engine: 'device' | 'local'; voice: string | null; upcoming?: string[] }[] = []
    let handlers: SpeakHandlers | null = null
    const primes = { count: 0 }
    const device: Speaker = {
      speak: (text, opts, h) => {
        said.push({ text, engine: 'device', voice: opts.voice?.name ?? null })
        handlers = h
      },
      stop: () => {
        handlers = null
      },
    }
    const localSpeaker = {
      speak: (text: string, opts: SpeakOptions, h: SpeakHandlers) => {
        said.push({ text, engine: 'local', voice: opts.voice?.voiceURI ?? null, upcoming: opts.local?.upcoming })
        handlers = h
      },
      stop: () => {
        handlers = null
      },
      prime: () => void primes.count++,
      close: () => {},
    }
    const downloaded = new Set(options.downloaded ?? [])
    const downloads: {
      id: string
      progress: (p: number) => void
      signal?: AbortSignal
      finish: (o: DownloadOutcome) => void
    }[] = []
    const voiceStore: VoiceStore = {
      status: async (v) => (downloaded.has(v.id) ? 'ready' : 'absent'),
      downloaded: async () => FOLIO_VOICES.filter((v) => downloaded.has(v.id)),
      download: (v, progress, signal) =>
        new Promise((resolve) => {
          downloads.push({
            id: v.id,
            progress,
            signal,
            finish: (o) => {
              if (o === 'ok') downloaded.add(v.id)
              resolve(o)
            },
          })
          signal?.addEventListener('abort', () => resolve('cancelled'))
        }),
      remove: vi.fn(async (voices) => {
        for (const v of voices) downloaded.delete(v.id)
      }),
      ensureEngine: vi.fn(async () => {}),
      engineUrls: () => [],
    }
    const storage = options.storage ?? memoryStorage()
    const notices: unknown[] = []
    const slug = options.slug ?? 'essays'
    const ra = createReadAloud({
      speaker: device,
      localSpeaker,
      voiceStore,
      loadVoices: async () => options.voices ?? [local, online],
      fetchChapter: async (_s, index) => {
        const chapter = speechChapter(book, index)
        return chapter ? { ok: true, data: { book: { ...bookInfo, slug }, chapter } } : { ok: false, reason: 'failed' }
      },
      storage,
      onState: () => {},
      onNotice: (n) => notices.push(n),
      locale: 'en-US',
    })
    return {
      ra,
      said,
      primes,
      downloads,
      voiceStore,
      storage,
      notices,
      start: async (at: StartAt = page(0, 'history', 2)) => {
        ra.start(slug, at)
        await flush()
      },
      end: async () => {
        const h = handlers
        handlers = null
        h?.onEnd()
        await flush()
      },
      fail: async (error: string) => {
        const h = handlers
        handlers = null
        h?.onError(error)
        await flush()
      },
    }
  }

  it('is the automatic choice once downloaded, for catalogue and private books, made two ahead', async () => {
    const t = localSetup({ downloaded: ['en_US-ljspeech-medium'] })
    await t.start()
    expect(t.said[0]).toEqual({ text: 'Three.', engine: 'local', voice: LJ, upcoming: [] })
    expect(t.ra.state().engine).toBe('local')
    expect(t.ra.state().local).toMatchObject({ offer: false, removable: FOLIO_VOICES[1]?.bytes })
    expect(t.voiceStore.ensureEngine).toHaveBeenCalled()
    expect(t.primes.count).toBeGreaterThan(0)
    const first = localSetup({ downloaded: ['en_US-ljspeech-medium'] })
    await first.start({ kind: 'offset', chapter: 0, position: { chapter: 'history', page: 1 }, offset: 0 })
    expect(first.said[0]).toMatchObject({ text: 'One.', upcoming: ['Two.', 'Three.'] })
    const own = localSetup({
      downloaded: ['en_US-ljspeech-medium'],
      slug: privateBookSlug('00000000-0000-4000-8000-000000000000'),
    })
    await own.start()
    expect(own.said[0]).toMatchObject({ engine: 'local', voice: LJ })
  })

  it('lets a remembered device voice win', async () => {
    const storage = memoryStorage()
    storage.setItem(VOICE_KEY, JSON.stringify({ en: 'Online (Natural)' }))
    const t = localSetup({ downloaded: ['en_US-ljspeech-medium'], storage })
    await t.start()
    expect(t.said[0]).toMatchObject({ engine: 'device', voice: 'Online (Natural)' })
  })

  it('offers itself while no voice for the language is downloaded, and Not now keeps it hidden', async () => {
    const t = localSetup()
    await t.start()
    expect(t.said[0]?.engine).toBe('device')
    const { local: state } = t.ra.state()
    expect(state.offer).toBe(true)
    expect(state.voices.map((v) => [v.id, v.state])).toEqual([
      ['en_US-ljspeech-medium', 'absent'],
      ['en_GB-cori-medium', 'absent'],
    ])
    expect(state.voices[0]?.bytes).toBe((FOLIO_VOICES[1]?.bytes ?? 0) + ENGINE_BYTES)
    t.ra.dismissOffer()
    expect(t.ra.state().local.offer).toBe(false)
    const again = localSetup({ storage: t.storage })
    await again.start()
    expect(again.ra.state().local.offer).toBe(false)
  })

  it('sizes a later voice without the engine, which is already on the device', async () => {
    const t = localSetup({ downloaded: ['en_US-ljspeech-medium'] })
    await t.start()
    const cori = t.ra.state().local.voices.find((v) => v.id === 'en_GB-cori-medium')
    expect(cori).toMatchObject({
      state: 'absent',
      bytes: FOLIO_VOICES.find((v) => v.id === 'en_GB-cori-medium')?.bytes,
    })
  })

  it('downloads when asked, switches at the next sentence and remembers it', async () => {
    const t = localSetup()
    await t.start(page(0, 'history', 1))
    expect(t.said.at(-1)?.engine).toBe('device')
    t.ra.downloadLocal('en_US-ljspeech-medium')
    t.ra.downloadLocal('en_US-ljspeech-medium')
    expect(t.downloads).toHaveLength(1)
    expect(t.ra.state().local.offer).toBe(false)
    t.downloads[0]?.progress(45)
    expect(t.ra.state().local.voices[0]).toMatchObject({ state: 'downloading', percent: 45 })
    t.downloads[0]?.finish('ok')
    await flush()
    expect(t.notices).toEqual([{ kind: 'ready' }])
    expect(t.ra.state()).toMatchObject({ engine: 'local', voice: { voiceURI: LJ } })
    expect(t.said.at(-1)?.engine).toBe('device')
    await t.end()
    await t.end()
    expect(t.said.at(-1)).toMatchObject({ engine: 'local', voice: LJ })
    expect(JSON.parse(t.storage.getItem(VOICE_KEY) ?? '{}')).toEqual({ en: LJ, 'en:private': LJ })
  })

  it('brings the offer back and says why when a download fails, and says nothing when cancelled', async () => {
    const t = localSetup()
    await t.start()
    t.ra.downloadLocal('en_US-ljspeech-medium')
    t.downloads[0]?.finish('failed')
    await flush()
    expect(t.notices).toEqual([{ kind: 'failed' }])
    expect(t.ra.state().local.offer).toBe(true)
    t.ra.downloadLocal('en_GB-cori-medium')
    t.downloads[1]?.finish('no_room')
    await flush()
    expect(t.notices.at(-1)).toEqual({ kind: 'no_room', bytes: (FOLIO_VOICES[0]?.bytes ?? 0) + ENGINE_BYTES })
    t.ra.downloadLocal('en_GB-cori-medium')
    t.ra.cancelDownload()
    await flush()
    expect(t.downloads[2]?.signal?.aborted).toBe(true)
    expect(t.notices).toHaveLength(2)
    expect(t.ra.state().local.voices[1]?.state).toBe('absent')
  })

  it('pauses on its two problems, and Use device voice goes on from the same sentence', async () => {
    const t = localSetup({ downloaded: ['en_US-ljspeech-medium'] })
    await t.start()
    await t.fail('local_failed')
    expect(t.ra.state()).toMatchObject({ status: 'paused', problem: { kind: 'local', code: 'local_failed' } })
    t.ra.useDeviceVoice()
    await flush()
    expect(t.said.at(-1)).toMatchObject({ text: 'Three.', engine: 'device', voice: 'Online (Natural)' })
    const gone = localSetup({ downloaded: ['en_US-ljspeech-medium'] })
    await gone.start()
    await gone.voiceStore.remove(FOLIO_VOICES)
    await gone.fail('local_missing')
    expect(gone.ra.state().problem).toEqual({ kind: 'local', code: 'local_missing' })
    expect(gone.ra.state().local.voices[0]?.state).toBe('absent')
  })

  it('says the chapter title again after a problem, rather than passing over it', async () => {
    const t = localSetup({ downloaded: ['en_US-ljspeech-medium'] })
    await t.start(page(0, 'history', 1))
    expect(t.said[0]?.text).toBe('Chapter 1. History.')
    await t.fail('local_failed')
    t.ra.toggle()
    expect(t.said.at(-1)?.text).toBe('Chapter 1. History.')
  })

  it('removes the language’s voices, reading on with the device voice, and offers itself again', async () => {
    const t = localSetup({ downloaded: ['en_US-ljspeech-medium'] })
    await t.start()
    t.ra.setVoice(LJ)
    t.ra.removeLocal()
    await flush()
    expect(t.voiceStore.remove).toHaveBeenCalled()
    expect(t.ra.state()).toMatchObject({ engine: 'device', voice: { name: 'Online (Natural)' } })
    expect(t.ra.state().local.offer).toBe(true)
    expect(t.said.at(-1)).toMatchObject({ engine: 'device', text: 'Three.' })
    expect(JSON.parse(t.storage.getItem(VOICE_KEY) ?? '{}')).toEqual({})
  })

  it('removes the language’s voices while a device voice reads, which reads on', async () => {
    const storage = memoryStorage()
    storage.setItem(VOICE_KEY, JSON.stringify({ en: 'Local' }))
    const t = localSetup({ downloaded: ['en_US-ljspeech-medium'], storage })
    await t.start()
    const said = t.said.length
    t.ra.removeLocal()
    await flush()
    expect(t.ra.state()).toMatchObject({ engine: 'device', voice: { name: 'Local' } })
    expect(t.ra.state().local).toMatchObject({ offer: true, removable: 0 })
    expect(t.said).toHaveLength(said)
  })

  it('notes a slow device', async () => {
    const t = localSetup({ downloaded: ['en_US-ljspeech-medium'] })
    await t.start()
    t.ra.noteSlow()
    expect(t.ra.state().local.slow).toBe(true)
  })

  it('reads with a downloaded voice when the device has none for the language', async () => {
    const t = localSetup({ downloaded: ['en_GB-cori-medium'], voices: [voice('Yelda', { lang: 'tr-TR' })] })
    t.ra.close()
    await t.start()
    expect(t.ra.state().problem).toBeNull()
    expect(t.said[0]).toMatchObject({ engine: 'local' })
  })
})
