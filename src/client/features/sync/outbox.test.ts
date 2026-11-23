import { describe, expect, it } from 'vitest'
import type { ListeningWrite, ReadingWrite, SettingsWrite, SyncBatch, TimeWrite } from '~/shared/sync/sync'
import { createOutbox, deviceZone, syncOutbox } from './outbox'
import type { SendResult } from './sync-client'

function setup(answers: SendResult[] = [], zone: string | null = 'Europe/Istanbul') {
  let clock = 0
  let timers: { at: number; run: () => void; id: number }[] = []
  let ids = 0
  const sent: { batch: SyncBatch; keepalive: boolean }[] = []
  let inFlight = 0
  let maxInFlight = 0
  let hold: Promise<void> | null = null
  const outbox = createOutbox({
    send: async (batch, { keepalive }) => {
      sent.push({ batch, keepalive })
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (hold) await hold
      await Promise.resolve()
      inFlight--
      return answers.shift() ?? 'ok'
    },
    now: () => clock,
    setTimer: (run, ms) => {
      const id = ++ids
      timers.push({ at: clock + ms, run, id })
      return id
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id)
    },
    zone: () => zone,
  })
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  const advance = async (ms: number) => {
    const until = clock + ms
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      clock = due.at
      timers = timers.filter((t) => t !== due)
      due.run()
      await settle()
    }
    clock = until
  }
  return {
    outbox,
    sent,
    advance,
    settle,
    maxInFlight: () => maxInFlight,
    holdSends: () => {
      let release = () => {}
      hold = new Promise<void>((r) => {
        release = r
      })
      return () => {
        hold = null
        release()
      }
    },
  }
}

const place = (book: string, at: number, page = 1): ReadingWrite => ({
  book,
  position: { chapter: 'chapter-1', page },
  at,
})
const episode = (at: number, positionMs: number | null = 1000): ListeningWrite => ({
  book: 'the-prophet',
  kind: 'episode',
  episode: 'ep_1',
  positionMs,
  at,
})
const time = (id: string, seconds: number, at = seconds): TimeWrite => ({
  id,
  kind: 'reading',
  day: '2026-11-21',
  seconds,
  at,
})
const settings = (at: number): SettingsWrite => ({
  values: { theme: 'dark', font: 'geist', leading: 'normal', measure: 'wide' },
  at,
})

