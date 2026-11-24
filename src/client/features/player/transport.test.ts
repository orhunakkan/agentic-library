import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerBook, PlayerEpisode } from '~/shared/content/book-page'
import { privateBookSlug } from '~/shared/content/book-slug'
import { fakeAudio } from '../../../../tests/fixtures/fake-audio'
import { episodeKey, legacyEpisodeKey, SPEED_KEY } from './position-store'
import { createTransport, FADE_MS } from './transport'

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries))
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

const MIN = 60_000

const book: PlayerBook = {
  slug: 'time-machine',
  title: 'The Time Machine',
  author: 'H. G. Wells',
  href: '/library/wells/time-machine',
  coverUrl: '/covers/time-machine.jpg',
  cover: {} as PlayerBook['cover'],
  image: null,
}
const imported: PlayerBook = {
  ...book,
  slug: privateBookSlug('0e0f0000-0000-4000-8000-000000000000'),
  title: 'Imported',
}

const episode = (id: string, number: number, extra: Partial<PlayerEpisode> = {}): PlayerEpisode => ({
  id,
  number,
  title: `Chapter ${number}`,
  durationMs: 10 * MIN,
  audioUrl: `/audio/${id}.mp3`,
  startMs: 0,
  pageHref: null,
  ...extra,
})

const files = [episode('e1', 1), episode('e2', 2), episode('e3', 3)]
const chapters = [
  episode('c1', 1, { audioUrl: '/a/one.mp3', startMs: 0, durationMs: 4 * MIN }),
  episode('c2', 2, { audioUrl: '/a/one.mp3', startMs: 4 * MIN, durationMs: 3 * MIN }),
  episode('c3', 3, { audioUrl: '/a/one.mp3', startMs: 7 * MIN, durationMs: 5 * MIN }),
  episode('c4', 4, { audioUrl: '/a/two.mp3', startMs: 0, durationMs: 6 * MIN }),
]

function setup(entries: Record<string, string> = {}, partEnded: () => 'stop' | 'continue' = () => 'continue') {
  const audio = fakeAudio()
  const storage = memoryStorage(entries)
  let clock = 1_000_000
  const deps = {
    audio,
    storage,
    now: () => clock,
    queue: vi.fn(),
    onBookFinished: vi.fn(),
    arbiter: { beforeAudiobook: vi.fn(), playing: vi.fn(), partEnded: vi.fn(partEnded), closed: vi.fn() },
    onState: vi.fn(),
  }
  const transport = createTransport(deps)
  const at = (ms: number) => {
    audio.currentTime = ms / 1000
    audio.fire('timeupdate')
  }
  const advance = (ms: number) => {
    clock += ms
    vi.advanceTimersByTime(ms)
  }
  return { audio, storage, deps, transport, at, advance }
}

