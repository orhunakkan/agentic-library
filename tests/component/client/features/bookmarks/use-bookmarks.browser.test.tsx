import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import { type LoadAnswer, PROBLEM_TEXT } from '~/client/features/bookmarks/bookmark-list'
import { useBookmarks } from '~/client/features/bookmarks/use-bookmarks'
import type { BookmarkErrorCode } from '~/server/bookmarks/actions'
import { type BookmarkView, MAX_BOOKMARKS_PER_BOOK } from '~/shared/bookmarks/bookmarks'
import type { ReaderView } from '~/shared/content/reader-view'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountHook } from '../../../../support/client/mount'

/** The book's bookmarks, as the server function loads them; each test says what it answers. */
const server = vi.hoisted(() => ({ getBookBookmarks: vi.fn() }))
vi.mock('~/server/account-functions', () => server)

/**
 * A bookmark endpoint's answer, as `src/server/bookmarks/actions.ts` sends it. The refusal codes are the handler's own
 * type; the success bodies have no shared type, so they are written to match the handler.
 */
const bookmarkJson = (
  status: number,
  body: { bookmark: BookmarkView } | { ok: true } | ErrorAnswer<BookmarkErrorCode>,
) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The network: each test says what the bookmark endpoints answer, and a request it didn't expect gets no answer. */
let fetchSpy: MockInstance<typeof fetch>

/** Each request sent to the network, as its path, method and JSON body. */
const sent = () =>
  fetchSpy.mock.calls.map(([path, init]) => ({
    path: String(path),
    method: init?.method,
    body: JSON.parse(String(init?.body)) as unknown,
  }))

const pageHref = (printedPage: number) => `/read/moby-dick/${printedPage}`

function bookmark(id: string, printedPage: number): BookmarkView {
  return {
    id,
    status: 'ok',
    opening: 'Call me Ishmael.',
    place: {
      chapterIndex: 0,
      chapterTitle: 'Loomings',
      chapter: null,
      page: printedPage,
      pageHref: pageHref(printedPage),
      label: `p. ${printedPage}`,
      position: printedPage - 1,
    },
    createdAt: '2026-11-01T10:00:00.000Z',
  }
}

/** The reader on a printed page of a paged book, which is all a bookmark reads from the view. */
function viewOf(printedPage: number): ReaderView {
  return {
    book: {
      slug: 'moby-dick',
      title: 'Moby-Dick',
      author: 'Herman Melville',
      href: '/books/moby-dick',
      coverUrl: '/covers/moby-dick.jpg',
      image: null,
      kind: 'paged',
      tone: 'default',
      language: 'en',
      collectionTitle: 'Classics',
    },
    toc: [],
    chapterIndex: 0,
    chapterTitle: 'Loomings',
    isChapterStart: false,
    breadcrumbs: [],
    documentTitle: 'Moby-Dick',
    canonicalPath: pageHref(printedPage),
    nav: {
      prev: { kind: 'start' },
      next: { kind: 'start' },
      status: { chapterNumber: 1, page: printedPage, pageCount: 40 },
      progress: { position: printedPage, total: 40 },
      dots: [],
    },
    page: { kind: 'paged', pageNumber: printedPage, blocks: [], footnotes: [] },
  }
}

const ready = (...bookmarks: BookmarkView[]): LoadAnswer => ({ state: 'ready', bookmarks })

interface Props {
  book: string
  signedIn: boolean
  embedded: boolean
}

const signedInTo = (book: string): Props => ({ book, signedIn: true, embedded: false })

const useBookmarksOf = ({ book, ...options }: Props) => useBookmarks(book, options)

const withToasts = (children: ReactNode) => <ToastProvider>{children}</ToastProvider>

const mountBookmarks = (props: Props) => mountHook(useBookmarksOf, props, withToasts)

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
  server.getBookBookmarks.mockResolvedValue(ready())
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer for this request'))
})

