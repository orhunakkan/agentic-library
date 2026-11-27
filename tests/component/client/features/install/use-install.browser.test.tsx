import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { page } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import type { BeforeInstallPromptEvent, InstallStore } from '~/client/features/install/install-offer'
import { useInstall } from '~/client/features/install/use-install'
import { mountHook } from '../../../../support/client/mount'

/**
 * The hook makes one install store for the page and keeps it, so an install in one test would stay installed in the
 * next. Each test makes a real store of its own on the real window, and the hook's store hands every call to it.
 */
const pageStore = vi.hoisted(() => ({ current: null as InstallStore | null }))

vi.mock('~/client/features/install/install-offer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/client/features/install/install-offer')>()
  const current = () => {
    if (!pageStore.current) throw new Error('No install store for this test')
    return pageStore.current
  }
  return {
    ...actual,
    createInstallStore: (): InstallStore => ({
      subscribe: (listener) => current().subscribe(listener),
      getSnapshot: () => current().getSnapshot(),
      onInstalled: (listener) => current().onInstalled(listener),
      promptInstall: () => current().promptInstall(),
    }),
  }
})

const withToasts = (children: ReactNode) => <ToastProvider>{children}</ToastProvider>

/** A `beforeinstallprompt` event as Chromium fires it, with the prompt answered by `outcome`. */
function installPrompt(outcome: 'accepted' | 'dismissed') {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  }) satisfies BeforeInstallPromptEvent
}

describe('useInstall', () => {
  beforeEach(async () => {
    window.__folioInstallPrompt = undefined
    const { createInstallStore } = await vi.importActual<typeof import('~/client/features/install/install-offer')>(
      '~/client/features/install/install-offer',
    )
    pageStore.current = createInstallStore(window)
  })

  it('offers nothing on a desktop page the browser has not offered to install', () => {
    const hook = mountHook(useInstall, undefined, withToasts)
    expect(hook.current.offer).toBe(null)
  })

  it('offers the install once the browser fires beforeinstallprompt, and holds back its own prompt', async () => {
    const hook = mountHook(useInstall, undefined, withToasts)
    const event = installPrompt('accepted')
    window.dispatchEvent(event)
    await expect.poll(() => hook.current.offer).toBe('prompt')
    expect(event.defaultPrevented).toBe(true)
  })

  it("shows the held prompt, answers with the reader's choice and then stops offering", async () => {
    const hook = mountHook(useInstall, undefined, withToasts)
    const event = installPrompt('dismissed')
    window.dispatchEvent(event)
    await expect.poll(() => hook.current.offer).toBe('prompt')
    await expect(hook.current.promptInstall()).resolves.toBe('dismissed')
    expect(event.prompt).toHaveBeenCalledOnce()
    await expect.poll(() => hook.current.offer).toBe(null)
  })

  it('answers unavailable when there is no prompt to show', async () => {
    const hook = mountHook(useInstall, undefined, withToasts)
    await expect(hook.current.promptInstall()).resolves.toBe('unavailable')
  })

  it('says Folio is installed, and stops offering, when the app is installed', async () => {
    const hook = mountHook(useInstall, undefined, withToasts)
    window.dispatchEvent(installPrompt('accepted'))
    await expect.poll(() => hook.current.offer).toBe('prompt')
    window.dispatchEvent(new Event('appinstalled'))
    await expect.element(page.getByRole('status')).toHaveTextContent('Folio is installed.')
    expect(hook.current.offer).toBe(null)
  })

  it('stops listening to the store when it unmounts', () => {
    const store = pageStore.current
    if (!store) throw new Error('No install store for this test')
    const disposers: Mock<() => void>[] = []
    const realSubscribe = store.subscribe
    const realOnInstalled = store.onInstalled
    vi.spyOn(store, 'subscribe').mockImplementation((listener) => {
      const dispose = vi.fn(realSubscribe(listener))
      disposers.push(dispose)
      return dispose
    })
    vi.spyOn(store, 'onInstalled').mockImplementation((listener) => {
      const dispose = vi.fn(realOnInstalled(listener))
      disposers.push(dispose)
      return dispose
    })
    const hook = mountHook(useInstall, undefined, withToasts)
    expect(store.subscribe).toHaveBeenCalled()
    expect(store.onInstalled).toHaveBeenCalledOnce()
    hook.unmount()
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(true)
  })
})
