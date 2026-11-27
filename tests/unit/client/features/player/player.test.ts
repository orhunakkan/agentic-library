import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlayer, type ReadAloudFactory } from '~/client/features/player/player'
import type { FetchResult } from '~/client/features/read-aloud/controller'
import type { Speaker, SpeakHandlers } from '~/client/features/read-aloud/speaker'
import type { VoiceLike } from '~/client/features/read-aloud/voices'
import type { PlayerBook, PlayerEpisode } from '~/shared/content/book-page'
import type { ChapterBook } from '~/shared/content/schema'
import { type SpeechChapterData, speechChapter } from '~/shared/read-aloud/speech-text'
import { fakeAudio } from '../../../../fixtures/fake-audio'

const essays: ChapterBook = {
  kind: 'chapter',
  slug: 'essays',
  chapters: [
    { id: 'c1', slug: 'history', title: 'History', pages: ['<p>One. Two.</p>'] },
    { id: 'c2', slug: 'self', title: 'Self', pages: ['<p>Three.</p>'] },
  ],
}
const essaysInfo = {
  slug: 'essays',
  title: 'Essays',
  author: 'Emerson',
  href: '/library/s/essays',
  coverUrl: '/covers/essays.svg',
  cover: { background: ['#000', '#111'], ink: '#fff', motif: 'arch' },
  language: 'en',
  chapterTitles: ['History', 'Self'],
} as SpeechChapterData['book']

const machine: PlayerBook = {
  slug: 'time-machine',
  title: 'The Time Machine',
  author: 'H. G. Wells',
  href: '/library/wells/time-machine',
  coverUrl: '/covers/time-machine.jpg',
  cover: {} as PlayerBook['cover'],
  image: null,
}
const episode = (id: string, number: number): PlayerEpisode => ({
  id,
  number,
  title: `Chapter ${number}`,
  durationMs: 600_000,
  audioUrl: `/audio/${id}.mp3`,
  startMs: 0,
  pageHref: null,
})
const episodes = [episode('e1', 1), episode('e2', 2)]

const english: VoiceLike = { name: 'Local', lang: 'en-US', voiceURI: 'Local', localService: true, default: false }
const history = { kind: 'page', chapter: 0, position: { chapter: 'history', page: 1 } } as const

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function setup(options: { fetch?: () => Promise<FetchResult>; signedIn?: boolean; speaks?: boolean } = {}) {
  const audio = fakeAudio()
  const said: string[] = []
  let handlers: SpeakHandlers | null = null
  const speaker: Speaker = {
    speak: (text, _opts, h) => {
      said.push(text)
      handlers = h
    },
    stop: () => {
      handlers = null
    },
    prime: () => {},
    close: () => {},
  }
  const built: boolean[] = []
  const disposed = vi.fn()
  const readAloud: ReadAloudFactory = (signedIn) => {
    built.push(signedIn)
    if (options.speaks === false) return null
    return {
      controller: {
        speaker,
        loadVoices: async () => [english],
        fetchChapter:
          options.fetch ??
          (async (_book, index) => {
            const chapter = speechChapter(essays, index)
            return chapter ? { ok: true, data: { book: essaysInfo, chapter } } : { ok: false, reason: 'not-found' }
          }),
        locale: 'en-US',
      },
      aside: { speaker, loadVoices: async () => [english], downloaded: async () => [], locale: 'en-US' },
      dispose: disposed,
    }
  }
  const deps = {
    storage: null,
    queue: vi.fn(),
    signedIn: options.signedIn ?? false,
    onBookFinished: vi.fn(),
    onSleepEnded: vi.fn(),
    onNotice: vi.fn(),
    lockScreen: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })),
  }
  const player = createPlayer(deps)
  player.attach({ audiobook: audio, readAloud })
  return {
    player,
    audio,
    deps,
    built,
    disposed,
    said,
    /** Finishes the sentence read aloud is saying. */
    end: async () => {
      const h = handlers
      handlers = null
      h?.onEnd()
      await flush()
    },
    readAloud: async (at: Parameters<typeof player.readAloud.start>[1] = history) => {
      player.readAloud.start('essays', at)
      await flush()
    },
    playAudiobook: () => {
      player.audiobook.play(machine, episodes, 'e1')
      audio.fire('play')
    },
  }
}

afterEach(() => vi.useRealTimers())

describe('one source plays at a time', () => {
  it('read aloud starting closes the audiobook and turns its sleep timer off', async () => {
    const t = setup()
    t.playAudiobook()
    t.player.setSleep(30)
    await t.readAloud()
    expect(t.player.state().audiobook.current).toBeNull()
    expect(t.player.state()).toMatchObject({ sleepChoice: 'off', now: { source: 'read-aloud' } })
    expect(t.said).toEqual(['Chapter 1. History.'])
  })

  it('an audiobook starting closes read aloud and turns its sleep timer off', async () => {
    const t = setup()
    await t.readAloud()
    t.player.setSleep(15)
    t.playAudiobook()
    expect(t.player.state().readAloud.book).toBeNull()
    expect(t.player.state()).toMatchObject({ sleepChoice: 'off', now: { source: 'audiobook', episode: { id: 'e1' } } })
  })

  it('an aside pauses read aloud and the audiobook', async () => {
    const t = setup()
    await t.readAloud()
    t.player.aside.say(
      ['Hello.'],
      { lang: 'en', privateBook: false },
      {
        onIdle: () => {},
        onFailed: () => {},
        onInterrupted: () => {},
      },
    )
    expect(t.player.state().readAloud.status).toBe('paused')
    t.playAudiobook()
    t.player.aside.hush()
    expect(t.audio.pause).toHaveBeenCalled()
  })

  it('says whether something plays, whichever source it is', async () => {
    const t = setup()
    await t.readAloud()
    expect(t.player.state().playing).toBe(true)
    t.player.readAloud.pause()
    expect(t.player.state().playing).toBe(false)
    t.playAudiobook()
    expect(t.player.state().playing).toBe(true)
  })
})

