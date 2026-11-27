import { describe, expect, it } from 'vitest'
import {
  API_KEY_LIMIT,
  ASK_LIMIT,
  blockedUntil,
  charactersRetryAt,
  IMPORT_LIMIT,
  IP_LIMIT,
  lookback,
  nextAllowedAt,
  overLimit,
  PASSKEY_CHALLENGE_LIMIT,
  SPEECH_LIMIT,
  USERNAME_LIMIT,
} from '~/server/rate-limit'

const T0 = new Date('2026-11-03T12:00:00Z').getTime()
const at = (minutes: number) => new Date(T0 + minutes * 60_000)

describe('username lock: 5 failures within 15 minutes lock it for 15 minutes', () => {
  it('locks at the fifth failure and unlocks 15 minutes after it', () => {
    const failures = [0, 1, 2, 3, 4].map(at)
    expect(blockedUntil(failures.slice(0, 4), USERNAME_LIMIT, at(4))).toBeNull()
    expect(blockedUntil(failures, USERNAME_LIMIT, at(4))).toEqual(at(19))
    expect(blockedUntil(failures, USERNAME_LIMIT, at(18.9))).toEqual(at(19))
    expect(blockedUntil(failures, USERNAME_LIMIT, at(19))).toBeNull()
  })

  it('does not lock when the five failures are spread over more than 15 minutes', () => {
    expect(blockedUntil([0, 4, 8, 12, 16].map(at), USERNAME_LIMIT, at(16))).toBeNull()
    expect(blockedUntil([0, 4, 8, 12, 15].map(at), USERNAME_LIMIT, at(15))).toEqual(at(30))
  })

  it('takes the latest lock when several windows qualify, in any order', () => {
    expect(blockedUntil([6, 0, 2, 4, 1, 3].map(at), USERNAME_LIMIT, at(6))).toEqual(at(21))
  })

  it('needs rows from one window plus one block period back', () => {
    expect(lookback(USERNAME_LIMIT)).toBe(30 * 60_000)
  })
})

describe('IP block: 30 failures within 15 minutes', () => {
  it('blocks at the thirtieth failure', () => {
    const failures = Array.from({ length: 30 }, (_, i) => at(i * 0.4))
    expect(blockedUntil(failures.slice(0, 29), IP_LIMIT, at(12))).toBeNull()
    expect(blockedUntil(failures, IP_LIMIT, at(12))).toEqual(new Date(at(11.6).getTime() + 15 * 60_000))
  })
})

describe('passkey sign-in challenges: 30 from one IP within 15 minutes', () => {
  it('refuses the thirty-first and frees up as the oldest ages out', () => {
    const times = Array.from({ length: 30 }, (_, i) => at(i * 0.4))
    expect(overLimit(times.slice(0, 29), PASSKEY_CHALLENGE_LIMIT, at(12))).toBe(false)
    expect(overLimit(times, PASSKEY_CHALLENGE_LIMIT, at(12))).toBe(true)
    expect(overLimit(times, PASSKEY_CHALLENGE_LIMIT, at(15))).toBe(false)
  })
})

describe('API-key changes: 10 an hour', () => {
  it('refuses the eleventh within the trailing hour', () => {
    const times = Array.from({ length: 10 }, (_, i) => at(i))
    expect(overLimit(times.slice(0, 9), API_KEY_LIMIT, at(10))).toBe(false)
    expect(overLimit(times, API_KEY_LIMIT, at(10))).toBe(true)
    expect(overLimit(times, API_KEY_LIMIT, at(60.5))).toBe(false)
  })
})

describe('private book imports: 10 an hour', () => {
  it('refuses the eleventh within the trailing hour and frees up as the oldest ages out', () => {
    const times = Array.from({ length: 10 }, (_, i) => at(i * 5))
    expect(overLimit(times.slice(0, 9), IMPORT_LIMIT, at(46))).toBe(false)
    expect(overLimit(times, IMPORT_LIMIT, at(46))).toBe(true)
    expect(overLimit(times, IMPORT_LIMIT, at(59.9))).toBe(true)
    expect(overLimit(times, IMPORT_LIMIT, at(60))).toBe(false)
    expect(lookback(IMPORT_LIMIT)).toBe(60 * 60_000)
  })
})

describe('Ask the book: 60 questions an hour', () => {
  it('says when the next question is allowed: when the oldest in the window turns an hour old', () => {
    const times = Array.from({ length: 60 }, (_, i) => at(i))
    expect(nextAllowedAt(times.slice(0, 59), ASK_LIMIT, at(59.5))).toBeNull()
    expect(nextAllowedAt(times, ASK_LIMIT, at(59.5))).toEqual(at(60))
    expect(nextAllowedAt(times, ASK_LIMIT, at(60))).toBeNull()
    expect(overLimit(times, ASK_LIMIT, at(59.5))).toBe(true)
  })

  it('counts only the questions inside the window, in any order', () => {
    const times = [at(-30), ...Array.from({ length: 60 }, (_, i) => at(60 - i))]
    expect(nextAllowedAt(times, ASK_LIMIT, at(70))).toBeNull()
    expect(nextAllowedAt(times, ASK_LIMIT, at(60.5))).toEqual(at(61))
  })
})

describe('read aloud with ElevenLabs: 150,000 characters an hour', () => {
  const minute = (m: number, characters: number) => ({ minute: at(m), characters })

  it('lets characters through while they fit, counting only the minutes inside the hour', () => {
    expect(SPEECH_LIMIT).toEqual({ max: 150_000, windowMs: 60 * 60_000, blockMs: 0 })
    expect(charactersRetryAt([], 200, SPEECH_LIMIT, at(0))).toBeNull()
    expect(charactersRetryAt([minute(0, 149_800)], 200, SPEECH_LIMIT, at(30))).toBeNull()
    expect(charactersRetryAt([minute(-61, 150_000)], 200, SPEECH_LIMIT, at(0))).toBeNull()
    expect(charactersRetryAt([minute(-60, 150_000)], 200, SPEECH_LIMIT, at(0))).toEqual(at(1))
  })

  it('says when enough of the oldest minutes leave the window, in any order', () => {
    const minutes = [minute(20, 50_000), minute(10, 50_000), minute(30, 50_000)]
    expect(charactersRetryAt(minutes, 1, SPEECH_LIMIT, at(40))).toEqual(at(71))
    expect(charactersRetryAt([...minutes, minute(35, 60_000)], 1, SPEECH_LIMIT, at(40))).toEqual(at(81))
  })

  it('waits a whole hour for more than the limit in one go', () => {
    expect(charactersRetryAt([], 150_001, SPEECH_LIMIT, at(0))).toEqual(at(60))
  })
})
