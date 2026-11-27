import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { syncOutbox } from '~/client/features/sync/outbox'
import { useSync } from '~/client/features/sync/use-sync'
import { mountHook } from '../../../../support/client/mount'

/**
 * The hook makes the page's one sync engine on first use and keeps it. The engine is its own unit-tested module, so
 * here it is a stand-in whose calls show what the hook asked of it.
 */
const engine = vi.hoisted(() => ({
  start: vi.fn(async (_username: string) => {}),
  stop: vi.fn(() => {}),
  pull: vi.fn(async () => {}),
  pullIfStale: vi.fn(async (_ms: number) => {}),
}))

vi.mock('~/client/features/sync/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/client/features/sync/engine')>()),
  createSync: () => engine,
}))

/** The engine reads the account's sync state through a server function, which imports TanStack Start. */
vi.mock('~/server/account-functions', () => ({ getSyncState: vi.fn() }))

const STALE_MS = 60_000

/** Puts the page in the background or brings it back, as the browser does when the reader switches tabs. */
function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useSync', () => {
  beforeEach(() => {
    for (const call of Object.values(engine)) call.mockClear()
    vi.spyOn(syncOutbox, 'flush').mockResolvedValue()
  })

  it("starts syncing the signed-in reader's account", () => {
    mountHook(useSync, 'ada')
    expect(engine.start).toHaveBeenCalledExactlyOnceWith('ada')
    expect(engine.stop).not.toHaveBeenCalled()
  })

  it('stops syncing when no one is signed in', () => {
    mountHook(useSync, null)
    expect(engine.stop).toHaveBeenCalledOnce()
    expect(engine.start).not.toHaveBeenCalled()
  })

  it('stops syncing on an embedded page, even for a signed-in reader', () => {
    document.documentElement.dataset.embed = 'on'
    onTestFinished(() => {
      delete document.documentElement.dataset.embed
    })
    mountHook(useSync, 'ada')
    expect(engine.stop).toHaveBeenCalledOnce()
    expect(engine.start).not.toHaveBeenCalled()
  })

  it('follows the reader as they switch accounts and sign out', () => {
    const hook = mountHook<string | null, void>(useSync, 'ada')
    hook.rerender('grace')
    expect(engine.start.mock.calls).toEqual([['ada'], ['grace']])
    hook.rerender(null)
    expect(engine.stop).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('focus'))
    expect(engine.pullIfStale).not.toHaveBeenCalled()
  })

  it('sends what is waiting when the page goes to the background or is left', () => {
    mountHook(useSync, 'ada')
    setVisibility('hidden')
    expect(syncOutbox.flush).toHaveBeenCalledExactlyOnceWith({ keepalive: true })
    window.dispatchEvent(new Event('pagehide'))
    expect(syncOutbox.flush).toHaveBeenCalledTimes(2)
    expect(syncOutbox.flush).toHaveBeenLastCalledWith({ keepalive: true })
  })

  it('reads the account again when the page comes back after a minute or more, not sooner', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mountHook(useSync, 'ada')
    setVisibility('hidden')
    clock.mockReturnValue(1_000_000 + STALE_MS - 1)
    setVisibility('visible')
    expect(engine.pull).not.toHaveBeenCalled()

    setVisibility('hidden')
    clock.mockReturnValue(1_000_000 + STALE_MS - 1 + STALE_MS)
    setVisibility('visible')
    expect(engine.pull).toHaveBeenCalledOnce()
  })

  it('does not read the account again on a visible page it never saw hidden', () => {
    mountHook(useSync, 'ada')
    setVisibility('visible')
    expect(engine.pull).not.toHaveBeenCalled()
  })

  it('reads the account again on focus if the last read is a minute old', () => {
    mountHook(useSync, 'ada')
    window.dispatchEvent(new Event('focus'))
    expect(engine.pullIfStale).toHaveBeenCalledExactlyOnceWith(STALE_MS)
  })

  it('stops listening to the page when it unmounts', () => {
    const hook = mountHook(useSync, 'ada')
    hook.unmount()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pagehide'))
    setVisibility('hidden')
    expect(engine.pullIfStale).not.toHaveBeenCalled()
    expect(syncOutbox.flush).not.toHaveBeenCalled()
  })
})
