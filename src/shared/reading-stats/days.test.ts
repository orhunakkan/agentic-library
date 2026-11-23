import { describe, expect, it } from 'vitest'
import { addDays, dayIn, daysBetween, isDay, isTimeZone, weekdayOf } from './days'

describe('dayIn', () => {
  it('reads the date in UTC', () => {
    expect(dayIn(new Date('2026-11-21T23:59:59Z'), 'UTC')).toBe('2026-11-21')
    expect(dayIn(new Date('2026-11-22T00:00:00Z'), 'UTC')).toBe('2026-11-22')
  })

  it('reads the date either side of local midnight in Los Angeles, Kiritimati and Kolkata', () => {
    expect(dayIn(new Date('2026-11-22T07:59:00Z'), 'America/Los_Angeles')).toBe('2026-11-21')
    expect(dayIn(new Date('2026-11-22T08:00:00Z'), 'America/Los_Angeles')).toBe('2026-11-22')
    expect(dayIn(new Date('2026-11-21T09:59:00Z'), 'Pacific/Kiritimati')).toBe('2026-11-21')
    expect(dayIn(new Date('2026-11-21T10:00:00Z'), 'Pacific/Kiritimati')).toBe('2026-11-22')
    expect(dayIn(new Date('2026-11-21T18:29:00Z'), 'Asia/Kolkata')).toBe('2026-11-21')
    expect(dayIn(new Date('2026-11-21T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-11-22')
  })
})

describe('addDays and daysBetween', () => {
  it('step over a daylight-saving change without moving a date', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })

  it('cross a month end, a year end and 29 February 2028', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2026-11-21', '2026-11-14')).toBe(-7)
  })

  it('give the weekday', () => {
    expect(weekdayOf('2026-11-21')).toBe(6)
    expect(weekdayOf('2026-11-22')).toBe(0)
  })
})

describe('isDay', () => {
  it('takes real dates written in full', () => {
    expect(isDay('2026-11-21')).toBe(true)
    expect(isDay('2028-02-29')).toBe(true)
  })

  it('refuses dates that don’t exist, short forms and other types', () => {
    expect(isDay('2026-02-30')).toBe(false)
    expect(isDay('2027-02-29')).toBe(false)
    expect(isDay('2026-13-01')).toBe(false)
    expect(isDay('2026-1-5')).toBe(false)
    expect(isDay('2026-11-21T00:00')).toBe(false)
    expect(isDay(20261121)).toBe(false)
    expect(isDay(null)).toBe(false)
  })
})

describe('isTimeZone', () => {
  it('accepts zones Intl knows', () => {
    expect(isTimeZone('Europe/Istanbul')).toBe(true)
    expect(isTimeZone('UTC')).toBe(true)
    expect(isTimeZone('America/Argentina/Buenos_Aires')).toBe(true)
    expect(isTimeZone('Etc/GMT+5')).toBe(true)
  })

  it('refuses unknown zones, long names, paths and other types', () => {
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone(`Europe/${'a'.repeat(58)}`)).toBe(false)
    expect(isTimeZone('../etc')).toBe(false)
    expect(isTimeZone('Europe/Istanbul ')).toBe(false)
    expect(isTimeZone('')).toBe(false)
    expect(isTimeZone(3)).toBe(false)
  })
})
