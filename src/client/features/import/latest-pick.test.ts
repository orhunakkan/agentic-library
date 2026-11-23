import { describe, expect, it } from 'vitest'
import { latestPick } from './latest-pick'

describe('latestPick', () => {
  it('applies the current pick’s result', () => {
    const picks = latestPick()
    const pick = picks.start()
    expect(picks.isCurrent(pick)).toBe(true)
  })

  it('ignores an older pick’s result once another file is picked', () => {
    const picks = latestPick()
    const first = picks.start()
    const second = picks.start()
    expect(picks.isCurrent(first)).toBe(false)
    expect(picks.isCurrent(second)).toBe(true)
  })

  it('makes every pick stale on Cancel', () => {
    const picks = latestPick()
    const first = picks.start()
    const second = picks.start()
    picks.invalidate()
    expect(picks.isCurrent(first)).toBe(false)
    expect(picks.isCurrent(second)).toBe(false)
  })

  it('applies a re-read of the current pick, which stays current too', () => {
    const picks = latestPick()
    const pick = picks.start()
    const reread = picks.current()
    expect(picks.isCurrent(reread)).toBe(true)
    expect(picks.isCurrent(pick)).toBe(true)
  })

  it('ignores a re-read once another file is picked, or on Cancel', () => {
    const picks = latestPick()
    picks.start()
    const reread = picks.current()
    picks.start()
    expect(picks.isCurrent(reread)).toBe(false)

    const again = picks.current()
    picks.invalidate()
    expect(picks.isCurrent(again)).toBe(false)
  })
})
