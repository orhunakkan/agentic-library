import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadAloudState } from '~/client/features/read-aloud/controller'
import type { PlayerBook, PlayerEpisode } from '~/shared/content/book-page'
import type { SpeechBook } from '~/shared/read-aloud/speech-text'
import { createLockScreen, type LockScreenActions, type MediaSessionLike } from './media-session'
import type { NowPlaying } from './now-playing'

const book: PlayerBook = {
  slug: 'time-machine',
  title: 'The Time Machine',
  author: 'H. G. Wells',
  href: '/library/wells/time-machine',
  coverUrl: '/covers/time-machine.jpg',
  cover: {} as PlayerBook['cover'],
  image: { src: '/covers/time-machine.webp', width: 400, height: 600 } as PlayerBook['image'],
}
const speechBook: SpeechBook = {
  ...book,
  slug: 'emerson',
  title: 'Essays',
  author: 'Ralph Waldo Emerson',
  coverUrl: '/covers/emerson.svg',
  image: null,
  language: 'en',
  chapterTitles: ['History', 'Self-Reliance'],
}
const episode: PlayerEpisode = {
  id: 'e2',
  number: 2,
  title: 'The Going',
  durationMs: 75 * 60_000,
  audioUrl: '/a/2.mp3',
  startMs: 0,
  pageHref: null,
}

const audiobook = (playing: boolean): NowPlaying => ({
  source: 'audiobook',
  book,
  episodes: [episode],
  episode,
  playing,
  positionMs: 1_000,
})
const readAloud = (engine: ReadAloudState['engine'], playing = true): NowPlaying => ({
  source: 'read-aloud',
  book: speechBook,
  engine,
  chapter: { index: 1, slug: 'self', title: 'Self-Reliance', number: 2, chapterCount: 2 },
  page: null,
  utterance: null,
  playing,
})

let made = 0
beforeEach(() => {
  made = 0
  vi.stubGlobal(
    'MediaMetadata',
    class {
      constructor(init: MediaMetadataInit) {
        made++
        Object.assign(this, init)
      }
    },
  )
})

function fakeSession() {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>()
  const ms = {
    metadata: null as unknown,
    playbackState: 'none' as MediaSessionPlaybackState,
    setActionHandler: vi.fn((action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      handlers.set(action, handler)
    }),
  }
  const press = (action: MediaSessionAction, details: Partial<MediaSessionActionDetails> = {}) =>
    handlers.get(action)?.({ action, ...details } as MediaSessionActionDetails)
  const offered = () => [...handlers].filter(([, h]) => h).map(([a]) => a)
  return { ms, handlers, press, offered }
}

function actions(): LockScreenActions {
  return {
    audiobook: {
      resume: vi.fn(),
      pause: vi.fn(),
      skip: vi.fn(),
      prev: vi.fn(),
      next: vi.fn(),
      seekFile: vi.fn(),
    },
    readAloud: { toggle: vi.fn(), prevSentence: vi.fn(), nextSentence: vi.fn() },
  }
}

function setup() {
  const fake = fakeSession()
  const acts = actions()
  const session = createLockScreen({ mediaSession: fake.ms as unknown as MediaSessionLike }, acts)
  return { ...fake, acts, session }
}

