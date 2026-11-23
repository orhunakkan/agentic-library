import {
  IDLE_MS,
  MAX_LISTENING_STEP_MS,
  MAX_READING_STEP_MS,
  MAX_SESSION_SECONDS,
} from '~/shared/reading-stats/contract'
import { dayIn } from '~/shared/reading-stats/days'
import type { TimeWrite } from '~/shared/sync/sync'

export interface TrackerDeps {
  now: () => number
  newId: () => string
  zone: () => string
  add: (item: TimeWrite) => void
}

export interface Tracker {
  setAccount: (name: string | null) => void
  setReading: (onReaderPage: boolean) => void
  setVisible: (visible: boolean) => void
  setListening: (playing: boolean) => void
  activity: () => void
  tick: () => void
}

interface Session {
  id: string
  kind: TimeWrite['kind']
  day: string
  ms: number
  sent: number
}

const MAX_SESSION_MS = MAX_SESSION_SECONDS * 1000

export function newSessionId(c: Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string } = crypto): string {
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = [...b].map((n) => n.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createTracker(deps: TrackerDeps): Tracker {
  let account: string | null = null
  let reading = false
  let visible = true
  let listening = false
  let lastActivity = Number.NEGATIVE_INFINITY
  let lastTick: number | null = null
  let session: Session | null = null

  const sessionFor = (kind: Session['kind'], day: string): Session => {
    if (!session || session.kind !== kind || session.day !== day || session.ms >= MAX_SESSION_MS) {
      session = { id: deps.newId(), kind, day, ms: 0, sent: 0 }
    }
    return session
  }

  const send = (s: Session, at: number) => {
    const seconds = Math.floor(s.ms / 1000)
    if (seconds < 1 || seconds <= s.sent) return
    s.sent = seconds
    deps.add({ id: s.id, kind: s.kind, day: s.day, seconds, at })
  }

  const count = (kind: Session['kind'], ms: number, at: number) => {
    const day = dayIn(new Date(at), deps.zone())
    let left = ms
    while (left > 0) {
      const s = sessionFor(kind, day)
      const step = Math.min(left, MAX_SESSION_MS - s.ms)
      s.ms += step
      left -= step
      send(s, at)
    }
  }

  const tick = () => {
    const t = deps.now()
    const previous = lastTick
    lastTick = t
    if (account === null || previous === null || t <= previous) return
    if (listening) {
      count('listening', Math.min(t - previous, MAX_LISTENING_STEP_MS), t)
      return
    }
    if (!reading || !visible) return
    const active = Math.min(t, lastActivity + IDLE_MS) - previous
    if (active > 0) count('reading', Math.min(active, MAX_READING_STEP_MS), t)
  }

  return {
    setAccount: (name) => {
      if (name === account) return
      tick()
      account = name
      session = null
    },
    setReading: (onReaderPage) => {
      tick()
      reading = onReaderPage
    },
    setVisible: (next) => {
      tick()
      visible = next
    },
    setListening: (playing) => {
      tick()
      listening = playing
    },
    activity: () => {
      tick()
      lastActivity = deps.now()
    },
    tick,
  }
}
