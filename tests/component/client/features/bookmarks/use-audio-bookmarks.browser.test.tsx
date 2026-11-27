import type { AnyRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import {
  AUDIO_PROBLEM_TEXT,
  type AudioLoadAnswer,
  type NewAudioBookmark,
} from '~/client/features/bookmarks/audio-bookmark-list'
import { useAudioBookmarks } from '~/client/features/bookmarks/use-audio-bookmarks'
import type { BookmarkErrorCode } from '~/server/bookmarks/actions'
import { type AudioBookmarkView, type EpisodeRef, MAX_AUDIO_BOOKMARKS_PER_USER } from '~/shared/bookmarks/audio'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountHookAt } from '../../../../support/client/router'

/** The book's audio bookmarks, as the server function loads them; each test says what it answers. */
const server = vi.hoisted(() => ({ getAudioBookmarks: vi.fn() }))
vi.mock('~/server/account-functions', () => server)

/**
 * An audio bookmark endpoint's answer, as `src/server/bookmarks/audio-actions.ts` sends it. The refusal codes are the
 * handler's own type; the success bodies have no shared type, so they are written to match the handler.
 */
const audioBookmarkJson = (
  status: number,
  body: { bookmark: AudioBookmarkView } | { ok: true } | ErrorAnswer<BookmarkErrorCode>,
) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The network: each test says what the audio bookmark endpoints answer, and an unexpected request gets no answer. */
let fetchSpy: MockInstance<typeof fetch>

/** Each request sent to the network, as its path, method and JSON body. */
const sent = () =>
  fetchSpy.mock.calls.map(([path, init]) => ({
    path: String(path),
    method: init?.method,
    body: JSON.parse(String(init?.body)) as unknown,
  }))

/**
 * The hook keeps one list per book for the whole page, as the player outlives the pages it plays on, so a list made
 * in one test is still there in the next. Each test bookmarks a book of its own.
 */
let books = 0
const nextBook = () => `podcast-${++books}`

const episodeOne: EpisodeRef = { id: 'ep1', number: 1, title: 'Pilot', durationMs: 1_800_000 }

function moment(id: string, positionMs: number): AudioBookmarkView {
  return { kind: 'episode', id, status: 'ok', positionMs, episode: episodeOne, createdAt: '2026-11-01T10:00:00.000Z' }
}

function newMoment(book: string, positionMs: number): NewAudioBookmark {
  return {
    request: { book, kind: 'episode', episode: 'ep1', positionMs },
    view: { kind: 'episode', positionMs, episode: episodeOne },
    label: 'Pilot · 1:05',
  }
}

const ready = (...bookmarks: AudioBookmarkView[]): AudioLoadAnswer => ({ state: 'ready', bookmarks })

const withToasts = (children: ReactNode) => <ToastProvider>{children}</ToastProvider>

const signedIn = { viewer: { username: 'reader' } }

const mountAudioBookmarks = (book: string, context: { viewer: { username: string } | null } = signedIn) =>
  mountHookAt('/listen', useAudioBookmarks, book, { context, wrap: withToasts })

/** Changes who the root route says is signed in, as signing in or out does once the router loads again. */
async function signInAs(router: AnyRouter, viewer: { username: string } | null) {
  router.update({ ...router.options, context: { viewer } })
  await router.invalidate()
}

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id)

/**
 * Waits until every promise callback already queued has run, so an answer the hook should ignore has had its chance
 * to show. It waits for the next task, not for any length of time.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * The time the page reads, moved on only by `returnAfterAMinute`. It is set before each mount, as a list takes
 * `Date.now` as its clock when it starts listening for the page's return.
 */
let time = 0

/** Hides the page and brings it back a minute later, which is when a list reloads. */
function returnAfterAMinute() {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  time += 60_000
  visibility.mockReturnValue('visible')
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  time = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => time)
  server.getAudioBookmarks.mockResolvedValue(ready())
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer for this request'))
})