describe('createLockScreen', () => {
  it('gives a playing audiobook the episode, the book, its cover and the seven controls', () => {
    const { ms, press, offered, acts, session } = setup()
    session.update(audiobook(true))
    expect(ms.metadata).toEqual({
      title: 'The Going',
      artist: 'H. G. Wells',
      album: 'The Time Machine',
      artwork: [{ src: '/covers/time-machine.jpg', sizes: '400x600', type: 'image/webp' }],
    })
    expect(ms.playbackState).toBe('none')
    expect(offered().sort()).toEqual(
      ['nexttrack', 'pause', 'play', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'].sort(),
    )
    press('play')
    press('pause')
    press('seekbackward')
    press('seekforward')
    press('previoustrack')
    press('nexttrack')
    press('seekto', { seekTime: 90.5 })
    press('seekto', {})
    const a = acts.audiobook
    expect([a.resume, a.pause, a.prev, a.next].map((f) => vi.mocked(f).mock.calls.length)).toEqual([1, 1, 1, 1])
    expect(vi.mocked(a.skip).mock.calls).toEqual([[-15_000], [15_000]])
    expect(vi.mocked(a.seekFile).mock.calls).toEqual([[90_500]])
  })

  it("sets a paused audiobook's metadata and controls once while its place moves on", () => {
    const { ms, session } = setup()
    session.update(audiobook(true))
    session.update({ ...audiobook(true), positionMs: 2_000 } as NowPlaying)
    session.update(audiobook(false))
    expect(ms.playbackState).toBe('none')
    expect(made).toBe(1)
    expect(ms.setActionHandler).toHaveBeenCalledTimes(7)
  })

  it('sets the metadata again for the next episode or chapter, and the controls only for a new source', () => {
    const { ms, session } = setup()
    const next = { ...episode, id: 'e3', number: 3, title: 'In the Golden Age' }
    session.update(audiobook(true))
    session.update({ ...audiobook(true), episode: next } as NowPlaying)
    expect(ms.metadata).toMatchObject({ title: 'In the Golden Age' })
    session.update({ source: null })
    session.update(readAloud('cloud'))
    const history = { index: 0, slug: 'history', title: 'History', number: 1, chapterCount: 2 }
    session.update({ ...readAloud('cloud'), chapter: history } as NowPlaying)
    expect(ms.metadata).toMatchObject({ title: 'History' })
    expect(made).toBe(4)
    expect(ms.setActionHandler).toHaveBeenCalledTimes(21)
  })

  it.each(['cloud', 'local'] as const)(
    'gives read aloud with a %s voice the chapter, the book and four controls',
    (engine) => {
      const { ms, press, offered, acts, session } = setup()
      session.update(readAloud(engine, false))
      expect(ms.metadata).toEqual({
        title: 'Self-Reliance',
        artist: 'Ralph Waldo Emerson',
        album: 'Essays',
        artwork: [{ src: '/covers/emerson.svg', sizes: '600x900', type: 'image/svg+xml' }],
      })
      expect(ms.playbackState).toBe('paused')
      expect(offered().sort()).toEqual(['nexttrack', 'pause', 'play', 'previoustrack'])
      press('pause')
      press('play')
      press('previoustrack')
      press('nexttrack')
      expect(acts.readAloud.toggle).toHaveBeenCalledOnce()
      session.update(readAloud(engine, true))
      expect(ms.playbackState).toBe('playing')
      press('play')
      press('pause')
      expect(acts.readAloud.toggle).toHaveBeenCalledTimes(2)
      expect(acts.readAloud.prevSentence).toHaveBeenCalledOnce()
      expect(acts.readAloud.nextSentence).toHaveBeenCalledOnce()
    },
  )

  it("titles read aloud with the book's title before it reaches a chapter", () => {
    const { ms, session } = setup()
    session.update({ ...readAloud('cloud'), chapter: null } as NowPlaying)
    expect(ms.metadata).toMatchObject({ title: 'Essays' })
  })

  it("leaves the lock screen alone for read aloud on the device's own engine", () => {
    const { ms, offered, session } = setup()
    session.update(readAloud('device'))
    expect(ms.metadata).toBeNull()
    expect(ms.playbackState).toBe('none')
    expect(offered()).toEqual([])
  })

  it('clears the lock screen when nothing plays', () => {
    const { ms, offered, session } = setup()
    session.update(audiobook(true))
    session.update({ source: null })
    expect(ms.metadata).toBeNull()
    expect(ms.playbackState).toBe('none')
    expect(offered()).toEqual([])
    session.update(readAloud('cloud'))
    session.update(readAloud('device'))
    expect(ms.metadata).toBeNull()
    expect(offered()).toEqual([])
  })

  it("switches read aloud's lock screen to the audiobook that follows it", () => {
    const { ms, press, offered, acts, session } = setup()
    session.update(readAloud('local', true))
    session.update(audiobook(false))
    expect(ms.metadata).toMatchObject({ title: 'The Going', album: 'The Time Machine' })
    expect(ms.playbackState).toBe('none')
    expect(offered()).toHaveLength(7)
    press('play')
    press('nexttrack')
    expect(acts.audiobook.resume).toHaveBeenCalledOnce()
    expect(acts.audiobook.next).toHaveBeenCalledOnce()
    expect(acts.readAloud.toggle).not.toHaveBeenCalled()
    expect(acts.readAloud.nextSentence).not.toHaveBeenCalled()
  })

  it('skips an action this browser does not support', () => {
    const { ms, offered, session } = setup()
    const set = ms.setActionHandler.getMockImplementation()
    ms.setActionHandler.mockImplementation((action, handler) => {
      if (action === 'seekto') throw new TypeError('unsupported')
      set?.(action, handler)
    })
    session.update(audiobook(true))
    expect(offered()).toHaveLength(6)
  })

  it('clears the lock screen when disposed', () => {
    const { ms, offered, session } = setup()
    session.update(readAloud('cloud'))
    session.dispose()
    expect(ms.metadata).toBeNull()
    expect(offered()).toEqual([])
  })

  it('does nothing in a browser without Media Session', () => {
    const session = createLockScreen({}, actions())
    expect(() => {
      session.update(audiobook(true))
      session.update({ source: null })
      session.dispose()
    }).not.toThrow()
    expect(made).toBe(0)
  })
})
