import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import type { ChangeResult } from '~/client/lib/post'
import { mountHook } from '~/client/testing/mount'
import type { HighlightColor } from '~/shared/highlights/colors'
import type { HighlightView } from '~/shared/highlights/group'
import { type HighlightLoadAnswer, PROBLEM_TEXT } from './highlight-list'
import type { HighlightProblem } from './highlights-client'
import { useHighlights } from './use-highlights'

/** The book's highlights, as the server function loads them; each test says what it answers. */
const server = vi.hoisted(() => ({ getBookHighlights: vi.fn() }))
vi.mock('~/server/account-functions', () => server)

/** The highlight endpoints, answered per test. */
const requests = vi.hoisted(() => ({
  createHighlight: vi.fn(),
  updateHighlight: vi.fn(),
  deleteHighlight: vi.fn(),
}))
vi.mock('./highlights-client', () => requests)

function highlight(id: string, color: HighlightColor = 'yellow'): HighlightView {
  return {
    id,
    color,
    note: null,
    text: `Passage ${id}`,
    status: 'ok',
    place: {
      chapterIndex: 0,
      chapterTitle: 'Loomings',
      chapter: 'loomings',
      page: 1,
      pageHref: '/read/moby-dick/loomings',
      href: '/read/moby-dick/loomings',
      label: 'Ch. 1 · p. 1',
      position: 0,
      start: 0,
      end: 10,
    },
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  }
}

const ready = (...highlights: HighlightView[]): HighlightLoadAnswer => ({ state: 'ready', highlights })

interface Props {
  book: string
  signedIn: boolean
  embedded: boolean
}

const signedInTo = (book: string): Props => ({ book, signedIn: true, embedded: false })

const useHighlightsOf = ({ book, ...options }: Props) => useHighlights(book, options)

const withToasts = (children: ReactNode) => <ToastProvider>{children}</ToastProvider>

const mountHighlights = (props: Props) => mountHook(useHighlightsOf, props, withToasts)

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
  server.getBookHighlights.mockResolvedValue(ready())
})

describe('useHighlights', () => {
  it('loads the book’s highlights for a signed-in reader', async () => {
    server.getBookHighlights.mockResolvedValue(ready(highlight('h1'), highlight('h2')))
    const hook = mountHighlights(signedInTo('moby-dick'))
    expect(hook.current.state).toBe('loading')

    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))
    expect(ids(hook.current.items)).toEqual(['h1', 'h2'])
    expect(hook.current.color).toBe('yellow')
    expect(server.getBookHighlights).toHaveBeenCalledExactlyOnceWith({ data: { book: 'moby-dick' } })
  })

  it('loads nothing for a signed-out reader, or in an embedded reader', async () => {
    const signedOut = mountHighlights({ book: 'moby-dick', signedIn: false, embedded: false })
    const embedded = mountHighlights({ book: 'moby-dick', signedIn: true, embedded: true })
    expect(signedOut.current.state).toBe('signed_out')
    expect(embedded.current.state).toBe('off')

    returnAfterAMinute()
    expect(server.getBookHighlights).not.toHaveBeenCalled()
  })

  it('follows the reader signing out and back in', async () => {
    server.getBookHighlights.mockResolvedValue(ready(highlight('h1')))
    const hook = mountHighlights(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['h1']))

    hook.rerender({ book: 'moby-dick', signedIn: false, embedded: false })
    expect(hook.current.state).toBe('signed_out')
    expect(hook.current.items).toEqual([])

    hook.rerender(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['h1']))
    expect(server.getBookHighlights).toHaveBeenCalledTimes(2)
  })

  it('shows the new book’s highlights, and ignores the old book’s answer when it comes late', async () => {
    const mobyDick = Promise.withResolvers<HighlightLoadAnswer>()
    const emma = Promise.withResolvers<HighlightLoadAnswer>()
    server.getBookHighlights.mockReturnValueOnce(mobyDick.promise).mockReturnValueOnce(emma.promise)
    const hook = mountHighlights(signedInTo('moby-dick'))

    hook.rerender(signedInTo('emma'))
    expect(hook.current.state).toBe('loading')
    expect(server.getBookHighlights).toHaveBeenLastCalledWith({ data: { book: 'emma' } })
    emma.resolve(ready(highlight('e1')))
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['e1']))

    mobyDick.resolve(ready(highlight('m1')))
    await settled()
    expect(ids(hook.current.items)).toEqual(['e1'])
  })

  it('shows a new color at once, and puts the old one back and says why when the server refuses it', async () => {
    server.getBookHighlights.mockResolvedValue(ready(highlight('h1', 'yellow')))
    const answer = Promise.withResolvers<ChangeResult<HighlightView, HighlightProblem>>()
    requests.updateHighlight.mockReturnValue(answer.promise)
    const hook = mountHighlights(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))

    hook.current.recolor('h1', 'blue')
    await vi.waitFor(() => expect(hook.current.items[0]?.color).toBe('blue'))
    expect(hook.current.color).toBe('blue')
    answer.resolve({ ok: false, problem: 'failed' })

    await vi.waitFor(() => expect(hook.current.items[0]?.color).toBe('yellow'))
    await expect.element(page.getByRole('status')).toHaveTextContent(PROBLEM_TEXT.failed)
  })

  it('says so when a note is saved', async () => {
    server.getBookHighlights.mockResolvedValue(ready(highlight('h1')))
    requests.updateHighlight.mockResolvedValue({ ok: true, value: { ...highlight('h1'), note: 'Call me Ishmael' } })
    const hook = mountHighlights(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))

    expect(await hook.current.saveNote('h1', '  Call me Ishmael ')).toBe(true)
    await vi.waitFor(() => expect(hook.current.items[0]?.note).toBe('Call me Ishmael'))
    await expect.element(page.getByRole('status')).toHaveTextContent('Note saved')
  })

  it('reloads when the page comes back after a minute away, until it unmounts', async () => {
    const hook = mountHighlights(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))
    expect(server.getBookHighlights).toHaveBeenCalledOnce()

    server.getBookHighlights.mockResolvedValue(ready(highlight('h1')))
    returnAfterAMinute()
    await vi.waitFor(() => expect(ids(hook.current.items)).toEqual(['h1']))
    expect(server.getBookHighlights).toHaveBeenCalledTimes(2)

    hook.unmount()
    returnAfterAMinute()
    expect(server.getBookHighlights).toHaveBeenCalledTimes(2)
  })

  it('stops reloading on return once the reader signs out', async () => {
    const hook = mountHighlights(signedInTo('moby-dick'))
    await vi.waitFor(() => expect(hook.current.state).toBe('ready'))

    hook.rerender({ book: 'moby-dick', signedIn: false, embedded: false })
    returnAfterAMinute()
    expect(server.getBookHighlights).toHaveBeenCalledOnce()
    expect(hook.current.state).toBe('signed_out')
  })
})
