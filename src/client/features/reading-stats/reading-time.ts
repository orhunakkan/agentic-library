import { useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { shellFor } from '~/client/components/nav-state'
import { deviceZone, syncOutbox } from '~/client/features/sync/outbox'
import { TICK_MS } from '~/shared/reading-stats/contract'
import { createTracker, newSessionId } from './tracker'

const tracker = createTracker({
  now: () => Date.now(),
  newId: () => newSessionId(),
  zone: () => deviceZone() ?? 'UTC',
  add: (item) => syncOutbox.add(item),
})

let counting = false
let reading = false
let listening = false
let timer: ReturnType<typeof setInterval> | null = null

function keepTicking() {
  const want = counting && (reading || listening)
  if (want && timer === null) timer = setInterval(() => tracker.tick(), TICK_MS)
  if (!want && timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

export const readingTime = {
  setListening: (playing: boolean) => {
    tracker.setListening(playing)
    listening = playing
    keepTicking()
  },
  tick: () => tracker.tick(),
}

export async function flushReadingTime(): Promise<boolean> {
  tracker.tick()
  const before = syncOutbox.timeSize()
  if (before === 0) return false
  await syncOutbox.flush()
  return syncOutbox.timeSize() < before
}

const ACTIVITY = ['scroll', 'wheel', 'keydown', 'pointerdown', 'touchstart'] as const

export function useReadingTime(username: string | null): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    const on = username !== null && document.documentElement.dataset.embed !== 'on'
    tracker.setAccount(on ? username : null)
    counting = on
    keepTicking()
  }, [username])

  useEffect(() => {
    reading = shellFor(pathname) === 'reader'
    tracker.setReading(reading)
    tracker.activity()
    keepTicking()
  }, [pathname])

  useEffect(() => {
    tracker.setVisible(document.visibilityState === 'visible')
    const onActivity = () => tracker.activity()
    const onVisibility = () => {
      const visible = document.visibilityState === 'visible'
      tracker.setVisible(visible)
      if (!visible) void syncOutbox.flush({ keepalive: true })
    }
    const onPageHide = () => {
      tracker.tick()
      void syncOutbox.flush({ keepalive: true })
    }
    for (const event of ACTIVITY) document.addEventListener(event, onActivity, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      for (const event of ACTIVITY) document.removeEventListener(event, onActivity, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])
}
