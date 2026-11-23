import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { parseFinished, parseGoal } from './input'

describe('parseGoal', () => {
  it('takes a goal choice and a time zone', () => {
    expect(parseGoal({ minutes: 30, zone: 'Europe/Istanbul' })).toEqual({ minutes: 30, zone: 'Europe/Istanbul' })
    expect(parseGoal({ minutes: 5, zone: 'UTC' })).toEqual({ minutes: 5, zone: 'UTC' })
  })

  it('refuses a goal outside the choices, a bad zone, missing or extra fields, and anything else', () => {
    for (const value of [
      { minutes: 25, zone: 'UTC' },
      { minutes: '30', zone: 'UTC' },
      { minutes: 30, zone: 'Mars/Olympus' },
      { minutes: 30 },
      { zone: 'UTC' },
      { minutes: 30, zone: 'UTC', day: '2026-11-21' },
      [30, 'UTC'],
      null,
      'goal',
    ]) {
      expect(parseGoal(value)).toBeNull()
    }
  })
})

describe('parseFinished', () => {
  it('takes a catalogue or private slug and whether it is finished', () => {
    expect(parseFinished({ book: 'pride-and-prejudice', finished: true })).toEqual({
      book: 'pride-and-prejudice',
      finished: true,
    })
    const own = privateBookSlug('0f9b8c7e-1d2a-4b3c-8d4e-5f6a7b8c9d0e')
    expect(parseFinished({ book: own, finished: false })).toEqual({ book: own, finished: false })
  })

  it('refuses a bad slug, a non-boolean, missing or extra fields', () => {
    for (const value of [
      { book: '../etc', finished: true },
      { book: '', finished: true },
      { book: 'emma', finished: 'yes' },
      { book: 'emma' },
      { finished: true },
      { book: 'emma', finished: true, title: 'Emma' },
      null,
    ]) {
      expect(parseFinished(value)).toBeNull()
    }
  })
})