const saved = (ms: number) => JSON.stringify({ v: 1, ms, at: 1 })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('starting an episode', () => {
  it('plays it from its remembered place', () => {
    const { audio, transport, deps } = setup({ [episodeKey(book.slug, 'e2')]: saved(3 * MIN) })
    transport.play(book, files, 'e2')
    expect(deps.arbiter.beforeAudiobook).toHaveBeenCalledOnce()
    expect(audio.src).toBe('/audio/e2.mp3')
    expect(audio.currentTime).toBe(180)
    expect(audio.play).toHaveBeenCalledOnce()
    expect(transport.state()).toMatchObject({ book, current: files[1], positionMs: 3 * MIN, durationMs: 10 * MIN })
    expect(transport.state()).toMatchObject({ hasPrev: true, hasNext: true })
    expect(transport.loaded()).toBe(true)
  })

  it('starts from the beginning within 10 seconds of the end', () => {
    const { audio, transport } = setup({ [episodeKey(book.slug, 'e1')]: saved(10 * MIN - 9000) })
    transport.play(book, files, 'e1')
    expect(audio.currentTime).toBe(0)
    expect(transport.state().positionMs).toBe(0)
  })

  it('reads a position saved under the old key, for a catalogue episode', () => {
    const { audio, transport } = setup({ [legacyEpisodeKey('/audio/e1.mp3')]: String(2 * MIN) })
    transport.play(book, files, 'e1')
    expect(audio.currentTime).toBe(120)
  })

  it('toggles the episode already loaded', () => {
    const { audio, transport, deps } = setup()
    transport.play(book, files, 'e1')
    audio.fire('play')
    transport.play(book, files, 'e1')
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(deps.arbiter.beforeAudiobook).toHaveBeenCalledOnce()
  })

  it('plays from a given time, kept within the episode', () => {
    const { audio, transport } = setup({ [episodeKey(book.slug, 'e1')]: saved(3 * MIN) })
    transport.playAt(book, files, 'e1', 20 * MIN)
    expect(audio.currentTime).toBe(600)
    expect(transport.state().positionMs).toBe(10 * MIN)
    transport.playAt(book, files, 'e1', 90_000)
    expect(audio.currentTime).toBe(90)
    expect(transport.state().positionMs).toBe(90_000)
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('says it is not playing when the browser refuses to play, and tells the arbiter', async () => {
    const { audio, transport, deps } = setup()
    audio.refuse = 'NotSupportedError'
    transport.play(book, files, 'e1')
    audio.fire('play')
    await vi.runAllTimersAsync()
    expect(transport.state().playing).toBe(false)
    expect(deps.arbiter.playing).toHaveBeenLastCalledWith('audiobook', false)
  })

  it('resumes the episode loaded (the lock screen), and does nothing with none', () => {
    const { audio, transport } = setup()
    transport.resume()
    expect(audio.play).not.toHaveBeenCalled()
    transport.play(book, files, 'e1')
    transport.resume()
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('follows the element playing and pausing, and tells the arbiter', () => {
    const { audio, transport, deps } = setup()
    transport.play(book, files, 'e1')
    audio.fire('play')
    expect(transport.state().playing).toBe(true)
    expect(deps.arbiter.playing).toHaveBeenLastCalledWith('audiobook', true)
    audio.fire('pause')
    expect(transport.state().playing).toBe(false)
    expect(deps.arbiter.playing).toHaveBeenLastCalledWith('audiobook', false)
    expect(deps.onState).toHaveBeenLastCalledWith(expect.objectContaining({ playing: false }))
  })

  it('pauses, and stays loaded', () => {
    const { audio, transport } = setup()
    transport.play(book, files, 'e1')
    transport.pause()
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(transport.loaded()).toBe(true)
  })

  it('does nothing with an episode it is not given', () => {
    const { audio, transport } = setup()
    transport.play(book, files, 'nope')
    transport.playAt(book, files, 'nope', 0)
    expect(audio.play).not.toHaveBeenCalled()
    expect(transport.loaded()).toBe(false)
  })
})

describe('a chapter inside a shared file', () => {
  it('plays the next chapter on without a seek', () => {
    const { audio, transport, at } = setup()
    transport.play(imported, chapters, 'c1')
    at(4 * MIN - 1000)
    const seekedTo = audio.currentTime
    transport.next()
    expect(transport.state().current?.id).toBe('c2')
    expect(audio.currentTime).toBe(seekedTo)
    expect(audio.src).toBe('/a/one.mp3')
  })

  it('moves the element within the file for a chapter further on', () => {
    const { audio, transport } = setup()
    transport.play(imported, chapters, 'c1')
    transport.play(imported, chapters, 'c3')
    expect(audio.currentTime).toBe(7 * 60)
  })

  it("reports and takes the chapter's own time, and keeps seeking inside it", () => {
    const { audio, transport, at } = setup()
    transport.play(imported, chapters, 'c2')
    expect(audio.currentTime).toBe(4 * 60)
    at(5 * MIN)
    expect(transport.state().positionMs).toBe(MIN)
    transport.seek(2 * MIN)
    expect(audio.currentTime).toBe(6 * 60)
    transport.seek(9 * MIN)
    expect(audio.currentTime).toBe(7 * 60)
    expect(transport.state().positionMs).toBe(3 * MIN)
    transport.skip(-10 * MIN)
    expect(audio.currentTime).toBe(4 * 60)
    expect(transport.state().positionMs).toBe(0)
  })

  it("converts the lock screen's time in the file", () => {
    const { audio, transport } = setup()
    transport.play(imported, chapters, 'c2')
    transport.seekFile(5 * MIN)
    expect(audio.currentTime).toBe(5 * 60)
    expect(transport.state().positionMs).toBe(MIN)
    transport.seekFile(MIN)
    expect(audio.currentTime).toBe(4 * 60)
  })

  it('keeps its own length when the file reports its', () => {
    const { audio, transport } = setup()
    transport.play(imported, chapters, 'c2')
    audio.duration = 12 * 60
    audio.fire('loadedmetadata')
    expect(transport.state().durationMs).toBe(3 * MIN)
  })

  it('notices its end on timeupdate, once', () => {
    const { audio, transport, at, storage } = setup()
    transport.play(imported, chapters, 'c1')
    at(4 * MIN - 100)
    at(4 * MIN - 50)
    expect(transport.state().current?.id).toBe('c2')
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(JSON.parse(storage.getItem(episodeKey(imported.slug, 'c1')) ?? '{}')).toMatchObject({ done: true })
  })
})

describe('a whole file', () => {
  it("seeks within the file's own length, once the element knows it", () => {
    const { audio, transport } = setup()
    transport.play(book, files, 'e1')
    audio.duration = 11 * 60
    audio.fire('loadedmetadata')
    expect(transport.state().durationMs).toBe(11 * MIN)
    transport.seek(30 * MIN)
    expect(audio.currentTime).toBe(11 * 60)
    expect(transport.state().positionMs).toBe(11 * MIN)
  })

  it('ignores a length the element does not know', () => {
    const { audio, transport } = setup()
    transport.play(book, files, 'e1')
    audio.duration = Number.POSITIVE_INFINITY
    audio.fire('loadedmetadata')
    expect(transport.state().durationMs).toBe(10 * MIN)
  })

  it('Previous on the first episode goes back to its start', () => {
    const { audio, transport, at } = setup()
    transport.play(book, files, 'e1')
    at(MIN)
    transport.prev()
    expect(audio.currentTime).toBe(0)
    expect(transport.state().current?.id).toBe('e1')
  })

  it('Previous and Next move through the book', () => {
    const { audio, transport } = setup()
    transport.play(book, files, 'e2')
    transport.prev()
    expect(audio.src).toBe('/audio/e1.mp3')
    transport.next()
    transport.next()
    expect(audio.src).toBe('/audio/e3.mp3')
    expect(transport.state()).toMatchObject({ hasPrev: true, hasNext: false })
    transport.next()
    expect(audio.src).toBe('/audio/e3.mp3')
  })
})

describe('saving where an episode is', () => {
  const stored = (storage: Storage, b = book, id = 'e1') =>
    JSON.parse(storage.getItem(episodeKey(b.slug, id)) ?? 'null')

  it('saves as it plays, each time it has moved 5 seconds', () => {
    const { transport, at, storage, deps } = setup()
    transport.play(book, files, 'e1')
    at(6000)
    expect(stored(storage)).toMatchObject({ ms: 6000 })
    at(9000)
    expect(stored(storage)).toMatchObject({ ms: 6000 })
    at(11_500)
    expect(stored(storage)).toMatchObject({ ms: 11_500 })
    expect(deps.queue).toHaveBeenCalledTimes(2)
    expect(deps.queue).toHaveBeenLastCalledWith({
      book: book.slug,
      kind: 'episode',
      episode: 'e1',
      positionMs: 11_500,
      at: 1_000_000,
    })
  })

  it('saves on pause and on close', () => {
    const { audio, transport, storage, deps } = setup()
    transport.play(book, files, 'e1')
    audio.currentTime = 2
    audio.fire('pause')
    expect(stored(storage)).toMatchObject({ ms: 2000 })
    audio.currentTime = 3
    transport.close()
    expect(stored(storage)).toMatchObject({ ms: 3000 })
    expect(deps.queue).toHaveBeenCalledTimes(2)
  })

  it('tells the arbiter it closed only when an episode was loaded', () => {
    const { transport, deps } = setup()
    transport.close()
    expect(deps.arbiter.closed).not.toHaveBeenCalled()
    transport.play(book, files, 'e1')
    transport.close()
    expect(deps.arbiter.closed).toHaveBeenCalledOnce()
  })

  it('saves nothing once the episode is marked finished', () => {
    const { audio, transport, storage } = setup()
    transport.play(book, files, 'e3')
    audio.currentTime = 600
    audio.fire('ended')
    audio.fire('pause')
    audio.fire('timeupdate')
    transport.close()
    expect(stored(storage, book, 'e3')).toMatchObject({ done: true })
  })

  it('takes the old key away for a catalogue episode only', () => {
    const legacy = legacyEpisodeKey('/audio/e1.mp3')
    const catalogue = setup({ [legacy]: '1000' })
    catalogue.transport.play(book, files, 'e1')
    catalogue.at(7000)
    expect(catalogue.storage.getItem(legacy)).toBeNull()

    const own = legacyEpisodeKey('/a/one.mp3')
    const mine = setup({ [own]: '1000' })
    mine.transport.play(imported, chapters, 'c1')
    mine.at(7000)
    expect(mine.storage.getItem(own)).toBe('1000')
  })
})

describe("an episode's end", () => {
  it('marks it finished and plays the next', () => {
    const { audio, transport, deps } = setup()
    transport.play(book, files, 'e1')
    audio.fire('ended')
    expect(deps.queue).toHaveBeenLastCalledWith(expect.objectContaining({ episode: 'e1', positionMs: null }))
    expect(audio.src).toBe('/audio/e2.mp3')
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(deps.onBookFinished).not.toHaveBeenCalled()
  })

  it('lines the next one up paused when the arbiter says stop', () => {
    const { audio, transport } = setup({}, () => 'stop')
    transport.play(imported, chapters, 'c1')
    audio.paused = false
    audio.currentTime = 4 * 60
    audio.fire('timeupdate')
    expect(audio.pause).toHaveBeenCalled()
    expect(transport.state().current?.id).toBe('c2')
    expect(audio.play).toHaveBeenCalledOnce()
  })

  it('reports the book finished after its last episode', () => {
    const { audio, transport, deps } = setup()
    transport.play(book, files, 'e3')
    audio.fire('ended')
    audio.fire('ended')
    expect(deps.onBookFinished).toHaveBeenCalledOnce()
    expect(deps.onBookFinished).toHaveBeenCalledWith(book)
  })

  it('is noticed again after a seek back', () => {
    const { audio, transport, deps } = setup()
    transport.play(book, files, 'e3')
    audio.fire('ended')
    transport.seek(0)
    audio.fire('ended')
    expect(deps.onBookFinished).toHaveBeenCalledTimes(2)
  })
})

describe('speed', () => {
  it('cycles and is remembered', () => {
    const { audio, transport, storage } = setup()
    transport.play(book, files, 'e1')
    transport.cycleSpeed()
    expect(audio.playbackRate).toBe(1.25)
    expect(storage.getItem(SPEED_KEY)).toBe('1.25')
    const again = setup({ [SPEED_KEY]: '1.25' })
    expect(again.transport.state().speed).toBe(1.25)
    again.transport.play(book, files, 'e1')
    expect(again.audio.playbackRate).toBe(1.25)
  })
})

describe('the fade', () => {
  it('lowers the volume over 10 seconds, then pauses and puts it back', () => {
    const { audio, transport, advance } = setup()
    transport.play(book, files, 'e1')
    audio.volume = 0.8
    transport.fadeOut()
    advance(FADE_MS / 2)
    expect(audio.volume).toBeCloseTo(0.4)
    expect(audio.pause).not.toHaveBeenCalled()
    advance(FADE_MS / 2)
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.volume).toBe(0.8)
  })

  it('is cancelled by toggle', () => {
    const { audio, transport, advance } = setup()
    transport.play(book, files, 'e1')
    audio.paused = false
    transport.fadeOut()
    advance(FADE_MS / 2)
    transport.toggle()
    expect(audio.volume).toBe(1)
    advance(FADE_MS)
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.volume).toBe(1)
  })
})

describe('closing', () => {
  it('unloads the element', () => {
    const { audio, transport } = setup()
    transport.play(book, files, 'e1')
    transport.close()
    expect(audio.src).toBe('')
    expect(audio.load).toHaveBeenCalledOnce()
    expect(transport.loaded()).toBe(false)
    expect(transport.state()).toMatchObject({ book: null, current: null, episodes: [], positionMs: 0, hasNext: false })
  })

  it('does nothing to the element with nothing loaded', () => {
    const { audio, transport } = setup()
    transport.close()
    transport.toggle()
    transport.seek(1000)
    transport.seekFile(1000)
    transport.next()
    expect(audio.load).not.toHaveBeenCalled()
    expect(audio.play).not.toHaveBeenCalled()
  })

  it('hears nothing from the element once disposed', () => {
    const { audio, transport } = setup()
    transport.play(book, files, 'e1')
    transport.dispose()
    audio.fire('play')
    expect(transport.state().playing).toBe(false)
  })
})
