import { describe, expect, it } from 'vitest'
import { isStillConfirming, nextPollDelay } from './confirm-wait'

describe('the wait for Paddle', () => {
  it('asks every 2 s for a minute, then every 10 s', () => {
    expect([nextPollDelay(0), nextPollDelay(58_000), nextPollDelay(60_000), nextPollDelay(600_000)]).toEqual([
      2_000, 2_000, 10_000, 10_000,
    ])
  })

  it('says still confirming after 60 s', () => {
    expect([isStillConfirming(59_999), isStillConfirming(60_000)]).toEqual([false, true])
  })
})
