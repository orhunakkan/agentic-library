import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetFinished, noteFinished } from '~/client/features/reading-stats/finish'

let embed: string | undefined
let onLine = true

function answer(body: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

beforeEach(() => {
  embed = undefined
  onLine = true
  vi.stubGlobal('document', {
    documentElement: {
      dataset: {
        get embed() {
          return embed
        },
      },
    },
  })
  vi.stubGlobal('navigator', {
    get onLine() {
      return onLine
    },
  })
})

describe('noteFinished', () => {
  it('toasts a newly finished book, once per page load', async () => {
    const fetch = answer({ book: 'emma', finished: true, added: true })
    const toast = vi.fn()
    await noteFinished('emma', 'Emma', { signedIn: true, toast })
    await noteFinished('emma', 'Emma', { signedIn: true, toast })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('Finished Emma. It’s in your reading stats.')
  })

  it('says nothing for a book marked before', async () => {
    answer({ book: 'persuasion', finished: true, added: false })
    const toast = vi.fn()
    await noteFinished('persuasion', 'Persuasion', { signedIn: true, toast })
    expect(toast).not.toHaveBeenCalled()
  })

  it('sends nothing signed out, embedded or offline', async () => {
    const fetch = answer({ book: 'x', finished: true, added: true })
    await noteFinished('signed-out', 'X', { signedIn: false, toast: vi.fn() })
    embed = 'on'
    await noteFinished('embedded', 'X', { signedIn: true, toast: vi.fn() })
    embed = undefined
    onLine = false
    await noteFinished('offline', 'X', { signedIn: true, toast: vi.fn() })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('tries again after a failure, or after the mark was taken off', async () => {
    answer({ error: 'failed' }, 500)
    const toast = vi.fn()
    await noteFinished('mansfield-park', 'Mansfield Park', { signedIn: true, toast })
    expect(toast).not.toHaveBeenCalled()
    answer({ book: 'mansfield-park', finished: true, added: true })
    await noteFinished('mansfield-park', 'Mansfield Park', { signedIn: true, toast })
    expect(toast).toHaveBeenCalledTimes(1)
    forgetFinished('mansfield-park')
    const fetch = answer({ book: 'mansfield-park', finished: true, added: true })
    await noteFinished('mansfield-park', 'Mansfield Park', { signedIn: true, toast })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
