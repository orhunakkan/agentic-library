import { describe, expect, it } from 'vitest'
import { choiceLabel, label, SLEEP_CHOICES, SLEEP_OFF, startSleep, tick } from '~/client/features/player/sleep'

describe('sleep timer', () => {
  it('offers off, 15 to 60 minutes and the end of the part', () => {
    expect(SLEEP_CHOICES.map((c) => choiceLabel(c, 'chapter'))).toEqual([
      'Off',
      '15 min',
      '30 min',
      '45 min',
      '60 min',
      'End of chapter',
    ])
    expect(choiceLabel('end-of-part', 'episode')).toBe('End of episode')
  })

  it('starts from a choice', () => {
    expect(startSleep('off')).toEqual(SLEEP_OFF)
    expect(startSleep(15)).toEqual({ kind: 'minutes', leftMs: 900_000 })
    expect(startSleep('end-of-part')).toEqual({ kind: 'end-of-part' })
  })

  it('counts down only the time it is ticked, and is done when the minutes run out', () => {
    let state = startSleep(15)
    for (let i = 0; i < 14 * 60; i++) state = tick(state, 1000).state
    expect(state).toEqual({ kind: 'minutes', leftMs: 60_000 })
    expect(tick(state, 0)).toEqual({ state, done: false })
    expect(tick(state, 59_999)).toEqual({ state: { kind: 'minutes', leftMs: 1 }, done: false })
    expect(tick(state, 60_000)).toEqual({ state: SLEEP_OFF, done: true })
  })

  it('never counts down when off or set to the end of the part', () => {
    expect(tick(SLEEP_OFF, 5000)).toEqual({ state: SLEEP_OFF, done: false })
    expect(tick({ kind: 'end-of-part' }, 5000)).toEqual({ state: { kind: 'end-of-part' }, done: false })
  })

  it('labels the dock with the minutes left, rounded up', () => {
    expect(label(SLEEP_OFF, 'chapter')).toBeNull()
    expect(label(startSleep(15), 'episode')).toBe('Sleep · 15 min')
    expect(label({ kind: 'minutes', leftMs: 11 * 60_000 + 1 }, 'episode')).toBe('Sleep · 12 min')
    expect(label({ kind: 'minutes', leftMs: 1 }, 'episode')).toBe('Sleep · 1 min')
    expect(label({ kind: 'end-of-part' }, 'chapter')).toBe('Sleep · End of chapter')
  })
})
