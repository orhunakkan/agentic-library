import { describe, expect, it } from 'vitest'
import { BAD_ISBN, IMPORT_PROBLEM_TEXT, importSaveText, PICTURE_FAILED, SAVE_FAILED } from './import-problems'

describe('the importer’s save problems', () => {
  it('says the book limit and the hourly limit with their numbers', () => {
    expect(IMPORT_PROBLEM_TEXT.quota).toBe('You have 25 of your own books. Delete one to import another.')
    expect(IMPORT_PROBLEM_TEXT.rate).toBe('You’ve imported 10 books in the last hour. Try again later.')
  })

  it('says every other problem in plain words', () => {
    expect(IMPORT_PROBLEM_TEXT).toMatchObject({
      'quota-user':
        'This book’s pictures no longer fit the room left in your library. Choose the file again to review it.',
      'book-too-large': 'This book is over 8 MB of text, the most a book can hold. Drop some chapters and try again.',
      'request-too-large': 'A chapter is too long to upload. Drop it, or merge less into it, and try again.',
      'too-long': 'Part of this book is longer than the importer allows. Drop the chapter it is in and try again.',
      empty: 'A chapter has no text the reader can show. Drop it and try again.',
      invalid: 'The book couldn’t be saved as it is. Check the title, author and language, then try again.',
      'signed-out': 'You’ve been signed out. Sign in again, then import the book again.',
      'not-found': 'The import was interrupted. Try again.',
      incomplete: 'The import was interrupted. Try again.',
      failed: 'Something went wrong while saving. Try again in a few minutes.',
    })
    expect(Object.keys(IMPORT_PROBLEM_TEXT)).toHaveLength(12)
  })

  it('falls back to the general failure, and names a refused picture', () => {
    expect(SAVE_FAILED).toBe('Something went wrong while saving. Try again in a few minutes.')
    expect(PICTURE_FAILED).toBe(
      'A picture couldn’t be saved, so the book wasn’t imported. Try again, or tell the owner if it keeps happening.',
    )
  })

  it('says why a book can’t be saved before anything is sent', () => {
    expect(importSaveText({ ok: false, problem: 'none' })).toBe('Keep at least one chapter.')
    expect(importSaveText({ ok: false, problem: 'too-many' })).toBe(
      'A book can have at most 1000 chapters. Merge some first.',
    )
    expect(importSaveText({ ok: false, problem: 'oversized' })).toBe(
      'A chapter is too long to upload. Drop it, or merge less into it, and try again.',
    )
    expect(BAD_ISBN).toBe('Not a valid ISBN.')
  })

  it('says what stopped a save, by the step', () => {
    const refused = (problem: string) => ({ ok: false as const, problem: problem as 'rate' })
    expect(importSaveText({ ok: false, at: 'start', refused: refused('rate') })).toBe(IMPORT_PROBLEM_TEXT.rate)
    expect(importSaveText({ ok: false, at: 'start', refused: refused('quota') })).toBe(IMPORT_PROBLEM_TEXT.quota)
    expect(importSaveText({ ok: false, at: 'picture', problem: 'type' })).toBe(PICTURE_FAILED)
    expect(importSaveText({ ok: false, at: 'picture', problem: 'failed' })).toBe(PICTURE_FAILED)
    expect(importSaveText({ ok: false, at: 'chapter', problem: 'empty' })).toBe(IMPORT_PROBLEM_TEXT.empty)
    expect(importSaveText({ ok: false, at: 'chapter', problem: 'signed-out' })).toBe(
      'You’ve been signed out. Sign in again, then import the book again.',
    )
    expect(importSaveText({ ok: false, at: 'finish', problem: 'incomplete' })).toBe(
      'The import was interrupted. Try again.',
    )
    expect(importSaveText({ ok: false, at: 'finish', problem: 'failed' })).toBe(SAVE_FAILED)
  })

  it('falls back to the general failure for a code it doesn’t know', () => {
    const unknown = 'teapot' as 'failed'
    expect(importSaveText({ ok: false, at: 'start', refused: { ok: false, problem: unknown } })).toBe(SAVE_FAILED)
    expect(importSaveText({ ok: false, at: 'chapter', problem: unknown })).toBe(SAVE_FAILED)
  })
})