describe('the outbox', () => {
  it('holds and sends nothing while off', async () => {
    const t = setup()
    t.outbox.add(place('emma', 1))
    expect(t.outbox.size()).toBe(0)
    await t.outbox.flush()
    await t.advance(60_000)
    expect(t.sent).toEqual([])
  })

  it('keeps the newest change per item, the later on a tie', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 5, 2))
    t.outbox.add(place('emma', 3, 9))
    t.outbox.add(place('emma', 5, 4))
    t.outbox.add(place('persuasion', 1))
    t.outbox.add(episode(2))
    t.outbox.add(episode(1, 99))
    t.outbox.add(settings(4))
    t.outbox.add(settings(6))
    expect(t.outbox.size()).toBe(4)
    await t.outbox.flush()
    expect(t.sent).toEqual([
      {
        batch: {
          reading: [place('emma', 5, 4), place('persuasion', 1)],
          listening: [episode(2)],
          settings: settings(6),
        },
        keepalive: false,
      },
    ])
    expect(t.outbox.size()).toBe(0)
  })

  it('sends 10 seconds after the first reading or settings change', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    await t.advance(4_000)
    t.outbox.add(place('emma', 2, 3))
    await t.advance(5_999)
    expect(t.sent).toHaveLength(0)
    await t.advance(1)
    expect(t.sent.map((s) => s.batch)).toEqual([{ reading: [place('emma', 2, 3)] }])

    t.outbox.add(settings(3))
    await t.advance(10_000)
    expect(t.sent.at(-1)?.batch).toEqual({ settings: settings(3) })
  })

  it('sends 30 seconds after the first listening change, sooner when a reading change comes', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(episode(1))
    await t.advance(29_999)
    expect(t.sent).toHaveLength(0)
    await t.advance(1)
    expect(t.sent).toHaveLength(1)

    t.outbox.add(episode(2))
    await t.advance(5_000)
    t.outbox.add(place('emma', 3))
    await t.advance(10_000)
    expect(t.sent.at(-1)?.batch).toEqual({ reading: [place('emma', 3)], listening: [episode(2)] })
  })

  it('sends at once on a flush, with keepalive when asked', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    await t.outbox.flush({ keepalive: true })
    expect(t.sent).toEqual([{ batch: { reading: [place('emma', 1)] }, keepalive: true }])
    await t.advance(60_000)
    expect(t.sent).toHaveLength(1)
  })

  it('sends every batch at once on a keepalive flush, since the page is leaving and no answer will come', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    t.outbox.add(time('s1', 365))
    t.holdSends()
    void t.outbox.flush({ keepalive: true })
    await t.settle()
    expect(t.sent).toEqual([
      { batch: { reading: [place('emma', 1)] }, keepalive: true },
      { batch: { time: [time('s1', 365)], zone: 'Europe/Istanbul' }, keepalive: true },
    ])
  })

  it('sends a keepalive flush at once, not after a request that is still out', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(time('s1', 345))
    t.holdSends()
    void t.outbox.flush()
    await t.settle()
    t.outbox.add(time('s1', 365))
    void t.outbox.flush({ keepalive: true })
    await t.settle()
    expect(t.sent.map((s) => [s.batch.time?.[0]?.seconds, s.keepalive])).toEqual([
      [345, false],
      [365, true],
    ])
  })

  it('sends at most 20 of each kind per request, and the rest straight after', async () => {
    const t = setup()
    t.outbox.enable('ada')
    for (let i = 0; i < 45; i++) t.outbox.add(place(`book-${i}`, i))
    for (let i = 0; i < 3; i++) t.outbox.add({ ...episode(i), episode: `ep_${i}` } as ListeningWrite)
    t.outbox.add(settings(1))
    await t.outbox.flush()
    expect(t.sent.map((s) => [s.batch.reading?.length, s.batch.listening?.length, Boolean(s.batch.settings)])).toEqual([
      [20, 3, true],
      [20, undefined, false],
      [5, undefined, false],
    ])
    expect(t.maxInFlight()).toBe(1)
  })

  it('keeps a failed batch, retries on the backoff, and takes a newer change meanwhile', async () => {
    const t = setup(['failed', 'failed', 'failed', 'failed', 'failed', 'ok'])
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    await t.outbox.flush()
    expect(t.outbox.size()).toBe(1)
    t.outbox.add(place('emma', 2, 5))
    await t.advance(9_999)
    expect(t.sent).toHaveLength(1)
    await t.advance(1)
    expect(t.sent).toHaveLength(2)
    expect(t.sent[1]?.batch).toEqual({ reading: [place('emma', 2, 5)] })
    await t.advance(30_000)
    expect(t.sent).toHaveLength(3)
    await t.advance(60_000)
    expect(t.sent).toHaveLength(4)
    await t.advance(299_999)
    expect(t.sent).toHaveLength(4)
    await t.advance(1)
    expect(t.sent).toHaveLength(5)
    await t.advance(300_000)
    expect(t.sent).toHaveLength(6)
    expect(t.outbox.size()).toBe(0)

    t.outbox.add(place('emma', 9))
    await t.advance(10_000)
    expect(t.sent).toHaveLength(7)
  })

  it('drops a batch the server called invalid', async () => {
    const t = setup(['invalid'])
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    await t.outbox.flush()
    expect(t.outbox.size()).toBe(0)
    await t.advance(600_000)
    expect(t.sent).toHaveLength(1)
  })

  it('switches off when the server says signed out', async () => {
    const t = setup(['signed_out'])
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    await t.outbox.flush()
    expect(t.outbox.size()).toBe(0)
    t.outbox.add(place('emma', 2))
    expect(t.outbox.size()).toBe(0)
  })

  it('forgets what it holds when switched off or to another account', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    t.outbox.enable('ada')
    expect(t.outbox.size()).toBe(1)
    t.outbox.enable('bea')
    expect(t.outbox.size()).toBe(0)
    t.outbox.add(place('emma', 1))
    t.outbox.enable(null)
    await t.advance(60_000)
    expect(t.sent).toEqual([])
  })

  it('never sends two batches at once, and keeps a change made while one is out', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    const release = t.holdSends()
    const first = t.outbox.flush()
    await t.settle()
    t.outbox.add(place('emma', 2, 7))
    const second = t.outbox.flush()
    await t.settle()
    expect(t.sent).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(t.maxInFlight()).toBe(1)
    expect(t.sent.map((s) => s.batch.reading?.[0]?.at)).toEqual([1, 2])
    expect(t.outbox.size()).toBe(0)
  })

  it('ignores an answer that comes after it was switched off', async () => {
    const t = setup(['failed'])
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    const release = t.holdSends()
    const sending = t.outbox.flush()
    await t.settle()
    t.outbox.enable(null)
    release()
    await sending
    await t.advance(600_000)
    expect(t.sent).toHaveLength(1)
  })
})

describe('time', () => {
  it('waits 60 seconds, then goes in a batch of its own with the zone, the newest seconds per session', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(time('s1', 5))
    t.outbox.add(time('s1', 10))
    t.outbox.add(time('s2', 3))
    expect(t.outbox.timeSize()).toBe(2)
    await t.advance(59_999)
    expect(t.sent).toEqual([])
    await t.advance(1)
    expect(t.sent.map((s) => s.batch)).toEqual([{ time: [time('s1', 10), time('s2', 3)], zone: 'Europe/Istanbul' }])
    expect(t.outbox.timeSize()).toBe(0)
  })

  it('never shares a batch with places or settings, and goes 20 sessions at a time', async () => {
    const t = setup()
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    t.outbox.add(settings(1))
    for (let i = 0; i < 25; i++) t.outbox.add(time(`s${i}`, i + 1))
    await t.advance(10_000)
    expect(t.sent.map((s) => [Object.keys(s.batch).sort(), s.batch.time?.length])).toEqual([
      [['reading', 'settings'], undefined],
      [['time', 'zone'], 20],
      [['time', 'zone'], 5],
    ])
  })

  it('leaves the zone out when the device has none the server would take', async () => {
    const t = setup([], null)
    t.outbox.enable('ada')
    t.outbox.add(time('s1', 5))
    await t.outbox.flush()
    expect(t.sent.map((s) => s.batch)).toEqual([{ time: [time('s1', 5)] }])
  })

  it('drops only the time a server refuses, so places still go', async () => {
    const t = setup(['ok', 'invalid'])
    t.outbox.enable('ada')
    t.outbox.add(place('emma', 1))
    t.outbox.add(time('s1', 5))
    await t.outbox.flush()
    expect(t.sent).toHaveLength(2)
    expect(t.outbox.size()).toBe(0)
  })
})

describe('deviceZone', () => {
  it('is the browser’s own zone', () => {
    expect(deviceZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})

describe('syncOutbox', () => {
  it('is off until the sync layer starts it', async () => {
    syncOutbox.add(place('emma', 1))
    expect(syncOutbox.size()).toBe(0)
    await syncOutbox.flush()
    syncOutbox.enable(null)
  })
})
