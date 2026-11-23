export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

declare global {
  interface Window {
    __folioInstallPrompt?: BeforeInstallPromptEvent
  }
}

export type InstallOffer = 'prompt' | 'ios' | null
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

export function installOffer({
  standalone,
  hasPrompt,
  iosLike,
}: {
  standalone: boolean
  hasPrompt: boolean
  iosLike: boolean
}): InstallOffer {
  if (standalone) return null
  if (hasPrompt) return 'prompt'
  if (iosLike) return 'ios'
  return null
}

export interface PlatformWindow {
  matchMedia?: (query: string) => { matches: boolean }
  navigator: { standalone?: unknown; maxTouchPoints?: number }
}

export function readPlatform(win: PlatformWindow): { standalone: boolean; iosLike: boolean } {
  let displayStandalone = false
  try {
    displayStandalone = win.matchMedia?.('(display-mode: standalone)').matches === true
  } catch {}
  let iosStandalone: unknown
  let touch = false
  try {
    iosStandalone = win.navigator.standalone
    touch = (win.navigator.maxTouchPoints ?? 0) > 0
  } catch {}
  return {
    standalone: displayStandalone || iosStandalone === true,
    iosLike: typeof iosStandalone === 'boolean' && touch,
  }
}

export interface InstallWindow extends PlatformWindow {
  __folioInstallPrompt?: BeforeInstallPromptEvent
  addEventListener(type: string, listener: (event: Event) => void): void
}

export interface InstallStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): InstallOffer
  onInstalled(listener: () => void): () => void
  promptInstall(): Promise<InstallOutcome>
}

export function createInstallStore(win: InstallWindow): InstallStore {
  const platform = readPlatform(win)
  let held: BeforeInstallPromptEvent | null = win.__folioInstallPrompt ?? null
  win.__folioInstallPrompt = undefined
  let installed = false
  const listeners = new Set<() => void>()
  const installedListeners = new Set<() => void>()
  const compute = () =>
    installOffer({ standalone: platform.standalone || installed, hasPrompt: held !== null, iosLike: platform.iosLike })
  let snapshot = compute()
  const notify = () => {
    snapshot = compute()
    for (const listener of listeners) listener()
  }

  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    held = event as BeforeInstallPromptEvent
    win.__folioInstallPrompt = undefined
    notify()
  })
  win.addEventListener('appinstalled', () => {
    held = null
    installed = true
    notify()
    for (const listener of installedListeners) listener()
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    onInstalled(listener) {
      installedListeners.add(listener)
      return () => installedListeners.delete(listener)
    },
    async promptInstall() {
      const event = held
      if (!event) return 'unavailable'
      try {
        await event.prompt()
        const { outcome } = await event.userChoice
        return outcome === 'accepted' ? 'accepted' : 'dismissed'
      } catch {
        return 'unavailable'
      } finally {
        held = null
        notify()
      }
    },
  }
}