describe('useBookmarks', () => {
  it('loads the book’s bookmarks for a signed-in reader', async () => {
    server.getBookBookmarks.mockResolvedValue(ready(bookmark('b1', 3), bookmark('b2', 9)))
    const hook = mountBookmarks(signedInTo('moby-dick'))
    expect(hook.current.state).toBe('loading')

    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))
    expect(ids(hook.current.items)).toEqual(['b1', 'b2'])
    expect(server.getBookBookmarks).toHaveBeenCalledExactlyOnceWith({ data: { book: 'moby-dick' } })
  })

  it('loads nothing for a signed-out reader, or in an embedded reader', () => {
    const signedOut = mountBookmarks({ book: 'moby-dick', signedIn: false, embedded: false })
    const embedded = mountBookmarks({ book: 'moby-dick', signedIn: true, embedded: true })
    expect(signedOut.current.state).toBe('signed_out')
    expect(embedded.current.state).toBe('off')

    returnAfterAMinute()
    expect(server.getBookBookmarks).not.toHaveBeenCalled()
  })

  it('turns off when the reader becomes embedded, and loads again when it stops being', async () => {
    server.getBookBookmarks.mockResolvedValue(ready(bookmark('b1', 3)))
    const hook = mountBookmarks(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['b1']))

    hook.rerender({ book: 'moby-dick', signedIn: true, embedded: true })
    expect(hook.current.state).toBe('off')
    expect(hook.current.items).toEqual([])
    returnAfterAMinute()
    expect(server.getBookBookmarks).toHaveBeenCalledOnce()

    hook.rerender(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['b1']))
    expect(server.getBookBookmarks).toHaveBeenCalledTimes(2)
  })

  it('shows the new book’s bookmarks, and ignores the old book’s answer when it comes late', async () => {
    const mobyDick = Promise.withResolvers<LoadAnswer>()
    const emma = Promise.withResolvers<LoadAnswer>()
    server.getBookBookmarks.mockReturnValueOnce(mobyDick.promise).mockReturnValueOnce(emma.promise)
    const hook = mountBookmarks(signedInTo('moby-dick'))

    hook.rerender(signedInTo('emma'))
    expect(hook.current.state).toBe('loading')
    expect(server.getBookBookmarks).toHaveBeenLastCalledWith({ data: { book: 'emma' } })
    emma.resolve(ready(bookmark('e1', 5)))
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['e1']))

    mobyDick.resolve(ready(bookmark('m1', 3)))
    await settled()
    expect(ids(hook.current.items)).toEqual(['e1'])
  })

  it('bookmarks the page at once, and takes it away and says why when the server refuses', async () => {
    const answer = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(answer.promise)
    const hook = mountBookmarks(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))

    hook.current.toggle(viewOf(12))
    await vi.waitFor(() => expect(hook.current.onPage(pageHref(12))).toHaveLength(1))
    expect(hook.current.items[0]).toMatchObject({ pending: true, place: { page: 12, label: 'p. 12', position: 11 } })
    expect(sent()).toEqual([
      { path: '/account/bookmarks/new', method: 'POST', body: { book: 'moby-dick', position: { printedPage: 12 } } },
    ])
    await expect.element(page.getByRole('status')).toHaveTextContent('Page bookmarked')

    answer.resolve(bookmarkJson(409, { error: 'quota', scope: 'book', max: MAX_BOOKMARKS_PER_BOOK }))
    await vi.waitFor(() => expect(hook.current.items).toEqual([]))
    await expect.element(page.getByRole('status')).toHaveTextContent(PROBLEM_TEXT['quota-book'])
  })

  it('takes away the bookmark on the page when the page is toggled again', async () => {
    server.getBookBookmarks.mockResolvedValue(ready(bookmark('b1', 3), bookmark('b2', 9)))
    fetchSpy.mockResolvedValue(bookmarkJson(200, { ok: true }))
    const hook = mountBookmarks(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))
    expect(ids(hook.current.onPage(pageHref(9)))).toEqual(['b2'])

    hook.current.toggle(viewOf(9))

    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['b1']))
    expect(hook.current.onPage(pageHref(9))).toEqual([])
    expect(sent()).toEqual([{ path: '/account/bookmarks/b2', method: 'POST', body: { intent: 'delete' } }])
    await expect.element(page.getByRole('status')).toHaveTextContent('Bookmark removed')
  })

  it('reloads when the page comes back after a minute away, until it unmounts', async () => {
    const hook = mountBookmarks(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))

    server.getBookBookmarks.mockResolvedValue(ready(bookmark('b1', 3)))
    returnAfterAMinute()
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['b1']))
    expect(server.getBookBookmarks).toHaveBeenCalledTimes(2)

    hook.unmount()
    returnAfterAMinute()
    expect(server.getBookBookmarks).toHaveBeenCalledTimes(2)
  })
})
