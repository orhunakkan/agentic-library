import { afterEach, describe, expect, it, vi } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { beforeSignOut, clearBrowserAccountData, SIGN_OUT_WAIT_MS, signOutSubmit } from './sign-out'

const PRIVATE_1234 = privateBookSlug('12341234-0000-4000-8000-000000000000')

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

const entry = (slug: string) => ({ bookSlug: slug, bookTitle: slug, chapterTitle: 'c', href: `/read/${slug}/c`, at: 1 })
const browser = () =>
  memoryStorage({
    'recent-reading': JSON.stringify([entry(PRIVATE_1234), entry('emma')]),
    [`ask:${PRIVATE_1234}`]: '{}',
    'ask:emma': '{}',
    [`read-aloud-pos:${PRIVATE_1234}`]: '{}',
    'read-aloud-pos:emma': '{}',
    [`listen-pos:${privateBookSlug('6f1c0000-0000-4000-8000-000000000000')}:1`]: '{"v":1,"ms":1000,"at":1}',
    'listen-pos:the-prophet:ep_1': '{"v":1,"ms":1000,"at":1}',
    'reader-prefs': '{"theme":"dark"}',
  })
const keys = (storage: Storage) => [...Array(storage.length)].map((_, i) => storage.key(i)).sort()

afterEach(() => {
  vi.useRealTimers()
})

describe('beforeSignOut', () => {
  it('sends what the outbox holds, then forgets private books and switches the outbox off', async () => {
    const order: string[] = []
    const storage = browser()
    const outbox = {
      flush: vi.fn(async (options?: { keepalive?: boolean }) => {
        order.push(`flush ${options?.keepalive}`)
        expect(storage.getItem(`ask:${PRIVATE_1234}`)).not.toBeNull()
      }),
      enable: vi.fn((account: string | null) => void order.push(`enable ${account}`)),
    }
    const forget = vi.fn(async () => void order.push('forget downloads'))
    await beforeSignOut(storage, outbox, forget, () => void order.push('count time'))
    expect(order).toEqual(['count time', 'flush true', 'forget downloads', 'enable null'])
    expect(keys(storage)).toEqual([
      'ask:emma',
      'listen-pos:the-prophet:ep_1',
      'read-aloud-pos:emma',
      'reader-prefs',
      'recent-reading',
    ])
    expect(JSON.parse(storage.getItem('recent-reading') ?? '[]')).toEqual([entry('emma')])
  })

  it('still clears when the outbox takes longer than 1.5 seconds, or fails', async () => {
    vi.useFakeTimers()
    const storage = browser()
    const outbox = { flush: vi.fn(() => new Promise<void>(() => {})), enable: vi.fn() }
    const signingOut = beforeSignOut(storage, outbox)
    await vi.advanceTimersByTimeAsync(SIGN_OUT_WAIT_MS - 1)
    expect(storage.getItem(`ask:${PRIVATE_1234}`)).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await signingOut
    expect(storage.getItem(`ask:${PRIVATE_1234}`)).toBeNull()
    expect(outbox.enable).toHaveBeenCalledWith(null)

    const failing = browser()
    const enable = vi.fn()
    const forget = () => Promise.reject(new Error('blocked'))
    await beforeSignOut(failing, { flush: () => Promise.reject(new Error('offline')), enable }, forget)
    expect(failing.getItem(`read-aloud-pos:${PRIVATE_1234}`)).toBeNull()
    expect(enable).toHaveBeenCalledWith(null)
  })
})

describe('clearBrowserAccountData', () => {
  it('forgets the private books and keeps the catalogue’s places and the settings', () => {
    const storage = browser()
    clearBrowserAccountData(storage)
    expect(keys(storage)).toEqual([
      'ask:emma',
      'listen-pos:the-prophet:ep_1',
      'read-aloud-pos:emma',
      'reader-prefs',
      'recent-reading',
    ])
    clearBrowserAccountData(null)
  })
})

describe('signOutSubmit', () => {
  it('holds the form’s post until the browser is ready, then submits it', async () => {
    const preventDefault = vi.fn()
    const submit = vi.fn()
    signOutSubmit({ preventDefault, currentTarget: { submit } as unknown as HTMLFormElement })
    expect(preventDefault).toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  })
})