describe('useAudioBookmarks', () => {
  it('loads the book’s audio bookmarks for a signed-in reader', async () => {
    const book = nextBook()
    server.getAudioBookmarks.mockResolvedValue(ready(moment('a1', 65_000)))
    const hook = await mountAudioBookmarks(book)
    expect(hook.current.book).toBe(book)

    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))
    expect(ids(hook.current.items)).toEqual(['a1'])
    expect(server.getAudioBookmarks).toHaveBeenCalledExactlyOnceWith({ data: { book } })
  })

  it('loads nothing for a signed-out reader', async () => {
    const hook = await mountAudioBookmarks(nextBook(), { viewer: null })
    expect(hook.current.state).toBe('signed_out')

    returnAfterAMinute()
    expect(server.getAudioBookmarks).not.toHaveBeenCalled()
  })

  it('follows the reader signing out and back in', async () => {
    const book = nextBook()
    server.getAudioBookmarks.mockResolvedValue(ready(moment('a1', 65_000)))
    const hook = await mountAudioBookmarks(book)
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['a1']))

    await signInAs(hook.router, null)
    await vi.waitFor(() => expect(hook.current.state).toBe('signed_out'))
    expect(hook.current.items).toEqual([])
    returnAfterAMinute()
    expect(server.getAudioBookmarks).toHaveBeenCalledOnce()

    await signInAs(hook.router, { username: 'reader' })
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['a1']))
    expect(server.getAudioBookmarks).toHaveBeenCalledTimes(2)
  })

  it('shows a book’s bookmarks at once when the player comes back to it, without loading them again', async () => {
    const book = nextBook()
    server.getAudioBookmarks.mockResolvedValue(ready(moment('a1', 65_000)))
    const first = await mountAudioBookmarks(book)
    await vi.waitFor(() => expect(first.current.state).toBe('ready'))
    first.unmount()

    const again = await mountAudioBookmarks(book)
    expect(again.current.state).toBe('ready')
    expect(ids(again.current.items)).toEqual(['a1'])
    expect(server.getAudioBookmarks).toHaveBeenCalledOnce()
  })

  it('shows the new book’s bookmarks, and ignores the old book’s answer when it comes late', async () => {
    const [oldBook, newBook] = [nextBook(), nextBook()]
    const oldAnswer = Promise.withResolvers<AudioLoadAnswer>()
    const newAnswer = Promise.withResolvers<AudioLoadAnswer>()
    server.getAudioBookmarks.mockReturnValueOnce(oldAnswer.promise).mockReturnValueOnce(newAnswer.promise)
    const hook = await mountAudioBookmarks(oldBook)

    hook.rerender(newBook)
    expect(hook.current.book).toBe(newBook)
    expect(hook.current.state).toBe('loading')
    expect(server.getAudioBookmarks).toHaveBeenLastCalledWith({ data: { book: newBook } })
    newAnswer.resolve(ready(moment('n1', 1_000)))
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['n1']))

    oldAnswer.resolve(ready(moment('o1', 2_000)))
    await settled()
    expect(ids(hook.current.items)).toEqual(['n1'])
  })

  it('bookmarks the moment at once, and takes it away and says why when the server refuses', async () => {
    const book = nextBook()
    const answer = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(answer.promise)
    const hook = await mountAudioBookmarks(book)
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))

    hook.current.add(newMoment(book, 65_000))
    await vi.waitFor(() => expect(hook.current.items).toHaveLength(1))
    expect(hook.current.items[0]).toMatchObject({ kind: 'episode', positionMs: 65_000, pending: true })
    expect(sent()).toEqual([
      { path: '/account/bookmarks/audio/new', method: 'POST', body: newMoment(book, 65_000).request },
    ])
    await expect.element(page.getByRole('status')).toHaveTextContent('Moment bookmarked · Pilot · 1:05')

    answer.resolve(audioBookmarkJson(409, { error: 'quota', scope: 'user', max: MAX_AUDIO_BOOKMARKS_PER_USER }))
    await vi.waitFor(() => expect(hook.current.items).toEqual([]))
    await expect.element(page.getByRole('status')).toHaveTextContent(AUDIO_PROBLEM_TEXT['quota-user'])
  })

  it('puts a removed bookmark back and says why when the server refuses', async () => {
    const book = nextBook()
    server.getAudioBookmarks.mockResolvedValue(ready(moment('a1', 65_000)))
    const answer = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(answer.promise)
    const hook = await mountAudioBookmarks(book)
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['a1']))

    hook.current.remove('a1')
    await vi.waitFor(() => expect(hook.current.items).toEqual([]))
    await expect.element(page.getByRole('status')).toHaveTextContent('Bookmark removed')

    expect(sent()).toEqual([{ path: '/account/bookmarks/audio/a1', method: 'POST', body: { intent: 'delete' } }])
    answer.resolve(audioBookmarkJson(500, { error: 'failed' }))
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['a1']))
    await expect.element(page.getByRole('status')).toHaveTextContent(AUDIO_PROBLEM_TEXT.failed)
  })

  it('reloads when the page comes back after a minute away, until it unmounts', async () => {
    const hook = await mountAudioBookmarks(nextBook())
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))

    server.getAudioBookmarks.mockResolvedValue(ready(moment('a1', 65_000)))
    returnAfterAMinute()
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['a1']))
    expect(server.getAudioBookmarks).toHaveBeenCalledTimes(2)

    hook.unmount()
    returnAfterAMinute()
    expect(server.getAudioBookmarks).toHaveBeenCalledTimes(2)
  })
})
