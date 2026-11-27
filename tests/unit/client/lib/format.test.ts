import { describe, expect, it } from 'vitest'
import { formatClock, formatDuration, pad2, relativeTime } from '~/client/lib/format'

describe('formatDuration', () => {
  it('shows hours and minutes', () => {
    expect(formatDuration((9 * 3600 + 18 * 60 + 40) * 1000)).toBe('9 hr 18 min')
  })

  it('drops hours under an hour', () => {
    expect(formatDuration(13 * 60_000 + 39_000)).toBe('13 min')
  })

  it('drops minutes on the exact hour', () => {
    expect(formatDuration(2 * 3_600_000)).toBe('2 hr')
  })

  it('never shows less than a minute', () => {
    expect(formatDuration(20_000)).toBe('1 min')
  })
})

describe('formatClock', () => {
  it('formats minutes and seconds', () => {
    expect(formatClock(12_400)).toBe('00:12')
  })

  it('adds hours when needed', () => {
    expect(formatClock((3600 + 62) * 1000)).toBe('1:01:02')
  })

  it('formats remaining time with a minus sign', () => {
    expect(formatClock(806_000, { remaining: true })).toBe('−13:26')
  })

  it('treats bad input as zero', () => {
    expect(formatClock(Number.NaN)).toBe('00:00')
  })
})

describe('pad2', () => {
  it('zero-pads chapter numbers', () => {
    expect(pad2(3)).toBe('03')
    expect(pad2(42)).toBe('42')
  })
})

describe('relativeTime', () => {
  const now = new Date(2026, 10, 5, 12, 0, 0).getTime()
  const ago = (ms: number) => relativeTime(now - ms, now)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  it('says just now under a minute, and for a time ahead of this clock', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59_000)).toBe('just now')
    expect(ago(-5 * minute)).toBe('just now')
  })

  it('counts minutes, hours and days', () => {
    expect(ago(minute)).toBe('1 minute ago')
    expect(ago(5 * minute + 30_000)).toBe('5 minutes ago')
    expect(ago(hour - 1)).toBe('59 minutes ago')
    expect(ago(hour)).toBe('1 hour ago')
    expect(ago(2 * hour + 59 * minute)).toBe('2 hours ago')
    expect(ago(day)).toBe('yesterday')
    expect(ago(3 * day)).toBe('3 days ago')
    expect(ago(30 * day - 1)).toBe('29 days ago')
  })

  it('gives the date from 30 days, with the year when it was another year', () => {
    expect(relativeTime(new Date(2026, 9, 3, 12).getTime(), now)).toBe('on 3 October')
    expect(relativeTime(new Date(2025, 11, 24, 12).getTime(), now)).toBe('on 24 December 2025')
  })
})
