import { describe, expect, it, vi } from 'vitest'
import {
  type BeforeInstallPromptEvent,
  createInstallStore,
  type InstallWindow,
  installOffer,
  readPlatform,
} from '~/client/features/install/install-offer'

describe('installOffer', () => {
  it('offers nothing when running installed, whatever else is true', () => {
    for (const hasPrompt of [true, false]) {
      for (const iosLike of [true, false]) {
        expect(installOffer({ standalone: true, hasPrompt, iosLike })).toBeNull()
      }
    }
  })

  it('offers the prompt over the iOS steps, the iOS steps on iOS, and nothing elsewhere', () => {
    expect(installOffer({ standalone: false, hasPrompt: true, iosLike: true })).toBe('prompt')
    expect(installOffer({ standalone: false, hasPrompt: true, iosLike: false })).toBe('prompt')
    expect(installOffer({ standalone: false, hasPrompt: false, iosLike: true })).toBe('ios')
    expect(installOffer({ standalone: false, hasPrompt: false, iosLike: false })).toBeNull()
  })
})

describe('readPlatform', () => {
  const media = (matches: boolean) => () => ({ matches })

  it('is standalone from the display mode or from iOS’s navigator.standalone', () => {
    expect(readPlatform({ matchMedia: media(true), navigator: {} }).standalone).toBe(true)
    expect(readPlatform({ matchMedia: media(false), navigator: { standalone: true, maxTouchPoints: 5 } })).toEqual({
      standalone: true,
      iosLike: true,
    })
  })

  it('is iOS-like only with a boolean navigator.standalone and touch', () => {
    expect(readPlatform({ matchMedia: media(false), navigator: { standalone: false, maxTouchPoints: 5 } })).toEqual({
      standalone: false,
      iosLike: true,
    })
    expect(
      readPlatform({ matchMedia: media(false), navigator: { standalone: false, maxTouchPoints: 0 } }).iosLike,
    ).toBe(false)
    expect(readPlatform({ matchMedia: media(false), navigator: { maxTouchPoints: 5 } })).toEqual({
      standalone: false,
      iosLike: false,
    })
    expect(
      readPlatform({ matchMedia: media(false), navigator: { standalone: 'yes', maxTouchPoints: 5 } }).iosLike,
    ).toBe(false)
  })

  it('treats a throwing matchMedia or navigator, or none, as a browser tab', () => {
    const throwing = () => {
      throw new Error('blocked')
    }
    expect(readPlatform({ matchMedia: throwing, navigator: { standalone: false, maxTouchPoints: 1 } })).toEqual({
      standalone: false,
      iosLike: true,
    })
    expect(readPlatform({ navigator: {} })).toEqual({ standalone: false, iosLike: false })
    const navigator = {
      get standalone() {
        return throwing()
      },
    }
    expect(readPlatform({ matchMedia: media(false), navigator })).toEqual({ standalone: false, iosLike: false })
  })
})

function fakeWindow(options: { held?: BeforeInstallPromptEvent; navigator?: InstallWindow['navigator'] } = {}) {
  const listeners: Record<string, (event: Event) => void> = {}
  const win: InstallWindow = {
    matchMedia: () => ({ matches: false }),
    navigator: options.navigator ?? { maxTouchPoints: 0 },
    __folioInstallPrompt: options.held,
    addEventListener: (type, listener) => {
      listeners[type] = listener
    },
  }
  return { win, fire: (type: string, event = new Event(type)) => listeners[type]?.(event) }
}

function promptEvent(outcome: 'accepted' | 'dismissed' | 'reject' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
  const prompt = vi.fn(async () => {
    if (outcome === 'reject') throw new Error('InvalidStateError')
  })
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome: outcome === 'reject' ? 'dismissed' : outcome }),
  })
  return { event, prompt }
}

describe('createInstallStore', () => {
  it('offers nothing on Chromium until there is an event', () => {
    const { win } = fakeWindow()
    expect(createInstallStore(win).getSnapshot()).toBeNull()
  })

  it('takes the event the boot script caught, and clears the window’s copy', () => {
    const { event } = promptEvent()
    const { win } = fakeWindow({ held: event })
    expect(createInstallStore(win).getSnapshot()).toBe('prompt')
    expect(win.__folioInstallPrompt).toBeUndefined()
  })

  it('holds a later beforeinstallprompt, keeping the browser’s banner away, and tells subscribers', () => {
    const { win, fire } = fakeWindow()
    const store = createInstallStore(win)
    const told = vi.fn()
    store.subscribe(told)
    const { event } = promptEvent()
    fire('beforeinstallprompt', event)
    expect(event.defaultPrevented).toBe(true)
    expect(store.getSnapshot()).toBe('prompt')
    expect(told).toHaveBeenCalledTimes(1)
  })

  it('drops the event and offers nothing more once installed, telling both kinds of listener', () => {
    const { event } = promptEvent()
    const { win, fire } = fakeWindow({ held: event })
    const store = createInstallStore(win)
    const told = vi.fn()
    const installed = vi.fn()
    store.subscribe(told)
    store.onInstalled(installed)
    fire('appinstalled')
    expect(store.getSnapshot()).toBeNull()
    expect(told).toHaveBeenCalledTimes(1)
    expect(installed).toHaveBeenCalledTimes(1)
  })

  it('stays quiet on iOS once installed too', () => {
    const { win, fire } = fakeWindow({ navigator: { standalone: false, maxTouchPoints: 5 } })
    const store = createInstallStore(win)
    expect(store.getSnapshot()).toBe('ios')
    fire('appinstalled')
    expect(store.getSnapshot()).toBeNull()
  })

  for (const outcome of ['accepted', 'dismissed'] as const) {
    it(`prompts, answers ${outcome}, and drops the used event`, async () => {
      const { event, prompt } = promptEvent(outcome)
      const { win } = fakeWindow({ held: event })
      const store = createInstallStore(win)
      const told = vi.fn()
      store.subscribe(told)
      await expect(store.promptInstall()).resolves.toBe(outcome)
      expect(prompt).toHaveBeenCalledTimes(1)
      expect(store.getSnapshot()).toBeNull()
      expect(told).toHaveBeenCalledTimes(1)
    })
  }

  it('answers unavailable with no event held, or when the browser refuses the prompt', async () => {
    const { win } = fakeWindow()
    await expect(createInstallStore(win).promptInstall()).resolves.toBe('unavailable')
    const { event } = promptEvent('reject')
    const refused = createInstallStore(fakeWindow({ held: event }).win)
    await expect(refused.promptInstall()).resolves.toBe('unavailable')
    expect(refused.getSnapshot()).toBeNull()
  })

  it('stops telling a subscriber that unsubscribed', () => {
    const { win, fire } = fakeWindow()
    const store = createInstallStore(win)
    const told = vi.fn()
    const installed = vi.fn()
    store.subscribe(told)()
    store.onInstalled(installed)()
    fire('beforeinstallprompt', promptEvent().event)
    fire('appinstalled')
    expect(told).not.toHaveBeenCalled()
    expect(installed).not.toHaveBeenCalled()
  })

  it('keeps the same snapshot between changes, as useSyncExternalStore needs', () => {
    const { win } = fakeWindow({ navigator: { standalone: false, maxTouchPoints: 5 } })
    const store = createInstallStore(win)
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })
})
