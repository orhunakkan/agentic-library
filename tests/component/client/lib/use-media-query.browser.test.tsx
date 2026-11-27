import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useMediaQuery } from '~/client/lib/use-media-query'
import { mountHook } from '../../../support/client/mount'

const WIDE = '(min-width: 900px)'

describe('useMediaQuery', () => {
  it('starts with whether the query matches the page now', async () => {
    await page.viewport(1280, 800)
    expect(mountHook(useMediaQuery, WIDE).current).toBe(true)
    await page.viewport(390, 844)
    expect(mountHook(useMediaQuery, WIDE).current).toBe(false)
  })

  it('follows the page as it stops and starts matching', async () => {
    await page.viewport(1280, 800)
    const hook = mountHook(useMediaQuery, WIDE)
    await page.viewport(390, 844)
    await vi.waitFor(() => expect(hook.current).toBe(false))
    await page.viewport(1280, 800)
    await vi.waitFor(() => expect(hook.current).toBe(true))
  })

  it('answers a new query when it is given one', async () => {
    await page.viewport(1280, 800)
    const hook = mountHook(useMediaQuery, WIDE)
    hook.rerender('(max-width: 600px)')
    expect(hook.current).toBe(false)
  })

  it('stops listening when it unmounts', async () => {
    await page.viewport(1280, 800)
    const watched: MediaQueryList[] = []
    const realMatchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const list = realMatchMedia(query)
      watched.push(list)
      vi.spyOn(list, 'removeEventListener')
      return list
    })
    const hook = mountHook(useMediaQuery, WIDE)
    hook.unmount()
    expect(watched.some((list) => vi.mocked(list.removeEventListener).mock.calls.length === 1)).toBe(true)
  })
})
