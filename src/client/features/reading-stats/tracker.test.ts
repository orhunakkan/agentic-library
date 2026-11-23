import { describe, expect, it } from 'vitest'
import type { TimeWrite } from '~/shared/sync/sync'
import { createTracker, newSessionId } from './tracker'

const NOON = Date.parse('2026-11-21T12:00:00Z')

function setup({ zone = 'UTC', start = NOON } = {}) {
  let clock = start
  let ids = 0
  const sent: TimeWrite[] = []
  const tracker = createTracker({
    now: () => clock,
    newId: () => `s${++ids}`,
    zone: () => zone,
    add: (item) => sent.push(item),
  })
  const pass = (ms: number, every = 5_000) => {
    for (let left = ms; left > 0; left -= every) {
      clock += Math.min(every, left)
      tracker.tick()
    }
  }
  const jump = (ms: number) => {
    clock += ms
  }
  const sessions = () => {
    const out = new Map<string, TimeWrite>()
    for (const item of sent) out.set(item.id, item)
    return [...out.values()]
  }
  const total = (kind?: TimeWrite['kind']) =>
    sessions()
      .filter((s) => !kind || s.kind === kind)
      .reduce((sum, s) => sum + s.seconds, 0)
  return { tracker, pass, jump, sent, sessions, total }
}

function reading(options?: Parameters<typeof setup>[0]) {
  const t = setup(options)
  t.tracker.setAccount('ada')
  t.tracker.setReading(true)
  t.tracker.activity()
  return t
}

describe('reading', () => {
  it('counts while on a reader page, visible, and active in the last 3 minutes', () => {
    const t = reading()
    t.pass(60_000)
    expect(t.total('reading')).toBe(60)
    t.pass(10 * 60_000)
    expect(t.total('reading')).toBe(60 + 120)
    t.tracker.activity()
    t.pass(30_000)
    expect(t.total('reading')).toBe(210)
  })

  it('counts nothing while hidden or off a reader page', () => {
    const t = reading()
    t.tracker.setVisible(false)
    t.pass(60_000)
    expect(t.total()).toBe(0)
    t.tracker.setVisible(true)
    t.tracker.setReading(false)
    t.tracker.activity()
    t.pass(60_000)
    expect(t.total()).toBe(0)
    t.tracker.setReading(true)
    t.tracker.activity()
    t.pass(5_000)
    expect(t.total('reading')).toBe(5)
  })

  it('adds at most 10 seconds for a 10-minute gap between ticks', () => {
    const t = reading()
    t.jump(10 * 60_000)
    t.tracker.tick()
    expect(t.total('reading')).toBe(10)
  })
})

describe('listening', () => {
  it('counts while hidden, and at most 5 minutes a step', () => {
    const t = setup()
    t.tracker.setAccount('ada')
    t.tracker.setVisible(false)
    t.tracker.setListening(true)
    t.pass(3 * 60_000, 60_000)
    expect(t.total('listening')).toBe(180)
    t.jump(20 * 60_000)
    t.tracker.tick()
    expect(t.total('listening')).toBe(180 + 300)
  })

  it('counts once, as listening, while a reader page is read along with the voice', () => {
    const t = reading()
    t.tracker.setListening(true)
    t.pass(60_000)
    expect(t.total('listening')).toBe(60)
    expect(t.total('reading')).toBe(0)
    t.tracker.setListening(false)
    t.tracker.activity()
    t.pass(10_000)
    expect(t.total('reading')).toBe(10)
  })
})

describe('sessions', () => {
  it('roll on a change of kind', () => {
    const t = reading()
    t.pass(20_000)
    t.tracker.setListening(true)
    t.pass(20_000)
    expect(t.sessions().map((s) => [s.id, s.kind, s.seconds])).toEqual([
      ['s1', 'reading', 20],
      ['s2', 'listening', 20],
    ])
  })

  it('roll at local midnight, under the device’s date', () => {
    const t = reading({ zone: 'Asia/Kolkata', start: Date.parse('2026-11-21T18:29:30Z') })
    t.pass(60_000)
    expect(t.sessions().map((s) => [s.day, s.seconds])).toEqual([
      ['2026-11-21', 25],
      ['2026-11-22', 35],
    ])
  })

  it('roll at 14,400 seconds', () => {
    const t = setup()
    t.tracker.setAccount('ada')
    t.tracker.setListening(true)
    t.pass(4 * 3_600_000 + 60_000, 60_000)
    expect(t.sessions().map((s) => s.seconds)).toEqual([14_400, 60])
  })

  it('roll on a change of account, and count nothing while off', () => {
    const t = setup()
    t.tracker.setListening(true)
    t.pass(60_000)
    expect(t.sent).toEqual([])
    t.tracker.setAccount('ada')
    t.pass(10_000)
    t.tracker.setAccount('bob')
    t.pass(10_000)
    t.tracker.setAccount(null)
    t.pass(60_000)
    expect(t.sessions().map((s) => [s.id, s.seconds])).toEqual([
      ['s1', 10],
      ['s2', 10],
    ])
  })

  it('send whole seconds, only as they grow, with when they were counted', () => {
    const t = setup()
    t.tracker.setAccount('ada')
    t.tracker.setListening(true)
    t.pass(400, 400)
    expect(t.sent).toEqual([])
    t.pass(1_000, 400)
    t.pass(1_000, 400)
    const seconds = t.sent.map((s) => s.seconds)
    expect(seconds).toEqual([1, 2])
    expect(t.sent.at(-1)).toEqual({ id: 's1', kind: 'listening', day: '2026-11-21', seconds: 2, at: NOON + 2_200 })
  })
})

describe('newSessionId', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('is the browser’s random UUID where there is one', () => {
    expect(newSessionId({ randomUUID: () => 'from-the-browser', getRandomValues: (a) => a })).toBe('from-the-browser')
    expect(newSessionId()).toMatch(UUID_V4)
  })

  it('makes a version 4 UUID from random bytes outside a secure context', () => {
    const bytes = {
      getRandomValues: <T extends ArrayBufferView | null>(a: T) => {
        new Uint8Array((a as Uint8Array).buffer).fill(255)
        return a
      },
    }
    expect(newSessionId(bytes)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(newSessionId({ getRandomValues: (a) => a })).toMatch(UUID_V4)
  })
})
