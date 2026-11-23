import { describe, expect, it } from 'vitest'
import {
  bestLine,
  cardStreakLine,
  cardTodayLine,
  dayLabel,
  dayName,
  FINISHED_ERRORS,
  finishedCountLine,
  finishedDateLine,
  finishedToast,
  formatDuration,
  GOAL_ERRORS,
  goalChoiceLabel,
  goalSavedLine,
  streakLine,
  todayLine,
  totalsLine,
  unfinishedLine,
} from './stats-copy'

describe('formatDuration', () => {
  it('reads whole minutes, rounded down, and hours past 60', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(59)).toBe('0 min')
    expect(formatDuration(60)).toBe('1 min')
    expect(formatDuration(2_700)).toBe('45 min')
    expect(formatDuration(3_600)).toBe('1 h')
    expect(formatDuration(3_660)).toBe('1 h 1 min')
    expect(formatDuration(3_900)).toBe('1 h 5 min')
    expect(formatDuration(41 * 3_600 + 180)).toBe('41 h 3 min')
  })
})

describe('the today line', () => {
  it('counts against the goal until it is met', () => {
    expect(todayLine(0, 15, false)).toBe('0 of 15 minutes today')
    expect(todayLine(12 * 60 + 59, 15, false)).toBe('12 of 15 minutes today')
    expect(todayLine(15 * 60, 15, true)).toBe('15 minutes today · goal met')
    expect(todayLine(23 * 60, 15, true)).toBe('23 minutes today · goal met')
  })

  it('has a short form on the library card', () => {
    expect(cardTodayLine(0, 15, false)).toBe('Today: 0 of 15 min')
    expect(cardTodayLine(12 * 60, 15, false)).toBe('Today: 12 of 15 min')
    expect(cardTodayLine(23 * 60, 15, true)).toBe('Today: 23 min · goal met')
  })
})

describe('the streak lines', () => {
  it('invite a first streak, and say what keeps one going', () => {
    expect(streakLine(0, false, 900)).toBe('No streak yet. Meet your goal today to start one.')
    expect(streakLine(1, true, 0)).toBe('1-day streak')
    expect(streakLine(4, true, 0)).toBe('4-day streak')
    expect(streakLine(4, false, 180)).toBe('4-day streak. Read 3 more minutes today to keep it.')
    expect(streakLine(4, false, 30)).toBe('4-day streak. Read 1 more minute today to keep it.')
  })

  it('give the best from 1 day, and the card’s from 1', () => {
    expect(bestLine(0)).toBeNull()
    expect(bestLine(1)).toBe('Best: 1 day')
    expect(bestLine(12)).toBe('Best: 12 days')
    expect(cardStreakLine(0)).toBeNull()
    expect(cardStreakLine(1)).toBe('1-day streak')
    expect(cardStreakLine(4)).toBe('4-day streak')
  })
})

describe('the week', () => {
  it('labels each day, today as Today', () => {
    expect(dayLabel('2026-11-17', '2026-11-21')).toBe('Tue')
    expect(dayLabel('2026-11-21', '2026-11-21')).toBe('Today')
  })

  it('names each day with its minutes and whether it met the goal', () => {
    expect(dayName('2026-11-16', 23 * 60, true)).toBe('Monday 16 November: 23 minutes, goal met')
    expect(dayName('2026-11-16', 60, false)).toBe('Monday 16 November: 1 minute, goal not met')
    expect(dayName('2026-11-01', 0, false)).toBe('Sunday 1 November: no reading')
  })
})

describe('the totals', () => {
  it('leave listening out when there is none', () => {
    expect(totalsLine({ reading: 30 * 3_600, listening: 11 * 3_600 })).toBe('Reading 30 h · Listening 11 h')
    expect(totalsLine({ reading: 600, listening: 0 })).toBe('Reading 10 min')
    expect(totalsLine({ reading: 0, listening: 0 })).toBe('Reading 0 min')
  })
})

describe('finished books', () => {
  it('count the year’s', () => {
    expect(finishedCountLine(0)).toBe('No books finished this year yet.')
    expect(finishedCountLine(1)).toBe('1 book finished this year')
    expect(finishedCountLine(3)).toBe('3 books finished this year')
  })

  it('say when, with the year only for another year', () => {
    const now = new Date(2026, 10, 21, 12)
    expect(finishedDateLine(new Date(2026, 10, 3, 9).toISOString(), now)).toBe('Finished 3 November')
    expect(finishedDateLine(new Date(2025, 5, 30, 9).toISOString(), now)).toBe('Finished 30 June 2025')
  })

  it('toast a newly finished book, and confirm taking the mark off', () => {
    expect(finishedToast('Pride and Prejudice')).toBe('Finished Pride and Prejudice. It’s in your reading stats.')
    expect(unfinishedLine('Pride and Prejudice')).toBe('Pride and Prejudice is no longer marked finished.')
  })
})

describe('the goal', () => {
  it('labels each choice', () => {
    expect([5, 10, 15, 20, 30, 45, 60, 90, 120].map(goalChoiceLabel)).toEqual([
      '5 minutes',
      '10 minutes',
      '15 minutes',
      '20 minutes',
      '30 minutes',
      '45 minutes',
      '1 hour',
      '1 hour 30 minutes',
      '2 hours',
    ])
  })

  it('confirms a saved goal', () => {
    expect(goalSavedLine(30)).toBe('Saved. Your goal is 30 minutes a day from today.')
    expect(goalSavedLine(60)).toBe('Saved. Your goal is 1 hour a day from today.')
  })
})

describe('the errors', () => {
  it('have a sentence for every code', () => {
    expect(GOAL_ERRORS).toEqual({
      invalid: 'That goal isn’t one of the choices.',
      signed_out: 'Sign in again to change your goal.',
      failed: 'Couldn’t save your goal. Try again.',
    })
    expect(FINISHED_ERRORS).toEqual({
      not_found: 'That book isn’t in your library any more.',
      signed_out: 'Sign in again to change that.',
      invalid: 'Couldn’t change that. Try again.',
      failed: 'Couldn’t change that. Try again.',
    })
  })
})
