import { browserStorage, clearPrivateThreads } from '~/client/features/ask/thread-store'
import { forgetPrivateDownloads } from '~/client/features/offline/store'
import { forgetPrivateEpisodes } from '~/client/features/player/position-store'
import { clearPrivatePositions } from '~/client/features/read-aloud/position-store'
import { clearPrivateReading } from '~/client/features/reader/continue-reading'
import { readingTime } from '~/client/features/reading-stats/reading-time'
import { type Outbox, syncOutbox } from '~/client/features/sync/outbox'

export const SIGN_OUT_WAIT_MS = 1500

export function clearBrowserAccountData(storage: Storage | null): void {
  clearPrivateReading(storage)
  clearPrivateThreads(storage)
  clearPrivatePositions(storage)
  forgetPrivateEpisodes(storage)
}

export async function beforeSignOut(
  storage: Storage | null,
  outbox: Pick<Outbox, 'flush' | 'enable'>,
  forgetDownloads: () => Promise<void> = forgetPrivateDownloads,
  countTime: () => void = () => readingTime.tick(),
): Promise<void> {
  countTime()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      outbox.flush({ keepalive: true }).catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SIGN_OUT_WAIT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
  clearBrowserAccountData(storage)
  await forgetDownloads().catch(() => {})
  outbox.enable(null)
}

export function signOutSubmit(event: { preventDefault: () => void; currentTarget: HTMLFormElement }): void {
  event.preventDefault()
  const form = event.currentTarget
  void beforeSignOut(browserStorage(), syncOutbox).finally(() => form.submit())
}