describe('the sleep timer', () => {
  it('stops read aloud at the end of the chapter, then turns itself off', async () => {
    const t = setup()
    t.player.setSleep('end-of-part')
    await t.readAloud()
    await t.end()
    await t.end()
    await t.end()
    expect(t.player.state()).toMatchObject({
      sleepChoice: 'off',
      readAloud: { status: 'paused', chapter: { index: 1 } },
    })
    expect(t.said).toEqual(['Chapter 1. History.', 'One.', 'Two.'])
    expect(t.deps.onSleepEnded).toHaveBeenCalledOnce()
  })

  it('turns the end-of-chapter timer off when read aloud closes itself (#96)', async () => {
    const t = setup({ fetch: async () => ({ ok: false, reason: 'failed' }) })
    t.player.setSleep('end-of-part')
    await t.readAloud()
    expect(t.player.state()).toMatchObject({ readAloud: { book: null, problem: { kind: 'load-failed' } } })
    expect(t.player.state()).toMatchObject({ sleep: { kind: 'off' }, sleepChoice: 'off' })
  })

  it('counts its minutes while read aloud plays, then stops after the sentence', async () => {
    vi.useFakeTimers()
    const t = setup()
    t.player.setSleep(15)
    await t.readAloud()
    vi.advanceTimersByTime(15 * 60_000)
    expect(t.player.state().sleep).toEqual({ kind: 'off' })
    expect(t.deps.onSleepEnded).not.toHaveBeenCalled()
    await t.end()
    expect(t.player.state().readAloud.status).toBe('paused')
    expect(t.said).toEqual(['Chapter 1. History.'])
    expect(t.deps.onSleepEnded).toHaveBeenCalledOnce()
  })
})

describe('signing in or out', () => {
  it('builds read aloud again for whoever is signed in, closing the book it was reading', async () => {
    const t = setup()
    await t.readAloud()
    t.player.setSignedIn(true)
    expect(t.built).toEqual([false, true])
    expect(t.disposed).toHaveBeenCalledOnce()
    expect(t.player.state().readAloud.book).toBeNull()
    t.player.setSignedIn(true)
    expect(t.built).toEqual([false, true])
  })

  it('leaves the audiobook and its sleep timer alone', () => {
    const t = setup()
    t.playAudiobook()
    t.player.setSleep(30)
    t.player.setSignedIn(true)
    expect(t.player.state()).toMatchObject({ sleepChoice: 30, now: { source: 'audiobook' } })
  })
})

describe('the state', () => {
  it('is one snapshot between changes, and subscribers hear each change', async () => {
    const t = setup()
    const heard = vi.fn()
    const stop = t.player.subscribe(heard)
    const before = t.player.state()
    expect(t.player.state()).toBe(before)
    t.playAudiobook()
    expect(heard).toHaveBeenCalled()
    expect(t.player.state()).not.toBe(before)
    stop()
    heard.mockClear()
    t.player.audiobook.close()
    expect(heard).not.toHaveBeenCalled()
  })

  it('says read aloud is supported only where the browser can speak', () => {
    expect(setup().player.state().readAloudSupported).toBe(true)
    expect(setup({ speaks: false }).player.state().readAloudSupported).toBe(false)
  })

  it('shows the lock screen what is playing', () => {
    const t = setup()
    t.playAudiobook()
    const screen = t.deps.lockScreen.mock.results[0]?.value
    expect(screen?.update).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'audiobook' }))
  })

  it('lets the media go once detached', () => {
    const t = setup()
    t.playAudiobook()
    t.player.detach()
    expect(t.player.state()).toMatchObject({ now: { source: null }, playing: false, readAloudSupported: false })
    t.player.audiobook.play(machine, episodes, 'e2')
    expect(t.audio.play).toHaveBeenCalledOnce()
  })
})

describe('moving within what plays', () => {
  it("goes to read aloud's chapter, following it", async () => {
    const t = setup()
    await t.readAloud()
    t.player.readAloud.setFollowing(false)
    t.player.toPart('1')
    await flush()
    expect(t.player.state().readAloud).toMatchObject({ following: true, chapter: { index: 1 } })
  })

  it("goes to the audiobook's episode", () => {
    const t = setup()
    t.playAudiobook()
    t.player.toPart('e2')
    expect(t.player.state().audiobook.current?.id).toBe('e2')
  })

  it('plays a bookmark in the source now playing', async () => {
    const t = setup()
    t.playAudiobook()
    t.player.playBookmark({
      kind: 'episode',
      id: 'b',
      status: 'ok',
      positionMs: 60_000,
      createdAt: '',
      episode: episodes[1] ?? null,
    })
    expect(t.player.state().audiobook).toMatchObject({ current: { id: 'e2' }, positionMs: 60_000 })

    await t.readAloud()
    const place = {
      chapterIndex: 1,
      chapterTitle: 'Self',
      chapter: 'self',
      page: 1,
      pageHref: '/read/essays/self/1',
      label: 'p. 1',
      position: 0,
      start: 0,
    }
    t.player.playBookmark({ kind: 'voice', id: 'v', status: 'ok', opening: 'Three', place, createdAt: '' })
    await flush()
    expect(t.player.state().readAloud).toMatchObject({ following: true, chapter: { index: 1 } })
    expect(t.said.at(-1)).toBe('Three.')
  })
})
